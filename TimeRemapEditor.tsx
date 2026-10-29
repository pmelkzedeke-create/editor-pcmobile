import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Diamond, Gauge, RotateCcw, Snowflake, Spline, Timer, Trash2 } from 'lucide-react';
import type { TimeRemap, TimeRemapKeyframe, TimelineClip } from '../types/editor';
import { clamp, createRemapPreset, createTimeRemap, DEFAULT_REMAP_HANDLE, getClipPlaybackRate, getClipSourceTime, insertRemapKeyframe, segmentCurve } from '../utils/timeRemap';
import type { RemapPreset } from '../utils/timeRemap';
import { formatTimecode } from '../utils/mediaHelpers';

interface TimeRemapEditorProps {
  clip: TimelineClip | null;
  fps: number;
  currentTime: number;
  locked: boolean;
  onSeek: (time: number) => void;
  onUpdateClipLive: (id: string, patch: Partial<TimelineClip>) => void;
  onCommitHistory: () => void;
}

interface RemapGraphProps {
  clip: TimelineClip;
  remap: TimeRemap;
  fps: number;
  localTime: number;
  selectedKeyId: string | null;
  view: 'value' | 'speed';
  disabled: boolean;
  onSelectKey: (id: string) => void;
  onChange: (remap: TimeRemap) => void;
  onSeekLocal: (time: number) => void;
  onCommit: () => void;
  onAddKey: (time: number) => void;
  onDeleteKey: () => void;
  onEase: () => void;
}

function RemapGraph({ clip, remap, fps, localTime, selectedKeyId, view, disabled, onSelectKey, onChange, onSeekLocal, onCommit, onAddKey, onDeleteKey, onEase }: RemapGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const graphId = useId().replace(/:/g, '');
  const keys = remap.keyframes;
  const W = 1000;
  const H = 240;
  const L = 56;
  const R = W - 24;
  const T = 24;
  const B = H - 32;
  const rates = Array.from({ length: 161 }, (_, i) => getClipPlaybackRate({ ...clip, timeRemap: { ...remap, enabled: true } }, i / 160 * clip.duration));
  const min = view === 'speed' ? Math.min(-0.5, ...rates) : Math.min(remap.sourceStart, ...keys.map((k) => k.sourceTime));
  const max = view === 'speed' ? Math.max(2, ...rates) * 1.12 : Math.max(remap.sourceEnd, ...keys.map((k) => k.sourceTime), min + 0.1);
  const x = (time: number) => L + time / clip.duration * (R - L);
  const y = (value: number) => B - (value - min) / Math.max(0.001, max - min) * (B - T);
  const pointFromClient = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      time: clamp(((clientX - rect.left) / rect.width * W - L) / (R - L) * clip.duration, 0, clip.duration),
      value: clamp((B - (clientY - rect.top) / rect.height * H) / (B - T) * (max - min) + min, 0, clip.type === 'video' ? clip.maxDuration : remap.sourceEnd),
    };
  };

  let path = '';
  if (view === 'speed') {
    path = rates.map((rate, i) => `${i ? 'L' : 'M'} ${x(i / 160 * clip.duration)} ${y(rate)}`).join(' ');
  } else if (keys.length) {
    path = `M ${x(keys[0].time)} ${y(keys[0].sourceTime)}`;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i];
      const b = keys[i + 1];
      if (a.interpolation === 'hold') path += ` H ${x(b.time)} V ${y(b.sourceTime)}`;
      else if (a.interpolation === 'bezier') {
        const [, c1, c2] = segmentCurve(a, b);
        path += ` C ${x(c1.x)} ${y(c1.y)}, ${x(c2.x)} ${y(c2.y)}, ${x(b.time)} ${y(b.sourceTime)}`;
      } else path += ` L ${x(b.time)} ${y(b.sourceTime)}`;
    }
  }

  const startDrag = (event: PointerEvent<SVGGElement | SVGCircleElement>, key: TimeRemapKeyframe, handle?: 'inHandle' | 'outHandle') => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || view !== 'value') return;
    svgRef.current?.focus();
    onSelectKey(key.id);
    onSeekLocal(key.time);
    const keyIndex = keys.findIndex((k) => k.id === key.id);
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const onMove = (ev: globalThis.PointerEvent) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 2) return;
      moved = true;
      const point = pointFromClient(ev.clientX, ev.clientY);
      let patch: Partial<TimeRemapKeyframe>;
      if (handle) {
        const neighbor = keys[keyIndex + (handle === 'outHandle' ? 1 : -1)];
        if (!neighbor) return;
        const dt = neighbor.time - key.time;
        const ds = neighbor.sourceTime - key.sourceTime;
        const other = (handle === 'outHandle' ? neighbor.inHandle : neighbor.outHandle) || DEFAULT_REMAP_HANDLE;
        patch = { [handle]: { x: clamp((point.time - key.time) / dt, 0.01, 0.99 - other.x), y: Math.abs(ds) > 1e-6 ? clamp((point.value - key.sourceTime) / ds, 0, 1) : 0 } };
      } else {
        const time = keyIndex === 0 ? 0 : keyIndex === keys.length - 1 ? clip.duration
          : clamp(Math.round(point.time * fps) / fps, keys[keyIndex - 1].time + 1 / fps, keys[keyIndex + 1].time - 1 / fps);
        patch = { time, sourceTime: Math.round(point.value * fps) / fps };
        onSeekLocal(time);
      }
      onChange({ ...remap, keyframes: keys.map((k) => k.id === key.id ? { ...k, ...patch } : k) });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (moved) onCommit();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
  };

  const keyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'F9') { event.preventDefault(); event.stopPropagation(); onEase(); }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); onDeleteKey(); }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && selectedKeyId && !disabled) {
      event.preventDefault(); event.stopPropagation();
      const delta = (event.key === 'ArrowUp' ? 1 : -1) / fps;
      onChange({ ...remap, keyframes: keys.map((k) => k.id === selectedKeyId ? { ...k, sourceTime: clamp(k.sourceTime + delta, 0, clip.type === 'video' ? clip.maxDuration : remap.sourceEnd) } : k) });
      onCommit();
    }
  };

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="remap-graph" tabIndex={0} role="application" aria-label="Grafico de Time Remapping. Arraste os keyframes para editar o tempo de origem." onKeyDown={keyboard}
      onDoubleClick={(event) => { if (!disabled && view === 'value') onAddKey(pointFromClient(event.clientX, event.clientY).time); }}
      onPointerDown={(event) => { if (event.target === event.currentTarget) onSeekLocal(pointFromClient(event.clientX, event.clientY).time); }}>
      <defs>
        <linearGradient id={`${graphId}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b82f6" stopOpacity=".14" /><stop offset="1" stopColor="#3b82f6" stopOpacity="0" /></linearGradient>
        <clipPath id={`${graphId}-clip`}><rect x={L - 8} y={T - 12} width={R - L + 16} height={B - T + 24} /></clipPath>
      </defs>
      {Array.from({ length: 5 }, (_, i) => {
        const time = i / 4 * clip.duration;
        const value = min + i / 4 * (max - min);
        return <g key={i} className="graph-grid">
          <line x1={L} x2={R} y1={y(value)} y2={y(value)} />
          <line x1={x(time)} x2={x(time)} y1={T} y2={B} />
          <text x={L - 10} y={y(value) + 4} textAnchor="end">{value.toFixed(1)}{view === 'speed' ? 'x' : 's'}</text>
          <text x={x(time)} y={B + 20} textAnchor="middle">{time.toFixed(2)}s</text>
        </g>;
      })}
      <g clipPath={`url(#${graphId}-clip)`}>
        {view === 'value' && <line x1={x(0)} y1={y(remap.sourceStart)} x2={x(clip.duration)} y2={y(remap.sourceEnd)} stroke="#52525b" strokeDasharray="5 6" vectorEffect="non-scaling-stroke" />}
        <path d={`${path} L ${R} ${B} L ${L} ${B} Z`} fill={`url(#${graphId}-fill)`} pointerEvents="none" />
        <path d={path} fill="none" stroke={remap.enabled ? '#60a5fa' : '#71717a'} strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        {view === 'value' && keys.map((key, index) => {
          const selected = key.id === selectedKeyId;
          const handles = selected ? (['inHandle', 'outHandle'] as const).flatMap((side) => {
            const next = side === 'outHandle';
            const neighbor = keys[index + (next ? 1 : -1)];
            if (!neighbor || (next ? key.interpolation : neighbor.interpolation) !== 'bezier') return [];
            const handle = key[side] || DEFAULT_REMAP_HANDLE;
            const hx = x(key.time + (neighbor.time - key.time) * handle.x);
            const hy = y(key.sourceTime + (neighbor.sourceTime - key.sourceTime) * handle.y);
            return [<g key={side}>
              <line x1={x(key.time)} y1={y(key.sourceTime)} x2={hx} y2={hy} stroke="#93c5fd" strokeOpacity=".65" vectorEffect="non-scaling-stroke" />
              <circle cx={hx} cy={hy} r="5" fill="#111827" stroke="#93c5fd" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="graph-handle" onPointerDown={(ev) => startDrag(ev, key, side)}><title>{next ? 'Alca de saida' : 'Alca de entrada'}</title></circle>
            </g>];
          }) : [];
          return <g key={key.id}>
            {handles}
            <g role="button" aria-label={`Keyframe ${index + 1}, ${key.time.toFixed(2)} segundos`} className="graph-keyframe" onPointerDown={(ev) => startDrag(ev, key)}>
              <rect x={x(key.time) - 10} y={y(key.sourceTime) - 10} width="20" height="20" fill="transparent" />
              <path d={`M ${x(key.time)} ${y(key.sourceTime) - 5.5} l 6 5.5 l -6 5.5 l -6 -5.5 Z`} fill={selected ? '#fbbf24' : '#131b2b'} stroke={selected ? '#fde68a' : '#93c5fd'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </g>
          </g>;
        })}
        <line x1={x(localTime)} x2={x(localTime)} y1={T - 10} y2={B} stroke="#ef4444" strokeOpacity=".8" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        <circle cx={x(localTime)} cy={y(view === 'speed' ? getClipPlaybackRate({ ...clip, timeRemap: { ...remap, enabled: true } }, localTime) : getClipSourceTime({ ...clip, timeRemap: { ...remap, enabled: true } }, localTime))} r="4" fill="#fff" stroke="#60a5fa" vectorEffect="non-scaling-stroke" pointerEvents="none" />
      </g>
    </svg>
  );
}

export function TimeRemapEditor({ clip, fps, currentTime, locked, onSeek, onUpdateClipLive, onCommitHistory }: TimeRemapEditorProps) {
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [view, setView] = useState<'value' | 'speed'>('value');
  useEffect(() => { setSelectedKeyId(null); }, [clip?.id]);
  if (!clip || (clip.type !== 'video' && clip.type !== 'image')) {
    return <div className="remap-empty"><Timer size={24} /><strong>Selecione um clipe de video ou imagem</strong><span>O Graph Editor mostra o tempo de origem em cada instante da sua timeline.</span></div>;
  }
  const remap = clip.timeRemap || createTimeRemap(clip);
  const enabled = !!clip.timeRemap?.enabled;
  const localTime = clamp(currentTime - clip.startTime, 0, clip.duration);
  const selectedKey = remap.keyframes.find((key) => key.id === selectedKeyId);
  const selectedIndex = remap.keyframes.findIndex((key) => key.id === selectedKeyId);
  const rate = getClipPlaybackRate(clip, localTime);
  const atKey = remap.keyframes.find((key) => Math.abs(key.time - localTime) < 0.5 / fps);
  const update = (value: TimeRemap, commit = false) => {
    if (locked) return;
    onUpdateClipLive(clip.id, { timeRemap: value });
    if (commit) onCommitHistory();
  };
  const seekLocal = (time: number) => onSeek(clip.startTime + Math.min(time, clip.duration - 1 / fps));
  const addKey = (time = localTime) => {
    const value = insertRemapKeyframe({ ...clip, timeRemap: { ...remap, enabled: true } }, time, fps);
    update(value, true);
    const key = value.keyframes.reduce((a, b) => Math.abs(a.time - time) < Math.abs(b.time - time) ? a : b);
    setSelectedKeyId(key.id);
    seekLocal(key.time);
    setView('value');
  };
  const deleteKey = () => {
    if (selectedIndex <= 0 || selectedIndex >= remap.keyframes.length - 1 || !enabled) return;
    update({ ...remap, keyframes: remap.keyframes.filter((k) => k.id !== selectedKeyId) }, true);
    setSelectedKeyId(null);
  };
  const ease = () => {
    update({ ...remap, enabled: true, keyframes: remap.keyframes.map((k, i) => !selectedKey || k.id === selectedKey.id || i === selectedIndex - 1 ? { ...k, interpolation: 'bezier', inHandle: { ...DEFAULT_REMAP_HANDLE }, outHandle: { ...DEFAULT_REMAP_HANDLE } } : k) }, true);
  };
  const preset = (name: RemapPreset) => {
    update(createRemapPreset(clip, name, localTime), true);
    setSelectedKeyId(null);
  };
  const patchKey = (patch: Partial<TimeRemapKeyframe>) => {
    if (!selectedKey) return;
    update({ ...remap, keyframes: remap.keyframes.map((key) => key.id === selectedKey.id ? { ...key, ...patch } : key) });
  };

  return <div className="time-remap-editor" data-testid="time-remap-editor">
    <div className="remap-properties">
      <div className="remap-heading"><span><Timer size={14} />Time Remapping</span><button role="switch" aria-checked={enabled} aria-label="Ativar Time Remapping" disabled={locked} onClick={() => update({ ...remap, enabled: !enabled }, true)} className={`studio-switch ${enabled ? 'is-on' : ''}`}><span /></button></div>
      <div className="remap-readout"><span>Tempo de origem</span><strong>{formatTimecode(getClipSourceTime(clip, localTime), true, fps)}</strong><small className={rate < 0 ? 'text-amber-400' : ''}>{Math.abs(rate) < 0.01 ? 'Congelado' : `${rate.toFixed(2)}x`}</small></div>
      <div className="keyframe-navigation">
        <button title="Keyframe anterior" disabled={!enabled || locked} onClick={() => { const key = [...remap.keyframes].reverse().find((k) => k.time < localTime - 0.5 / fps); if (key) { setSelectedKeyId(key.id); seekLocal(key.time); } }}><ChevronLeft size={14} /></button>
        <button title="Adicionar keyframe na agulha" aria-label="Adicionar keyframe" disabled={locked} onClick={() => addKey()}><Diamond size={12} className={atKey && enabled ? 'fill-amber-400 text-amber-400' : ''} /></button>
        <button title="Proximo keyframe" disabled={!enabled || locked} onClick={() => { const key = remap.keyframes.find((k) => k.time > localTime + 0.5 / fps); if (key) { setSelectedKeyId(key.id); seekLocal(key.time); } }}><ChevronRight size={14} /></button>
        <span>{enabled ? remap.keyframes.length : 0} keyframes</span>
        <button title="Excluir keyframe selecionado" disabled={locked || selectedIndex <= 0 || selectedIndex === remap.keyframes.length - 1} onClick={deleteKey}><Trash2 size={12} /></button>
      </div>
      {selectedKey && enabled ? <div className="remap-key-fields">
        <label>Timeline (s)<input aria-label="Tempo do keyframe" type="number" step={1 / fps} disabled={locked || selectedIndex === 0 || selectedIndex === remap.keyframes.length - 1} value={Number(selectedKey.time.toFixed(3))} onChange={(event) => patchKey({ time: clamp(Number(event.target.value), remap.keyframes[Math.max(0, selectedIndex - 1)].time + 1 / fps, remap.keyframes[Math.min(remap.keyframes.length - 1, selectedIndex + 1)].time - 1 / fps) })} onBlur={onCommitHistory} /></label>
        <label>Origem (s)<input aria-label="Tempo de origem do keyframe" type="number" min={0} max={clip.type === 'video' ? clip.maxDuration : remap.sourceEnd} step={1 / fps} disabled={locked} value={Number(selectedKey.sourceTime.toFixed(3))} onChange={(event) => patchKey({ sourceTime: clamp(Number(event.target.value), 0, clip.type === 'video' ? clip.maxDuration : remap.sourceEnd) })} onBlur={onCommitHistory} /></label>
      </div> : <p className="remap-help">{locked ? 'Desbloqueie a faixa para editar.' : 'Duplo clique no grafico para adicionar. Arraste um losango para mudar o tempo.'}</p>}
      <div className="remap-presets">
        <button disabled={locked} onClick={() => preset('ramp')} title="Rapido nas bordas, lento no centro"><Spline size={12} />Speed Ramp</button>
        <button disabled={locked} onClick={() => preset('slow')}><Gauge size={12} />Lento 0.25x</button>
        <button disabled={locked} onClick={() => preset('reverse')}><RotateCcw size={12} />Reverso</button>
        <button disabled={locked} onClick={() => preset('freeze')}><Snowflake size={12} />Congelar</button>
      </div>
      <label className="remap-duration">Duracao na timeline<input aria-label="Duracao do clipe remapeado" type="number" min={0.25} max={300} step={1 / fps} disabled={!enabled || locked} value={Number(clip.duration.toFixed(3))} onChange={(event) => {
        const duration = clamp(Number(event.target.value), 0.25, 300);
        onUpdateClipLive(clip.id, { duration, timeRemap: { ...remap, keyframes: remap.keyframes.map((key) => ({ ...key, time: key.time / clip.duration * duration })) } });
      }} onBlur={onCommitHistory} /><span>s</span></label>
      <button className="remap-reset" disabled={locked} onClick={() => preset('normal')}>Restaurar tempo original</button>
    </div>
    <div className="remap-graph-section">
      <div className="remap-graph-toolbar">
        <div className="remap-view-tabs"><button className={view === 'value' ? 'active' : ''} onClick={() => setView('value')}>Grafico de valor</button><button className={view === 'speed' ? 'active' : ''} onClick={() => setView('speed')}>Velocidade</button></div>
        <span className="remap-clip-name" title={clip.name}>{clip.name}</span>
        <select aria-label="Interpolacao do keyframe" disabled={!enabled || locked} value={selectedKey?.interpolation || remap.keyframes[0]?.interpolation || 'linear'} onChange={(event) => {
          const interpolation = event.target.value as TimeRemapKeyframe['interpolation'];
          update({ ...remap, keyframes: remap.keyframes.map((key) => !selectedKey || key.id === selectedKey.id ? { ...key, interpolation } : key) }, true);
        }}><option value="linear">Linear</option><option value="bezier">Bezier</option><option value="hold">Hold (congelar)</option></select>
        <button className="ease-button" disabled={locked} onClick={ease} title="Suavizar keyframes selecionados (F9)"><Spline size={13} />Easy Ease<kbd>F9</kbd></button>
      </div>
      <div className="remap-axis-title">{view === 'value' ? 'TEMPO DE ORIGEM (s)' : 'VELOCIDADE (x)'}{!enabled && <span>Ative o cronometro ou escolha um preset para editar</span>}</div>
      <RemapGraph clip={clip} remap={remap} fps={fps} localTime={localTime} selectedKeyId={selectedKeyId} view={view} disabled={!enabled || locked} onSelectKey={setSelectedKeyId} onChange={update} onSeekLocal={seekLocal} onCommit={onCommitHistory} onAddKey={addKey} onDeleteKey={deleteKey} onEase={ease} />
      <div className="remap-graph-footer"><span><i className="graph-legend-line" />{view === 'value' ? 'Tempo remapeado' : 'Velocidade instantanea'}<i className="graph-legend-key" />Keyframe</span><span>{clip.type === 'image' ? 'Imagem: remapeia o movimento de camera e os efeitos.' : 'Audio original silenciado em reverso e congelamento.'}</span></div>
    </div>
  </div>;
}