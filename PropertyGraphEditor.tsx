import React, { useId, useMemo, useRef, useState } from 'react';
import {
  Clipboard,
  Copy,
  Diamond,
  FlipHorizontal,
  FlipVertical,
  Plus,
  Spline,
  Star,
  Trash2,
  Wand2,
} from 'lucide-react';
import type {
  AnimatableProperty,
  EasingName,
  PropertyKeyframe,
  PropertyTrack,
  TimelineClip,
  TrackLoopMode,
} from '../types/editor';
import {
  DEFAULT_IN_HANDLE,
  DEFAULT_OUT_HANDLE,
  EASING_PRESETS,
  invertCurveValues,
  mirrorCurveTiming,
  SavedCurvePreset,
  scaleCurveIntensity,
  smoothCurveKeyframes,
} from '../core/easing';
import {
  ANIMATABLE_PROPERTIES,
  deleteKeyframesFromTrack,
  evaluatePropertyTrack,
  getClipBasePropertyValue,
  getPropertyVelocity,
  sortPropertyKeyframes,
  upsertKeyframeOnClip,
} from '../core/keyframes';
import { clamp } from '../utils/timeRemap';

interface PropertyGraphEditorProps {
  clip: TimelineClip | null;
  fps: number;
  currentTime: number;
  locked: boolean;
  copiedTrack: PropertyTrack | null;
  onCopyTrack: (track: PropertyTrack) => void;
  onSeek: (time: number) => void;
  onUpdateClipLive: (clipId: string, patch: Partial<TimelineClip>) => void;
  onCommitHistory: () => void;
}

const SAVED_CURVES_STORAGE = 'cinecorte.customCurves.v1';

function loadSavedCurves(): SavedCurvePreset[] {
  try {
    const raw = localStorage.getItem(SAVED_CURVES_STORAGE);
    if (!raw) {
      return [
        {
          id: 'curve-snappy',
          name: 'Snappy Motion',
          favorite: true,
          outHandle: { x: 0.18, y: 0.85 },
          inHandle: { x: 0.72, y: 0.02 },
        },
        {
          id: 'curve-velvet',
          name: 'Velvet Settle',
          favorite: true,
          outHandle: { x: 0.45, y: 0 },
          inHandle: { x: 0.82, y: 0 },
        },
      ];
    }
    return JSON.parse(raw) as SavedCurvePreset[];
  } catch {
    return [];
  }
}

export const PropertyGraphEditor: React.FC<PropertyGraphEditorProps> = ({
  clip,
  fps,
  currentTime,
  locked,
  copiedTrack,
  onCopyTrack,
  onSeek,
  onUpdateClipLive,
  onCommitHistory,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const graphId = useId().replace(/:/g, '');
  const [selectedProp, setSelectedProp] = useState<AnimatableProperty>('scale');
  const [graphMode, setGraphMode] = useState<'value' | 'speed'>('value');
  const [selectedKeyIds, setSelectedKeyIds] = useState<string[]>([]);
  const [savedCurves, setSavedCurves] = useState<SavedCurvePreset[]>(() => loadSavedCurves());

  const persistCurves = (next: SavedCurvePreset[]) => {
    setSavedCurves(next);
    try {
      localStorage.setItem(SAVED_CURVES_STORAGE, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
  };

  if (!clip) {
    return (
      <div className="remap-empty" data-testid="property-graph-empty">
        <Spline size={22} />
        <strong>Selecione uma camada na timeline</strong>
        <span>O Graph Editor anima Posição, Escala, Rotação, Opacidade, Trim Paths e Máscaras com curvas Bézier reais.</span>
      </div>
    );
  }

  const propMeta = ANIMATABLE_PROPERTIES.find((p) => p.key === selectedProp) || ANIMATABLE_PROPERTIES[0];
  const localTime = clamp(currentTime - clip.startTime, 0, clip.duration);
  const baseValue = getClipBasePropertyValue(clip, selectedProp);
  const currentTrack = clip.keyframes?.find((t) => t.property === selectedProp);
  const keys = useMemo(
    () => sortPropertyKeyframes(currentTrack?.keyframes || []),
    [currentTrack]
  );

  const updateTrack = (updater: (track: PropertyTrack) => PropertyTrack, commit = true) => {
    if (locked) return;
    const baseTrack: PropertyTrack = currentTrack || {
      property: selectedProp,
      keyframes: [],
    };
    const nextTrack = updater(baseTrack);
    const others = (clip.keyframes || []).filter((t) => t.property !== selectedProp);
    const nextAll =
      nextTrack.keyframes.length > 0 || nextTrack.expression
        ? [...others, nextTrack]
        : others;
    onUpdateClipLive(clip.id, { keyframes: nextAll });
    if (commit) onCommitHistory();
  };

  const addKeyframeAtPlayhead = () => {
    if (locked) return;
    const evalNow = evaluatePropertyTrack(currentTrack, localTime, baseValue);
    const nextTracks = upsertKeyframeOnClip(clip, selectedProp, localTime, evalNow, 'bezier');
    onUpdateClipLive(clip.id, { keyframes: nextTracks });
    onCommitHistory();
  };

  const addQuickRamp = () => {
    if (locked) return;
    const vStart = selectedProp === 'opacity' || selectedProp === 'trimEndPct' ? 0 : baseValue - 30;
    const vEnd = selectedProp === 'opacity' || selectedProp === 'trimEndPct' ? 100 : baseValue;
    updateTrack(() => ({
      property: selectedProp,
      loop: currentTrack?.loop || 'none',
      expression: currentTrack?.expression,
      expressionEnabled: currentTrack?.expressionEnabled,
      keyframes: [
        {
          id: `pkf-${Math.random().toString(36).slice(2, 8)}`,
          time: 0,
          value: vStart,
          easing: 'bezier',
          outHandle: { x: 0.25, y: 0.8 },
          inHandle: { x: 0.35, y: 0 },
        },
        {
          id: `pkf-${Math.random().toString(36).slice(2, 8)}`,
          time: Math.min(clip.duration, 1.2),
          value: vEnd,
          easing: 'linear',
          outHandle: { ...DEFAULT_OUT_HANDLE },
          inHandle: { x: 0.65, y: 0 },
        },
      ],
    }));
  };

  const applyPresetEasing = (easing: EasingName) => {
    if (!keys.length || locked) return;
    const presetMeta = EASING_PRESETS.find((e) => e.id === easing);
    const selSet = new Set(selectedKeyIds);
    updateTrack((tr) => ({
      ...tr,
      keyframes: tr.keyframes.map((k) =>
        selSet.size === 0 || selSet.has(k.id)
          ? {
              ...k,
              easing,
              outHandle: presetMeta ? { ...presetMeta.outHandle } : k.outHandle,
              inHandle: presetMeta ? { ...presetMeta.inHandle } : k.inHandle,
            }
          : k
      ),
    }));
  };

  // Sample curve across 140 steps for crisp SVG plotting
  const W = 1000;
  const H = 225;
  const L = 58;
  const R = W - 24;
  const T = 20;
  const B = H - 28;

  const samples = Array.from({ length: 141 }, (_, i) => {
    const t = (i / 140) * clip.duration;
    return graphMode === 'speed'
      ? getPropertyVelocity(currentTrack, t, baseValue)
      : evaluatePropertyTrack(currentTrack, t, baseValue);
  });

  const rawMin = Math.min(...samples, ...(graphMode === 'value' ? keys.map((k) => k.value) : [0]));
  const rawMax = Math.max(...samples, ...(graphMode === 'value' ? keys.map((k) => k.value) : [1]));
  const pad = Math.max(5, (rawMax - rawMin) * 0.16);
  const minY = rawMin - pad;
  const maxY = rawMax + pad;

  const toX = (t: number) => L + (t / Math.max(0.05, clip.duration)) * (R - L);
  const toY = (v: number) => B - ((v - minY) / Math.max(0.001, maxY - minY)) * (B - T);

  const clientToGraph = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const t = clamp((((clientX - rect.left) / rect.width) * W - L) / (R - L) * clip.duration, 0, clip.duration);
    const v = ((B - ((clientY - rect.top) / rect.height) * H) / (B - T)) * (maxY - minY) + minY;
    return { time: t, value: v };
  };

  const pathD = samples
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX((i / 140) * clip.duration).toFixed(1)} ${toY(v).toFixed(1)}`)
    .join(' ');

  const startKeyDrag = (
    e: React.PointerEvent,
    key: PropertyKeyframe,
    handleSide?: 'outHandle' | 'inHandle'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (locked || graphMode !== 'value') return;

    const multi = e.shiftKey
      ? selectedKeyIds.includes(key.id)
        ? selectedKeyIds
        : [...selectedKeyIds, key.id]
      : [key.id];
    setSelectedKeyIds(multi);

    const startPt = clientToGraph(e.clientX, e.clientY);
    const snapshotKeys = keys.map((k) => ({ ...k }));
    const keyIdx = snapshotKeys.findIndex((k) => k.id === key.id);
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      moved = true;
      const pt = clientToGraph(ev.clientX, ev.clientY);
      if (handleSide) {
        const neighbor = snapshotKeys[keyIdx + (handleSide === 'outHandle' ? 1 : -1)];
        if (!neighbor) return;
        const dt = Math.max(0.01, Math.abs(neighbor.time - key.time));
        const dv = neighbor.value - key.value;
        const normX = clamp(
          handleSide === 'outHandle' ? (pt.time - key.time) / dt : (key.time - pt.time) / dt,
          0.02,
          0.98
        );
        const normY =
          Math.abs(dv) > 1e-4
            ? clamp(
                handleSide === 'outHandle'
                  ? (pt.value - key.value) / dv
                  : (key.value - pt.value) / dv,
                -1.5,
                2.2
              )
            : 0;
        updateTrack(
          (tr) => ({
            ...tr,
            keyframes: tr.keyframes.map((k) =>
              k.id === key.id
                ? { ...k, easing: 'bezier', [handleSide]: { x: Number(normX.toFixed(3)), y: Number(normY.toFixed(3)) } }
                : k
            ),
          }),
          false
        );
      } else {
        const dTime = pt.time - startPt.time;
        const dVal = pt.value - startPt.value;
        const selSet = new Set(multi);
        updateTrack(
          (tr) => ({
            ...tr,
            keyframes: sortPropertyKeyframes(
              snapshotKeys.map((k) =>
                selSet.has(k.id)
                  ? {
                      ...k,
                      time: Number(clamp(k.time + dTime, 0, clip.duration).toFixed(3)),
                      value: Number(clamp(k.value + dVal, propMeta.min, propMeta.max).toFixed(2)),
                    }
                  : k
              )
            ),
          }),
          false
        );
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) onCommitHistory();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  const activeSelectedKey = keys.find((k) => selectedKeyIds.includes(k.id)) || keys[0];

  return (
    <div className="time-remap-editor" data-testid="property-graph-editor">
      {/* Left Sidebar inside Graph Drawer */}
      <div className="remap-properties">
        <div className="remap-heading">
          <span>
            <Spline size={14} /> Graph Editor
          </span>
          <span className="font-mono-code text-[10px] text-[#60a5fa]">
            {keys.length} KF
          </span>
        </div>

        <label className="text-[10px] text-[#a1a1aa] flex flex-col gap-1">
          Propriedade Animada
          <select
            aria-label="Propriedade do Graph Editor"
            value={selectedProp}
            onChange={(e) => {
              setSelectedProp(e.target.value as AnimatableProperty);
              setSelectedKeyIds([]);
            }}
            className="bg-[#09090b] border border-[#27272a] rounded px-2 py-1 text-xs text-[#f4f4f5] outline-none"
          >
            {ANIMATABLE_PROPERTIES.map((p) => {
              const count = clip.keyframes?.find((t) => t.property === p.key)?.keyframes.length || 0;
              return (
                <option key={p.key} value={p.key}>
                  {p.label} {count > 0 ? `(${count} ◆)` : ''}
                </option>
              );
            })}
          </select>
        </label>

        <div className="remap-readout">
          <span>{propMeta.label}</span>
          <strong>
            {evaluatePropertyTrack(currentTrack, localTime, baseValue).toFixed(1)}
            {propMeta.unit}
          </strong>
          <small>
            {getPropertyVelocity(currentTrack, localTime, baseValue).toFixed(1)}
            {propMeta.unit}/s
          </small>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={addKeyframeAtPlayhead}
            disabled={locked}
            title="Inserir Keyframe na Agulha"
            className="flex-1 py-1.5 px-2 rounded bg-[#2563eb] hover:bg-[#3b82f6] text-white text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer"
          >
            <Diamond size={11} /> + Keyframe
          </button>
          <button
            onClick={addQuickRamp}
            disabled={locked}
            title="Criar rampa automática de entrada"
            className="py-1.5 px-2 rounded bg-[#1c1c21] hover:bg-[#27272a] border border-[#27272a] text-[11px] text-[#f4f4f5] cursor-pointer"
          >
            <Wand2 size={12} />
          </button>
          <button
            disabled={locked || selectedKeyIds.length === 0}
            onClick={() => {
              const next = deleteKeyframesFromTrack(clip, selectedProp, new Set(selectedKeyIds));
              onUpdateClipLive(clip.id, { keyframes: next });
              onCommitHistory();
              setSelectedKeyIds([]);
            }}
            title="Remover keyframe(s) selecionado(s)"
            className="py-1.5 px-2 rounded bg-[#1c1c21] hover:bg-[#ef4444]/20 border border-[#27272a] text-[#a1a1aa] hover:text-[#ef4444] disabled:opacity-35 cursor-pointer"
          >
            <Trash2 size={12} />
          </button>
        </div>

        {/* Loop mode & Copy/Paste */}
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          <select
            aria-label="Modo de repetição da animação"
            value={currentTrack?.loop || 'none'}
            onChange={(e) =>
              updateTrack((tr) => ({ ...tr, loop: e.target.value as TrackLoopMode }))
            }
            className="bg-[#09090b] border border-[#27272a] rounded px-1.5 py-1 text-[#f4f4f5]"
          >
            <option value="none">Sem Loop</option>
            <option value="cycle">Loop Ciclo</option>
            <option value="pingpong">Ping-Pong</option>
            <option value="offset">Offset Contínuo</option>
          </select>

          <div className="flex gap-1">
            <button
              disabled={!currentTrack || currentTrack.keyframes.length === 0}
              onClick={() => currentTrack && onCopyTrack(currentTrack)}
              title="Copiar curva/keyframes"
              className="flex-1 rounded bg-[#1c1c21] hover:bg-[#27272a] border border-[#27272a] flex items-center justify-center text-[#a1a1aa] hover:text-white disabled:opacity-30 cursor-pointer"
            >
              <Copy size={11} />
            </button>
            <button
              disabled={!copiedTrack || locked}
              onClick={() => {
                if (!copiedTrack) return;
                updateTrack(() => ({
                  ...copiedTrack,
                  property: selectedProp,
                  keyframes: copiedTrack.keyframes.map((k) => ({
                    ...k,
                    id: `pkf-${Math.random().toString(36).slice(2, 8)}`,
                  })),
                }));
              }}
              title="Colar animação na propriedade atual"
              className="flex-1 rounded bg-[#1c1c21] hover:bg-[#27272a] border border-[#27272a] flex items-center justify-center text-[#a1a1aa] hover:text-white disabled:opacity-30 cursor-pointer"
            >
              <Clipboard size={11} />
            </button>
          </div>
        </div>

        {/* Saved Custom Curves / Favorites */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-[#71717a]">
            <span>Curvas Salvas & Favoritas</span>
            <button
              disabled={!activeSelectedKey}
              onClick={() => {
                if (!activeSelectedKey) return;
                const item: SavedCurvePreset = {
                  id: `sc-${Date.now()}`,
                  name: `Curva ${savedCurves.length + 1}`,
                  favorite: true,
                  outHandle: activeSelectedKey.outHandle || { ...DEFAULT_OUT_HANDLE },
                  inHandle: activeSelectedKey.inHandle || { ...DEFAULT_IN_HANDLE },
                };
                persistCurves([item, ...savedCurves]);
              }}
              className="text-[#60a5fa] hover:underline flex items-center gap-0.5 cursor-pointer"
            >
              <Plus size={10} /> Salvar
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {savedCurves.slice(0, 4).map((sc) => (
              <button
                key={sc.id}
                onClick={() => {
                  const selSet = new Set(selectedKeyIds);
                  updateTrack((tr) => ({
                    ...tr,
                    keyframes: tr.keyframes.map((k) =>
                      selSet.size === 0 || selSet.has(k.id)
                        ? {
                            ...k,
                            easing: 'bezier',
                            outHandle: { ...sc.outHandle },
                            inHandle: { ...sc.inHandle },
                          }
                        : k
                    ),
                  }));
                }}
                className="px-2 py-0.5 rounded bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-[10px] text-[#f4f4f5] flex items-center gap-1 cursor-pointer"
              >
                <Star size={9} className="text-amber-400 fill-amber-400" />
                {sc.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right Interactive Curve Stage */}
      <div className="remap-graph-section">
        <div className="remap-graph-toolbar flex-wrap gap-1.5">
          <div className="remap-view-tabs">
            <button
              className={graphMode === 'value' ? 'active' : ''}
              onClick={() => setGraphMode('value')}
            >
              Curva de Valor
            </button>
            <button
              className={graphMode === 'speed' ? 'active' : ''}
              onClick={() => setGraphMode('speed')}
            >
              Curva de Velocidade
            </button>
          </div>

          <select
            aria-label="Preset de Easing"
            value={activeSelectedKey?.easing || 'ease-in-out'}
            onChange={(e) => applyPresetEasing(e.target.value as EasingName)}
            className="bg-[#09090b] border border-[#27272a] rounded px-2 py-1 text-xs text-[#f4f4f5]"
          >
            {EASING_PRESETS.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.label}
              </option>
            ))}
          </select>

          <button
            disabled={keys.length < 2 || locked}
            onClick={() => updateTrack((tr) => ({ ...tr, keyframes: invertCurveValues(tr.keyframes) }))}
            title="Inverter valores verticalmente"
            className="px-2 py-1 rounded bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-[11px] text-[#a1a1aa] hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <FlipVertical size={12} /> Inverter
          </button>

          <button
            disabled={keys.length < 2 || locked}
            onClick={() => updateTrack((tr) => ({ ...tr, keyframes: mirrorCurveTiming(tr.keyframes) }))}
            title="Espelhar curva no tempo"
            className="px-2 py-1 rounded bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-[11px] text-[#a1a1aa] hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <FlipHorizontal size={12} /> Espelhar
          </button>

          <button
            disabled={keys.length < 2 || locked}
            onClick={() =>
              updateTrack((tr) => ({
                ...tr,
                keyframes: smoothCurveKeyframes(tr.keyframes, new Set(selectedKeyIds)),
              }))
            }
            title="Suavizar alças Bézier"
            className="px-2 py-1 rounded bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-[11px] text-[#a1a1aa] hover:text-white cursor-pointer"
          >
            Suavizar
          </button>

          <button
            disabled={keys.length < 2 || locked}
            onClick={() => updateTrack((tr) => ({ ...tr, keyframes: scaleCurveIntensity(tr.keyframes, 1.25) }))}
            title="Ampliar intensidade da curva em +25%"
            className="px-2 py-1 rounded bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-[11px] text-[#a1a1aa] hover:text-white cursor-pointer"
          >
            +25% Amp
          </button>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="remap-graph"
          onDoubleClick={(ev) => {
            if (locked || graphMode !== 'value') return;
            const pt = clientToGraph(ev.clientX, ev.clientY);
            const next = upsertKeyframeOnClip(
              clip,
              selectedProp,
              pt.time,
              clamp(pt.value, propMeta.min, propMeta.max),
              'bezier'
            );
            onUpdateClipLive(clip.id, { keyframes: next });
            onCommitHistory();
          }}
          onPointerDown={(ev) => {
            if (ev.target === ev.currentTarget) {
              const pt = clientToGraph(ev.clientX, ev.clientY);
              onSeek(clip.startTime + Math.min(pt.time, clip.duration - 1 / fps));
            }
          }}
        >
          <defs>
            <linearGradient id={`${graphId}-grad`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#38bdf8" stopOpacity="0.18" />
              <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
            </linearGradient>
          </defs>

          {Array.from({ length: 5 }, (_, i) => {
            const t = (i / 4) * clip.duration;
            const v = minY + (i / 4) * (maxY - minY);
            return (
              <g key={i} className="graph-grid">
                <line x1={L} x2={R} y1={toY(v)} y2={toY(v)} />
                <line x1={toX(t)} x2={toX(t)} y1={T} y2={B} />
                <text x={L - 8} y={toY(v) + 4} textAnchor="end">
                  {v.toFixed(0)}
                  {propMeta.unit}
                </text>
                <text x={toX(t)} y={B + 18} textAnchor="middle">
                  {t.toFixed(2)}s
                </text>
              </g>
            );
          })}

          <path d={`${pathD} L ${R} ${B} L ${L} ${B} Z`} fill={`url(#${graphId}-grad)`} pointerEvents="none" />
          <path
            d={pathD}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2.2"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />

          {/* Draggable Keyframes + Bezier Handles */}
          {graphMode === 'value' &&
            keys.map((k, idx) => {
              const isSel = selectedKeyIds.includes(k.id);
              const nextK = keys[idx + 1];
              const prevK = keys[idx - 1];
              const outH = k.outHandle || DEFAULT_OUT_HANDLE;
              const inH = k.inHandle || DEFAULT_IN_HANDLE;

              return (
                <g key={k.id}>
                  {isSel && nextK && (
                    <g>
                      <line
                        x1={toX(k.time)}
                        y1={toY(k.value)}
                        x2={toX(k.time + (nextK.time - k.time) * outH.x)}
                        y2={toY(k.value + (nextK.value - k.value) * outH.y)}
                        stroke="#fbbf24"
                        strokeOpacity="0.8"
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        cx={toX(k.time + (nextK.time - k.time) * outH.x)}
                        cy={toY(k.value + (nextK.value - k.value) * outH.y)}
                        r="5.5"
                        fill="#09090b"
                        stroke="#fbbf24"
                        strokeWidth="1.8"
                        className="graph-handle"
                        onPointerDown={(ev) => startKeyDrag(ev, k, 'outHandle')}
                      />
                    </g>
                  )}

                  {isSel && prevK && (
                    <g>
                      <line
                        x1={toX(k.time)}
                        y1={toY(k.value)}
                        x2={toX(k.time - (k.time - prevK.time) * inH.x)}
                        y2={toY(k.value - (k.value - prevK.value) * inH.y)}
                        stroke="#fbbf24"
                        strokeOpacity="0.8"
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        cx={toX(k.time - (k.time - prevK.time) * inH.x)}
                        cy={toY(k.value - (k.value - prevK.value) * inH.y)}
                        r="5.5"
                        fill="#09090b"
                        stroke="#fbbf24"
                        strokeWidth="1.8"
                        className="graph-handle"
                        onPointerDown={(ev) => startKeyDrag(ev, k, 'inHandle')}
                      />
                    </g>
                  )}

                  <g
                    role="button"
                    aria-label={`PropKey ${idx + 1}`}
                    className="graph-keyframe"
                    onPointerDown={(ev) => startKeyDrag(ev, k)}
                  >
                    <rect x={toX(k.time) - 10} y={toY(k.value) - 10} width="20" height="20" fill="transparent" />
                    <path
                      d={`M ${toX(k.time)} ${toY(k.value) - 6} l 6 6 l -6 6 l -6 -6 Z`}
                      fill={isSel ? '#fbbf24' : '#0f172a'}
                      stroke={isSel ? '#fef08a' : '#38bdf8'}
                      strokeWidth="1.6"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                </g>
              );
            })}

          {/* Playhead line on graph */}
          <line
            x1={toX(localTime)}
            x2={toX(localTime)}
            y1={T - 8}
            y2={B}
            stroke="#ef4444"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        </svg>

        <div className="remap-graph-footer">
          <span>Duplo clique adiciona keyframe • Shift+Clique seleciona vários • Arraste alças Bézier amarelas</span>
          <span>Somente a propriedade ativa ({propMeta.label}) é alterada</span>
        </div>
      </div>
    </div>
  );
};
