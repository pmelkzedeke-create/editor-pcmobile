import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { RotateCcw } from 'lucide-react';
import { CanvasPreview } from './components/CanvasPreview';
import { MediaLoadingModal, type MediaLoadingState } from './components/MediaLoadingModal';
import {
  CommandPaletteModal,
  CompositionSettingsModal,
  PaletteCommand,
} from './components/CommandPalette';
import { InspectorPanel } from './components/InspectorPanel';
import { MediaSidebar } from './components/MediaSidebar';
import { MobileActionBar } from './components/mobile/MobileActionBar';
import { MobileBottomSheet } from './components/mobile/MobileBottomSheet';
import { MissingMediaModal } from './components/MissingMediaModal';
import { ExportModal, ShortcutsModal } from './components/Modals';
import { GraphDrawerTab, TimelinePanel } from './components/TimelinePanel';
import { TopBar } from './components/TopBar';
import { buildBeatMarkersForClip, decodeAudioAssetEnvelope } from './core/audioAnalysis';
import {
  createNewComposition,
  getProjectDimensions,
  precomposeClips,
  switchActiveComposition,
  syncActiveComposition,
  validateAndNormalizeProject,
} from './core/compositions';
import {
  rehydrateAssetsFromRegistry,
  toPersistedAsset,
} from './core/persistence/projectIO';
import { slicePropertyTracks } from './core/keyframes';
import { createDefaultMask, createDefaultShapeData } from './core/shapesAndMasks';
import { useResponsiveLayout, type MobileDrawer } from './hooks/useResponsiveLayout';
import { usePreviewRender } from './hooks/usePreviewRender';
import { useProjectPersistence } from './hooks/useProjectPersistence';
import {
  AspectRatioKey,
  ClipEffect,
  ColorAdjustments,
  LeftSidebarTab,
  MediaAsset,
  PreviewResolution,
  ProjectState,
  PropertyTrack,
  SavedMotionPreset,
  StudioTheme,
  TimelineClip,
  Track,
  TrackType,
  TransitionType,
  VectorShapeKind,
  WorkArea,
} from './types/editor';
import {
  MediaElementPool,
  renderFrameToCanvas,
  syncMediaPlayback,
} from './utils/compositor';
import { buildInitialWorkspace } from './utils/initialProject';
import {
  createClipFromAsset,
  DEFAULT_FILTERS,
  formatTimecode,
  parseUploadedMediaFile,
  TextPresetItem,
  uid,
} from './utils/mediaHelpers';
import { createEffect } from './utils/sapphireEffects';
import type { EffectPreset } from './utils/sapphireEffects';
import { clamp, getClipSourceTime, sliceTimeRemap } from './utils/timeRemap';

const MAX_HISTORY = 40;

export function App() {
  const initialData = useMemo(() => {
    const built = buildInitialWorkspace();
    return {
      assets: built.assets,
      project: syncActiveComposition(built.project),
    };
  }, []);

  const [assets, setAssets] = useState<MediaAsset[]>(initialData.assets);
  const [project, setProject] = useState<ProjectState>(initialData.project);
  const projectRef = useRef(initialData.project);
  const setProjectLive = useCallback(
    (update: ProjectState | ((prev: ProjectState) => ProjectState)) => {
      const rawNext = typeof update === 'function' ? update(projectRef.current) : update;
      const synced = syncActiveComposition(rawNext);
      projectRef.current = synced;
      setProject(synced);
    },
    []
  );

  // Undo / Redo history stacks
  const [past, setPast] = useState<ProjectState[]>([]);
  const [future, setFuture] = useState<ProjectState[]>([]);
  const pastRef = useRef<ProjectState[]>([]);
  const futureRef = useRef<ProjectState[]>([]);
  const lastCommittedRef = useRef<ProjectState>(initialData.project);

  // Playback & Workspace UI State
  const [currentTime, setCurrentTime] = useState<number>(0.9);
  const playheadRef = useRef(0.9);
  const [previewResolution, setPreviewResolution] = useState<PreviewResolution>(2);
  const [graphOpen, setGraphOpen] = useState(false);
  const [graphTab, setGraphTab] = useState<GraphDrawerTab>('remap');
  const [copiedTrack, setCopiedTrack] = useState<PropertyTrack | null>(null);
  const [effectsFocusToken, setEffectsFocusToken] = useState(0);
  const [propertyFocus, setPropertyFocus] = useState<{ prop: string; nonce: number }>({
    prop: '',
    nonce: 0,
  });
  const layout = useResponsiveLayout();
  const compactUI = !layout.isDesktop; // phone + tablet use bottom bar + sheets
  const phoneLandscape = layout.isMobile && layout.isLandscape;
  const [focusMonitor, setFocusMonitor] = useState(false);
  const [playAreaOnly, setPlayAreaOnly] = useState(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [masterMuted, setMasterMuted] = useState<boolean>(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>('clip-v1-1');
  const [activeTab, setActiveTab] = useState<LeftSidebarTab>('media');
  const [zoomPxPerSec, setZoomPxPerSec] = useState<number>(52);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [visionBusy, setVisionBusy] = useState(false);
  const [theme, setTheme] = useState<StudioTheme>('dark');
  const [liveFps, setLiveFps] = useState<number>(60);

  // Modals & Notifications
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [showCompSettings, setShowCompSettings] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showRecoveryBanner, setShowRecoveryBanner] = useState<boolean>(true);

  // Live Camera / Screen Recorder State
  const [isRecordingSource, setIsRecordingSource] = useState<'camera' | 'screen' | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const [mediaLoading, setMediaLoading] = useState<MediaLoadingState | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  // Shared media pool
  const mediaPoolRef = useRef<MediaElementPool>(new MediaElementPool());

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2600);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Live UI FPS telemetry & debounced Autosave
  useEffect(() => {
    let frames = 0;
    let lastStamp = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      frames++;
      if (now - lastStamp >= 1000) {
        setLiveFps(Math.min(60, Math.round((frames * 1000) / (now - lastStamp))));
        frames = 0;
        lastStamp = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const assetsMap = useMemo(
    () => new Map(assets.map((a) => [a.id, a])),
    [assets]
  );

  const totalDuration = useMemo(() => {
    if (project.clips.length === 0) return 10;
    return Math.max(
      1,
      ...project.clips.map((c) => Number((c.startTime + c.duration).toFixed(2)))
    );
  }, [project.clips]);

  const selectedClip = useMemo(
    () => project.clips.find((c) => c.id === selectedClipId) || null,
    [project.clips, selectedClipId]
  );

  const workArea = useMemo<WorkArea>(() => {
    const start = clamp(
      project.workArea?.start || 0,
      0,
      Math.max(0, totalDuration - 1 / project.fps)
    );
    return {
      start,
      end: clamp(project.workArea?.end ?? totalDuration, start + 1 / project.fps, totalDuration),
    };
  }, [project.workArea, project.fps, totalDuration]);

  const preview = usePreviewRender(project, assetsMap, previewResolution, {
    currentTime,
    duration: totalDuration,
    playing: isPlaying,
    suspended: showExportModal || visionBusy,
  });

  const pushHistory = useCallback((snapshot: ProjectState) => {
    pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), snapshot];
    futureRef.current = [];
    setPast(pastRef.current);
    setFuture([]);
  }, []);

  const applyProjectChange = useCallback(
    (updater: (prev: ProjectState) => ProjectState) => {
      const prev = projectRef.current;
      const next = syncActiveComposition(updater(prev));
      if (next === prev) return;
      pushHistory(lastCommittedRef.current);
      lastCommittedRef.current = next;
      setProjectLive(next);
    },
    [pushHistory, setProjectLive]
  );

  const handleUpdateClipLive = useCallback(
    (clipId: string, patch: Partial<TimelineClip>) => {
      const previous = projectRef.current;
      const target = previous.clips.find((clip) => clip.id === clipId);
      if (!target || previous.tracks.find((track) => track.id === target.trackId)?.locked) return;
      setProjectLive({
        ...previous,
        clips: previous.clips.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)),
      });
    },
    [setProjectLive]
  );

  const handleCommitHistory = useCallback(() => {
    if (projectRef.current === lastCommittedRef.current) return;
    pushHistory(lastCommittedRef.current);
    lastCommittedRef.current = projectRef.current;
  }, [pushHistory]);

  // Project persistence: debounced autosave, recovery, portable packages and relink.
  const persistence = useProjectPersistence({
    project,
    assets,
    onProjectRestored: (restored) => {
      applyProjectChange(() => restored);
      setCurrentTime(0);
      playheadRef.current = 0;
      setIsPlaying(false);
      setSelectedClipId(restored.clips.find((clip) => clip.type !== 'audio')?.id || null);
    },
    onAssetsRestored: (restoredAssets) => setAssets(restoredAssets),
    onAssetUpdated: (updated) =>
      setAssets((prev) => prev.map((asset) => (asset.id === updated.id ? updated : asset))),
    showToast,
  });

  const handleUndo = useCallback(() => {
    const snapshot = pastRef.current[pastRef.current.length - 1];
    if (!snapshot) return;
    futureRef.current = [projectRef.current, ...futureRef.current];
    pastRef.current = pastRef.current.slice(0, -1);
    setPast(pastRef.current);
    setFuture(futureRef.current);
    lastCommittedRef.current = snapshot;
    setProjectLive(snapshot);
    showToast('Ação desfeita');
  }, [setProjectLive, showToast]);

  const handleRedo = useCallback(() => {
    const snapshot = futureRef.current[0];
    if (!snapshot) return;
    pastRef.current = [...pastRef.current, projectRef.current];
    futureRef.current = futureRef.current.slice(1);
    setPast(pastRef.current);
    setFuture(futureRef.current);
    lastCommittedRef.current = snapshot;
    setProjectLive(snapshot);
    showToast('Ação refeita');
  }, [setProjectLive, showToast]);

  const seekTo = useCallback(
    (time: number) => {
      const next = clamp(Math.round(time * project.fps) / project.fps, 0, totalDuration);
      playheadRef.current = next;
      setCurrentTime(next);
      setIsPlaying(false);
    },
    [project.fps, totalDuration]
  );

  useEffect(() => {
    if (playheadRef.current > totalDuration) seekTo(Math.max(0, totalDuration - 1 / project.fps));
  }, [totalDuration, project.fps, seekTo]);

  const togglePlay = useCallback(() => {
    setPlayAreaOnly(false);
    if (!isPlaying && playheadRef.current >= totalDuration - 0.5 / project.fps) {
      playheadRef.current = 0;
      setCurrentTime(0);
    }
    setIsPlaying((value) => !value);
  }, [isPlaying, totalDuration, project.fps]);

  const playWorkArea = useCallback(() => {
    if (isPlaying && playAreaOnly) {
      setIsPlaying(false);
      return;
    }
    playheadRef.current = workArea.start;
    setCurrentTime(workArea.start);
    setPlayAreaOnly(true);
    setIsPlaying(true);
    preview.cache.prefetch(workArea.start);
  }, [isPlaying, playAreaOnly, workArea, preview.cache]);

  const renderPreview = useCallback(() => {
    if (preview.state.status === 'rendering') {
      preview.cancel();
      return;
    }
    setIsPlaying(false);
    void preview.render(workArea);
  }, [preview.render, preview.cancel, preview.state.status, workArea]);

  const setAreaBoundary = useCallback(
    (boundary: 'start' | 'end') => {
      const value = playheadRef.current;
      applyProjectChange((prev) => ({
        ...prev,
        workArea:
          boundary === 'start'
            ? { start: clamp(value, 0, workArea.end - 1 / project.fps), end: workArea.end }
            : {
                start: workArea.start,
                end: clamp(value, workArea.start + 1 / project.fps, totalDuration),
              },
      }));
    },
    [applyProjectChange, workArea, project.fps, totalDuration]
  );

  useEffect(() => {
    const activeIds = new Set(project.clips.map((c) => c.id));
    mediaPoolRef.current.cleanupMissingClips(activeIds);
  }, [project.clips]);

  const effectiveTracks = useMemo<Track[]>(() => {
    const anySolo = project.tracks.some((track) => track.solo);
    return project.tracks.map((track) => ({
      ...track,
      muted: masterMuted || track.muted || (anySolo && !track.solo),
      hidden: track.hidden || (anySolo && !track.solo && track.type !== 'audio'),
    }));
  }, [project.tracks, masterMuted]);

  useEffect(() => {
    syncMediaPlayback(
      mediaPoolRef.current,
      effectiveTracks,
      project.clips,
      assetsMap,
      currentTime,
      isPlaying,
      preview.cache.has(currentTime)
    );
  }, [isPlaying, effectiveTracks, project.clips, assetsMap, currentTime, preview.cache]);

  useEffect(() => {
    if (!isPlaying) {
      mediaPoolRef.current.pauseAll();
      return;
    }
    let rafId = 0;
    let startWall = performance.now();
    let startTime = playheadRef.current;
    let lastFrame = -1;
    const start = playAreaOnly ? workArea.start : 0;
    const end = playAreaOnly ? workArea.end : totalDuration;
    const tick = (now: number) => {
      let time = startTime + (now - startWall) / 1000;
      if (time >= end) {
        if (!isLooping) {
          playheadRef.current = Math.max(start, end - 1 / project.fps);
          setCurrentTime(playheadRef.current);
          setIsPlaying(false);
          return;
        }
        time = start;
        startTime = start;
        startWall = now;
      }
      const frame = Math.floor(time * project.fps + 1e-5);
      if (frame !== lastFrame) {
        lastFrame = frame;
        playheadRef.current = frame / project.fps;
        setCurrentTime(playheadRef.current);
        preview.cache.prefetch(playheadRef.current);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    isPlaying,
    isLooping,
    playAreaOnly,
    workArea.start,
    workArea.end,
    totalDuration,
    project.fps,
    preview.cache,
  ]);

  // Upload Local Media Files with animated progress, real stages and cancellation
  const handleUploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      const parsed: MediaAsset[] = [];
      let cancelled = false;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }
        setMediaLoading({
          active: true,
          filename: file.name,
          sizeBytes: file.size,
          stage: files.length > 1 ? `Arquivo ${i + 1} de ${files.length} • Iniciando...` : 'Iniciando leitura...',
          percent: 2,
          cancel: () => controller.abort(),
        });
        // Yield so the loading animation paints before heavy decode work
        await new Promise((r) => setTimeout(r, 30));

        try {
          const asset = await parseUploadedMediaFile(file, {
            signal: controller.signal,
            onProgress: (p) =>
              setMediaLoading((prev) =>
                prev
                  ? {
                      ...prev,
                      stage:
                        files.length > 1
                          ? `Arquivo ${i + 1} de ${files.length} • ${p.stage}`
                          : p.stage,
                      percent: p.percent,
                    }
                  : prev
              ),
          });
          if (asset) {
            if (asset.type === 'audio') {
              try {
                setMediaLoading((prev) => (prev ? { ...prev, stage: 'Analisando batidas do áudio...', percent: 92 } : prev));
                asset.envelope = await decodeAudioAssetEnvelope(asset.url);
              } catch {
                // ignore envelope fallback
              }
            }
            parsed.push(asset);
          } else if (!controller.signal.aborted) {
            setMediaLoading({
              active: false,
              filename: file.name,
              sizeBytes: file.size,
              stage: '',
              percent: 0,
              error: `"${file.name}" usa um formato incompatível ou está corrompido. Formatos aceitos: MP4, WebM, MOV, PNG, JPG, SVG, MP3, WAV, GLB, GLTF e Lottie JSON.`,
            });
            return;
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            cancelled = true;
            break;
          }
          setMediaLoading({
            active: false,
            filename: file.name,
            sizeBytes: file.size,
            stage: '',
            percent: 0,
            error: err instanceof Error ? err.message : 'Falha ao processar o arquivo.',
          });
          return;
        }
      }

      uploadAbortRef.current = null;
      setMediaLoading(null);
      if (cancelled) {
        showToast('Importação cancelada pelo usuário');
        if (parsed.length > 0) setAssets((prev) => [...parsed, ...prev]);
        return;
      }
      if (parsed.length > 0) {
        setAssets((prev) => [...parsed, ...prev]);
        showToast(`${parsed.length} arquivo(s) importado(s) com sucesso`);
      } else {
        showToast('Formato de arquivo incompatível ou corrompido');
      }
    },
    [showToast]
  );

  // Add Vector Shape Layer (`rect`, `ellipse`, `polygon`, `star`, `line`, `path`)
  const handleAddShapeLayer = useCallback(
    (kind: VectorShapeKind) => {
      applyProjectChange((prev) => {
        let shapeTrack = prev.tracks.find((t) => t.type === 'shape' && !t.locked);
        let tracks = prev.tracks;
        if (!shapeTrack) {
          shapeTrack = {
            id: uid('track-s'),
            name: 'S1 • Formas Vetoriais',
            type: 'shape',
            muted: false,
            hidden: false,
            locked: false,
          };
          tracks = [shapeTrack, ...prev.tracks];
        }
        const names: Record<VectorShapeKind, string> = {
          rect: 'Retângulo',
          ellipse: 'Elipse',
          polygon: 'Polígono',
          star: 'Estrela',
          line: 'Linha',
          path: 'Curva Bézier',
        };
        const newClip: TimelineClip = {
          id: uid('clip-shape'),
          trackId: shapeTrack.id,
          type: 'shape',
          name: `Forma • ${names[kind]}`,
          startTime: Number(playheadRef.current.toFixed(2)),
          duration: 5.0,
          trimStart: 0,
          maxDuration: 300,
          x: 0,
          y: 0,
          scale: 100,
          rotation: 0,
          opacity: 100,
          flipH: false,
          flipV: false,
          fitMode: 'contain',
          speed: 1,
          motionPreset: 'none',
          filters: { ...DEFAULT_FILTERS },
          transitionIn: 'fade',
          transitionInDuration: 0.25,
          transitionOut: 'fade',
          transitionOutDuration: 0.25,
          volume: 0,
          muted: true,
          fadeIn: 0,
          fadeOut: 0,
          shapeData: createDefaultShapeData(kind),
        };
        setSelectedClipId(newClip.id);
        return { ...prev, tracks, clips: [...prev.clips, newClip] };
      });
      showToast('Camada de forma vetorial criada');
    },
    [applyProjectChange, showToast]
  );

  // Add Solid, Adjustment, Null, 3D Model, Camera or Light Layer
  const handleAddSpecialLayer = useCallback(
    (kind: 'solid' | 'adjustment' | 'null' | 'model3d' | 'camera' | 'light') => {
      applyProjectChange((prev) => {
        const is3DLayer = kind === 'model3d' || kind === 'camera' || kind === 'light';
        let targetTrack = is3DLayer ? prev.tracks.find((t) => t.type === '3d' && !t.locked) : undefined;
        let tracks = prev.tracks;
        if (is3DLayer && !targetTrack) {
          targetTrack = {
            id: uid('track-3d'),
            name: '3D • Cena Tridimensional',
            type: '3d',
            muted: false,
            hidden: false,
            locked: false,
          };
          tracks = [targetTrack, ...prev.tracks];
        }
        const track: Track = targetTrack || {
          id: uid('track-fx'),
          name:
            kind === 'adjustment'
              ? 'ADJ • Camada de Ajuste'
              : kind === 'null'
              ? 'NULL • Controlador'
              : 'SLD • Sólido',
          type: 'video',
          muted: false,
          hidden: false,
          locked: false,
        };
        if (!targetTrack) tracks = [track, ...prev.tracks];
        const baseClip: TimelineClip = {
          id: uid(`clip-${kind}`),
          trackId: track.id,
          type: kind as TimelineClip['type'],
          solidColor: kind === 'solid' ? '#1d4ed8' : undefined,
          name:
            kind === 'adjustment'
              ? 'Camada de Ajuste Global'
              : kind === 'null'
              ? 'Objeto Nulo (Pai)'
              : kind === 'model3d'
              ? 'Modelo 3D • Cubo'
              : kind === 'camera'
              ? 'Câmera 3D Profissional'
              : kind === 'light'
              ? 'Luz 3D Direcional'
              : 'Sólido Azul Estúdio',
          startTime: Number(playheadRef.current.toFixed(2)),
          duration: 8,
          trimStart: 0,
          maxDuration: 300,
          x: 0,
          y: 0,
          z: 0,
          scale: 100,
          rotation: 0,
          opacity: 100,
          flipH: false,
          flipV: false,
          fitMode: 'cover',
          is3D: is3DLayer ? true : undefined,
          model3dData:
            kind === 'model3d'
              ? {
                  geometry: 'cube',
                  color: '#3b82f6',
                  roughness: 0.3,
                  metalness: 0.4,
                  wireframe: false,
                  castShadow: true,
                  receiveShadow: true,
                }
              : undefined,
          cameraData:
            kind === 'camera'
              ? {
                  fov: 50,
                  near: 0.1,
                  far: 5000,
                  focusDistance: 800,
                  aperture: 0,
                  lookAtX: 0,
                  lookAtY: 0,
                  lookAtZ: 0,
                }
              : undefined,
          lightData:
            kind === 'light'
              ? {
                  lightType: 'directional',
                  color: '#ffffff',
                  intensity: 2,
                  distance: 1200,
                  decay: 2,
                  castShadow: true,
                }
              : undefined,
          speed: 1,
          motionPreset: 'none',
          filters:
            kind === 'adjustment'
              ? { ...DEFAULT_FILTERS, contrast: 118, saturation: 122, temperature: 14, presetName: 'Ajuste' }
              : { ...DEFAULT_FILTERS },
          transitionIn: 'none',
          transitionInDuration: 0,
          transitionOut: 'none',
          transitionOutDuration: 0,
          volume: 0,
          muted: true,
          fadeIn: 0,
          fadeOut: 0,
        };
        setSelectedClipId(baseClip.id);
        return {
          ...prev,
          tracks,
          clips: [...prev.clips, baseClip],
        };
      });
      showToast(
        kind === 'adjustment'
          ? 'Camada de Ajuste criada sobre a composição'
          : kind === 'null'
          ? 'Objeto Nulo criado (use Camada Pai para vincular)'
          : kind === 'model3d'
          ? 'Modelo 3D criado — importe .GLB na aba Mídia para modelos reais'
          : kind === 'camera'
          ? 'Câmera 3D criada — controle FOV, foco e profundidade de campo'
          : kind === 'light'
          ? 'Luz 3D criada com sombras reais'
          : 'Camada Sólida criada'
      );
    },
    [applyProjectChange, showToast]
  );

  // Pre-compose Selected Layer
  const handlePrecomposeSelected = useCallback(() => {
    if (!selectedClipId) {
      showToast('Selecione uma camada para pré-compor');
      return;
    }
    const res = precomposeClips(projectRef.current, [selectedClipId]);
    if (!res) {
      showToast('Não foi possível pré-compor esta camada');
      return;
    }
    applyProjectChange(() => res.nextProject);
    setSelectedClipId(res.precompClipId);
    showToast('Camada agrupada em Pré-Composição aninhada!');
  }, [selectedClipId, applyProjectChange, showToast]);

  // Detect Audio Peaks / Beats and Insert Markers
  const handleDetectAudioBeats = useCallback(
    async (asset: MediaAsset) => {
      try {
        let env = asset.envelope;
        if (!env || env.length === 0) {
          env = await decodeAudioAssetEnvelope(asset.url);
          setAssets((prev) =>
            prev.map((a) => (a.id === asset.id ? { ...a, envelope: env } : a))
          );
        }
        const audioClip = projectRef.current.clips.find((c) => c.mediaId === asset.id);
        const startT = audioClip ? audioClip.startTime : 0;
        const dur = audioClip ? audioClip.duration : asset.duration;
        const trim = audioClip ? audioClip.trimStart : 0;
        const spd = audioClip ? audioClip.speed : 1;

        const beatMarkers = buildBeatMarkersForClip(startT, dur, trim, spd, env);
        applyProjectChange((prev) => ({
          ...prev,
          markers: [
            ...prev.markers.filter((m) => !m.id.startsWith('beat-')),
            ...beatMarkers,
          ],
        }));
        showToast(`${beatMarkers.length} batidas detectadas e marcadas na timeline!`);
      } catch {
        showToast('Não foi possível analisar as batidas deste áudio');
      }
    },
    [applyProjectChange, showToast]
  );

  // Apply & Save Motion Presets
  const handleApplyMotionPreset = useCallback(
    (preset: SavedMotionPreset) => {
      applyProjectChange((prev) => {
        const target =
          prev.clips.find((c) => c.id === selectedClipId) ||
          prev.clips.find(
            (c) =>
              c.type !== 'audio' &&
              playheadRef.current >= c.startTime &&
              playheadRef.current < c.startTime + c.duration
          );
        if (!target) {
          showToast('Selecione uma camada para aplicar o preset');
          return prev;
        }
        setSelectedClipId(target.id);
        const p = preset.patch;
        const addedBehaviors = (p.motionBehaviors || []).map((b) => ({
          ...b,
          id: uid('beh'),
        }));
        const addedEffects = (p.effects || [])
          .map((e) => createEffect(e.type, e.params || {}))
          .filter((item): item is ClipEffect => !!item);

        showToast(`Preset "${preset.name}" aplicado!`);
        return {
          ...prev,
          clips: prev.clips.map((c) => {
            if (c.id !== target.id) return c;
            return {
              ...c,
              motionStack: addedBehaviors.length
                ? [...(c.motionStack || []), ...addedBehaviors]
                : c.motionStack,
              keyframes: p.keyframes
                ? [
                    ...(c.keyframes || []).filter(
                      (tr) => !p.keyframes!.some((np) => np.property === tr.property)
                    ),
                    ...p.keyframes.map((tr) => ({
                      ...tr,
                      keyframes: tr.keyframes.map((k) => ({ ...k, id: uid('pkf') })),
                    })),
                  ]
                : c.keyframes,
              effects: addedEffects.length
                ? [...(c.effects || []), ...addedEffects]
                : c.effects,
              filters: p.filters ? { ...c.filters, ...p.filters } : c.filters,
              transitionIn: p.transitionIn ?? c.transitionIn,
              transitionInDuration: p.transitionIn ? 0.5 : c.transitionInDuration,
              transitionOut: p.transitionOut ?? c.transitionOut,
              transitionOutDuration: p.transitionOut ? 0.5 : c.transitionOutDuration,
              textStyle:
                c.textStyle && p.textAnimator
                  ? { ...c.textStyle, animator: { ...p.textAnimator } }
                  : c.textStyle,
              shapeData:
                c.shapeData && p.shapePatch
                  ? { ...c.shapeData, ...p.shapePatch }
                  : c.shapeData,
            };
          }),
        };
      });
    },
    [applyProjectChange, selectedClipId, showToast]
  );

  const handleSaveLayerAsPreset = useCallback(
    (name: string) => {
      if (!selectedClip) return;
      const custom: SavedMotionPreset = {
        id: uid('preset'),
        name,
        category: 'Intro',
        description: `Preset salvo a partir de "${selectedClip.name}"`,
        version: '1.0',
        favorite: true,
        gradient: 'from-blue-600 to-indigo-600',
        patch: {
          motionBehaviors: (selectedClip.motionStack || []).map(({ id: _id, ...rest }) => rest),
          keyframes: selectedClip.keyframes,
          effects: (selectedClip.effects || []).map((e) => ({ type: e.type, params: { ...e.params } })),
          filters: { ...selectedClip.filters },
        },
      };
      applyProjectChange((prev) => ({
        ...prev,
        customPresets: [custom, ...(prev.customPresets || [])],
      }));
      showToast(`Preset "${name}" salvo na biblioteca!`);
    },
    [selectedClip, applyProjectChange, showToast]
  );

  // Align & Stagger Productivity Helpers
  const handleAlignSelected = useCallback(
    (mode: 'center-h' | 'center-v' | 'left' | 'right' | 'top' | 'bottom') => {
      if (!selectedClipId) {
        showToast('Selecione uma camada para alinhar');
        return;
      }
      applyProjectChange((prev) => ({
        ...prev,
        clips: prev.clips.map((c) => {
          if (c.id !== selectedClipId) return c;
          if (mode === 'center-h') return { ...c, x: 0 };
          if (mode === 'center-v') return { ...c, y: 0 };
          if (mode === 'left') return { ...c, x: -35 };
          if (mode === 'right') return { ...c, x: 35 };
          if (mode === 'top') return { ...c, y: -35 };
          return { ...c, y: 35 };
        }),
      }));
      showToast('Camada alinhada');
    },
    [selectedClipId, applyProjectChange, showToast]
  );

  const handleStaggerClips = useCallback(() => {
    applyProjectChange((prev) => {
      const visualClips = prev.clips.filter((c) => c.type !== 'audio');
      if (visualClips.length < 2) return prev;
      const baseStart = Math.min(...visualClips.map((c) => c.startTime));
      let idx = 0;
      return {
        ...prev,
        clips: prev.clips.map((c) =>
          c.type === 'audio'
            ? c
            : { ...c, startTime: Number((baseStart + idx++ * 0.35).toFixed(2)) }
        ),
      };
    });
    showToast('Stagger aplicado às camadas visuais (+0.35s)');
  }, [applyProjectChange, showToast]);

  const handleAddAssetToTimeline = useCallback(
    (asset: MediaAsset) => {
      applyProjectChange((prev) => {
        const desiredType: TrackType =
          asset.type === 'audio' ? 'audio' : asset.type === 'model3d' ? '3d' : 'video';
        let targetTrack =
          prev.tracks.find(
            (t) =>
              t.type === desiredType &&
              !t.locked &&
              (desiredType !== 'video' || t.id === 'track-v1')
          ) || prev.tracks.find((t) => t.type === desiredType && !t.locked);

        let tracks = prev.tracks;
        if (!targetTrack) {
          const newTrack: Track = {
            id: uid('track'),
            name:
              desiredType === 'audio'
                ? 'Nova Faixa Áudio'
                : desiredType === '3d'
                ? '3D • Cena Tridimensional'
                : 'Nova Faixa Vídeo',
            type: desiredType,
            muted: false,
            hidden: false,
            locked: false,
          };
          tracks = [newTrack, ...tracks];
          targetTrack = newTrack;
        }

        const onTrack = prev.clips.filter((c) => c.trackId === targetTrack!.id);
        const blocking = onTrack.find(
          (c) => currentTime >= c.startTime && currentTime < c.startTime + c.duration - 0.05
        );
        const startAt = blocking
          ? Math.max(...onTrack.map((c) => c.startTime + c.duration))
          : currentTime;

        const newClip = createClipFromAsset(asset, targetTrack.id, startAt);
        setSelectedClipId(newClip.id);
        return {
          ...prev,
          tracks,
          clips: [...prev.clips, newClip],
        };
      });
      showToast(`Adicionado: ${asset.name}`);
    },
    [applyProjectChange, currentTime, showToast]
  );

  const handleDropAssetOnTrack = useCallback(
    (assetId: string, trackId: string, dropTime: number) => {
      const asset = assetsMap.get(assetId);
      if (!asset) return;

      applyProjectChange((prev) => {
        const clickedTrack = prev.tracks.find((t) => t.id === trackId);
        const neededType: TrackType = asset.type === 'audio' ? 'audio' : 'video';

        let finalTrackId = trackId;
        let updatedTracks = prev.tracks;

        if (!clickedTrack || clickedTrack.type !== neededType) {
          const fallback = prev.tracks.find((t) => t.type === neededType && !t.locked);
          if (fallback) {
            finalTrackId = fallback.id;
          } else {
            const created: Track = {
              id: uid('track'),
              name: neededType === 'audio' ? 'A2 • Áudio' : 'V • Vídeo',
              type: neededType,
              muted: false,
              hidden: false,
              locked: false,
            };
            updatedTracks = [...prev.tracks, created];
            finalTrackId = created.id;
          }
        }

        const newClip = createClipFromAsset(asset, finalTrackId, dropTime);
        setSelectedClipId(newClip.id);
        return {
          ...prev,
          tracks: updatedTracks,
          clips: [...prev.clips, newClip],
        };
      });
    },
    [assetsMap, applyProjectChange]
  );

  const handleDropExternalFiles = useCallback(
    async (fileList: FileList, trackId: string, dropTime: number) => {
      const files = Array.from(fileList);
      let cursor = dropTime;
      for (const file of files) {
        const asset = await parseUploadedMediaFile(file);
        if (!asset) continue;
        setAssets((prev) => [asset, ...prev]);
        applyProjectChange((prev) => {
          const neededType: TrackType = asset.type === 'audio' ? 'audio' : 'video';
          const clicked = prev.tracks.find((t) => t.id === trackId);
          const resolvedTrack =
            clicked && clicked.type === neededType
              ? clicked
              : prev.tracks.find((t) => t.type === neededType && !t.locked) || clicked!;
          const clip = createClipFromAsset(asset, resolvedTrack.id, cursor);
          cursor += clip.duration;
          setSelectedClipId(clip.id);
          return { ...prev, clips: [...prev.clips, clip] };
        });
      }
      showToast('Arquivo adicionado diretamente à faixa');
    },
    [applyProjectChange, showToast]
  );

  const handleAddTextPreset = useCallback(
    (preset: TextPresetItem) => {
      applyProjectChange((prev) => {
        let textTrack = prev.tracks.find((t) => t.type === 'text' && !t.locked);
        let tracks = prev.tracks;
        if (!textTrack) {
          textTrack = {
            id: uid('track-t'),
            name: 'T • Títulos',
            type: 'text',
            muted: false,
            hidden: false,
            locked: false,
          };
          tracks = [textTrack, ...prev.tracks];
        }

        const newClip: TimelineClip = {
          id: uid('clip-txt'),
          trackId: textTrack.id,
          type: 'text',
          name: `Texto • ${preset.label}`,
          startTime: Number(currentTime.toFixed(2)),
          duration: 4.5,
          trimStart: 0,
          maxDuration: 300,
          x: 0,
          y: preset.y,
          scale: 100,
          rotation: 0,
          opacity: 100,
          flipH: false,
          flipV: false,
          fitMode: 'contain',
          speed: 1,
          motionPreset: 'none',
          filters: { ...DEFAULT_FILTERS },
          transitionIn: 'fade',
          transitionInDuration: 0.3,
          transitionOut: 'fade',
          transitionOutDuration: 0.3,
          volume: 0,
          muted: true,
          fadeIn: 0,
          fadeOut: 0,
          textStyle: { ...preset.style },
        };

        setSelectedClipId(newClip.id);
        return {
          ...prev,
          tracks,
          clips: [...prev.clips, newClip],
        };
      });
      showToast(`Texto adicionado em ${formatTimecode(currentTime, false)}`);
    },
    [applyProjectChange, currentTime, showToast]
  );

  const handleApplyColorPreset = useCallback(
    (filters: ColorAdjustments) => {
      applyProjectChange((prev) => {
        let target = prev.clips.find(
          (c) => c.id === selectedClipId && c.type !== 'audio'
        );
        if (!target) {
          target = prev.clips.find(
            (c) =>
              c.type !== 'audio' &&
              currentTime >= c.startTime &&
              currentTime < c.startTime + c.duration
          );
        }
        if (!target) {
          showToast('Nenhuma camada visual selecionada');
          return prev;
        }
        setSelectedClipId(target.id);
        showToast(`Filtro "${filters.presetName}" aplicado`);
        return {
          ...prev,
          clips: prev.clips.map((c) =>
            c.id === target!.id ? { ...c, filters: { ...filters } } : c
          ),
        };
      });
    },
    [applyProjectChange, selectedClipId, currentTime, showToast]
  );

  const handleApplyTransitionPreset = useCallback(
    (type: TransitionType) => {
      applyProjectChange((prev) => {
        let target = prev.clips.find((c) => c.id === selectedClipId && c.type !== 'audio');
        if (!target) {
          target = prev.clips.find(
            (c) =>
              c.type !== 'audio' &&
              currentTime >= c.startTime &&
              currentTime < c.startTime + c.duration
          );
        }
        if (!target) {
          showToast('Selecione uma camada visual');
          return prev;
        }
        setSelectedClipId(target.id);
        const dur = type === 'none' ? 0 : 0.6;
        showToast('Transição aplicada à camada');
        return {
          ...prev,
          clips: prev.clips.map((c) =>
            c.id === target!.id
              ? {
                  ...c,
                  transitionIn: type,
                  transitionInDuration: dur,
                  transitionOut: type,
                  transitionOutDuration: dur,
                }
              : c
          ),
        };
      });
    },
    [applyProjectChange, selectedClipId, currentTime, showToast]
  );

  const findEffectTarget = useCallback(
    (state: ProjectState) => {
      const selected = state.clips.find(
        (clip) => clip.id === selectedClipId && clip.type !== 'audio'
      );
      if (selected) return selected;
      return state.clips.find(
        (clip) =>
          clip.type !== 'audio' &&
          playheadRef.current >= clip.startTime &&
          playheadRef.current < clip.startTime + clip.duration
      );
    },
    [selectedClipId]
  );

  const handleChangeEffects = useCallback(
    (clipId: string, effects: ClipEffect[], commit = true) => {
      handleUpdateClipLive(clipId, { effects });
      if (commit) handleCommitHistory();
    },
    [handleUpdateClipLive, handleCommitHistory]
  );

  const handleApplyEffect = useCallback(
    (type: string) => {
      applyProjectChange((prev) => {
        const target = findEffectTarget(prev);
        if (!target || prev.tracks.find((track) => track.id === target.trackId)?.locked) {
          showToast('Selecione uma camada visual desbloqueada');
          return prev;
        }
        const effect = createEffect(type);
        if (!effect) return prev;
        setSelectedClipId(target.id);
        setEffectsFocusToken((token) => token + 1);
        showToast(`${type} aplicado em ${target.name}`);
        return {
          ...prev,
          clips: prev.clips.map((clip) =>
            clip.id === target.id
              ? { ...clip, effects: [...(clip.effects || []), effect] }
              : clip
          ),
        };
      });
    },
    [applyProjectChange, findEffectTarget, showToast]
  );

  const handleApplyEffectPreset = useCallback(
    (preset: EffectPreset) => {
      applyProjectChange((prev) => {
        const target = findEffectTarget(prev);
        if (!target || prev.tracks.find((track) => track.id === target.trackId)?.locked) {
          showToast('Selecione uma camada visual desbloqueada');
          return prev;
        }
        const created = preset.effects
          .map((item) => createEffect(item.type, item.params || {}))
          .filter((effect): effect is ClipEffect => !!effect);
        setSelectedClipId(target.id);
        setEffectsFocusToken((token) => token + 1);
        showToast(`Look "${preset.label}" aplicado`);
        return {
          ...prev,
          clips: prev.clips.map((clip) =>
            clip.id === target.id
              ? { ...clip, effects: [...(clip.effects || []), ...created] }
              : clip
          ),
        };
      });
    },
    [applyProjectChange, findEffectTarget, showToast]
  );

  const handleSplitAtPlayhead = useCallback(() => {
    applyProjectChange((prev) => {
      const lockedIds = new Set(prev.tracks.filter((t) => t.locked).map((t) => t.id));
      let target = prev.clips.find(
        (c) =>
          c.id === selectedClipId &&
          !lockedIds.has(c.trackId) &&
          currentTime > c.startTime + 0.1 &&
          currentTime < c.startTime + c.duration - 0.1
      );

      if (!target) {
        target = prev.clips.find(
          (c) =>
            !lockedIds.has(c.trackId) &&
            currentTime > c.startTime + 0.1 &&
            currentTime < c.startTime + c.duration - 0.1
        );
      }

      if (!target) {
        showToast('Posicione a agulha sobre um clipe para dividir');
        return prev;
      }

      const splitOffset = Number((currentTime - target.startTime).toFixed(2));
      const rightDuration = Number((target.duration - splitOffset).toFixed(2));

      const leftClip: TimelineClip = {
        ...target,
        duration: splitOffset,
        timeRemap: sliceTimeRemap(target, 0, splitOffset),
        keyframes: slicePropertyTracks(target.keyframes, 0, splitOffset),
        transitionOut: 'none',
        transitionOutDuration: 0,
      };

      const rightClip: TimelineClip = {
        ...target,
        id: uid('clip'),
        startTime: Number(currentTime.toFixed(2)),
        duration: rightDuration,
        trimStart: Number(getClipSourceTime(target, splitOffset).toFixed(6)),
        timeRemap: sliceTimeRemap(target, splitOffset, target.duration),
        keyframes: slicePropertyTracks(target.keyframes, splitOffset, target.duration),
        transitionIn: 'none',
        transitionInDuration: 0,
        filters: { ...target.filters },
        textStyle: target.textStyle ? { ...target.textStyle } : undefined,
        shapeData: target.shapeData ? { ...target.shapeData } : undefined,
        masks: target.masks ? target.masks.map((m) => ({ ...m })) : undefined,
      };

      setSelectedClipId(rightClip.id);
      showToast(`Camada dividida em ${formatTimecode(currentTime, true, prev.fps)}`);

      return {
        ...prev,
        clips: prev.clips.flatMap((c) =>
          c.id === target!.id ? [leftClip, rightClip] : [c]
        ),
      };
    });
  }, [applyProjectChange, selectedClipId, currentTime, showToast]);

  const handleDuplicateClip = useCallback(
    (clipId?: string) => {
      const id = clipId || selectedClipId;
      if (!id) return;

      applyProjectChange((prev) => {
        const orig = prev.clips.find((c) => c.id === id);
        if (!orig) return prev;
        const copy: TimelineClip = {
          ...orig,
          id: uid('clip'),
          startTime: Number((orig.startTime + orig.duration).toFixed(2)),
          filters: { ...orig.filters },
          textStyle: orig.textStyle ? { ...orig.textStyle } : undefined,
          shapeData: orig.shapeData ? { ...orig.shapeData } : undefined,
          masks: orig.masks ? orig.masks.map((m) => ({ ...m, id: uid('mask') })) : undefined,
        };
        setSelectedClipId(copy.id);
        showToast('Camada duplicada');
        return {
          ...prev,
          clips: [...prev.clips, copy],
        };
      });
    },
    [applyProjectChange, selectedClipId, showToast]
  );

  const handleDeleteClip = useCallback(
    (clipId?: string, ripple = false) => {
      const id = clipId || selectedClipId;
      if (!id) return;

      applyProjectChange((prev) => {
        const target = prev.clips.find((c) => c.id === id);
        if (!target) return prev;
        const track = prev.tracks.find((t) => t.id === target.trackId);
        if (track?.locked) {
          showToast('A faixa está bloqueada');
          return prev;
        }

        const remaining = prev.clips
          .filter((c) => c.id !== id)
          .map((c) => {
            if (
              ripple &&
              c.trackId === target.trackId &&
              c.startTime >= target.startTime + target.duration - 0.02
            ) {
              return {
                ...c,
                startTime: Math.max(0, Number((c.startTime - target.duration).toFixed(2))),
              };
            }
            return c;
          });

        setSelectedClipId(null);
        showToast(ripple ? 'Camada excluída e espaço fechado' : 'Camada excluída');
        return { ...prev, clips: remaining };
      });
    },
    [applyProjectChange, selectedClipId, showToast]
  );

  const handleChangeClipSpeed = useCallback(
    (clipId: string, newSpeed: number) => {
      setProjectLive((prev) => ({
        ...prev,
        clips: prev.clips.map((c) => {
          if (
            c.id !== clipId ||
            c.timeRemap?.enabled ||
            prev.tracks.find((t) => t.id === c.trackId)?.locked
          ) {
            return c;
          }
          const sourceLen = c.duration * c.speed;
          const adjustedDur = Math.max(0.25, Number((sourceLen / newSpeed).toFixed(2)));
          return { ...c, speed: newSpeed, duration: adjustedDur };
        }),
      }));
    },
    [setProjectLive]
  );

  const handleStartRecording = useCallback(
    async (source: 'camera' | 'screen') => {
      try {
        const stream =
          source === 'camera'
            ? await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

        activeStreamRef.current = stream;
        const chunks: BlobPart[] = [];
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) chunks.push(ev.data);
        };

        recorder.onstop = async () => {
          if (recordTimerRef.current) clearInterval(recordTimerRef.current);
          stream.getTracks().forEach((t) => t.stop());
          setIsRecordingSource(null);
          setRecordingSeconds(0);

          const blob = new Blob(chunks, { type: 'video/webm' });
          const file = new File(
            [blob],
            `Gravacao-${source === 'camera' ? 'Camera' : 'Tela'}-${Date.now()}.webm`,
            { type: 'video/webm' }
          );
          const asset = await parseUploadedMediaFile(file);
          if (asset) {
            setAssets((prev) => [asset, ...prev]);
            handleAddAssetToTimeline(asset);
          }
        };

        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (recorder.state !== 'inactive') recorder.stop();
        });

        recorder.start(250);
        setIsRecordingSource(source);
        setRecordingSeconds(0);
        recordTimerRef.current = window.setInterval(() => {
          setRecordingSeconds((s) => s + 1);
        }, 1000);
        showToast('Gravação iniciada!');
      } catch {
        showToast('Permissão de câmera/tela negada ou indisponível');
      }
    },
    [handleAddAssetToTimeline, showToast]
  );

  const handleStopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleCaptureFramePng = useCallback(() => {
    const spec = getProjectDimensions(project);
    const offscreen = document.createElement('canvas');
    offscreen.width = spec.width;
    offscreen.height = spec.height;
    const ctx = offscreen.getContext('2d', { alpha: true });
    if (!ctx) return;

    renderFrameToCanvas(
      ctx,
      spec.width,
      spec.height,
      project.tracks,
      project.clips,
      assetsMap,
      mediaPoolRef.current,
      currentTime,
      {
        backgroundColor: project.backgroundColor,
        transparentBg: project.transparentBg,
        fps: project.fps,
        compositions: project.compositions,
      }
    );

    const url = offscreen.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `quadro-${formatTimecode(currentTime, false).replace(':', 'm')}s.png`;
    a.click();
    showToast('Quadro PNG exportado com sucesso!');
  }, [project, assetsMap, currentTime, showToast]);

  const handleNewEmptyProject = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    playheadRef.current = 0;
    setSelectedClipId(null);
    applyProjectChange((prev) => ({
      ...prev,
      projectName: 'Novo Projeto',
      clips: [],
      markers: [],
    }));
    showToast('Projeto em branco criado — o anterior continua em Desfazer (Ctrl+Z) e no autosave');
  }, [applyProjectChange, showToast]);

  const handleSaveProjectJson = useCallback(() => {
    const synced = syncActiveComposition({
      ...project,
      assetRegistry: assets.map(toPersistedAsset),
    });
    const blob = new Blob([JSON.stringify(synced, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${synced.projectName.toLowerCase().replace(/\s+/g, '-')}.json`;
    a.click();
    showToast('Projeto salvo em .JSON');
  }, [project, assets, showToast]);

  const handleLoadProjectJson = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const raw = JSON.parse(text);
        const { project: parsed, error } = validateAndNormalizeProject(raw);
        if (!parsed) {
          showToast(error || 'Arquivo de projeto inválido');
          return;
        }
        applyProjectChange(() => parsed);
        setCurrentTime(0);
        playheadRef.current = 0;
        setIsPlaying(false);
        setSelectedClipId(
          parsed.clips.find((clip) => clip.type !== 'audio')?.id || null
        );

        // Rehydrate media referenced by the file (same machine) and surface the rest.
        const { assets: restoredAssets, missing } = await rehydrateAssetsFromRegistry(
          parsed.assetRegistry
        );
        if (restoredAssets.length > 0) setAssets(restoredAssets);
        if (missing.length > 0) {
          showToast(
            `Projeto carregado — ${missing.length} mídia(s) precisam de relink.`
          );
        } else {
          showToast('Projeto carregado com sucesso');
        }
      } catch {
        showToast('Arquivo de projeto inválido');
      }
    },
    [applyProjectChange, showToast]
  );

  const selectedOrUnderPlayhead = useCallback(
    (state: ProjectState) => {
      const selected = state.clips.find((clip) => clip.id === selectedClipId);
      if (selected) return selected;
      return state.clips.find(
        (clip) =>
          playheadRef.current >= clip.startTime &&
          playheadRef.current < clip.startTime + clip.duration
      );
    },
    [selectedClipId]
  );

  const shiftLayerEdge = useCallback(
    (edge: 'start' | 'end') => {
      applyProjectChange((prev) => {
        const target = selectedOrUnderPlayhead(prev);
        if (!target) {
          showToast('Selecione uma camada primeiro');
          return prev;
        }
        if (prev.tracks.find((track) => track.id === target.trackId)?.locked) {
          showToast('Camada bloqueada');
          return prev;
        }
        const time = playheadRef.current;
        const end = target.startTime + target.duration;
        const startTime = edge === 'start' ? time : time - target.duration;
        setSelectedClipId(target.id);
        showToast(
          edge === 'start'
            ? 'Início da camada movido para a agulha'
            : 'Fim da camada movido para a agulha'
        );
        return {
          ...prev,
          clips: prev.clips.map((clip) =>
            clip.id === target.id
              ? {
                  ...clip,
                  startTime: Number(startTime.toFixed(6)),
                  duration: edge === 'start' ? end - startTime : clip.duration,
                }
              : clip
          ),
        };
      });
    },
    [applyProjectChange, selectedOrUnderPlayhead, showToast]
  );

  const trimLayerAtPlayhead = useCallback(
    (edge: 'in' | 'out') => {
      applyProjectChange((prev) => {
        const target = selectedOrUnderPlayhead(prev);
        if (!target) {
          showToast('Selecione uma camada primeiro');
          return prev;
        }
        if (prev.tracks.find((track) => track.id === target.trackId)?.locked) {
          showToast('Camada bloqueada');
          return prev;
        }
        const local = playheadRef.current - target.startTime;
        if (local <= 0.05 || local >= target.duration - 0.05) {
          showToast('Posicione a agulha dentro da camada para aparar');
          return prev;
        }
        setSelectedClipId(target.id);
        showToast(
          edge === 'in' ? 'Entrada aparada na agulha (Alt+[)' : 'Saída aparada na agulha (Alt+])'
        );
        return {
          ...prev,
          clips: prev.clips.map((clip) => {
            if (clip.id !== target.id) return clip;
            if (edge === 'out') {
              return {
                ...clip,
                duration: Number(local.toFixed(6)),
                timeRemap: sliceTimeRemap(clip, 0, local),
                keyframes: slicePropertyTracks(clip.keyframes, 0, local),
              };
            }
            return {
              ...clip,
              startTime: Number(playheadRef.current.toFixed(6)),
              duration: Number((clip.duration - local).toFixed(6)),
              trimStart: getClipSourceTime(clip, local),
              timeRemap: sliceTimeRemap(clip, local, clip.duration),
              keyframes: slicePropertyTracks(clip.keyframes, local, clip.duration),
            };
          }),
        };
      });
    },
    [applyProjectChange, selectedOrUnderPlayhead, showToast]
  );

  const jumpToLayerEdge = useCallback(
    (edge: 'in' | 'out') => {
      const target = selectedOrUnderPlayhead(projectRef.current);
      if (!target) {
        showToast('Selecione uma camada primeiro');
        return;
      }
      setSelectedClipId(target.id);
      seekTo(
        edge === 'in'
          ? target.startTime
          : Math.max(target.startTime, target.startTime + target.duration - 1 / project.fps)
      );
    },
    [selectedOrUnderPlayhead, seekTo, project.fps, showToast]
  );

  // Command Palette Items (`Ctrl+K`)
  const paletteCommands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: 'cmd-comp-new',
        category: 'Composição',
        label: 'Criar Nova Composição',
        run: () => {
          applyProjectChange((p) => createNewComposition(p));
          playheadRef.current = 0;
          setCurrentTime(0);
          setSelectedClipId(null);
        },
      },
      { id: 'cmd-comp-settings', category: 'Composição', label: 'Configurações da Composição (Resolução, FPS, Fundo)', run: () => setShowCompSettings(true) },
      { id: 'cmd-precomp', category: 'Camada', label: 'Pré-compor Camada Selecionada', shortcut: 'Ctrl+Shift+C', run: handlePrecomposeSelected },
      { id: 'cmd-shape-rect', category: 'Forma', label: 'Adicionar Retângulo Vetorial', run: () => handleAddShapeLayer('rect') },
      { id: 'cmd-shape-ellipse', category: 'Forma', label: 'Adicionar Elipse / Anel Vetorial', run: () => handleAddShapeLayer('ellipse') },
      { id: 'cmd-shape-star', category: 'Forma', label: 'Adicionar Estrela Vetorial', run: () => handleAddShapeLayer('star') },
      { id: 'cmd-shape-bezier', category: 'Forma', label: 'Adicionar Curva Bézier', run: () => handleAddShapeLayer('path') },
      { id: 'cmd-solid', category: 'Camada', label: 'Adicionar Camada Sólida (Solid)', run: () => handleAddSpecialLayer('solid') },
      { id: 'cmd-adj', category: 'Camada', label: 'Adicionar Camada de Ajuste (Adjustment Layer)', run: () => handleAddSpecialLayer('adjustment') },
      { id: 'cmd-null', category: 'Camada', label: 'Adicionar Objeto Nulo (Null Controller)', run: () => handleAddSpecialLayer('null') },
      {
        id: 'cmd-mask-ellipse',
        category: 'Máscara',
        label: 'Adicionar Máscara Elíptica na Camada Selecionada',
        run: () => {
          if (!selectedClip) return;
          handleUpdateClipLive(selectedClip.id, {
            masks: [...(selectedClip.masks || []), createDefaultMask('ellipse', (selectedClip.masks?.length || 0) + 1)],
          });
          handleCommitHistory();
        },
      },
      { id: 'cmd-graph', category: 'Animação', label: 'Abrir Graph Editor (Curvas de Propriedades)', shortcut: 'U', run: () => { setGraphTab('curves'); setGraphOpen(true); } },
      { id: 'cmd-remap', category: 'Animação', label: 'Abrir Time Remapping', run: () => { setGraphTab('remap'); setGraphOpen(true); } },
      { id: 'cmd-split', category: 'Edição', label: 'Dividir Camada na Agulha', shortcut: 'Ctrl+Shift+D', run: handleSplitAtPlayhead },
      { id: 'cmd-stagger', category: 'Produtividade', label: 'Stagger — Sequenciar Camadas em Escada', run: handleStaggerClips },
      { id: 'cmd-center', category: 'Alinhar', label: 'Centralizar Camada na Composição', run: () => { handleAlignSelected('center-h'); handleAlignSelected('center-v'); } },
      { id: 'cmd-ram', category: 'Render', label: 'Renderizar Prévia RAM da Área de Trabalho', shortcut: 'R', run: renderPreview },
      { id: 'cmd-export', category: 'Exportar', label: 'Exportar Vídeo / Sequência PNG / Áudio WAV', run: () => { setIsPlaying(false); setShowExportModal(true); } },
      { id: 'cmd-theme', category: 'Interface', label: 'Alternar Tema Escuro / Claro', run: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) },
    ],
    [
      applyProjectChange,
      handlePrecomposeSelected,
      handleAddShapeLayer,
      handleAddSpecialLayer,
      selectedClip,
      handleUpdateClipLive,
      handleCommitHistory,
      handleSplitAtPlayhead,
      handleStaggerClips,
      handleAlignSelected,
      renderPreview,
    ]
  );

  // Global Studio Keyboard Shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'k') {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        void persistence.saveNow();
        return;
      }

      const targetEl = e.target as HTMLElement | null;
      const tag = targetEl?.tagName;
      const inputType = tag === 'INPUT' ? (targetEl as HTMLInputElement).type : '';
      const isTextControl =
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        (tag === 'INPUT' && inputType !== 'range' && inputType !== 'checkbox' && inputType !== 'color');
      if (isTextControl) return;
      if ((e.key === 'Enter' || e.code === 'Space') && (tag === 'BUTTON' || tag === 'A')) return;

      if (showExportModal || showShortcutsModal || showCommandPalette || showCompSettings) {
        if (e.key === 'Escape') {
          setShowShortcutsModal(false);
          setShowCommandPalette(false);
          setShowCompSettings(false);
        }
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (e.shiftKey) playWorkArea();
        else togglePlay();
      } else if (mod && e.shiftKey && key === 'd') {
        e.preventDefault();
        handleSplitAtPlayhead();
      } else if (mod && e.shiftKey && key === 'c') {
        e.preventDefault();
        handlePrecomposeSelected();
      } else if (mod && key === 'd') {
        e.preventDefault();
        handleDuplicateClip();
      } else if ((key === 'r' && !mod && !e.altKey) || e.code === 'Numpad0' || e.key === 'Enter') {
        e.preventDefault();
        renderPreview();
      } else if ((key === 'b' || key === 'n') && !mod) {
        e.preventDefault();
        setAreaBoundary(key === 'b' ? 'start' : 'end');
      } else if ((key === 'u' && !mod) || (mod && e.altKey && key === 't')) {
        e.preventDefault();
        setGraphOpen((value) => !value);
      } else if ((key === 's' || key === 'p' || key === 't') && !mod && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const prop = key === 's' ? 'scale' : key === 'p' ? 'x' : 'opacity';
        const label = key === 's' ? 'Escala' : key === 'p' ? 'Posição' : 'Opacidade';
        const target = selectedOrUnderPlayhead(projectRef.current);
        if (!target) {
          showToast('Selecione uma camada primeiro');
        } else {
          setSelectedClipId(target.id);
          setFocusMonitor(false);
          setPropertyFocus((prev) => ({ prop, nonce: prev.nonce + 1 }));
          showToast(`${label} revelada no inspetor`);
        }
      } else if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        if (e.altKey) trimLayerAtPlayhead(e.key === '[' ? 'in' : 'out');
        else shiftLayerEdge(e.key === '[' ? 'start' : 'end');
      } else if ((key === 'i' || key === 'o') && !mod && !e.shiftKey) {
        e.preventDefault();
        jumpToLayerEdge(key === 'i' ? 'in' : 'out');
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        seekTo(e.key === 'Home' ? 0 : totalDuration - 1 / project.fps);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteClip(undefined, e.shiftKey);
      } else if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      } else if (key === 'm' && !mod) {
        e.preventDefault();
        applyProjectChange((prev) => ({
          ...prev,
          markers: [
            ...prev.markers,
            {
              id: uid('mk'),
              time: Number(playheadRef.current.toFixed(2)),
              label: `M${prev.markers.length + 1}`,
              color: '#38bdf8',
            },
          ],
        }));
        showToast('Marcador adicionado');
      } else if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'PageUp' ||
        e.key === 'PageDown'
      ) {
        e.preventDefault();
        setIsPlaying(false);
        const back = e.key === 'ArrowLeft' || e.key === 'PageUp';
        const step = (e.shiftKey ? 10 : 1) / project.fps;
        seekTo(playheadRef.current + (back ? -step : step));
      } else if ((e.key === '+' || e.key === '=') && !mod) {
        e.preventDefault();
        setZoomPxPerSec((zoom) => Math.min(160, zoom + 12));
      } else if (e.key === '-' && !mod) {
        e.preventDefault();
        setZoomPxPerSec((zoom) => Math.max(15, zoom - 12));
      } else if (e.key === '?') {
        setShowShortcutsModal((v) => !v);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    showExportModal,
    showShortcutsModal,
    showCommandPalette,
    showCompSettings,
    persistence,
    playWorkArea,
    togglePlay,
    renderPreview,
    setAreaBoundary,
    seekTo,
    handleSplitAtPlayhead,
    handlePrecomposeSelected,
    handleDeleteClip,
    handleUndo,
    handleRedo,
    handleDuplicateClip,
    applyProjectChange,
    selectedOrUnderPlayhead,
    shiftLayerEdge,
    trimLayerAtPlayhead,
    jumpToLayerEdge,
    project.fps,
    totalDuration,
    showToast,
  ]);

  const mediaSidebarEl = (
        <MediaSidebar
          isMobileDrawer={compactUI}
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          assets={assets}
          customPresets={project.customPresets || []}
          onChangeCustomPresets={(list) =>
            applyProjectChange((prev) => ({ ...prev, customPresets: list }))
          }
          onSaveLayerAsPreset={handleSaveLayerAsPreset}
          onApplyMotionPreset={handleApplyMotionPreset}
          onUploadFiles={handleUploadFiles}
          onAddAssetToTimeline={handleAddAssetToTimeline}
          onAddShapeLayer={handleAddShapeLayer}
          onAddSpecialLayer={handleAddSpecialLayer}
          onPrecomposeSelected={handlePrecomposeSelected}
          onDetectAudioBeats={handleDetectAudioBeats}
          onAddTextPreset={handleAddTextPreset}
          onApplyColorPreset={handleApplyColorPreset}
          onApplyTransitionPreset={handleApplyTransitionPreset}
          onApplyEffect={handleApplyEffect}
          onApplyPreset={handleApplyEffectPreset}
          targetName={selectedClip ? selectedClip.name : null}
          isRecordingSource={isRecordingSource}
          recordingSeconds={recordingSeconds}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
        />
  );
  const canvasEl = (
        <CanvasPreview
          isMobile={compactUI}
          onAnalysisBusy={setVisionBusy}
          onPausePlayback={() => setIsPlaying(false)}
          project={project}
          fps={project.fps}
          tracks={effectiveTracks}
          clips={project.clips}
          assetsMap={assetsMap}
          pool={mediaPoolRef.current}
          currentTime={currentTime}
          totalDuration={totalDuration}
          isPlaying={isPlaying}
          isLooping={isLooping}
          masterMuted={masterMuted}
          selectedClipId={selectedClipId}
          onSelectClip={setSelectedClipId}
          onUpdateClipLive={handleUpdateClipLive}
          onCommitHistory={handleCommitHistory}
          previewCache={preview.cache}
          previewState={preview.state}
          previewResolution={previewResolution}
          onChangePreviewResolution={setPreviewResolution}
          focusMonitor={focusMonitor}
          onToggleFocusMonitor={() => setFocusMonitor((value) => !value)}
          onTogglePlay={togglePlay}
          onSeek={seekTo}
          onToggleLoop={() => setIsLooping((l) => !l)}
          onToggleMasterMute={() => setMasterMuted((m) => !m)}
        />
  );
  const inspectorEl = (
        <InspectorPanel
          isMobileDrawer={compactUI}
          project={project}
          assetsMap={assetsMap}
          onAnalysisBusy={setVisionBusy}
          onPausePlayback={() => setIsPlaying(false)}
          currentTime={currentTime}
          selectedClip={selectedClip}
          allClips={project.clips}
          onOpenTimeRemap={() => {
            setGraphTab('remap');
            setGraphOpen(true);
          }}
          onOpenPropertyGraph={() => {
            setGraphTab('curves');
            setGraphOpen(true);
          }}
          trackLocked={
            !!project.tracks.find((track) => track.id === selectedClip?.trackId)?.locked
          }
          onOpenEffectsBrowser={() => {
            setActiveTab('effects');
            if (compactUI) layout.openMobileDrawer('effects');
          }}
          effectsFocusToken={effectsFocusToken}
          propertyFocus={propertyFocus}
          onChangeEffects={handleChangeEffects}
          fps={project.fps}
          totalDuration={totalDuration}
          clipCount={project.clips.length}
          onUpdateClipLive={handleUpdateClipLive}
          onCommitHistory={handleCommitHistory}
          onChangeClipSpeed={handleChangeClipSpeed}
          onDuplicateClip={handleDuplicateClip}
          onDeleteClip={(id) => handleDeleteClip(id, false)}
        />
  );
  const timelineEl = (
      <TimelinePanel
        compact={compactUI}
        fillHeight={phoneLandscape}
        autoPreview={preview.autoEnabled}
        autoBusy={preview.autoBusy}
        onToggleAutoPreview={() => preview.setAutoEnabled((enabled) => !enabled)}
        graphOpen={graphOpen}
        graphTab={graphTab}
        onChangeGraphTab={setGraphTab}
        onToggleGraph={() => setGraphOpen((value) => !value)}
        copiedTrack={copiedTrack}
        onCopyTrack={(tr) => {
          setCopiedTrack(tr);
          showToast('Curva de animação copiada!');
        }}
        onPrecomposeSelected={handlePrecomposeSelected}
        fps={project.fps}
        workArea={workArea}
        previewState={preview.state}
        previewResolution={previewResolution}
        onChangePreviewResolution={setPreviewResolution}
        onChangeWorkArea={(area) => setProjectLive((prev) => ({ ...prev, workArea: area }))}
        onSetWorkAreaStart={() => setAreaBoundary('start')}
        onSetWorkAreaEnd={() => setAreaBoundary('end')}
        onFitWorkArea={() => applyProjectChange((prev) => ({ ...prev, workArea: undefined }))}
        onRenderPreview={renderPreview}
        onCancelPreview={preview.cancel}
        onClearPreview={preview.clear}
        onPlayWorkArea={playWorkArea}
        playingWorkArea={isPlaying && playAreaOnly}
        tracks={project.tracks}
        clips={project.clips}
        markers={project.markers}
        currentTime={currentTime}
        totalDuration={totalDuration}
        selectedClipId={selectedClipId}
        zoomPxPerSec={zoomPxPerSec}
        snapEnabled={snapEnabled}
        onChangeZoom={setZoomPxPerSec}
        onToggleSnap={() => setSnapEnabled((s) => !s)}
        onSeek={seekTo}
        onSelectClip={setSelectedClipId}
        onSplitAtPlayhead={handleSplitAtPlayhead}
        onDuplicateSelected={() => handleDuplicateClip()}
        onDeleteSelected={(ripple) => handleDeleteClip(undefined, ripple)}
        onAddMarker={() => {
          applyProjectChange((prev) => ({
            ...prev,
            markers: [
              ...prev.markers,
              {
                id: uid('mk'),
                time: Number(currentTime.toFixed(2)),
                label: `M${prev.markers.length + 1}`,
                color: '#38bdf8',
              },
            ],
          }));
          showToast('Marcador inserido');
        }}
        onRemoveMarker={(markerId) =>
          applyProjectChange((prev) => ({
            ...prev,
            markers: prev.markers.filter((m) => m.id !== markerId),
          }))
        }
        onAddTrack={(type) => {
          applyProjectChange((prev) => {
            const count = prev.tracks.filter((t) => t.type === type).length + 1;
            const prefix =
              type === 'video' ? 'V' : type === 'shape' ? 'S' : type === 'text' ? 'T' : 'A';
            const label =
              type === 'video'
                ? 'Vídeo Overlay'
                : type === 'shape'
                ? 'Formas Vetoriais'
                : type === 'text'
                ? 'Texto Extra'
                : 'Áudio Extra';
            const newTrack: Track = {
              id: uid('track'),
              name: `${prefix}${count} • ${label}`,
              type,
              muted: false,
              hidden: false,
              locked: false,
            };
            return {
              ...prev,
              tracks:
                type === 'audio'
                  ? [...prev.tracks, newTrack]
                  : [newTrack, ...prev.tracks],
            };
          });
          showToast('Nova faixa adicionada');
        }}
        onToggleTrackProp={(trackId, prop) =>
          applyProjectChange((prev) => ({
            ...prev,
            tracks: prev.tracks.map((t) =>
              t.id === trackId ? { ...t, [prop]: !t[prop] } : t
            ),
          }))
        }
        onUpdateClipLive={handleUpdateClipLive}
        onCommitHistory={handleCommitHistory}
        onDropAssetOnTrack={handleDropAssetOnTrack}
        onDropExternalFiles={handleDropExternalFiles}
      />
  );

  const drawer = layout.mobileDrawer;
  const handleSelectDrawer = (next: MobileDrawer) => {
    if (next === 'none') return layout.closeMobileDrawer();
    if (next === 'inspector') return layout.toggleMobileDrawer('inspector');
    if (drawer !== 'none' && drawer !== 'inspector' && activeTab === next) {
      layout.closeMobileDrawer();
      return;
    }
    setActiveTab(next);
    layout.openMobileDrawer(next);
  };
  const drawerTitles: Record<MobileDrawer, string> = {
    none: '',
    media: 'Mídia',
    text: 'Texto',
    effects: 'Efeitos',
    shapes: 'Formas',
    audio: 'Áudio',
    inspector: selectedClip ? `Editar • ${selectedClip.name}` : 'Ajustes',
  };

  return (
    <div
      data-theme={theme}
      style={{ '--mobile-bar-h': 'calc(56px + env(safe-area-inset-bottom, 0px))' } as CSSProperties}
      className="studio-shell h-dvh w-screen flex flex-col bg-[#09090b] text-[#f4f4f5] overflow-hidden"
    >
      <TopBar
        compact={compactUI}
        projectName={project.projectName}
        onChangeProjectName={(name) =>
          setProjectLive((prev) => ({ ...prev, projectName: name }))
        }
        aspectRatio={project.aspectRatio}
        onChangeAspectRatio={(ratio: AspectRatioKey) =>
          applyProjectChange((prev) => ({ ...prev, aspectRatio: ratio }))
        }
        fps={project.fps}
        onChangeFps={(fps) => applyProjectChange((prev) => ({ ...prev, fps }))}
        compositions={project.compositions || []}
        activeCompId={project.activeCompId || 'comp-main'}
        onSelectComposition={(compId) => {
          applyProjectChange((prev) => switchActiveComposition(prev, compId));
          setCurrentTime(0);
          playheadRef.current = 0;
          setSelectedClipId(null);
        }}
        onNewComposition={() => {
          applyProjectChange((prev) => createNewComposition(prev));
          setCurrentTime(0);
          playheadRef.current = 0;
          setSelectedClipId(null);
          showToast('Nova composição criada');
        }}
        onOpenCompSettings={() => setShowCompSettings(true)}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
        onAlignSelected={handleAlignSelected}
        onStaggerClips={handleStaggerClips}
        onDuplicateProject={() => {
          applyProjectChange((prev) => ({
            ...prev,
            projectName: `${prev.projectName} (Cópia)`,
          }));
          showToast('Projeto duplicado');
        }}
        hasAutosave={persistence.sessionAvailable}
        onRecoverAutosave={() => void persistence.recoverSession()}
        saveStatus={persistence.saveStatus}
        lastSavedAt={persistence.lastSavedAt}
        missingMediaCount={persistence.missingCount}
        onSaveNow={() => void persistence.saveNow()}
        onExportPackage={() => void persistence.exportPackage()}
        onImportPackage={(file) => void persistence.importPackage(file)}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        liveFps={liveFps}
        cacheBytes={preview.state.bytes}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onNewEmptyProject={handleNewEmptyProject}
        onSaveProjectJson={handleSaveProjectJson}
        onLoadProjectJson={handleLoadProjectJson}
        onOpenShortcuts={() => setShowShortcutsModal(true)}
        onOpenExport={() => {
          setIsPlaying(false);
          setShowExportModal(true);
        }}
      />

      {compactUI ? (
        <>
          {phoneLandscape ? (
            <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
              <div className="flex-1 min-w-0 flex">{canvasEl}</div>
              <div className="w-[52%] min-w-0 flex flex-col border-l border-[#27272a]">{timelineEl}</div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 flex">{canvasEl}</div>
              {timelineEl}
            </div>
          )}
          <MobileActionBar
            activeDrawer={drawer}
            onSelectDrawer={handleSelectDrawer}
            onSplitAtPlayhead={handleSplitAtPlayhead}
            hasSelectedClip={!!selectedClip}
            selectedClipName={selectedClip?.name}
          />
          <MobileBottomSheet
            isOpen={drawer !== 'none'}
            onClose={layout.closeMobileDrawer}
            title={drawerTitles[drawer]}
            height={drawer === 'inspector' ? '54dvh' : '50dvh'}
          >
            {drawer === 'inspector' ? inspectorEl : drawer !== 'none' ? mediaSidebarEl : null}
          </MobileBottomSheet>
        </>
      ) : (
        <>
          <div
            className={`studio-workspace flex-1 min-h-0 flex overflow-hidden ${
              focusMonitor ? 'is-focus' : ''
            }`}
          >
            {mediaSidebarEl}
            {canvasEl}
            {inspectorEl}
          </div>
          {timelineEl}
        </>
      )}

      {showExportModal && (
        <ExportModal
          project={project}
          assets={assets}
          totalDuration={totalDuration}
          workArea={workArea}
          onCaptureFramePng={handleCaptureFramePng}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {showShortcutsModal && (
        <ShortcutsModal onClose={() => setShowShortcutsModal(false)} />
      )}

      {persistence.missingCount > 0 && (
        <MissingMediaModal
          missing={persistence.missingAssets}
          onRelink={persistence.relinkAsset}
          onDismiss={persistence.clearMissing}
        />
      )}

      {showCommandPalette && (
        <CommandPaletteModal
          commands={paletteCommands}
          onClose={() => setShowCommandPalette(false)}
        />
      )}

      {showCompSettings && (
        <CompositionSettingsModal
          project={project}
          onSave={(patch, compName) => {
            applyProjectChange((prev) => {
              const updatedComps = (prev.compositions || []).map((c) =>
                c.id === prev.activeCompId && compName ? { ...c, name: compName } : c
              );
              return { ...prev, ...patch, compositions: updatedComps };
            });
            showToast('Configurações da composição atualizadas!');
          }}
          onClose={() => setShowCompSettings(false)}
        />
      )}

      {/* Interrupted-session recovery banner (non-blocking, Milestone 1) */}
      {persistence.canRecoverAtBoot && showRecoveryBanner && (
        <div
          data-testid="recovery-banner"
          className="fixed top-14 left-1/2 -translate-x-1/2 z-40 flex flex-wrap items-center justify-center gap-3 px-4 py-2.5 w-max max-w-[calc(100vw-1rem)] rounded-xl bg-[#18181c]/95 border border-[#3f3f46] shadow-2xl"
        >
          <div className="w-8 h-8 rounded-lg bg-[#2563eb]/20 text-[#60a5fa] flex items-center justify-center shrink-0">
            <RotateCcw className="w-4 h-4" />
          </div>
          <div className="text-xs">
            <p className="text-[#f4f4f5] font-semibold">Sessão anterior encontrada</p>
            <p className="text-[#a1a1aa]">
              Recupere o trabalho não finalizado ou descarte o projeto salvo.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              data-testid="recover-session"
              onClick={() => {
                void persistence.recoverSession();
                setShowRecoveryBanner(false);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#3b82f6] text-white text-xs font-semibold cursor-pointer"
            >
              Recuperar
            </button>
            <button
              data-testid="discard-session"
              onClick={() => {
                persistence.discardSession();
                setShowRecoveryBanner(false);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#1c1c21] hover:bg-[#27272a] text-[#a1a1aa] text-xs cursor-pointer"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {toastMsg && (
        <div style={compactUI ? { bottom: 'calc(var(--mobile-bar-h) + 12px)' } : undefined} className="fixed bottom-4 right-4 max-w-[calc(100vw-2rem)] z-50 px-3.5 py-2 rounded-lg bg-[#18181c]/95 border border-[#3f3f46] text-xs font-medium text-[#f4f4f5] shadow-xl pointer-events-none">
          {toastMsg}
        </div>
      )}

      <MediaLoadingModal state={mediaLoading} onClose={() => setMediaLoading(null)} />
    </div>
  );
}
export default App;
