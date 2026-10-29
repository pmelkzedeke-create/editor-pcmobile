import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MediaAsset, PreviewResolution, ProjectState, WorkArea } from '../types/editor';
import { getProjectDimensions } from '../core/compositions';
import { AutoPreviewRenderer } from '../core/autoPreview';
import { PreviewFrameCache, renderPreviewRange } from '../utils/previewCache';

export interface PreviewRenderState {
  status: 'idle' | 'rendering' | 'ready' | 'cancelled' | 'error';
  progress: number;
  frameCount: number;
  bytes: number;
  ranges: WorkArea[];
  error: string | null;
  automatic?: boolean;
}
const emptyState: PreviewRenderState = { status: 'idle', progress: 0, frameCount: 0, bytes: 0, ranges: [], error: null };
interface AutoPreviewOptions {
  currentTime: number;
  duration: number;
  playing: boolean;
  suspended?: boolean;
}

export function usePreviewRender(project: ProjectState, assets: Map<string, MediaAsset>, resolution: PreviewResolution, auto?: AutoPreviewOptions) {
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [autoBusy, setAutoBusy] = useState(false);
  // Nested comps and audio-reactive inputs affect pixels; the playhead never does.
  const signature = useMemo(() => JSON.stringify({
    ratio: project.aspectRatio, cw: project.customWidth, ch: project.customHeight,
    bg: project.backgroundColor, alpha: project.transparentBg, fps: project.fps, comp: project.activeCompId,
    tracks: project.tracks,
    clips: project.clips.map(({ thumbnail: _t, waveform: _w, ...clip }) => clip),
    comps: project.compositions,
  }), [project]);
  const effectiveProject = useMemo(() => {
    const solo = project.tracks.some((t) => t.solo);
    return { ...project, tracks: project.tracks.map((t) => ({ ...t, hidden: t.hidden || (solo && !t.solo && t.type !== 'audio'), muted: t.muted || (solo && !t.solo) })) };
  }, [signature]);
  const cache = useMemo(() => {
    const spec = getProjectDimensions(project);
    return new PreviewFrameCache(project.fps, Math.max(2, Math.round(spec.width / resolution)), Math.max(2, Math.round(spec.height / resolution)));
  }, [signature, resolution, assets]);
  const [state, setState] = useState<PreviewRenderState>(emptyState);
  const controllerRef = useRef<AbortController | null>(null);
  const automaticRef = useRef<AutoPreviewRenderer | null>(null);
  const pauseUntil = useRef(0);
  const lastAutomaticPublish = useRef(0);
  const [schedulerVersion, setSchedulerVersion] = useState(0);
  const manualRef = useRef(false);

  useEffect(() => {
    manualRef.current = false;
    setState(emptyState);
    setAutoBusy(false);
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      automaticRef.current?.dispose();
      automaticRef.current = null;
      cache.clear();
    };
  }, [cache]);

  useEffect(() => {
    if (!autoEnabled || auto?.suspended || manualRef.current) return;
    const renderer = new AutoPreviewRenderer(effectiveProject, assets, cache, (busy, error) => {
      setAutoBusy(busy);
      if (manualRef.current) return;
      if (busy && !error && performance.now() - lastAutomaticPublish.current < 100) return;
      lastAutomaticPublish.current = performance.now();
      setState((previous) => ({
        ...previous, status: error ? 'error' : cache.frames.size ? 'ready' : 'idle',
        frameCount: cache.frames.size, bytes: cache.bytes, ranges: cache.ranges(),
        error: error || null, automatic: true,
      }));
    });
    automaticRef.current = renderer;
    return () => { renderer.dispose(); if (automaticRef.current === renderer) automaticRef.current = null; };
  }, [effectiveProject, assets, cache, autoEnabled, auto?.suspended, schedulerVersion]);

  useEffect(() => {
    if (!auto || !autoEnabled || auto.suspended || manualRef.current) return;
    const request = () => automaticRef.current?.schedule(auto.currentTime, auto.duration, auto.playing);
    const wait = Math.max(0, pauseUntil.current - performance.now());
    if (wait === 0) { request(); return; }
    // Re-enabling after Clear/Cancel must restart even when the playhead is idle.
    const timer = setTimeout(request, wait + 5);
    return () => clearTimeout(timer);
  }, [auto?.currentTime, auto?.duration, auto?.playing, auto?.suspended, autoEnabled, cache, schedulerVersion]);

  const render = useCallback(async (area: WorkArea) => {
    controllerRef.current?.abort();
    automaticRef.current?.dispose();
    automaticRef.current = null;
    setAutoBusy(false);
    manualRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    const update = (status: PreviewRenderState['status'], progress: number, error: string | null = null) => {
      if (controllerRef.current !== controller) return;
      setState({ status, progress, error, frameCount: cache.frames.size, bytes: cache.bytes, ranges: cache.ranges(), automatic: false });
    };
    let percent = 0;
    update('rendering', 0);
    try {
      await renderPreviewRange(effectiveProject, assets, cache, area, controller.signal, (done, total) => {
        percent = Math.round(done / total * 100);
        update('rendering', percent);
      });
      cache.prefetch(area.start);
      update('ready', 100);
    } catch (error) {
      update(controller.signal.aborted ? 'cancelled' : 'error', percent, controller.signal.aborted ? null : error instanceof Error ? error.message : 'Falha ao renderizar a previa.');
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        manualRef.current = false;
        pauseUntil.current = performance.now() + 1200;
        setSchedulerVersion((v) => v + 1);
      }
    }
  }, [effectiveProject, assets, cache]);
  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  const clear = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    manualRef.current = false;
    automaticRef.current?.dispose();
    automaticRef.current = null;
    pauseUntil.current = performance.now() + 1200;
    cache.clear();
    setState(emptyState);
    setAutoBusy(false);
    setSchedulerVersion((v) => v + 1);
  }, [cache]);
  return { cache, state, render, cancel, clear, autoEnabled, autoBusy, setAutoEnabled };
}
