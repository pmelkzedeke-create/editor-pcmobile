import React, { useEffect, useRef, useState } from 'react';
import {
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
  const boundsRef = useRef<RenderedClipBounds[]>([]);

  const [stageSize, setStageSize] = useState({ width: 640, height: 360 });
  const [viewZoom, setViewZoom] = useState<'fit' | number>('fit');
  const [frameError, setFrameError] = useState<string | null>(null);
  const [showGuides, setShowGuides] = useState(false);
  const [cursorCoords, setCursorCoords] = useState<{ x: number; y: number } | null>(null);
  const [selectedBox, setSelectedBox] = useState<RenderedClipBounds | null>(null);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !context) return;
    let cancelled = false;
    const controller = new AbortController();
    const setBounds = (bounds: RenderedClipBounds[]) => {
      boundsRef.current = bounds;
      setSelectedBox(
        selectedClipId ? bounds.find((box) => box.clipId === selectedClipId) || null : null
      );
    };
    const drawLive = () => {
      if (cancelled || previewCache.has(displayTime)) return;
      setBounds(
        renderFrameToCanvas(
          context,
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
        )
      );
    };
    const draw = async () => {
      if (previewCache.has(displayTime)) {
        const bitmap =
          previewCache.peek(displayTime) ||
          (await previewCache.decode(previewCache.frameIndex(displayTime)));
        if (!cancelled && bitmap) {
          context.clearRect(0, 0, renderWidth, renderHeight);
          context.drawImage(bitmap, 0, 0, renderWidth, renderHeight);
          setBounds(previewCache.bounds(displayTime));
        }
        previewCache.prefetch(displayTime);
      } else if (!isPlaying) {
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
        drawLive();
      } else {
        drawLive();
      }
    };
    const unsubscribe = pool.subscribe(drawLive);
    // WebGL context restored after the OS reclaimed it (common on phones): redraw 3D layers.
    window.addEventListener('otto-3d-restored', drawLive);
    setFrameError(null);
    void draw().catch((error) => {
      if (!cancelled && !controller.signal.aborted) {
        setFrameError(error instanceof Error ? error.message : 'Erro na previa.');
      }
    });
    void document.fonts.ready.then(() => {
      if (!cancelled) drawLive();
    });
    return () => {
      cancelled = true;
      controller.abort();
      unsubscribe();
      window.removeEventListener('otto-3d-restored', drawLive);
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
    previewState.frameCount,
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
      const nx = Math.round((st.origX + dxPct) * 10) / 10;
      const ny = Math.round((st.origY + dyPct) * 10) / 10;

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
        <div
          style={{
            width: stageSize.width,
            height: stageSize.height,
            backgroundImage: project.transparentBg
              ? 'repeating-conic-gradient(#1f1f25 0% 25%, #2b2b34 0% 50%)'
              : undefined,
            backgroundSize: '20px 20px',
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

          {/* Selection Bounding Box + Anchor Point Overlay */}
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
              <span className="absolute -top-1.5 -left-1.5 w-2.5 h-2.5 bg-white border-2 border-[#2563eb] rounded-xs" />
              <span className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 bg-white border-2 border-[#2563eb] rounded-xs" />
              <span className="absolute -bottom-1.5 -left-1.5 w-2.5 h-2.5 bg-white border-2 border-[#2563eb] rounded-xs" />
              <span className="absolute -bottom-1.5 -right-1.5 w-2.5 h-2.5 bg-white border-2 border-[#2563eb] rounded-xs" />
              <Crosshair className="w-3.5 h-3.5 text-amber-400 drop-shadow absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
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
