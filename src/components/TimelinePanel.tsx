import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookmarkPlus,
  ChartSpline,
  Copy,
  Eye,
  EyeOff,
  Film,
  Headphones,
  Hexagon,
  Layers,
  Lock,
  Magnet,
  Maximize,
  Music,
  Plus,
  Scissors,
  Spline,
  Trash2,
  Type,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  Zap,
  ChevronDown,
} from 'lucide-react';
import {
  PropertyTrack,
  TimelineClip,
  TimelineMarker,
  Track,
  TrackType,
  WorkArea,
} from '../types/editor';
import { formatTimecode } from '../utils/mediaHelpers';
import { createEffect } from '../utils/sapphireEffects';
import { PreviewRenderBar } from './PreviewRenderBar';
import type { PreviewControlsProps } from './PreviewRenderBar';
import { PropertyGraphEditor } from './PropertyGraphEditor';
import { TimeRemapEditor } from './TimeRemapEditor';
import { clamp, getClipSourceTime, sliceTimeRemap } from '../utils/timeRemap';
import { slicePropertyTracks } from '../core/keyframes';

export type GraphDrawerTab = 'remap' | 'curves';

interface TimelinePanelProps extends PreviewControlsProps {
  graphOpen: boolean;
  graphTab: GraphDrawerTab;
  onChangeGraphTab: (tab: GraphDrawerTab) => void;
  onToggleGraph: () => void;
  copiedTrack: PropertyTrack | null;
  onCopyTrack: (track: PropertyTrack) => void;
  onPrecomposeSelected: () => void;
  onChangeWorkArea: (area: WorkArea) => void;
  tracks: Track[];
  clips: TimelineClip[];
  markers: TimelineMarker[];
  currentTime: number;
  totalDuration: number;
  selectedClipId: string | null;
  selectedClipIds?: string[];
  zoomPxPerSec: number;
  snapEnabled: boolean;
  onChangeZoom: (pxPerSec: number) => void;
  onToggleSnap: () => void;
  onSeek: (time: number) => void;
  onSelectClip: (clipId: string | null, additive?: boolean) => void;
  onSplitAtPlayhead: () => void;
  onDuplicateSelected: () => void;
  onDeleteSelected: (ripple?: boolean) => void;
  onAddMarker: () => void;
  onRemoveMarker: (markerId: string) => void;
  onAddTrack: (type: TrackType) => void;
  onToggleTrackProp: (trackId: string, prop: 'muted' | 'hidden' | 'locked' | 'solo') => void;
  onUpdateClipLive: (clipId: string, patch: Partial<TimelineClip>) => void;
  onCommitHistory: () => void;
  onDropAssetOnTrack: (assetId: string, trackId: string, dropTime: number) => void;
  onDropExternalFiles: (files: FileList, trackId: string, dropTime: number) => void;
  /** Phone layout: narrower track headers, shorter panel, touch-sized handles. */
  compact?: boolean;
  /** Fill parent height (phone landscape side-by-side layout). */
  fillHeight?: boolean;
}

const HEADER_WIDTH_DESKTOP = 168;
const HEADER_WIDTH_COMPACT = 92;
const TRACK_HEIGHT = 54;

export const TimelinePanel: React.FC<TimelinePanelProps> = ({
  tracks,
  clips,
  markers,
  currentTime,
  totalDuration,
  selectedClipId,
  selectedClipIds = [],
  zoomPxPerSec,
  snapEnabled,
  onChangeZoom,
  onToggleSnap,
  onSeek,
  onSelectClip,
  onSplitAtPlayhead,
  onDuplicateSelected,
  onDeleteSelected,
  onAddMarker,
  onRemoveMarker,
  onAddTrack,
  onToggleTrackProp,
  onUpdateClipLive,
  onCommitHistory,
  onDropAssetOnTrack,
  onDropExternalFiles,
  graphOpen,
  graphTab,
  onChangeGraphTab,
  onToggleGraph,
  copiedTrack,
  onCopyTrack,
  onPrecomposeSelected,
  onChangeWorkArea,
  workArea,
  fps,
  compact = false,
  fillHeight = false,
  ...previewControls
}) => {
  const HEADER_WIDTH = compact ? HEADER_WIDTH_COMPACT : HEADER_WIDTH_DESKTOP;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(() =>
    compact
      ? Math.min(300, Math.max(190, window.innerHeight * 0.34))
      : Math.min(360, Math.max(280, window.innerHeight * 0.4))
  );
  const [hideShy, setHideShy] = useState(false);
  const minPanelHeight = compact ? 150 : 230;

  // Keep panel inside the viewport when the screen rotates / mode switches.
  useEffect(() => {
    setPanelHeight((h) =>
      clamp(h, minPanelHeight, Math.max(minPanelHeight, window.innerHeight * (compact ? 0.6 : 0.68)))
    );
  }, [compact, minPanelHeight]);

  // Two-finger pinch zooms the timeline (native listeners: need passive:false).
  const zoomRef = useRef(zoomPxPerSec);
  zoomRef.current = zoomPxPerSec;
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    let startDist = 0;
    let startZoom = 0;
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDist = dist(e.touches);
        startZoom = zoomRef.current;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && startDist > 0) {
        e.preventDefault();
        onChangeZoom(Math.round(clamp(startZoom * (dist(e.touches) / startDist), 15, 160)));
      }
    };
    const onEnd = () => {
      startDist = 0;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphOpen]);
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) || null;
  const isPlayingArea = previewControls.playingWorkArea;

  useEffect(() => {
    if (!isPlayingArea || !scrollContainerRef.current) return;
    const element = scrollContainerRef.current;
    const x = HEADER_WIDTH + currentTime * zoomPxPerSec;
    if (
      x > element.scrollLeft + element.clientWidth - 60 ||
      x < element.scrollLeft + HEADER_WIDTH
    ) {
      element.scrollLeft = Math.max(0, x - HEADER_WIDTH - 60);
    }
  }, [currentTime, zoomPxPerSec, isPlayingArea]);

  const [snapGuideTime, setSnapGuideTime] = useState<number | null>(null);
  const [expandedTracks, setExpandedTracks] = useState<Set<string>>(new Set());
  const [addTrackOpen, setAddTrackOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    clipId: string;
    x: number;
    y: number;
  } | null>(null);

  const timelineSpanSec = Math.max(totalDuration + 12, 24);
  const timelineWidthPx = timelineSpanSec * zoomPxPerSec;

  const ticks = useMemo(() => {
    let majorStep = 1;
    if (zoomPxPerSec < 25) majorStep = 10;
    else if (zoomPxPerSec < 48) majorStep = 5;
    else if (zoomPxPerSec < 90) majorStep = 2;
    else majorStep = 1;

    const list: { time: number; major: boolean }[] = [];
    const subStep = majorStep / 2;
    for (let t = 0; t <= timelineSpanSec; t += subStep) {
      const rounded = Math.round(t * 100) / 100;
      const isMajor = Math.abs(rounded % majorStep) < 0.001;
      list.push({ time: rounded, major: isMajor });
    }
    return list;
  }, [timelineSpanSec, zoomPxPerSec]);

  const computeSnappedTime = (rawTime: number, ignoreClipId?: string): number => {
    const clamped = Math.max(0, rawTime);
    if (!snapEnabled) {
      setSnapGuideTime(null);
      return clamped;
    }

    const thresholdSec = 8 / zoomPxPerSec;
    const candidates: number[] = [0, currentTime, ...markers.map((m) => m.time)];
    for (const c of clips) {
      if (c.id === ignoreClipId) continue;
      candidates.push(c.startTime, c.startTime + c.duration);
    }

    let best = clamped;
    let bestDist = thresholdSec;
    let snapped = false;

    for (const pt of candidates) {
      const dist = Math.abs(clamped - pt);
      if (dist <= bestDist) {
        bestDist = dist;
        best = pt;
        snapped = true;
      }
    }

    setSnapGuideTime(snapped ? best : null);
    return best;
  };

  const clientXToTime = (clientX: number): number => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return 0;
    const rect = scroller.getBoundingClientRect();
    const xInContent = clientX - rect.left + scroller.scrollLeft - HEADER_WIDTH;
    return Math.max(0, xInContent / zoomPxPerSec);
  };

  const handleRulerMouseDown = (e: React.PointerEvent) => {
    e.preventDefault();
    onSeek(clientXToTime(e.clientX));

    const onMove = (ev: PointerEvent) => {
      onSeek(clientXToTime(ev.clientX));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const handleClipBodyMouseDown = (
    e: React.PointerEvent,
    clip: TimelineClip,
    track: Track
  ) => {
    e.stopPropagation();
    const isAdditive = e.shiftKey || e.ctrlKey || e.metaKey;
    const isAlreadyInGroup = selectedClipIds.length > 1 && selectedClipIds.includes(clip.id);
    if (isAdditive) {
      onSelectClip(clip.id, true);
      return;
    }
    if (!isAlreadyInGroup) {
      onSelectClip(clip.id, false);
    }

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let moved = false;
    let longPressTriggered = false;

    // Long-press on touch opens the quick clip action menu
    const longPressTimer =
      e.pointerType === 'touch'
        ? window.setTimeout(() => {
            if (!moved) {
              longPressTriggered = true;
              setContextMenu({
                clipId: clip.id,
                x: Math.max(12, Math.min(window.innerWidth - 220, startClientX - 80)),
                y: Math.max(12, Math.min(window.innerHeight - 280, startClientY - 180)),
              });
            }
          }, 460)
        : null;

    if (track.locked) {
      const clearTouch = () => {
        if (longPressTimer !== null) window.clearTimeout(longPressTimer);
        window.removeEventListener('pointerup', clearTouch);
        window.removeEventListener('pointercancel', clearTouch);
      };
      window.addEventListener('pointerup', clearTouch);
      window.addEventListener('pointercancel', clearTouch);
      return;
    }

    const origStart = clip.startTime;
    const origDuration = clip.duration;
    const groupIds = isAlreadyInGroup ? selectedClipIds : [clip.id];
    const groupOrigStarts = new Map<string, number>();
    for (const gid of groupIds) {
      const gc = clips.find((c) => c.id === gid);
      const gt = gc ? tracks.find((t) => t.id === gc.trackId) : undefined;
      if (gc && !gt?.locked) {
        groupOrigStarts.set(gid, gc.startTime);
      }
    }

    const onMove = (ev: PointerEvent) => {
      if (longPressTriggered) return;
      if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) > 7) {
        if (longPressTimer !== null) window.clearTimeout(longPressTimer);
      }
      const dxSec = (ev.clientX - startClientX) / zoomPxPerSec;
      let nextStart = Math.max(0, origStart + dxSec);

      const snappedStart = computeSnappedTime(nextStart, clip.id);
      if (snappedStart !== nextStart) {
        nextStart = snappedStart;
      } else {
        const snappedEnd = computeSnappedTime(nextStart + origDuration, clip.id);
        if (Math.abs(snappedEnd - (nextStart + origDuration)) < 8 / zoomPxPerSec) {
          nextStart = Math.max(0, snappedEnd - origDuration);
        }
      }

      let targetTrackId = clip.trackId;
      const scroller = scrollContainerRef.current;
      if (scroller && groupOrigStarts.size <= 1) {
        const rect = scroller.getBoundingClientRect();
        const relY = ev.clientY - rect.top + scroller.scrollTop - 48;
        const hoveredIdx = Math.floor(relY / TRACK_HEIGHT);
        const candidate = tracks[hoveredIdx];
        if (candidate && !candidate.locked) {
          const isCompatible =
            clip.type === 'audio'
              ? candidate.type === 'audio'
              : candidate.type !== 'audio';
          if (isCompatible) {
            targetTrackId = candidate.id;
          }
        }
      }

      moved = true;
      const roundedNextStart = Math.round(nextStart * fps) / fps;
      const appliedDelta = roundedNextStart - origStart;

      if (groupOrigStarts.size > 1) {
        for (const [gid, gStart] of groupOrigStarts.entries()) {
          onUpdateClipLive(gid, {
            startTime: Math.max(0, Math.round((gStart + appliedDelta) * fps) / fps),
          });
        }
      } else {
        onUpdateClipLive(clip.id, {
          startTime: roundedNextStart,
          trackId: targetTrackId,
        });
      }
    };

    const onUp = () => {
      if (longPressTimer !== null) window.clearTimeout(longPressTimer);
      setSnapGuideTime(null);
      if (moved) onCommitHistory();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const handleTrimLeftMouseDown = (
    e: React.PointerEvent,
    clip: TimelineClip,
    track: Track
  ) => {
    e.stopPropagation();
    onSelectClip(clip.id);
    if (track.locked) return;

    const startClientX = e.clientX;
    const origStart = clip.startTime;
    const origDuration = clip.duration;
    const origTrimStart = clip.trimStart;
    const clipEnd = origStart + origDuration;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dxSec = (ev.clientX - startClientX) / zoomPxPerSec;
      let proposedStart = computeSnappedTime(origStart + dxSec, clip.id);

      const minStartByMedia = clip.timeRemap?.enabled
        ? 0
        : origStart - origTrimStart / clip.speed;
      proposedStart = Math.round(proposedStart * fps) / fps;
      proposedStart = Math.max(0, minStartByMedia, Math.min(clipEnd - 0.25, proposedStart));

      const delta = proposedStart - origStart;
      const newDuration = clipEnd - proposedStart;
      const newTrimStart = clip.timeRemap?.enabled
        ? getClipSourceTime(clip, delta)
        : Math.max(0, origTrimStart + delta * clip.speed);

      moved = true;
      onUpdateClipLive(clip.id, {
        startTime: Number(proposedStart.toFixed(6)),
        duration: Number(newDuration.toFixed(6)),
        trimStart: newTrimStart,
        timeRemap: sliceTimeRemap(clip, delta, clip.duration),
        keyframes: slicePropertyTracks(clip.keyframes, delta, clip.duration),
      });
    };

    const onUp = () => {
      setSnapGuideTime(null);
      if (moved) onCommitHistory();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const handleTrimRightMouseDown = (
    e: React.PointerEvent,
    clip: TimelineClip,
    track: Track
  ) => {
    e.stopPropagation();
    onSelectClip(clip.id);
    if (track.locked) return;

    const startClientX = e.clientX;
    const origStart = clip.startTime;
    const origDuration = clip.duration;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dxSec = (ev.clientX - startClientX) / zoomPxPerSec;
      const proposedEnd =
        Math.round(computeSnappedTime(origStart + origDuration + dxSec, clip.id) * fps) / fps;
      const maxAllowedDuration = Math.max(
        0.25,
        clip.timeRemap?.enabled ? 300 : (clip.maxDuration - clip.trimStart) / clip.speed
      );
      const newDuration = Math.max(
        0.25,
        Math.min(maxAllowedDuration, proposedEnd - origStart)
      );

      moved = true;
      onUpdateClipLive(clip.id, {
        duration: Number(newDuration.toFixed(6)),
        timeRemap: sliceTimeRemap(clip, 0, Number(newDuration.toFixed(6))),
        keyframes: slicePropertyTracks(clip.keyframes, 0, Number(newDuration.toFixed(6))),
      });
    };

    const onUp = () => {
      setSnapGuideTime(null);
      if (moved) onCommitHistory();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const dragWorkArea = (event: React.PointerEvent, edge: 'start' | 'end' | 'move') => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const original = { ...workArea };
    const onMove = (ev: PointerEvent) => {
      const delta = Math.round(((ev.clientX - startX) / zoomPxPerSec) * fps) / fps;
      if (edge === 'start') {
        onChangeWorkArea({
          ...original,
          start: clamp(original.start + delta, 0, original.end - 1 / fps),
        });
      }
      if (edge === 'end') {
        onChangeWorkArea({
          ...original,
          end: clamp(original.end + delta, original.start + 1 / fps, totalDuration),
        });
      }
      if (edge === 'move') {
        const start = clamp(
          original.start + delta,
          0,
          totalDuration - (original.end - original.start)
        );
        onChangeWorkArea({ start, end: start + original.end - original.start });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      onCommitHistory();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
  };

  const handleFitToScreen = () => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;
    const availW = Math.max(240, scroller.clientWidth - HEADER_WIDTH - 48);
    const ideal = Math.max(15, Math.min(160, Math.floor(availW / Math.max(4, totalDuration))));
    onChangeZoom(ideal);
  };

  const handleStaggerClips = () => {
    const targetIds =
      selectedClipIds.length >= 2
        ? selectedClipIds
        : selectedClip
        ? clips.filter((c) => c.trackId === selectedClip.trackId).map((c) => c.id)
        : [];
    if (targetIds.length < 2) return;
    const sorted = clips
      .filter((c) => targetIds.includes(c.id))
      .sort((a, b) => a.startTime - b.startTime);
    const baseStart = sorted[0].startTime;
    const stepSec = Math.round(0.25 * fps) / fps;
    sorted.forEach((c, idx) => {
      onUpdateClipLive(c.id, {
        startTime: Number((baseStart + idx * stepSec).toFixed(4)),
      });
    });
    onCommitHistory();
  };

  return (
    <section
      style={fillHeight ? undefined : { height: panelHeight }}
      className={`timeline-panel ${compact ? 'is-compact' : ''} ${fillHeight ? 'is-fill flex-1 min-h-0' : 'shrink-0'} bg-[#121215] border-t border-[#27272a] flex flex-col select-none`}
    >
      {!fillHeight && <div
        className="timeline-resize-handle"
        role="separator"
        aria-label="Redimensionar timeline"
        aria-orientation="horizontal"
        onPointerDown={(event) => {
          event.preventDefault();
          const start = event.clientY;
          const height = panelHeight;
          const move = (ev: PointerEvent) =>
            setPanelHeight(clamp(height + start - ev.clientY, minPanelHeight, window.innerHeight * (compact ? 0.6 : 0.68)));
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up, { once: true });
          window.addEventListener('pointercancel', up, { once: true });
        }}
      >
        <span />
      </div>}

      <PreviewRenderBar {...previewControls} fps={fps} workArea={workArea} />

      {/* Timeline Action Toolbar */}
      <div className="h-10 px-3 bg-[#16161a] border-b border-[#27272a] flex items-center justify-between gap-2 shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1 shrink-0">
          <div className="timeline-view-tabs">
            <button
              className={!graphOpen ? 'active' : ''}
              onClick={() => {
                if (graphOpen) onToggleGraph();
              }}
            >
              <Layers size={12} />
              <span>Timeline</span>
            </button>
            <button
              className={graphOpen && graphTab === 'remap' ? 'active' : ''}
              onClick={() => {
                onChangeGraphTab('remap');
                if (!graphOpen) onToggleGraph();
              }}
              title="Time Remapping"
            >
              <ChartSpline size={13} />
              <span>Time Remapping</span>
            </button>
            <button
              className={graphOpen && graphTab === 'curves' ? 'active' : ''}
              onClick={() => {
                onChangeGraphTab('curves');
                if (!graphOpen) onToggleGraph();
              }}
              title="Graph Editor — Curvas de Propriedades"
            >
              <Spline size={13} />
              <span>Graph Editor</span>
            </button>
          </div>

          <div className="h-4 w-px bg-[#27272a] mx-1" />

          <button
            onClick={onSplitAtPlayhead}
            title="Dividir Camada na Agulha (Ctrl+Shift+D — After Effects)"
            className="px-2.5 py-1 rounded-md bg-[#1c1c21] hover:bg-[#27272a] border border-[#27272a] text-xs font-medium text-[#f4f4f5] flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Scissors className="w-3.5 h-3.5 text-[#ef4444]" />
            <span>Dividir</span>
            <kbd className="font-mono-code text-[9px] text-[#71717a] ml-0.5">Ctrl+Shift+D</kbd>
          </button>

          <button
            onClick={onDuplicateSelected}
            disabled={!selectedClipId}
            title="Duplicar Selecionado (Ctrl+D)"
            className="p-1.5 rounded-md text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21] disabled:opacity-35 transition-colors cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => onDeleteSelected(false)}
            disabled={!selectedClipId}
            title="Excluir Clipe (Delete)"
            className="p-1.5 rounded-md text-[#a1a1aa] hover:text-[#ef4444] hover:bg-[#ef4444]/10 disabled:opacity-35 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => onDeleteSelected(true)}
            disabled={!selectedClipId}
            title="Excluir e Fechar Espaço (Shift+Delete)"
            className="hidden sm:flex px-2 py-1 rounded-md text-[11px] text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21] disabled:opacity-35 transition-colors cursor-pointer"
          >
            Excluir + Juntar
          </button>

          <div className="h-4 w-px bg-[#27272a] mx-1" />

          <button
            onClick={onAddMarker}
            title="Inserir Marcador na Agulha (M)"
            className="p-1.5 rounded-md text-[#a1a1aa] hover:text-[#38bdf8] hover:bg-[#1c1c21] transition-colors cursor-pointer"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
          </button>

          {/* Add Track Dropdown */}
          <div className="relative">
            <button
              onClick={() => setAddTrackOpen((v) => !v)}
              className="px-2 py-1 rounded-md bg-[#1c1c21] hover:bg-[#27272a] border border-[#27272a] text-[11px] font-medium text-[#a1a1aa] hover:text-[#f4f4f5] flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>Faixa</span>
            </button>

            {addTrackOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAddTrackOpen(false)} />
                <div className="absolute left-0 bottom-9 w-48 rounded-lg bg-[#18181c] border border-[#27272a] shadow-xl py-1 z-50 text-xs">
                  <button
                    onClick={() => {
                      onAddTrack('video');
                      setAddTrackOpen(false);
                    }}
                    className="w-full px-3 py-1.5 flex items-center gap-2 text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
                  >
                    <Film className="w-3.5 h-3.5 text-[#6366f1]" />
                    <span>Nova Faixa de Vídeo</span>
                  </button>
                  <button
                    onClick={() => {
                      onAddTrack('shape');
                      setAddTrackOpen(false);
                    }}
                    className="w-full px-3 py-1.5 flex items-center gap-2 text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
                  >
                    <Hexagon className="w-3.5 h-3.5 text-[#38bdf8]" />
                    <span>Nova Faixa de Formas</span>
                  </button>
                  <button
                    onClick={() => {
                      onAddTrack('text');
                      setAddTrackOpen(false);
                    }}
                    className="w-full px-3 py-1.5 flex items-center gap-2 text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
                  >
                    <Type className="w-3.5 h-3.5 text-[#f59e0b]" />
                    <span>Nova Faixa de Texto</span>
                  </button>
                  <button
                    onClick={() => {
                      onAddTrack('audio');
                      setAddTrackOpen(false);
                    }}
                    className="w-full px-3 py-1.5 flex items-center gap-2 text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
                  >
                    <Music className="w-3.5 h-3.5 text-[#10b981]" />
                    <span>Nova Faixa de Áudio</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Snapping & Timeline Zoom */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleStaggerClips}
            title="Sequenciar / Stagger: desloca camadas selecionadas em cascata (0.25s)"
            className="px-2 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 border bg-[#1c1c21] hover:bg-[#27272a] border-[#27272a] text-[#a1a1aa] hover:text-[#f4f4f5] transition-colors cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 text-[#38bdf8]" />
            <span className="hidden lg:inline">Cascata</span>
          </button>

          <button
            onClick={() => setHideShy((v) => !v)}
            title="Ocultar / Mostrar camadas marcadas como Shy na timeline"
            className={`px-2 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 border transition-colors cursor-pointer ${
              hideShy
                ? 'bg-sky-500/20 border-sky-400/60 text-sky-300'
                : 'bg-[#1c1c21] border-[#27272a] text-[#71717a]'
            }`}
          >
            <EyeOff className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Shy</span>
          </button>

          <button
            onClick={onToggleSnap}
            title="Alinhamento Magnético (Ímã)"
            className={`px-2 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 border transition-colors cursor-pointer ${
              snapEnabled
                ? 'bg-[#2563eb]/20 border-[#2563eb]/50 text-[#60a5fa]'
                : 'bg-[#1c1c21] border-[#27272a] text-[#71717a]'
            }`}
          >
            <Magnet className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Ímã</span>
          </button>

          <div className="h-4 w-px bg-[#27272a]" />

          <button
            onClick={() => onChangeZoom(Math.max(15, zoomPxPerSec - 15))}
            title="Diminuir Zoom"
            className="p-1 rounded text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21] cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <input
            type="range"
            min={15}
            max={160}
            value={zoomPxPerSec}
            onChange={(e) => onChangeZoom(Number(e.target.value))}
            aria-label="Zoom da linha do tempo"
            className="studio-slider w-24"
          />

          <button
            onClick={() => onChangeZoom(Math.min(160, zoomPxPerSec + 15))}
            title="Aumentar Zoom"
            className="p-1 rounded text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21] cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleFitToScreen}
            title="Ajustar projeto inteiro na janela"
            className="p-1 rounded text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21] cursor-pointer"
          >
            <Maximize className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Graph Drawer: either Time Remapping or Multi-Property Curve Graph Editor */}
      {graphOpen &&
        (graphTab === 'curves' ? (
          <PropertyGraphEditor
            clip={selectedClip}
            fps={fps}
            currentTime={currentTime}
            locked={!!tracks.find((track) => track.id === selectedClip?.trackId)?.locked}
            copiedTrack={copiedTrack}
            onCopyTrack={onCopyTrack}
            onSeek={onSeek}
            onUpdateClipLive={onUpdateClipLive}
            onCommitHistory={onCommitHistory}
          />
        ) : (
          <TimeRemapEditor
            clip={selectedClip}
            fps={fps}
            currentTime={currentTime}
            locked={!!tracks.find((track) => track.id === selectedClip?.trackId)?.locked}
            onSeek={onSeek}
            onUpdateClipLive={onUpdateClipLive}
            onCommitHistory={onCommitHistory}
          />
        ))}

      {/* Scrollable Ruler + Multi-Track Area */}
      <div
        ref={scrollContainerRef}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 10 : -10;
            onChangeZoom(Math.max(15, Math.min(160, zoomPxPerSec + delta)));
          }
        }}
        className={`${graphOpen ? 'hidden' : 'flex-1'} overflow-auto relative bg-[#09090b]`}
      >
        <div
          style={{ width: `${HEADER_WIDTH + timelineWidthPx}px` }}
          className="min-w-full relative"
        >
          {/* Sticky Top Time Ruler Row */}
          <div className="h-12 sticky top-0 z-20 flex bg-[#121215] border-b border-[#27272a]">
            <div
              style={{ width: `${HEADER_WIDTH}px` }}
              className="shrink-0 sticky left-0 z-30 bg-[#121215] border-r border-[#27272a] px-3 flex items-center justify-between"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#71717a]">
                {compact ? `Faixas ${tracks.length}` : `Camadas (${tracks.length})`}
              </span>
              {!compact && (
                <span className="font-mono-code text-[10px] text-[#3b82f6]">
                  {zoomPxPerSec}px/s
                </span>
              )}
            </div>

            <div onPointerDown={handleRulerMouseDown} className="flex-1 relative cursor-pointer touch-none">
              <div className="work-area-rail">
                <div
                  title="Arraste para mover a area de trabalho"
                  className="work-area-selection"
                  style={{
                    left: workArea.start * zoomPxPerSec,
                    width: (workArea.end - workArea.start) * zoomPxPerSec,
                  }}
                  onPointerDown={(event) => dragWorkArea(event, 'move')}
                >
                  <span
                    className="work-area-handle left"
                    title="Inicio da area de trabalho (B)"
                    onPointerDown={(event) => dragWorkArea(event, 'start')}
                  />
                  <span className="work-area-center" />
                  <span
                    className="work-area-handle right"
                    title="Fim da area de trabalho (N)"
                    onPointerDown={(event) => dragWorkArea(event, 'end')}
                  />
                </div>
              </div>
              <div
                className="timeline-cache-base"
                style={{ width: totalDuration * zoomPxPerSec }}
              />
              {previewControls.previewState.ranges.map((range) => (
                <div
                  key={range.start}
                  className="timeline-cache-range"
                  data-testid="cached-range"
                  style={{
                    left: range.start * zoomPxPerSec,
                    width: (range.end - range.start) * zoomPxPerSec,
                  }}
                />
              ))}
              {ticks.map((tk) => (
                <div
                  key={tk.time}
                  style={{ left: `${tk.time * zoomPxPerSec}px` }}
                  className="absolute top-5 bottom-0 pointer-events-none"
                >
                  <div
                    className={`w-px ${
                      tk.major ? 'h-3.5 bg-[#52525b]' : 'h-2 bg-[#27272a]'
                    }`}
                  />
                  {tk.major && (
                    <span className="font-mono-code text-[9px] text-[#71717a] pl-1 -mt-0.5 block">
                      {formatTimecode(tk.time, false)}
                    </span>
                  )}
                </div>
              ))}

              {/* Timeline Markers */}
              {markers.map((mk) => (
                <button
                  key={mk.id}
                  style={{ left: `${mk.time * zoomPxPerSec}px` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeek(mk.time);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onRemoveMarker(mk.id);
                  }}
                  title={`${mk.label} (${formatTimecode(mk.time, false)}) • Clique direito para remover`}
                  className="absolute top-[22px] -translate-x-1/2 px-1.5 py-0.5 rounded bg-[#0ea5e9]/20 border border-[#38bdf8] text-[#7dd3fc] font-mono-code text-[9px] leading-none z-10 cursor-pointer"
                >
                  {mk.label}
                </button>
              ))}
            </div>
          </div>

          {/* Track Rows Stack */}
          <div className="relative">
            {tracks.map((track) => {
              const trackClips = clips.filter(
                (c) => c.trackId === track.id && (!hideShy || !c.shy)
              );

              return (
                <React.Fragment key={track.id}>
                <div
                  style={{ height: `${TRACK_HEIGHT}px` }}
                  className="flex flex-wrap border-b border-[#27272a]/70 relative"
                >
                  <div
                    style={{ width: `${HEADER_WIDTH}px` }}
                    className="shrink-0 sticky left-0 z-10 bg-[#121215] border-r border-[#27272a] px-2.5 flex items-center justify-between gap-1.5"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {track.type === 'video' && (
                        <Film className="w-3.5 h-3.5 shrink-0 text-[#6366f1]" />
                      )}
                      {track.type === '3d' && (
                        <span className="shrink-0 font-mono-code text-[9px] font-bold px-1 py-0.5 rounded bg-indigo-500/25 text-indigo-300 border border-indigo-500/40">
                          3D
                        </span>
                      )}
                      {track.type === 'shape' && (
                        <Hexagon className="w-3.5 h-3.5 shrink-0 text-[#38bdf8]" />
                      )}
                      {track.type === 'text' && (
                        <Type className="w-3.5 h-3.5 shrink-0 text-[#f59e0b]" />
                      )}
                      {track.type === 'audio' && (
                        <Music className="w-3.5 h-3.5 shrink-0 text-[#10b981]" />
                      )}
                      <span className="text-[11px] font-medium text-[#f4f4f5] truncate">
                        {track.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => {
                          const next = new Set(expandedTracks);
                          if (next.has(track.id)) next.delete(track.id);
                          else next.add(track.id);
                          setExpandedTracks(next);
                        }}
                        title={expandedTracks.has(track.id) ? 'Recolher propriedades da faixa' : 'Expandir propriedades da faixa (estilo After Effects)'}
                        aria-pressed={expandedTracks.has(track.id)}
                        className={`p-1 rounded transition-colors cursor-pointer ${
                          expandedTracks.has(track.id)
                            ? 'text-[#a5b4fc] bg-[#6366f1]/20'
                            : 'text-[#71717a] hover:text-[#f4f4f5]'
                        }`}
                      >
                        <ChevronDown className={`w-3 h-3 transition-transform ${expandedTracks.has(track.id) ? 'rotate-180' : ''}`} />
                      </button>
                      <button
                        onClick={() => onToggleTrackProp(track.id, 'solo')}
                        title={
                          track.solo
                            ? 'Desativar Solo'
                            : 'Solo — isolar esta camada (como no After Effects)'
                        }
                        aria-pressed={!!track.solo}
                        className={`p-1 rounded transition-colors cursor-pointer ${
                          track.solo
                            ? 'text-[#fbbf24] bg-[#f59e0b]/20'
                            : 'text-[#71717a] hover:text-[#f4f4f5]'
                        }`}
                      >
                        <Headphones className="w-3 h-3" />
                      </button>

                      {(track.type === 'audio' || track.type === 'video') && (
                        <button
                          onClick={() => onToggleTrackProp(track.id, 'muted')}
                          title={track.muted ? 'Ativar áudio da faixa' : 'Silenciar faixa'}
                          className={`p-1 rounded transition-colors cursor-pointer ${
                            track.muted
                              ? 'text-[#ef4444] bg-[#ef4444]/15'
                              : 'text-[#71717a] hover:text-[#f4f4f5]'
                          }`}
                        >
                          {track.muted ? (
                            <VolumeX className="w-3 h-3" />
                          ) : (
                            <Volume2 className="w-3 h-3" />
                          )}
                        </button>
                      )}

                      {track.type !== 'audio' && (
                        <button
                          onClick={() => onToggleTrackProp(track.id, 'hidden')}
                          title={track.hidden ? 'Mostrar faixa' : 'Ocultar faixa'}
                          className={`p-1 rounded transition-colors cursor-pointer ${
                            track.hidden
                              ? 'text-[#f59e0b] bg-[#f59e0b]/15'
                              : 'text-[#71717a] hover:text-[#f4f4f5]'
                          }`}
                        >
                          {track.hidden ? (
                            <EyeOff className="w-3 h-3" />
                          ) : (
                            <Eye className="w-3 h-3" />
                          )}
                        </button>
                      )}

                      <button
                        onClick={() => onToggleTrackProp(track.id, 'locked')}
                        title={track.locked ? 'Desbloquear faixa' : 'Bloquear faixa'}
                        className={`p-1 rounded transition-colors cursor-pointer ${
                          track.locked
                            ? 'text-[#60a5fa] bg-[#2563eb]/20'
                            : 'text-[#71717a] hover:text-[#f4f4f5]'
                        }`}
                      >
                        {track.locked ? (
                          <Lock className="w-3 h-3" />
                        ) : (
                          <Unlock className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Track Clip Lane */}
                  <div
                    onClick={(e) => {
                      if (e.target === e.currentTarget) {
                        onSelectClip(null);
                        onSeek(clientXToTime(e.clientX));
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (track.locked) return;
                      const dropTime = computeSnappedTime(clientXToTime(e.clientX));
                      setSnapGuideTime(null);
                      const assetId = e.dataTransfer.getData('application/x-asset-id');
                      if (assetId) {
                        onDropAssetOnTrack(assetId, track.id, dropTime);
                      } else if (e.dataTransfer.files?.length) {
                        onDropExternalFiles(e.dataTransfer.files, track.id, dropTime);
                      }
                    }}
                    className={`flex-1 relative transition-colors ${
                      track.locked || track.hidden
                        ? 'opacity-50 bg-[#0d0d10]'
                        : 'hover:bg-[#121216]/60'
                    }`}
                  >
                    {trackClips.map((clip) => {
                      const leftPx = clip.startTime * zoomPxPerSec;
                      const widthPx = Math.max(18, clip.duration * zoomPxPerSec);
                      const isPrimarySelected = clip.id === selectedClipId;
                      const isMultiSelected = selectedClipIds.includes(clip.id);
                      const isSelected = isPrimarySelected || isMultiSelected;

                      const bgStyle =
                        clip.type === 'video' || clip.type === 'image' || clip.type === 'svg'
                          ? 'bg-[#312e81]/90 border-[#6366f1]/70'
                          : clip.type === 'audio'
                          ? 'bg-[#064e3b]/90 border-[#10b981]/70'
                          : clip.type === 'shape'
                          ? 'bg-[#0c4a6e]/90 border-[#38bdf8]/70'
                          : clip.type === 'model3d'
                          ? 'bg-[#312e81] border-indigo-400/80'
                          : clip.type === 'camera'
                          ? 'bg-[#0c4a6e] border-sky-400/80'
                          : clip.type === 'light'
                          ? 'bg-[#713f12] border-amber-400/80'
                          : clip.type === 'lottie'
                          ? 'bg-[#4c1d95]/90 border-[#a855f7]/70'
                          : clip.type === 'adjustment'
                          ? 'bg-[#701a75]/90 border-[#f472b6]/70'
                          : clip.type === 'null'
                          ? 'bg-[#3f3f46]/90 border-[#fbbf24]/70'
                          : clip.type === 'precomp'
                          ? 'bg-[#134e4a]/90 border-[#2dd4bf]/70'
                          : clip.type === 'solid'
                          ? 'bg-[#1e3a8a]/90 border-[#60a5fa]/70'
                          : 'bg-[#78350f]/90 border-[#f59e0b]/70';

                      const allPropKeyTimes = Array.from(
                        new Set(
                          (clip.keyframes || []).flatMap((tr) =>
                            tr.keyframes.map((k) => Number(k.time.toFixed(2)))
                          )
                        )
                      );

                      return (
                        <div
                          key={clip.id}
                          style={{
                            left: `${leftPx}px`,
                            width: `${widthPx}px`,
                            borderLeftColor: clip.labelColor || undefined,
                            borderLeftWidth: clip.labelColor ? '4px' : undefined,
                          }}
                          onPointerDown={(e) => handleClipBodyMouseDown(e, clip, track)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            onSelectClip(clip.id);
                            onSeek(clip.startTime);
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onSelectClip(clip.id);
                            setContextMenu({
                              clipId: clip.id,
                              x: Math.min(window.innerWidth - 210, e.clientX),
                              y: Math.max(12, e.clientY - 210),
                            });
                          }}
                          className={`group/clip touch-none absolute top-1 bottom-1 rounded-md border overflow-hidden cursor-grab active:cursor-grabbing select-none ${bgStyle} ${
                            isPrimarySelected
                              ? 'ring-2 ring-[#3b82f6] border-white z-10 shadow-lg'
                              : isMultiSelected
                              ? 'ring-2 ring-cyan-400 border-cyan-200 z-10 shadow-md'
                              : 'hover:brightness-110'
                          }`}
                        >
                          {clip.thumbnail && (
                            <div
                              style={{
                                backgroundImage: `url(${clip.thumbnail})`,
                                backgroundRepeat: 'repeat-x',
                                backgroundSize: 'auto 100%',
                              }}
                              className="absolute inset-0 opacity-35 pointer-events-none"
                            />
                          )}

                          {clip.waveform && clip.waveform.length > 0 && (
                            <div className="absolute inset-x-1 bottom-0.5 h-6 flex items-end gap-[2px] pointer-events-none opacity-75">
                              {clip.waveform.map((val, idx) => (
                                <div
                                  key={idx}
                                  style={{ height: `${Math.max(14, val * 100)}%` }}
                                  className={`flex-1 rounded-t-xs ${
                                    clip.type === 'audio'
                                      ? 'bg-[#34d399]'
                                      : 'bg-[#a5b4fc]/60'
                                  }`}
                                />
                              ))}
                            </div>
                          )}

                          {clip.transitionIn !== 'none' && clip.transitionInDuration > 0 && (
                            <div
                              style={{
                                width: `${Math.min(
                                  widthPx * 0.45,
                                  clip.transitionInDuration * zoomPxPerSec
                                )}px`,
                              }}
                              className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-white/25 to-transparent pointer-events-none"
                            />
                          )}
                          {clip.transitionOut !== 'none' && clip.transitionOutDuration > 0 && (
                            <div
                              style={{
                                width: `${Math.min(
                                  widthPx * 0.45,
                                  clip.transitionOutDuration * zoomPxPerSec
                                )}px`,
                              }}
                              className="absolute right-0 top-0 bottom-0 bg-gradient-to-l from-white/25 to-transparent pointer-events-none"
                            />
                          )}

                          <div className="relative z-10 px-2.5 py-1 flex items-center justify-between gap-1 pointer-events-none">
                            <span className="text-[11px] font-medium text-white truncate drop-shadow flex items-center gap-1">
                              {clip.solo && (
                                <span className="px-1 py-0.2 rounded bg-amber-400 text-black text-[8px] font-bold">
                                  SOLO
                                </span>
                              )}
                              {clip.guideLayer && (
                                <span className="px-1 py-0.2 rounded bg-emerald-400 text-black text-[8px] font-bold">
                                  GUIA
                                </span>
                              )}
                              {clip.type === 'text' && clip.textStyle
                                ? clip.textStyle.text
                                : clip.name}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              {clip.type !== 'audio' && (
                                <button
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectClip(clip.id);
                                    const hasFmb = clip.effects?.some((fx) => fx.type === 'S_ForceMotionBlur' && fx.enabled);
                                    if (hasFmb) {
                                      onUpdateClipLive(clip.id, {
                                        effects: clip.effects!.map((fx) =>
                                          fx.type === 'S_ForceMotionBlur' ? { ...fx, enabled: false } : fx
                                        ),
                                      });
                                    } else {
                                      const fmb = createEffect('S_ForceMotionBlur');
                                      if (fmb) {
                                        onUpdateClipLive(clip.id, {
                                          effects: [...(clip.effects || []), fmb],
                                        });
                                      }
                                    }
                                    onCommitHistory();
                                  }}
                                  title={clip.effects?.some((fx) => fx.type === 'S_ForceMotionBlur' && fx.enabled)
                                    ? 'CC Force Motion Blur: ON (clique para desligar)'
                                    : 'CC Force Motion Blur: OFF (clique para ativar)'}
                                  aria-pressed={!!clip.effects?.some((fx) => fx.type === 'S_ForceMotionBlur' && fx.enabled)}
                                  className={`pointer-events-auto p-0.5 rounded transition-colors cursor-pointer ${
                                    clip.effects?.some((fx) => fx.type === 'S_ForceMotionBlur' && fx.enabled)
                                      ? 'text-cyan-200 bg-cyan-500/40'
                                      : 'text-white/60 hover:text-white bg-black/30'
                                  }`}
                                >
                                  <Zap size={11} />
                                </button>
                              )}
                              {clip.vfx && (clip.vfx.background?.enabled || clip.vfx.cleanup?.enabled || clip.vfx.stabilization?.enabled || clip.vfx.tracking) && <span className="vision-clip-badge" title="Recorte, tracking ou estabilizacao aplicados a midia de origem">VFX</span>}
                              {!!clip.masks?.length && (
                                <span className="font-mono-code text-[9px] px-1 rounded bg-amber-500/30 text-amber-200">
                                  M{clip.masks.length}
                                </span>
                              )}
                              {!!clip.effects?.filter((effect) => effect.enabled).length && (
                                <span
                                  className="fx-clip-badge"
                                  title={`${
                                    clip.effects.filter((effect) => effect.enabled).length
                                  } efeito(s)`}
                                >
                                  fx {clip.effects.filter((effect) => effect.enabled).length}
                                </span>
                              )}
                              {clip.timeRemap?.enabled && (
                                <span className="remap-clip-badge" title="Time Remapping ativo">
                                  <ChartSpline size={10} />
                                  TR
                                </span>
                              )}
                              {clip.speed !== 1 && !clip.timeRemap?.enabled && (
                                <span className="font-mono-code text-[9px] px-1 rounded bg-black/60 text-[#fde047]">
                                  {clip.speed}x
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Time Remap Keyframe Diamonds */}
                          {clip.timeRemap?.enabled && (
                            <div className="clip-keyframe-lane">
                              {clip.timeRemap.keyframes.map((key) => (
                                <button
                                  key={key.id}
                                  title={`Keyframe: ${key.time.toFixed(2)}s / origem ${key.sourceTime.toFixed(2)}s`}
                                  style={{ left: `${(key.time / clip.duration) * 100}%` }}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onSelectClip(clip.id);
                                    onSeek(clip.startTime + Math.min(key.time, clip.duration - 1 / fps));
                                  }}
                                />
                              ))}
                            </div>
                          )}

                          {/* Property Keyframe Diamonds */}
                          {!clip.timeRemap?.enabled && allPropKeyTimes.length > 0 && (
                            <div className="clip-keyframe-lane">
                              {allPropKeyTimes.map((kt) => (
                                <button
                                  key={kt}
                                  title={`Keyframe de propriedade em ${kt.toFixed(2)}s`}
                                  style={{ left: `${(kt / Math.max(0.05, clip.duration)) * 100}%` }}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onSelectClip(clip.id);
                                    onSeek(clip.startTime + Math.min(kt, clip.duration - 1 / fps));
                                  }}
                                />
                              ))}
                            </div>
                          )}

                          <div
                            onPointerDown={(e) => handleTrimLeftMouseDown(e, clip, track)}
                            title="Arrastar para aparar início"
                            className={`absolute left-0 top-0 bottom-0 ${compact ? 'w-4' : 'w-2.5'} touch-none bg-black/35 hover:bg-[#3b82f6] flex items-center justify-center cursor-ew-resize z-20 transition-opacity ${isSelected || compact ? 'opacity-100' : 'opacity-0 group-hover/clip:opacity-100'}`}
                          >
                            <div className="w-0.5 h-4 bg-white/90 rounded-full" />
                          </div>

                          <div
                            onPointerDown={(e) => handleTrimRightMouseDown(e, clip, track)}
                            title="Arrastar para aparar fim"
                            className={`absolute right-0 top-0 bottom-0 ${compact ? 'w-4' : 'w-2.5'} touch-none bg-black/35 hover:bg-[#3b82f6] flex items-center justify-center cursor-ew-resize z-20 transition-opacity ${isSelected || compact ? 'opacity-100' : 'opacity-0 group-hover/clip:opacity-100'}`}
                          >
                            <div className="w-0.5 h-4 bg-white/90 rounded-full" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {expandedTracks.has(track.id) && (
                  <div className="border-b border-[#27272a]/70 bg-[#0c0c10] px-3 py-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                    <div className="space-y-1">
                      <p className="text-[#71717a] font-semibold uppercase tracking-wide">Áudio</p>
                      <button
                        onClick={() => onToggleTrackProp(track.id, 'muted')}
                        className={`w-full text-left px-2 py-1 rounded border cursor-pointer ${
                          track.muted
                            ? 'bg-[#ef4444]/15 border-[#ef4444]/40 text-[#fca5a5]'
                            : 'bg-[#18181c] border-[#27272a] text-[#a1a1aa]'
                        }`}
                      >
                        {track.muted ? 'Mudo' : 'Som ativo'}
                      </button>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[#71717a] font-semibold uppercase tracking-wide">Vídeo</p>
                      <button
                        onClick={() => onToggleTrackProp(track.id, 'hidden')}
                        className={`w-full text-left px-2 py-1 rounded border cursor-pointer ${
                          track.hidden
                            ? 'bg-[#f59e0b]/15 border-[#f59e0b]/40 text-[#fcd34d]'
                            : 'bg-[#18181c] border-[#27272a] text-[#a1a1aa]'
                        }`}
                      >
                        {track.hidden ? 'Oculto' : 'Visível'}
                      </button>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[#71717a] font-semibold uppercase tracking-wide">Edição</p>
                      <button
                        onClick={() => onToggleTrackProp(track.id, 'locked')}
                        className={`w-full text-left px-2 py-1 rounded border cursor-pointer ${
                          track.locked
                            ? 'bg-[#2563eb]/15 border-[#3b82f6]/40 text-[#93c5fd]'
                            : 'bg-[#18181c] border-[#27272a] text-[#a1a1aa]'
                        }`}
                      >
                        {track.locked ? 'Bloqueada' : 'Livre'}
                      </button>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[#71717a] font-semibold uppercase tracking-wide">Solo</p>
                      <button
                        onClick={() => onToggleTrackProp(track.id, 'solo')}
                        className={`w-full text-left px-2 py-1 rounded border cursor-pointer ${
                          track.solo
                            ? 'bg-[#f59e0b]/15 border-[#f59e0b]/40 text-[#fcd34d]'
                            : 'bg-[#18181c] border-[#27272a] text-[#a1a1aa]'
                        }`}
                      >
                        {track.solo ? 'Solo ON' : 'Solo OFF'}
                      </button>
                    </div>
                    <p className="col-span-2 sm:col-span-4 text-[#52525b]">
                      {trackClips.length} clipe(s) nesta faixa • posição/escala/rotação de cada clipe ficam no Inspetor ao selecionar
                    </p>
                  </div>
                )}
                </React.Fragment>
              );
            })}

            {snapGuideTime !== null && (
              <div
                style={{ left: `${HEADER_WIDTH + snapGuideTime * zoomPxPerSec}px` }}
                className="pointer-events-none absolute -top-12 bottom-0 w-px bg-[#38bdf8] shadow-[0_0_8px_#38bdf8] z-30"
              />
            )}

            <div
              style={{ left: `${HEADER_WIDTH + currentTime * zoomPxPerSec}px` }}
              className="pointer-events-none absolute -top-12 bottom-0 z-30"
            >
              <div
                onPointerDown={handleRulerMouseDown}
                className={`pointer-events-auto touch-none -translate-x-1/2 ${compact ? 'w-6 h-6' : 'w-3.5 h-4'} bg-[#ef4444] rounded-b-sm shadow cursor-ew-resize flex items-center justify-center`}
              >
                <div className="w-0.5 h-2 bg-white/80 rounded-full" />
              </div>
              <div className="w-[1.5px] -translate-x-[0.5px] h-full bg-[#ef4444] shadow-[0_0_6px_rgba(239,68,68,0.65)]" />
            </div>
          </div>
        </div>
      </div>

      {/* Right-Click Clip Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
            className="fixed z-50 w-52 rounded-lg bg-[#18181c] border border-[#3f3f46] shadow-2xl py-1 text-xs"
          >
            <button
              onClick={() => {
                onSplitAtPlayhead();
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 flex items-center justify-between text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
            >
              <span>Dividir na Agulha</span>
              <span className="font-mono-code text-[10px] text-[#71717a]">Ctrl+Shift+D</span>
            </button>
            <button
              onClick={() => {
                onDuplicateSelected();
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 flex items-center justify-between text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
            >
              <span>Duplicar Clipe</span>
              <span className="font-mono-code text-[10px] text-[#71717a]">Ctrl+D</span>
            </button>
            <button
              onClick={() => {
                onPrecomposeSelected();
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 flex items-center justify-between text-[#34d399] hover:bg-[#27272a] cursor-pointer"
            >
              <span>Pré-compor Camada</span>
              <span className="font-mono-code text-[10px] text-[#71717a]">Ctrl+Shift+C</span>
            </button>
            <button
              onClick={() => {
                const c = clips.find((item) => item.id === contextMenu.clipId);
                if (c) {
                  onUpdateClipLive(c.id, { muted: !c.muted });
                  onCommitHistory();
                }
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
            >
              Alternar Áudio (Mudo)
            </button>
            <button
              onClick={() => {
                onChangeGraphTab('curves');
                if (!graphOpen) onToggleGraph();
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left text-[#93c5fd] hover:bg-[#27272a] cursor-pointer"
            >
              Graph Editor / Time Remap
            </button>
            <div className="my-1 h-px bg-[#27272a]" />
            <button
              onClick={() => {
                onDeleteSelected(false);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 flex items-center justify-between text-[#fca5a5] hover:bg-[#ef4444]/15 cursor-pointer"
            >
              <span>Excluir Clipe</span>
              <span className="font-mono-code text-[10px] text-[#71717a]">Del</span>
            </button>
            <button
              onClick={() => {
                onDeleteSelected(true);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left text-[#fca5a5] hover:bg-[#ef4444]/15 cursor-pointer"
            >
              Excluir e Fechar Espaço
            </button>
          </div>
        </>
      )}
    </section>
  );
};
