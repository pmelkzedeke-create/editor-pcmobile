/**
 * Project I/O — versioned project persistence, recovery and portable packages.
 *
 * Design rules:
 *  - Project JSON stores asset *descriptors* only (id, name, type, size, waveform…).
 *  - Binary media lives in MediaBlobStore (IndexedDB). Base64 is used only inside
 *    portable packages, and only for assets under an explicit size budget.
 *  - Every load path validates and migrates the payload before it reaches the editor.
 *  - Missing media is never silently discarded: it is reported so the user can relink.
 */
import type {
  MediaAsset,
  PersistedAsset,
  ProjectState,
} from '../../types/editor';
import {
  PROJECT_SCHEMA_VERSION,
  syncActiveComposition,
  validateAndNormalizeProject,
} from '../compositions';
import { mediaStore } from './mediaStore';
export { registerAssetBlob } from './mediaStore';

/**
 * Studio audio beds are synthesized deterministically, so they can always be
 * rebuilt from their id + duration instead of being reported as lost media.
 */
const SYNTH_SAMPLE_KINDS: Record<string, 'cinema-pulse' | 'lofi-groove' | 'ambient-pad' | 'whoosh-sfx'> = {
  'sample-audio-cinema': 'cinema-pulse',
  'sample-audio-lofi': 'lofi-groove',
  'sample-audio-ambient': 'ambient-pad',
  'sample-sfx-whoosh': 'whoosh-sfx',
};

export const PROJECT_FILE_FORMAT = 'cinecorte-project';
export const PROJECT_FORMAT_VERSION = 3;
export const SESSION_STORAGE_KEY = 'cinecorte.session.v3';
export const LEGACY_SESSION_KEYS = ['cinecorte.project.autosave.v2'];
/** Per-asset budget for base64 embedding inside a portable package. */
export const EMBED_LIMIT_BYTES = 12 * 1024 * 1024;

export interface ProjectPackage {
  format: typeof PROJECT_FILE_FORMAT;
  formatVersion: number;
  savedAt: number;
  projectName: string;
  project: ProjectState;
  assets: PersistedAsset[];
  /** base64 payloads for assets under the embedding budget */
  media: Record<string, string>;
  /** assets intentionally not embedded (too large) — will require relinking */
  omitted: string[];
}

export interface LoadedSession {
  project: ProjectState;
  assets: MediaAsset[];
  missing: PersistedAsset[];
  savedAt: number;
}

export function toPersistedAsset(asset: MediaAsset): PersistedAsset {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    duration: asset.duration,
    width: asset.width,
    height: asset.height,
    size: asset.size,
    mimeType: asset.mimeType,
    storageKey: asset.storageKey || asset.id,
    ambientFX: asset.ambientFX,
    isSample: asset.isSample,
    thumbnail: asset.thumbnail,
    waveform: asset.waveform,
    envelope: asset.envelope,
  };
}

function fromPersistedAsset(meta: PersistedAsset, url: string, status: MediaAsset['status']): MediaAsset {
  return {
    id: meta.id,
    name: meta.name,
    type: meta.type,
    url,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    size: meta.size,
    mimeType: meta.mimeType,
    storageKey: meta.storageKey || meta.id,
    ambientFX: meta.ambientFX,
    isSample: meta.isSample,
    thumbnail: meta.thumbnail,
    waveform: meta.waveform,
    envelope: meta.envelope,
    status,
  };
}

function isSampleUrl(url: string): boolean {
  return typeof url === 'string' && (url.startsWith('/samples/') || url.startsWith('data:'));
}

/** Serializes the session (project + asset descriptors) and persists every blob. */
export async function persistSession(
  project: ProjectState,
  assets: MediaAsset[]
): Promise<{ ok: boolean; error?: string }> {
  try {
    const registry = assets.map(toPersistedAsset);
    for (const asset of assets) {
      if (asset.isSample || isSampleUrl(asset.url)) continue;
      const key = asset.storageKey || asset.id;
      // Blobs are written at ingestion time; here we only verify recoverability so
      // the descriptor survives even when the binary is gone (user can relink).
      if (!(await mediaStore.has(key))) asset.status = 'missing';
    }

    const payload = {
      format: PROJECT_FILE_FORMAT,
      formatVersion: PROJECT_FORMAT_VERSION,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      savedAt: Date.now(),
      project: { ...syncActiveComposition(project), assetRegistry: registry },
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
    // Legacy autosave key is cleared so recovery never restores a stale snapshot.
    LEGACY_SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Falha ao salvar a sessão: ${error.message}`
          : 'Falha ao salvar a sessão.',
    };
  }
}

/**
 * Synchronous best-effort flush used on `pagehide`/`beforeunload`: writes the
 * project + asset descriptors immediately so an interrupted session is always
 * recoverable, even when the async autosave debounce never got to run.
 */
export function flushSessionSync(project: ProjectState, assets: MediaAsset[]): void {
  try {
    const registry = assets.map(toPersistedAsset);
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        format: PROJECT_FILE_FORMAT,
        formatVersion: PROJECT_FORMAT_VERSION,
        schemaVersion: PROJECT_SCHEMA_VERSION,
        savedAt: Date.now(),
        project: { ...syncActiveComposition(project), assetRegistry: registry },
      })
    );
    LEGACY_SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage may be unavailable; the in-memory project is unaffected.
  }
}

/** Reads, migrates and validates a saved session, rehydrating blobs from the media store. */
export async function loadPersistedSession(): Promise<LoadedSession | null> {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    // Migrate the pre-v3 autosave (project only, no media) if that is all we have.
    const legacy = LEGACY_SESSION_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
    if (!legacy) return null;
    try {
      const parsed = JSON.parse(legacy) as { savedAt?: number; project?: unknown };
      const validated = validateAndNormalizeProject(parsed.project);
      if (!validated.project) return null;
      return {
        project: validated.project,
        assets: [],
        missing: [],
        savedAt: parsed.savedAt || Date.now(),
      };
    } catch {
      return null;
    }
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ProjectPackage> & {
      project?: unknown;
      savedAt?: number;
    };
    const validated = validateAndNormalizeProject(parsed.project);
    if (!validated.project) return null;

    const descriptors = Array.isArray(parsed.assets)
      ? parsed.assets
      : (validated.project.assetRegistry ?? []);
    const assets: MediaAsset[] = [];
    const missing: PersistedAsset[] = [];

    for (const meta of descriptors) {
      if (!meta || typeof meta.id !== 'string') continue;
      const resolved = await resolveDescriptor(meta);
      if (resolved.asset) assets.push(resolved.asset);
      else {
        missing.push(meta);
        assets.push(fromPersistedAsset(meta, '', 'missing'));
      }
    }

    return {
      project: { ...validated.project, assetRegistry: descriptors },
      assets,
      missing,
      savedAt: parsed.savedAt || Date.now(),
    };
  } catch {
    return null;
  }
}

export function hasPersistedSession(): boolean {
  return !!localStorage.getItem(SESSION_STORAGE_KEY) || LEGACY_SESSION_KEYS.some((key) => !!localStorage.getItem(key));
}

export function clearPersistedSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
  LEGACY_SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
}

async function resolveDescriptor(
  meta: PersistedAsset
): Promise<{ asset?: MediaAsset; missing?: PersistedAsset }> {
  const key = meta.storageKey || meta.id;
  if (meta.isSample && meta.thumbnail && isSampleUrl(meta.thumbnail)) {
    return { asset: fromPersistedAsset(meta, meta.thumbnail, 'ready') };
  }
  const blob = await mediaStore.get(key);
  if (blob) return { asset: fromPersistedAsset(meta, URL.createObjectURL(blob), 'ready') };

  // Deterministic synthesized samples are regenerated, never reported as missing.
  const kind = SYNTH_SAMPLE_KINDS[meta.id];
  if (kind) {
    const { synthesizeStudioAudio } = await import('../../utils/mediaHelpers');
    const synth = synthesizeStudioAudio(kind, meta.duration || 20);
    const asset = fromPersistedAsset(meta, synth.url, 'ready');
    asset.waveform = meta.waveform ?? synth.waveform;
    asset.envelope = meta.envelope ?? synth.envelope;
    return { asset };
  }
  return { missing: meta };
}

/** Rebuilds asset objects (and blob URLs) from descriptors stored in a project file. */
export async function rehydrateAssetsFromRegistry(
  registry: PersistedAsset[] | undefined
): Promise<{ assets: MediaAsset[]; missing: PersistedAsset[] }> {
  const assets: MediaAsset[] = [];
  const missing: PersistedAsset[] = [];
  for (const meta of registry ?? []) {
    if (!meta || typeof meta.id !== 'string') continue;
    const resolved = await resolveDescriptor(meta);
    if (resolved.asset) assets.push(resolved.asset);
    else {
      missing.push(meta);
      assets.push(fromPersistedAsset(meta, '', 'missing'));
    }
  }
  return { assets, missing };
}

/** Asset ids referenced by clips but without a usable binary source. */
export function detectMissingMedia(project: ProjectState, assets: MediaAsset[]): string[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const missing = new Set<string>();

  const scanClips = (clips: ProjectState['clips']) => {
    for (const clip of clips) {
      if (!clip.mediaId) continue;
      const asset = byId.get(clip.mediaId);
      if (!asset || asset.status === 'missing' || (!asset.url && !asset.isSample)) {
        missing.add(clip.mediaId);
      }
    }
  };

  scanClips(project.clips);
  for (const comp of project.compositions ?? []) scanClips(comp.clips);
  return [...missing];
}

/**
 * Replaces the binary of an existing asset while keeping its id, so timeline clips,
 * keyframes and effects stay linked. Returns the refreshed asset descriptor.
 */
export async function relinkAssetFromFile(
  existing: MediaAsset,
  file: File
): Promise<MediaAsset | null> {
  const { parseUploadedMediaFile } = await import('../../utils/mediaHelpers');
  const fresh = await parseUploadedMediaFile(file);
  if (!fresh) return null;
  const storageKey = existing.storageKey || existing.id;
  await mediaStore.put(storageKey, file);
  return {
    ...fresh,
    id: existing.id,
    storageKey,
    name: existing.name,
    status: 'ready',
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  // ArrayBuffer path keeps this usable in browser AND Node (tests), with no FileReader.
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

/**
 * Builds a portable project package (.ottoproj.json): project + asset descriptors +
 * base64 media under the size budget. Oversized media is listed in `omitted` so the
 * receiving machine reports it as missing and offers relinking — never silently dropped.
 */
export async function buildProjectPackage(
  project: ProjectState,
  assets: MediaAsset[],
  options?: { embedLimitBytes?: number }
): Promise<{ blob: Blob; filename: string; omittedCount: number }> {
  const limit = options?.embedLimitBytes ?? EMBED_LIMIT_BYTES;
  const registry = assets.map(toPersistedAsset);
  const media: Record<string, string> = {};
  const omitted: string[] = [];

  for (const asset of assets) {
    if (asset.isSample || isSampleUrl(asset.url)) continue;
    const key = asset.storageKey || asset.id;
    const blob = await mediaStore.get(key);
    if (!blob) {
      omitted.push(asset.id);
      continue;
    }
    if (blob.size > limit) {
      omitted.push(asset.id);
      continue;
    }
    try {
      media[asset.id] = await blobToBase64(blob);
    } catch {
      omitted.push(asset.id);
    }
  }

  const pkg: ProjectPackage = {
    format: PROJECT_FILE_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    savedAt: Date.now(),
    projectName: project.projectName,
    project: { ...syncActiveComposition(project), assetRegistry: registry },
    assets: registry,
    media,
    omitted,
  };

  const safeName =
    project.projectName.trim().toLowerCase().replace(/[^a-z0-9-_]+/gi, '-') || 'projeto';
  return {
    blob: new Blob([JSON.stringify(pkg)], { type: 'application/json' }),
    filename: `${safeName}.ottoproj.json`,
    omittedCount: omitted.length,
  };
}

export interface ImportResult {
  project: ProjectState;
  assets: MediaAsset[];
  missing: PersistedAsset[];
  warnings: string[];
}

/** Validates and rehydrates a portable package before it can reach the editor state. */
export async function parseProjectPackage(file: File): Promise<ImportResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error('O arquivo não contém JSON válido.');
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('O arquivo não contém um projeto válido.');
  }
  const pkg = raw as Partial<ProjectPackage>;
  if (pkg.format !== PROJECT_FILE_FORMAT && !(pkg as { project?: unknown }).project) {
    throw new Error('Formato de projeto desconhecido.');
  }
  const validated = validateAndNormalizeProject(pkg.project);
  if (!validated.project) {
    throw new Error('Estrutura de projeto inválida: faltam faixas ou clipes.');
  }

  const descriptors = Array.isArray(pkg.assets)
    ? pkg.assets
    : (validated.project.assetRegistry ?? []);
  const mediaTable = pkg.media ?? {};
  const omitted = new Set(pkg.omitted ?? []);
  const assets: MediaAsset[] = [];
  const missing: PersistedAsset[] = [];
  const warnings: string[] = [];

  for (const meta of descriptors) {
    if (!meta || typeof meta.id !== 'string') continue;
    const key = meta.storageKey || meta.id;
    const embedded = mediaTable[meta.id];
    if (embedded) {
      const blob = base64ToBlob(embedded, meta.mimeType || 'application/octet-stream');
      await mediaStore.put(key, blob);
      assets.push(fromPersistedAsset(meta, URL.createObjectURL(blob), 'ready'));
      continue;
    }
    const resolved = await resolveDescriptor(meta);
    if (resolved.asset) {
      assets.push(resolved.asset);
      continue;
    }
    missing.push(meta);
    assets.push(fromPersistedAsset(meta, '', 'missing'));
    warnings.push(
      omitted.has(meta.id)
        ? `"${meta.name}" não foi embutido (arquivo grande demais) — será necessário relinkar.`
        : `"${meta.name}" não está disponível neste dispositivo — será necessário relinkar.`
    );
  }

  return {
    project: { ...validated.project, assetRegistry: descriptors },
    assets,
    missing,
    warnings,
  };
}
