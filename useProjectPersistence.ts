import { useCallback, useEffect, useRef, useState } from 'react';
import { useMemo } from 'react';
import type { MediaAsset, PersistedAsset, ProjectState, SaveStatus } from '../types/editor';
import {
  buildProjectPackage,
  clearPersistedSession,
  flushSessionSync,
  detectMissingMedia,
  hasPersistedSession,
  loadPersistedSession,
  parseProjectPackage,
  persistSession,
  toPersistedAsset,
  relinkAssetFromFile,
} from '../core/persistence/projectIO';

export interface ProjectPersistenceApi {
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  /** True when a previous session left recoverable work at boot. */
  canRecoverAtBoot: boolean;
  sessionAvailable: boolean;
  missingAssets: PersistedAsset[];
  /** Assets referenced by the timeline with no resolvable binary. */
  missingCount: number;
  saveNow: () => Promise<void>;
  exportPackage: () => Promise<void>;
  importPackage: (file: File) => Promise<void>;
  recoverSession: () => Promise<boolean>;
  discardSession: () => void;
  relinkAsset: (assetId: string, file: File) => Promise<boolean>;
  clearMissing: () => void;
}

interface Options {
  project: ProjectState;
  assets: MediaAsset[];
  onProjectRestored: (project: ProjectState) => void;
  onAssetsRestored: (assets: MediaAsset[]) => void;
  onAssetUpdated: (asset: MediaAsset) => void;
  showToast: (message: string) => void;
}

const AUTOSAVE_DELAY_MS = 900;

export function useProjectPersistence({
  project,
  assets,
  onProjectRestored,
  onAssetsRestored,
  onAssetUpdated,
  showToast,
}: Options): ProjectPersistenceApi {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [sessionAvailable, setSessionAvailable] = useState<boolean>(() => hasPersistedSession());
  const [missingAssets, setMissingAssets] = useState<PersistedAsset[]>([]);

  const projectRef = useRef(project);
  const assetsRef = useRef(assets);
  projectRef.current = project;
  assetsRef.current = assets;
  const firstRun = useRef(true);
  const savingRef = useRef(false);
  // A session that already existed when the editor booted is recoverable work
  // from an interrupted session, not an autosave the user just made here.
  const bootHadSession = useRef(hasPersistedSession());

  const runSave = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveStatus('saving');
    const result = await persistSession(projectRef.current, assetsRef.current);
    savingRef.current = false;
    if (result.ok) {
      setSaveStatus('saved');
      setLastSavedAt(Date.now());
      setSessionAvailable(true);
    } else {
      setSaveStatus('error');
      showToast(result.error || 'Falha ao salvar a sessão.');
    }
  }, [showToast]);

  // Interrupted sessions must still be recoverable: flush synchronously when the
  // page is being hidden or closed, before the debounced autosave can run.
  useEffect(() => {
    const flush = () => flushSessionSync(projectRef.current, assetsRef.current);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  // Debounced autosave: never lose work, never block the UI.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setSaveStatus('dirty');
    const timer = window.setTimeout(() => {
      void runSave();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [project, assets, runSave]);

  const saveNow = useCallback(async () => {
    await runSave();
    showToast('Projeto salvo');
  }, [runSave, showToast]);

  const exportPackage = useCallback(async () => {
    try {
      const { blob, filename, omittedCount } = await buildProjectPackage(
        projectRef.current,
        assetsRef.current
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      showToast(
        omittedCount > 0
          ? `Pacote exportado — ${omittedCount} mídia(s) grande(s) ficaram de fora e exigirão relink.`
          : 'Pacote de projeto exportado com mídias incluídas'
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao exportar o pacote.');
    }
  }, [showToast]);

  const importPackage = useCallback(
    async (file: File) => {
      try {
        const result = await parseProjectPackage(file);
        onProjectRestored(result.project);
        onAssetsRestored(result.assets);
        setMissingAssets(result.missing);
        await runSave();
        if (result.missing.length > 0) {
          showToast(
            `${result.missing.length} mídia(s) precisam de relink — o projeto foi carregado preservando a timeline.`
          );
        } else {
          showToast('Pacote de projeto importado com sucesso');
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Arquivo de projeto inválido.');
      }
    },
    [onProjectRestored, onAssetsRestored, runSave, showToast]
  );

  const recoverSession = useCallback(async (): Promise<boolean> => {
    const session = await loadPersistedSession();
    if (!session) {
      setSessionAvailable(false);
      showToast('Nenhuma sessão recuperável foi encontrada.');
      return false;
    }
    onProjectRestored(session.project);
    if (session.assets.length > 0) onAssetsRestored(session.assets);
    setMissingAssets(session.missing);
    setSaveStatus('saved');
    setLastSavedAt(session.savedAt);
    showToast(
      session.missing.length > 0
        ? `Sessão recuperada — ${session.missing.length} mídia(s) precisam de relink.`
        : 'Sessão recuperada com sucesso'
    );
    return true;
  }, [onProjectRestored, onAssetsRestored, showToast]);

  const discardSession = useCallback(() => {
    clearPersistedSession();
    setSessionAvailable(false);
    setMissingAssets([]);
    showToast('Sessão salva descartada');
  }, [showToast]);

  const relinkAsset = useCallback(
    async (assetId: string, file: File): Promise<boolean> => {
      const existing = assetsRef.current.find((a) => a.id === assetId);
      if (!existing) {
        showToast('Mídia não encontrada para relink.');
        return false;
      }
      const updated = await relinkAssetFromFile(existing, file);
      if (!updated) {
        showToast(`"${file.name}" não pôde ser decodificado — escolha um arquivo compatível.`);
        return false;
      }
      onAssetUpdated(updated);
      setMissingAssets((prev) => {
        const next = prev.filter((item) => item.id !== assetId);
        const allResolved =
          detectMissingMedia(projectRef.current, [
            ...assetsRef.current.filter((a) => a.id !== assetId),
            updated,
          ]).length === 0;
        return allResolved ? [] : next;
      });
      showToast(`"${existing.name}" relinkado com sucesso`);
      void runSave();
      return true;
    },
    [onAssetUpdated, runSave, showToast]
  );

  const clearMissing = useCallback(() => setMissingAssets([]), []);

  // Missing media is the union of:
  //  - gaps found while importing/recovering a project (even unused media), and
  //  - anything the timeline references that no longer resolves right now.
  const detectedMissing = useMemo(() => {
    const byId = new Map<string, PersistedAsset>(missingAssets.map((item) => [item.id, item]));
    for (const id of detectMissingMedia(project, assets)) {
      if (byId.has(id)) continue;
      const asset = assets.find((item) => item.id === id);
      byId.set(id, asset ? toPersistedAsset(asset) : { id, name: id, type: 'video', duration: 0 });
    }
    return [...byId.values()];
  }, [project, assets, missingAssets]);

  return {
    saveStatus,
    lastSavedAt,
    canRecoverAtBoot: bootHadSession.current,
    sessionAvailable,
    missingAssets: detectedMissing,
    missingCount: detectedMissing.length,
    saveNow,
    exportPackage,
    importPackage,
    recoverSession,
    discardSession,
    relinkAsset,
    clearMissing,
  };
}
