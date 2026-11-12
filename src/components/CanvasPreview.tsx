import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Grid3X3,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Repeat,
  RotateCw,
  Volume2,
  VolumeX,
  Scan,
  X,
} from 'lucide-react';
import {
  MediaAsset,
  PreviewResolution,
  ProjectState,
  TimelineClip,
  Track,
} from '../types/editor';
import { getProjectDimensions } from '../core/compositions';
import { upsertKeyframeOnClip } from '../core/keyframes';
import {
  MediaElementPool,
  RenderedClipBounds,
  renderFrameToCanvas,
} from '../utils/compositor';
import { formatTimecode } from '../utils/mediaHelpers';
import { prepareMediaFrame } from '../utils/previewCache';
import type { PreviewFrameCache } from '../utils/previewCache';
import type { PreviewRenderState } from '../hooks/usePreviewRender';
import { MotionToolsPanel } from './MotionToolsPanel';
import { AudioVuMeter } from './AudioVuMeter';
import { VideoScopesPanel } from './VideoScopesPanel';
import {
  buildRotationGizmoPatch,
  buildScaleGizmoPatch,
  snapCanvasPosition,
} from '../utils/canvasGizmos';

interface CanvasPreviewProps {
  onAnalysisBusy: (busy: boolean) => void;
  onPausePlayback: () => void;
  project: ProjectState;
  previewCache: PreviewFrameCache;
  previewState: PreviewRenderState;
  previewResolution: PreviewResolution;
  onChangePreviewResolution: (resolution: PreviewResolution) => void;
  focusMonitor: boolean;
  onToggleFocusMonitor: () => void;
  fps: number;
  tracks: Track[];
  clips: TimelineClip[];
  assetsMap: Map<string, MediaAsset>;
  pool: MediaElementPool;
  currentTime: number;
  totalDuration: number;
  isPlaying: boolean;
  isLooping: boolean;
  masterMuted: boolean;
  selectedClipId: string | null;
  onSelectClip: (clipId: string | null) => void;
  onUpdateClipLive: (clipId: string, patch: Partial<TimelineClip>) => void;
  onCommitHistory: () => void;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onToggleLoop: () => void;
  onToggleMasterMute: () => void;
  isMobile?: boolean;
}

export const CanvasPreview: React.FC<CanvasPreviewProps> = ({
  onAnalysisBusy,
  onPausePlayback,
  project,
  fps,
  tracks,
  clips,
  assetsMap,
  pool,
  currentTime,
  totalDuration,
  isPlaying,
  isLooping,
  masterMuted,
  selectedClipId,
  onSelectClip,
  onUpdateClipLive,
  onCommitHistory,
  onTogglePlay,
  onSeek,
  onToggleLoop,
  onToggleMasterMute,
  isMobile = false,
  previewCache,
  previewState,
  previewResolution,
  onChangePreviewResolution,
  focusMonitor,
  onToggleFocusMonitor,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageWrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backbufferRef = useRef<HTMLCanvasElement | null>(null);
  const boundsRef = useRef<RenderedClipBounds[]>([]);

  const [stageSize, setStageSize] = useState({ width: 640, height: 360 });
  const [viewZoom, setViewZoom] = useState<'fit' | number>('fit');
  const [frameError, setFrameError] = useState<string | null>(null);
  const [showGuides, setShowGuides] = useState(false);
  const [showScopes, setShowScopes] = useState(false);
  const [falseColor, setFalseColor] = useState(false);
  const [cursorCoords, setCursorCoords] = useState<{ x: number; y: number } | null>(null);
  const [selectedBox, setSelectedBox] = useState<RenderedClipBounds | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });
  const [editingTextClipId, setEditingTextClipId] = useState<string | null>(null);
  const [showVision, setShowVision] = useState(false);
  useEffect(() => { setShowVision(false); }, [selectedClipId]);

  const lastTapRef = useRef<{ clipId: string; time: number } | null>(null);
  const dragStateRef = useRef<{
    clipId: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  const spec = getProjectDimensions(project);
  const renderWidth = Math.max(2, Math.round(spec.width / previewResolution));
  const renderHeight = Math.max(2, Math.round(spec.height / previewResolution));
  const displayTime = Math.min(currentTime, Math.max(0, totalDuration - 1 / fps));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resize = () => {
      const pad = isMobile ? 12 : 32;
      const fitRatio = Math.min(
        Math.max(1, container.clientWidth - pad) / spec.width,
        Math.max(1, container.clientHeight - pad) / spec.height
      );
      const ratio = viewZoom === 'fit' ? fitRatio : fitRatio * viewZoom;
      setStageSize({
        width: Math.floor(spec.width * ratio),
        height: Math.floor(spec.height * ratio),
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => observer.disconnect();
  }, [spec.width, spec.height, viewZoom, isMobile]);

  const isCurrentFrameCached = previewCache.has(displayTime);
  void previewState.frameCount;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !context) return;
    if (!backbufferRef.current) {
      backbufferRef.current = document.createElement('canvas');
    }
    const backbuffer = backbufferRef.current;
    if (backbuffer.width !== renderWidth || backbuffer.height !== renderHeight) {
      backbuffer.width = renderWidth;
      backbuffer.height = renderHeight;
    }
    const backCtx = backbuffer.getContext('2d', { alpha: true });
    if (!backCtx) return;

    let cancelled = false;
    const controller = new AbortController();

    const blitToMonitor = (source: CanvasImageSource) => {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'copy';
      context.drawImage(source, 0, 0, renderWidth, renderHeight);
      context.restore();
    };

    const setBounds = (bounds: RenderedClipBounds[]) => {
      boundsRef.current = bounds;
      setSelectedBox(
        selectedClipId ? bounds.find((box) => box.clipId === selectedClipId) || null : null
      );
    };

    const drawLive = () => {
      if (cancelled) return;
      const bounds = renderFrameToCanvas(
        backCtx,
        renderWidth,
        renderHeight,
        tracks,
        clips,
        assetsMap,
        pool,
        displayTime,
        {
          backgroundColor: project.backgroundColor,
          transparentBg: project.transparentBg,
          fps,
          compositions: project.compositions,
        }
      );
      blitToMonitor(backbuffer);
      setBounds(bounds);
    };

    const draw = async () => {
      if (previewCache.has(displayTime)) {
        const syncBitmap = previewCache.peek(displayTime);
        if (syncBitmap) {
          blitToMonitor(syncBitmap);
          setBounds(previewCache.bounds(displayTime));
          previewCache.prefetch(displayTime);
          return;
        }
        // Fallback immediate draw so monitor never blinks while decoding a cold cached blob
        drawLive();
        const bitmap = await previewCache.decode(previewCache.frameIndex(displayTime));
        if (!cancelled && bitmap) {
          blitToMonitor(bitmap);
          setBounds(previewCache.bounds(displayTime));
        }
        previewCache.prefetch(displayTime);
      } else if (!isPlaying) {
        // Immediate synchronous paint from warm media pool, then refine after exact video seek
        drawLive();
        await prepareMediaFrame(
          {
            ...project,
            tracks,
            clips,
          },
          assetsMap,
          pool,
          displayTime,
          controller.signal
        );
        if (!cancelled && !previewCache.has(displayTime)) {
          drawLive();
        }
      } else {
        drawLive();
      }
    };

    const onPoolUpdate = () => {
      if (!cancelled && !previewCache.has(displayTime)) drawLive();
    };
    const unsubscribe = pool.subscribe(onPoolUpdate);
    // WebGL context restored after the OS reclaimed it (common on phones): redraw 3D layers.
    window.addEventListener('otto-3d-restored', onPoolUpdate);
    setFrameError(null);
    void draw().catch((error) => {
      if (!cancelled && !controller.signal.aborted) {
        setFrameError(error instanceof Error ? error.message : 'Erro na previa.');
      }
    });
    void document.fonts.ready.then(() => {
      if (!cancelled && !previewCache.has(displayTime)) drawLive();
    });
    return () => {
      cancelled = true;
      controller.abort();
      unsubscribe();
      window.removeEventListener('otto-3d-restored', onPoolUpdate);
    };
  }, [
    project,
    renderWidth,
    renderHeight,
    tracks,
    clips,
    assetsMap,
    pool,
    displayTime,
    selectedClipId,
    isPlaying,
    previewCache,
    isCurrentFrameCached,
    fps,
  ]);

  const mapClientToCanvas = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { cx: 0, cy: 0, rectW: 1, rectH: 1 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = renderWidth / Math.max(1, rect.width);
    const scaleY = renderHeight / Math.max(1, rect.height);
    return {
      cx: (clientX - rect.left) * scaleX,
      cy: (clientY - rect.top) * scaleY,
      rectW: rect.width,
      rectH: rect.height,
    };
  };

  const handleCanvasMouseDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { cx, cy } = mapClientToCanvas(e.clientX, e.clientY);
    const hit = [...boundsRef.current]
      .reverse()
      .find(
        (b) =>
          cx >= b.x - 10 &&
          cx <= b.x + b.width + 10 &&
          cy >= b.y - 10 &&
          cy <= b.y + b.height + 10
      );

    if (!hit) {
      onSelectClip(null);
      return;
    }

    onSelectClip(hit.clipId);
    const targetClip = clips.find((c) => c.id === hit.clipId);
    if (!targetClip) return;

    // Double-tap on touch screens opens the inline text editor (dblclick is unreliable there).
    if (e.pointerType === 'touch') {
      const now = performance.now();
      const last = lastTapRef.current;
      if (last && last.clipId === hit.clipId && now - last.time < 380 && targetClip.type === 'text') {
        setEditingTextClipId(targetClip.id);
        lastTapRef.current = null;
        return;
      }
      lastTapRef.current = { clipId: hit.clipId, time: now };
    }
    const track = tracks.find((t) => t.id === targetClip.trackId);
    if (track?.locked) return;

    dragStateRef.current = {
      clipId: hit.clipId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: targetClip.x,
      origY: targetClip.y,
      moved: false,
    };

    const onMove = (ev: PointerEvent) => {
      const st = dragStateRef.current;
      const canvas = canvasRef.current;
      if (!st || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dxPct = ((ev.clientX - st.startClientX) / Math.max(1, rect.width)) * 100;
      const dyPct = ((ev.clientY - st.startClientY) / Math.max(1, rect.height)) * 100;
      st.moved = true;
      const rawX = st.origX + dxPct;
      const rawY = st.origY + dyPct;
      const activeVisualClips = clips.filter(
        (c) =>
          c.enabled !== false &&
          c.type !== 'audio' &&
          displayTime >= c.startTime &&
          displayTime < c.startTime + c.duration
      );
      const snapped = snapCanvasPosition(rawX, rawY, activeVisualClips, st.clipId, ev.altKey);
      const nx = snapped.x;
      const ny = snapped.y;
      setSnapGuides({ x: snapped.snapLineX, y: snapped.snapLineY });

      const latestClip = clips.find((c) => c.id === st.clipId);
      const localT = latestClip ? Math.max(0, displayTime - latestClip.startTime) : 0;
      let keyframes = latestClip?.keyframes;
      if (latestClip?.keyframes?.some((k) => k.property === 'x')) {
        keyframes = upsertKeyframeOnClip(latestClip, 'x', localT, nx, 'ease-in-out');
      }
      if (latestClip?.keyframes?.some((k) => k.property === 'y')) {
        keyframes = upsertKeyframeOnClip(
          { ...latestClip, keyframes },
          'y',
          localT,
          ny,
          'ease-in-out'
        );
      }

      onUpdateClipLive(st.clipId, {
        x: nx,
        y: ny,
        ...(keyframes ? { keyframes } : {}),
      });
    };

    const onUp = () => {
      setSnapGuides({ x: null, y: null });
      if (dragStateRef.current?.moved) {
        onCommitHistory();
      }
      dragStateRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Interactive Corner Scale Gizmo
  const handleScaleCornerPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!selectedClipId || !selectedBox) return;
    const targetClip = clips.find((c) => c.id === selectedClipId);
    if (!targetClip) return;
    const track = tracks.find((t) => t.id === targetClip.trackId);
    if (track?.locked) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const centerClientX = rect.left + (selectedBox.centerX / renderWidth) * rect.width;
    const centerClientY = rect.top + (selectedBox.centerY / renderHeight) * rect.height;
    const startDist = Math.max(
      12,
      Math.hypot(e.clientX - centerClientX, e.clientY - centerClientY)
    );
    const origScale = targetClip.scale;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const currDist = Math.hypot(ev.clientX - centerClientX, ev.clientY - centerClientY);
      const ratio = currDist / startDist;
      const nextScale = origScale * ratio;
      const latest = clips.find((c) => c.id === targetClip.id) || targetClip;
      const localT = Math.max(0, displayTime - latest.startTime);
      moved = true;
      onUpdateClipLive(latest.id, buildScaleGizmoPatch(latest, localT, nextScale));
    };

    const onUp = () => {
      if (moved) onCommitHistory();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Interactive Top Rotation Gizmo
  const handleRotatePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!selectedClipId || !selectedBox) return;
    const targetClip = clips.find((c) => c.id === selectedClipId);
    if (!targetClip) return;
    const track = tracks.find((t) => t.id === targetClip.trackId);
    if (track?.locked) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const centerClientX = rect.left + (selectedBox.centerX / renderWidth) * rect.width;
    const centerClientY = rect.top + (selectedBox.centerY / renderHeight) * rect.height;
    const startAngleRad = Math.atan2(e.clientY - centerClientY, e.clientX - centerClientX);
    const origRotation = targetClip.rotation;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const currAngleRad = Math.atan2(ev.clientY - centerClientY, ev.clientX - centerClientX);
      const deltaDeg = ((currAngleRad - startAngleRad) * 180) / Math.PI;
      const latest = clips.find((c) => c.id === targetClip.id) || targetClip;
      const localT = Math.max(0, displayTime - latest.startTime);
      moved = true;
      onUpdateClipLive(
        latest.id,
        buildRotationGizmoPatch(latest, localT, origRotation + deltaDeg, ev.shiftKey)
      );
    };

    const onUp = () => {
      if (moved) onCommitHistory();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Interactive Anchor Point Gizmo
  const handleAnchorPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!selectedClipId) return;
    const targetClip = clips.find((c) => c.id === selectedClipId);
    if (!targetClip) return;
    const track = tracks.find((t) => t.id === targetClip.trackId);
    if (track?.locked) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const origAnchorX = targetClip.anchorX ?? 0;
    const origAnchorY = targetClip.anchorY ?? 0;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dxPct = ((ev.clientX - startX) / Math.max(1, rect.width)) * 100;
      const dyPct = ((ev.clientY - startY) / Math.max(1, rect.height)) * 100;
      let ax = Math.round((origAnchorX + dxPct) * 2) / 2;
      let ay = Math.round((origAnchorY + dyPct) * 2) / 2;
      if (!ev.altKey && Math.abs(ax) < 2) ax = 0;
      if (!ev.altKey && Math.abs(ay) < 2) ay = 0;
      moved = true;
      onUpdateClipLive(targetClip.id, {
        anchorX: Math.max(-100, Math.min(100, ax)),
        anchorY: Math.max(-100, Math.min(100, ay)),
      });
    };

    const onUp = () => {
      if (moved) onCommitHistory();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Two-finger Pinch-to-Scale & Rotate on Mobile Touchscreens
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let startDist = 0;
    let startAngle = 0;
    let origScale = 100;
    let origRot = 0;
    let activeId: string | null = null;
    let touched = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !selectedClipId) return;
      const clip = clips.find((c) => c.id === selectedClipId);
      if (!clip) return;
      const track = tracks.find((t) => t.id === clip.trackId);
      if (track?.locked) return;
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      startDist = Math.max(10, Math.hypot(dx, dy));
      startAngle = Math.atan2(dy, dx);
      origScale = clip.scale;
      origRot = clip.rotation;
      activeId = clip.id;
      touched = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !activeId || startDist <= 0) return;
      e.preventDefault();
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const currDist = Math.hypot(dx, dy);
      const currAngle = Math.atan2(dy, dx);
      const latest = clips.find((c) => c.id === activeId);
      if (!latest) return;
      const localT = Math.max(0, displayTime - latest.startTime);
      const nextScale = origScale * (currDist / startDist);
      const nextRot = origRot + ((currAngle - startAngle) * 180) / Math.PI;
      touched = true;
      onUpdateClipLive(latest.id, {
        ...buildScaleGizmoPatch(latest, localT, nextScale),
        ...buildRotationGizmoPatch(latest, localT, nextRot, false),
      });
    };

    const onTouchEnd = () => {
      if (touched) onCommitHistory();
      startDist = 0;
      activeId = null;
      touched = false;
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [selectedClipId, clips, tracks, displayTime, onUpdateClipLive, onCommitHistory]);

  const handleCanvasDoubleClick = () => {
    if (!selectedClipId) return;
    const clip = clips.find((c) => c.id === selectedClipId);
    if (clip && clip.type === 'text') {
      setEditingTextClipId(clip.id);
    }
  };

  const handleFullscreen = () => {
    const el = stageWrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  };

  const editingClip = editingTextClipId
    ? clips.find((c) => c.id === editingTextClipId)
    : null;

  const activeSelectedClip = selectedClipId
    ? clips.find((c) => c.id === selectedClipId) || null
    : null;

  return (
    <section
      ref={stageWrapperRef}
      className="flex-1 min-w-0 flex flex-col bg-[#09090b] h-full select-none"
    >
      {/* Top Viewport Info Strip */}
      <div className="h-9 px-2 sm:px-3 gap-2 border-b border-[#27272a]/70 flex items-center justify-between text-[11px] text-[#71717a] shrink-0 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block w-2 h-2 rounded-full bg-[#10b981] shrink-0" />
          <span className="font-medium text-[#a1a1aa] truncate">
            {project.compositions?.find((c) => c.id === project.activeCompId)?.name || 'Composição'}
          </span>
          <span className="font-mono-code text-[10px] px-1.5 py-0.5 rounded bg-[#121215] border border-[#27272a] shrink-0">
            {renderWidth}×{renderHeight}
          </span>
          {cursorCoords && (
            <span className="hidden md:inline font-mono-code text-[10px] text-[#52525b]">
              X:{cursorCoords.x} Y:{cursorCoords.y}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {activeSelectedClip && (activeSelectedClip.type === 'video' || activeSelectedClip.type === 'image') && <button title="Abrir recorte e movimento (VFX)" aria-label="Abrir ferramentas VFX" onClick={() => { onPausePlayback(); setShowVision(true); }} className="monitor-vfx-launch"><Scan size={14} /><span>VFX</span></button>}
          <span className={`monitor-cache-label ${isMobile ? 'hidden' : ''} ${previewCache.has(displayTime) ? 'is-cached' : ''}`}>
            <i />
            {previewCache.has(displayTime) ? 'Cache' : 'Ao vivo'}
          </span>

          <select
            aria-label="Zoom do monitor"
            value={String(viewZoom)}
            onChange={(e) =>
              setViewZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))
            }
            className={`monitor-resolution ${isMobile ? 'hidden' : 'hidden sm:inline-block'}`}
          >
            <option value="fit">Ajustar</option>
            <option value="0.5">50%</option>
            <option value="0.75">75%</option>
            <option value="1">100%</option>
            <option value="1.5">150%</option>
          </select>

          <select
            aria-label="Resolucao do monitor"
            className="monitor-resolution"
            value={previewResolution}
            onChange={(event) =>
              onChangePreviewResolution(Number(event.target.value) as PreviewResolution)
            }
          >
            <option value={1}>Completa</option>
            <option value={2}>1/2</option>
            <option value={4}>1/4</option>
          </select>

          {!isMobile && <button
            onClick={onToggleFocusMonitor}
            title={focusMonitor ? 'Mostrar paineis' : 'Ampliar monitor'}
            className="p-1 rounded text-[#a1a1aa] hover:text-white cursor-pointer"
          >
            {focusMonitor ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>}

          <button
            onClick={() => setShowScopes((v) => !v)}
            title="Scopes de Vídeo (Histograma RGB, Waveform IRE, Vectorscope, False Color)"
            className={`px-2 py-1 rounded flex items-center gap-1 text-[11px] transition-colors cursor-pointer ${
              showScopes
                ? 'bg-[#2563eb]/20 text-[#60a5fa] border border-[#2563eb]/40'
                : 'text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#121215]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Scopes</span>
          </button>

          <button
            onClick={() => setShowGuides((v) => !v)}
            title="Guias, Grade e Margens de Segurança"
            className={`px-2 py-1 rounded flex items-center gap-1 text-[11px] transition-colors cursor-pointer ${
              showGuides
                ? 'bg-[#2563eb]/20 text-[#60a5fa] border border-[#2563eb]/40'
                : 'text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#121215]'
            }`}
          >
            <Grid3X3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Guias</span>
          </button>

          <button
            onClick={handleFullscreen}
            title="Tela Cheia"
            className="p-1 rounded text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#121215] transition-colors cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Center Canvas Stage */}
      <div
        ref={containerRef}
        className={`flex-1 min-h-0 ${isMobile ? 'p-1.5' : 'p-4'} flex items-center justify-center overflow-auto relative`}
      >
        {showScopes && (
          <VideoScopesPanel
            sourceCanvas={canvasRef.current}
            currentTime={displayTime}
            falseColor={falseColor}
            onToggleFalseColor={() => setFalseColor((v) => !v)}
            onClose={() => setShowScopes(false)}
          />
        )}
        <div
          style={{
            width: stageSize.width,
            height: stageSize.height,
            backgroundImage: project.transparentBg
              ? 'repeating-conic-gradient(#1f1f25 0% 25%, #2b2b34 0% 50%)'
              : undefined,
            backgroundSize: '20px 20px',
            filter: falseColor ? 'saturate(320%) hue-rotate(140deg) contrast(145%)' : undefined,
          }}
          className="relative shrink-0 shadow-2xl border border-[#27272a] bg-black rounded-md overflow-hidden"
        >
          <canvas
            ref={canvasRef}
            width={renderWidth}
            height={renderHeight}
            data-testid="program-monitor"
            onPointerDown={handleCanvasMouseDown}
            onPointerMove={(e) => {
              if (e.pointerType === 'touch') return;
              const { cx, cy } = mapClientToCanvas(e.clientX, e.clientY);
              setCursorCoords({
                x: Math.round(cx * previewResolution),
                y: Math.round(cy * previewResolution),
              });
            }}
            onPointerLeave={() => setCursorCoords(null)}
            onDoubleClick={handleCanvasDoubleClick}
            className="w-full h-full block cursor-move touch-none"
          />

          {frameError && (
            <div className="monitor-error" role="alert">
              {frameError}
            </div>
          )}

          {/* Safe Margins, Rule of Thirds & Center Rulers Overlay */}
          {showGuides && (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/20" />
              <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/20" />
              <div className="absolute top-1/3 left-0 right-0 h-px bg-white/20" />
              <div className="absolute top-2/3 left-0 right-0 h-px bg-white/20" />
              <div className="absolute inset-[5%] border border-sky-400/30 rounded-xs" />
              <div className="absolute inset-[10%] border border-dashed border-amber-400/35 rounded-xs" />
              <Crosshair className="w-4 h-4 text-white/40 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
          )}

          {/* Active Layer Mask Wireframe Preview */}
          {activeSelectedClip?.masks?.map((mask) =>
            mask.enabled ? (
              <div
                key={mask.id}
                style={{
                  left: `${50 + mask.x - mask.width / 2}%`,
                  top: `${50 + mask.y - mask.height / 2}%`,
                  width: `${mask.width}%`,
                  height: `${mask.height}%`,
                  borderRadius: mask.kind === 'ellipse' ? '9999px' : '2px',
                }}
                className="pointer-events-none absolute border border-dashed border-amber-400 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
              />
            ) : null
          )}

          {/* Magnetic Snapping Alignment Guides */}
          {(snapGuides.x !== null || snapGuides.y !== null) && (
            <div className="pointer-events-none absolute inset-0 z-10">
              {snapGuides.x !== null && (
                <div
                  style={{ left: `${snapGuides.x}%` }}
                  className="absolute top-0 bottom-0 w-px bg-cyan-400 shadow-[0_0_8px_#22d3ee]"
                />
              )}
              {snapGuides.y !== null && (
                <div
                  style={{ top: `${snapGuides.y}%` }}
                  className="absolute left-0 right-0 h-px bg-fuchsia-400 shadow-[0_0_8px_#e879f9]"
                />
              )}
            </div>
          )}

          {/* Selection Bounding Box + Interactive Scale / Rotate / Anchor Handles */}
          {selectedBox && !isPlaying && (
            <div
              style={{
                left: `${(selectedBox.x / renderWidth) * 100}%`,
                top: `${(selectedBox.y / renderHeight) * 100}%`,
                width: `${(selectedBox.width / renderWidth) * 100}%`,
                height: `${(selectedBox.height / renderHeight) * 100}%`,
              }}
              className={`pointer-events-none absolute border-2 rounded-sm shadow-[0_0_0_1px_rgba(0,0,0,0.5)] ${
                activeSelectedClip?.type === 'null'
                  ? 'border-amber-400 bg-amber-400/10'
                  : 'border-[#3b82f6]'
              }`}
            >
              {/* Top Rotation Stem + Handle */}
              <div className="absolute left-1/2 -top-6 -translate-x-1/2 flex flex-col items-center">
                <button
                  type="button"
                  data-testid="gizmo-rotate-handle"
                  title="Arrastar para rotacionar camada (Shift = 15°)"
                  onPointerDown={handleRotatePointerDown}
                  className="pointer-events-auto touch-none w-4 h-4 rounded-full bg-[#2563eb] hover:bg-[#3b82f6] border border-white text-white flex items-center justify-center shadow cursor-grab active:cursor-grabbing"
                >
                  <RotateCw className="w-2.5 h-2.5" />
                </button>
                <div className="w-px h-2 bg-[#3b82f6]" />
              </div>

              {/* 4 Interactive Scale Corner Handles */}
              <span
                data-testid="gizmo-scale-nw"
                title="Arrastar para redimensionar (Escala)"
                onPointerDown={handleScaleCornerPointerDown}
                className="pointer-events-auto touch-none absolute -top-2 -left-2 w-3.5 h-3.5 bg-white hover:bg-sky-200 border-2 border-[#2563eb] rounded-xs cursor-nwse-resize shadow"
              />
              <span
                data-testid="gizmo-scale-ne"
                title="Arrastar para redimensionar (Escala)"
                onPointerDown={handleScaleCornerPointerDown}
                className="pointer-events-auto touch-none absolute -top-2 -right-2 w-3.5 h-3.5 bg-white hover:bg-sky-200 border-2 border-[#2563eb] rounded-xs cursor-nesw-resize shadow"
              />
              <span
                data-testid="gizmo-scale-sw"
                title="Arrastar para redimensionar (Escala)"
                onPointerDown={handleScaleCornerPointerDown}
                className="pointer-events-auto touch-none absolute -bottom-2 -left-2 w-3.5 h-3.5 bg-white hover:bg-sky-200 border-2 border-[#2563eb] rounded-xs cursor-nesw-resize shadow"
              />
              <span
                data-testid="gizmo-scale-se"
                title="Arrastar para redimensionar (Escala)"
                onPointerDown={handleScaleCornerPointerDown}
                className="pointer-events-auto touch-none absolute -bottom-2 -right-2 w-3.5 h-3.5 bg-white hover:bg-sky-200 border-2 border-[#2563eb] rounded-xs cursor-nwse-resize shadow"
              />

              {/* Interactive Anchor Point Handle */}
              <button
                type="button"
                data-testid="gizmo-anchor-handle"
                title="Arrastar Ponto de Ancoragem (Anchor Point)"
                onPointerDown={handleAnchorPointerDown}
                style={{
                  left: `${50 + (activeSelectedClip?.anchorX ?? 0)}%`,
                  top: `${50 + (activeSelectedClip?.anchorY ?? 0)}%`,
                }}
                className="pointer-events-auto touch-none absolute -translate-x-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-amber-400/20 cursor-crosshair"
              >
                <Crosshair className="w-4 h-4 text-amber-400 drop-shadow" />
              </button>
            </div>
          )}

          {/* Inline Text Editing Modal Overlay */}
          {editingClip && editingClip.textStyle && (
            <div className="absolute inset-0 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 z-20">
              <div className="w-full max-w-md bg-[#18181c] border border-[#3f3f46] rounded-xl p-3.5 shadow-2xl">
                <p className="text-xs font-semibold text-[#f4f4f5] mb-2">
                  Editar Texto na Tela
                </p>
                <textarea
                  autoFocus
                  rows={3}
                  value={editingClip.textStyle.text}
                  onChange={(e) =>
                    onUpdateClipLive(editingClip.id, {
                      textStyle: {
                        ...editingClip.textStyle!,
                        text: e.target.value,
                      },
                    })
                  }
                  className="w-full bg-[#09090b] border border-[#27272a] focus:border-[#3b82f6] rounded-lg p-2.5 text-sm text-[#f4f4f5] outline-none resize-none"
                />
                <div className="flex justify-end gap-2 mt-2.5">
                  <button
                    onClick={() => {
                      onCommitHistory();
                      setEditingTextClipId(null);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#3b82f6] text-white text-xs font-semibold cursor-pointer"
                  >
                    Concluir
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Transport Control Bar (48px) */}
      <div className={`${isMobile ? 'h-12 px-2 gap-1' : 'h-12 px-4 gap-3'} bg-[#121215] border-t border-[#27272a] flex items-center justify-between shrink-0`}>
        <div className="flex items-center gap-1.5 min-w-0 shrink-0">
          <span className="font-mono-code text-xs font-semibold text-[#f4f4f5]">
            {formatTimecode(currentTime, true, fps)}
          </span>
          <span className="font-mono-code text-xs text-[#52525b] hidden min-[420px]:inline">/</span>
          <span className="font-mono-code text-xs text-[#71717a] hidden min-[420px]:inline">
            {formatTimecode(totalDuration, true, fps)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onSeek(0)}
            title="Ir para o Início (Home)"
            className="p-2 sm:p-1.5 rounded-lg text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21] transition-colors cursor-pointer"
          >
            <ChevronFirst className="w-4 h-4" />
          </button>

          <button
            onClick={() => onSeek(Math.max(0, currentTime - 1 / fps))}
            title="Voltar 1 Quadro (←)"
            className="p-2 sm:p-1.5 rounded-lg text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21] transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            onClick={onTogglePlay}
            title="Reproduzir / Pausar (Espaço)"
            className="w-9 h-9 rounded-full bg-[#f4f4f5] hover:bg-white text-[#09090b] flex items-center justify-center shadow-md transition-transform active:scale-95 cursor-pointer"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          <button
            onClick={() => onSeek(Math.min(totalDuration, currentTime + 1 / fps))}
            title="Avançar 1 Quadro (→)"
            className="p-2 sm:p-1.5 rounded-lg text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21] transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            onClick={() => onSeek(totalDuration)}
            title="Ir para o Fim (End)"
            className="p-2 sm:p-1.5 rounded-lg text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21] transition-colors cursor-pointer"
          >
            <ChevronLast className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-1.5 shrink-0">
          <AudioVuMeter
            project={{ ...project, tracks, clips }}
            assetsMap={assetsMap}
            currentTime={displayTime}
            masterMuted={masterMuted}
            compact={isMobile}
          />
          <button
            onClick={onToggleLoop}
            title="Repetição Contínua (Loop)"
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isLooping
                ? 'bg-[#2563eb]/20 text-[#60a5fa]'
                : 'text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#1c1c21]'
            }`}
          >
            <Repeat className="w-4 h-4" />
          </button>

          <button
            onClick={onToggleMasterMute}
            title={masterMuted ? 'Ativar Som' : 'Silenciar Monitor'}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              masterMuted
                ? 'bg-[#ef4444]/15 text-[#ef4444]'
                : 'text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21]'
            }`}
          >
            {masterMuted ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
      {showVision && activeSelectedClip && (activeSelectedClip.type === 'video' || activeSelectedClip.type === 'image') && <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Ferramentas VFX">
        <div className="vision-dialog">
          <header><span>{activeSelectedClip.name}</span><button aria-label="Fechar ferramentas VFX" onClick={() => setShowVision(false)}><X size={16} /></button></header>
          <div><MotionToolsPanel key={activeSelectedClip.id} clip={activeSelectedClip} asset={activeSelectedClip.mediaId ? assetsMap.get(activeSelectedClip.mediaId) : undefined} project={project} currentTime={currentTime} locked={!!tracks.find((t) => t.id === activeSelectedClip.trackId)?.locked} onUpdate={onUpdateClipLive} onCommit={onCommitHistory} onBusy={onAnalysisBusy} onPause={onPausePlayback} /></div>
        </div>
      </div>}
    </section>
  );
};
