import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Diamond,
  Disc,
  Eye,
  EyeOff,
  Plus,
  RotateCcw,
  Sparkles,
  Spline,
  Timer,
  Trash2,
} from 'lucide-react';
import type { ClipEffect, EasingName, PropertyTrack, TimelineClip } from '../types/editor';
import { EFFECTS_BY_TYPE } from '../utils/sapphireEffects';
import { evaluatePropertyTrack } from '../core/keyframes';
import {
  TIME_SLICE_PRESETS,
  TIME_SLICE_PRESET_COUNTS,
  TIME_SLICE_DISTRIBUTIONS,
  TIME_SLICE_INTERPOLATIONS,
  TIME_SLICE_MASK_TYPES,
  DEFAULT_TIME_SLICE_PARAMS,
} from '../utils/timeSlice';

export interface EffectControlsProps {
  clip: TimelineClip;
  locked: boolean;
  currentTime: number;
  fps: number;
  onSeek?: (time: number) => void;
  onOpenBrowser: () => void;
  onChangeEffects: (effects: ClipEffect[], commit?: boolean) => void;
  onOpenGraphForParam?: (effectId: string, paramKey: string) => void;
  autoKeyframe?: boolean;
  onToggleAutoKeyframe?: () => void;
  showTimeSliceWidget?: boolean;
  onToggleTimeSliceWidget?: () => void;
}

export const EffectControls: React.FC<EffectControlsProps> = ({
  clip,
  locked,
  currentTime,
  fps,
  onSeek,
  onOpenBrowser,
  onChangeEffects,
  onOpenGraphForParam,
  autoKeyframe = false,
  onToggleAutoKeyframe,
  showTimeSliceWidget = true,
  onToggleTimeSliceWidget,
}) => {
  const effects = clip.effects || [];
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const localTime = Number(
    Math.max(0, Math.min(clip.duration, currentTime - clip.startTime)).toFixed(4)
  );

  const patch = (id: string, updater: (effect: ClipEffect) => ClipEffect, commit = true) =>
    onChangeEffects(
      effects.map((effect) => (effect.id === id ? updater(effect) : effect)),
      commit
    );

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= effects.length) return;
    const next = [...effects];
    [next[index], next[target]] = [next[target], next[index]];
    onChangeEffects(next);
  };

  if (!effects.length) {
    return (
      <div className="effect-controls-empty" data-testid="effect-controls">
        <Sparkles size={22} className="text-[#3b82f6]" />
        <strong className="text-sm text-[#f4f4f5]">Nenhum efeito aplicado</strong>
        <span className="text-xs text-[#71717a] max-w-xs leading-relaxed">
          Abra a biblioteca de efeitos (Sapphire / Time Slice) e clique em um efeito para empilhá-lo nesta camada.
        </span>
        <button
          onClick={onOpenBrowser}
          disabled={locked}
          className="mt-2 px-3 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#3b82f6] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
        >
          <Plus size={13} />
          Procurar efeitos
        </button>
      </div>
    );
  }

  return (
    <div className="effect-controls" data-testid="effect-controls">
      {/* Header with Effect Count, Auto-Keyframe Toggle and Add Effect Button */}
      <div className="effect-controls-head pb-2 border-b border-[#27272a] mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-[#a1a1aa] truncate">
            {effects.length} efeito{effects.length > 1 ? 's' : ''} em <strong className="text-[#f4f4f5]">{clip.name}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Auto-Keyframe toggle button */}
          {onToggleAutoKeyframe && (
            <button
              type="button"
              onClick={onToggleAutoKeyframe}
              title={
                autoKeyframe
                  ? 'Auto-Keyframe ATIVADO: alterações gravam keyframes na agulha'
                  : 'Auto-Keyframe DESATIVADO: clique para ativar gravação automática'
              }
              className={`px-2 py-1 rounded text-[10px] font-semibold flex items-center gap-1 border transition-colors cursor-pointer ${
                autoKeyframe
                  ? 'bg-red-500/15 border-red-500/40 text-red-400'
                  : 'bg-[#18181c] border-[#27272a] text-[#71717a] hover:text-[#a1a1aa]'
              }`}
            >
              <Disc size={11} className={autoKeyframe ? 'text-red-500 animate-pulse' : ''} />
              <span>Auto-Key {autoKeyframe ? 'ON' : 'OFF'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenBrowser}
            disabled={locked}
            title="Adicionar outro efeito"
            className="p-1 rounded bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-white transition-colors cursor-pointer disabled:opacity-40"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Effects Stack */}
      {effects.map((effect, index) => {
        const definition = EFFECTS_BY_TYPE.get(effect.type);
        if (!definition) return null;
        const isCollapsed = collapsed.includes(effect.id);
        const isTimeSlice = effect.type === 'S_TimeSlice';

        return (
          <section
            key={effect.id}
            className={`effect-stack-item border border-[#27272a] rounded-lg bg-[#141418] overflow-hidden mb-2.5 transition-colors ${
              effect.enabled ? '' : 'opacity-60'
            }`}
          >
            {/* Effect Header */}
            <header className="flex items-center gap-1.5 px-2.5 py-2 bg-[#1c1c22] border-b border-[#27272a]">
              <button
                type="button"
                className="fx-toggle p-1 rounded text-[#71717a] hover:text-[#f4f4f5] cursor-pointer disabled:opacity-40"
                aria-label={`${effect.enabled ? 'Desativar' : 'Ativar'} ${definition.label}`}
                aria-pressed={effect.enabled}
                disabled={locked}
                onClick={() => patch(effect.id, (item) => ({ ...item, enabled: !item.enabled }))}
              >
                {effect.enabled ? <Eye size={13} className="text-[#3b82f6]" /> : <EyeOff size={13} />}
              </button>

              <button
                type="button"
                className="fx-name flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer"
                onClick={() =>
                  setCollapsed((prev) =>
                    prev.includes(effect.id) ? prev.filter((id) => id !== effect.id) : [...prev, effect.id]
                  )
                }
                aria-expanded={!isCollapsed}
              >
                <span className="fx-badge font-mono-code text-[9px] px-1 py-0.5 rounded bg-[#2563eb]/20 text-[#60a5fa] font-bold">
                  fx
                </span>
                <span className="text-xs font-semibold text-[#f4f4f5] truncate">{definition.label}</span>
              </button>

              <div className="fx-actions flex items-center gap-0.5 shrink-0">
                {/* On-screen widget toggle for Time Slice */}
                {isTimeSlice && onToggleTimeSliceWidget && (
                  <button
                    type="button"
                    onClick={onToggleTimeSliceWidget}
                    title={showTimeSliceWidget ? 'Ocultar widget visual no monitor' : 'Mostrar widget visual no monitor'}
                    className={`p-1 rounded transition-colors cursor-pointer ${
                      showTimeSliceWidget ? 'text-amber-400 bg-amber-400/10' : 'text-[#71717a] hover:text-[#f4f4f5]'
                    }`}
                  >
                    <Compass size={12} />
                  </button>
                )}

                <button
                  type="button"
                  disabled={locked || index === 0}
                  onClick={() => move(index, -1)}
                  title="Mover efeito para cima na pilha"
                  className="p-1 rounded text-[#71717a] hover:text-[#f4f4f5] disabled:opacity-30 cursor-pointer"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  type="button"
                  disabled={locked || index === effects.length - 1}
                  onClick={() => move(index, 1)}
                  title="Mover efeito para baixo na pilha"
                  className="p-1 rounded text-[#71717a] hover:text-[#f4f4f5] disabled:opacity-30 cursor-pointer"
                >
                  <ChevronDown size={12} />
                </button>
                <button
                  type="button"
                  disabled={locked}
                  title="Redefinir parâmetros e keyframes deste efeito"
                  onClick={() =>
                    patch(effect.id, (item) => ({
                      ...item,
                      params: Object.fromEntries(definition.params.map((param) => [param.key, param.def])),
                      keyframes: [],
                    }))
                  }
                  className="p-1 rounded text-[#71717a] hover:text-[#f4f4f5] disabled:opacity-30 cursor-pointer"
                >
                  <RotateCcw size={11} />
                </button>
                <button
                  type="button"
                  className="fx-delete p-1 rounded text-[#71717a] hover:text-red-400 disabled:opacity-30 cursor-pointer"
                  disabled={locked}
                  title="Remover efeito da camada"
                  aria-label={`Remover ${definition.label}`}
                  onClick={() => onChangeEffects(effects.filter((item) => item.id !== effect.id))}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </header>

            {!isCollapsed && (
              <div className="p-3 space-y-3">
                {/* SPECIAL TIME SLICE PRESETS BAR */}
                {isTimeSlice && (
                  <div className="p-2.5 rounded-lg bg-[#09090b] border border-[#27272a] space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-amber-300 flex items-center gap-1">
                        <Sparkles size={12} /> Presets Time Slice
                      </span>
                      <span className="font-mono-code text-[10px] text-[#71717a]">18 presets</span>
                    </div>

                    <select
                      aria-label="Presets do Time Slice"
                      className="w-full bg-[#18181c] border border-[#27272a] rounded px-2 py-1 text-xs text-[#f4f4f5] outline-none"
                      onChange={(e) => {
                        const found = TIME_SLICE_PRESETS.find((p) => p.id === e.target.value);
                        if (found) {
                          patch(effect.id, (eff) => ({
                            ...eff,
                            params: {
                              ...DEFAULT_TIME_SLICE_PARAMS,
                              ...eff.params,
                              ...found.params,
                            },
                          }));
                        }
                      }}
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Escolha um preset...
                      </option>
                      {TIME_SLICE_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {p.description}
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center gap-1 pt-1 overflow-x-auto text-[10px]">
                      <span className="text-[#71717a] shrink-0 text-[10px]">Fatias rápidas:</span>
                      {TIME_SLICE_PRESET_COUNTS.map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => {
                            patch(effect.id, (eff) => ({
                              ...eff,
                              params: { ...eff.params, sliceNumber: cnt },
                            }));
                          }}
                          className={`px-1.5 py-0.5 rounded font-mono-code border transition-colors cursor-pointer ${
                            (effect.params?.sliceNumber ?? 12) === cnt
                              ? 'bg-[#2563eb] border-[#3b82f6] text-white'
                              : 'bg-[#18181c] border-[#27272a] text-[#a1a1aa] hover:text-white'
                          }`}
                        >
                          {cnt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* PARAMETERS LIST WITH UNIVERSAL KEYFRAME SYSTEM */}
                <div className="space-y-3">
                  {definition.params.map((param) => {
                    const track = effect.keyframes?.find((t) => t.property === param.key);
                    const hasKeyframes = !!track && track.keyframes.length > 0;

                    // Evaluate live value at current time if keyframed, otherwise static param
                    const liveValue = hasKeyframes
                      ? evaluatePropertyTrack(track, localTime, effect.params?.[param.key] ?? param.def)
                      : (effect.params?.[param.key] ?? param.def);

                    // Check if current playhead is directly on a keyframe
                    const currentKf = track?.keyframes.find((k) => Math.abs(k.time - localTime) < 0.018);
                    const isAtKeyframe = !!currentKf;

                    // Navigation to previous / next keyframes
                    const prevKf = track?.keyframes
                      .filter((k) => k.time < localTime - 0.018)
                      .sort((a, b) => b.time - a.time)[0];
                    const nextKf = track?.keyframes
                      .filter((k) => k.time > localTime + 0.018)
                      .sort((a, b) => a.time - b.time)[0];

                    // Stopwatch toggle
                    const toggleStopwatch = () => {
                      if (locked) return;
                      patch(effect.id, (eff) => {
                        const existingTracks = eff.keyframes ? [...eff.keyframes] : [];
                        const trIdx = existingTracks.findIndex((t) => t.property === param.key);

                        if (trIdx >= 0 && existingTracks[trIdx].keyframes.length > 0) {
                          // Turn OFF: remove keyframes for this param, preserve current value
                          existingTracks.splice(trIdx, 1);
                          return {
                            ...eff,
                            params: { ...eff.params, [param.key]: liveValue },
                            keyframes: existingTracks,
                          };
                        } else {
                          // Turn ON: add first keyframe at localTime
                          const kfTime = Number((Math.round(localTime * fps) / fps).toFixed(4));
                          const newTrack: PropertyTrack = {
                            property: param.key,
                            keyframes: [
                              {
                                id: `ekf-${Math.random().toString(36).slice(2, 8)}`,
                                time: kfTime,
                                value: liveValue,
                                easing: 'ease-in-out' as EasingName,
                              },
                            ],
                          };
                          const filtered = existingTracks.filter((t) => t.property !== param.key);
                          return {
                            ...eff,
                            params: { ...eff.params, [param.key]: liveValue },
                            keyframes: [...filtered, newTrack],
                          };
                        }
                      });
                    };

                    // Diamond add/remove keyframe at playhead
                    const toggleKeyframeAtPlayhead = () => {
                      if (locked) return;
                      patch(effect.id, (eff) => {
                        const existingTracks = eff.keyframes ? [...eff.keyframes] : [];
                        const trIdx = existingTracks.findIndex((t) => t.property === param.key);

                        if (trIdx === -1) {
                          // Create track with keyframe
                          existingTracks.push({
                            property: param.key,
                            keyframes: [
                              {
                                id: `ekf-${Math.random().toString(36).slice(2, 8)}`,
                                time: localTime,
                                value: liveValue,
                                easing: 'ease-in-out',
                              },
                            ],
                          });
                          return { ...eff, keyframes: existingTracks };
                        }

                        const curTr = existingTracks[trIdx];
                        const kfNearIdx = curTr.keyframes.findIndex((k) => Math.abs(k.time - localTime) < 0.018);

                        if (kfNearIdx >= 0) {
                          // Remove keyframe at playhead
                          const nextKeys = curTr.keyframes.filter((_, i) => i !== kfNearIdx);
                          if (nextKeys.length === 0) {
                            existingTracks.splice(trIdx, 1);
                          } else {
                            existingTracks[trIdx] = { ...curTr, keyframes: nextKeys };
                          }
                          return { ...eff, keyframes: existingTracks };
                        } else {
                          // Add keyframe at playhead
                          const kfTime = Number((Math.round(localTime * fps) / fps).toFixed(4));
                          const nextKeys = [
                            ...curTr.keyframes,
                            {
                              id: `ekf-${Math.random().toString(36).slice(2, 8)}`,
                              time: kfTime,
                              value: liveValue,
                              easing: 'ease-in-out' as EasingName,
                            },
                          ].sort((a, b) => a.time - b.time);
                          existingTracks[trIdx] = { ...curTr, keyframes: nextKeys };
                          return { ...eff, keyframes: existingTracks };
                        }
                      });
                    };

                    // Value change handler (slider or direct input)
                    const handleValueChange = (newVal: number, commit = false) => {
                      if (locked) return;
                      patch(
                        effect.id,
                        (eff) => {
                          const existingTracks = eff.keyframes ? [...eff.keyframes] : [];
                          const trIdx = existingTracks.findIndex((t) => t.property === param.key);
                          const kfTime = Number((Math.round(localTime * fps) / fps).toFixed(4));

                          if (hasKeyframes || autoKeyframe) {
                            // Record/update keyframe at localTime
                            if (trIdx === -1) {
                              existingTracks.push({
                                property: param.key,
                                keyframes: [
                                  {
                                    id: `ekf-${Math.random().toString(36).slice(2, 8)}`,
                                    time: kfTime,
                                    value: newVal,
                                    easing: 'ease-in-out' as EasingName,
                                  },
                                ],
                              });
                            } else {
                              const curTr = existingTracks[trIdx];
                              const kfNearIdx = curTr.keyframes.findIndex((k) => Math.abs(k.time - localTime) < 0.018);
                              const nextKeys =
                                kfNearIdx >= 0
                                  ? curTr.keyframes.map((k, i) => (i === kfNearIdx ? { ...k, value: newVal } : k))
                                  : [
                                      ...curTr.keyframes,
                                      {
                                        id: `ekf-${Math.random().toString(36).slice(2, 8)}`,
                                        time: kfTime,
                                        value: newVal,
                                        easing: 'ease-in-out' as EasingName,
                                      },
                                    ].sort((a, b) => a.time - b.time);
                              existingTracks[trIdx] = { ...curTr, keyframes: nextKeys };
                            }
                            return {
                              ...eff,
                              params: { ...eff.params, [param.key]: newVal },
                              keyframes: existingTracks,
                            };
                          }

                          // Static update
                          return {
                            ...eff,
                            params: { ...eff.params, [param.key]: newVal },
                          };
                        },
                        commit
                      );
                    };

                    // Specialized Dropdown labels for integer mode parameters
                    let modeDropdown: React.ReactNode = null;
                    if (isTimeSlice && param.key === 'timeDistribution') {
                      modeDropdown = (
                        <select
                          aria-label={param.label}
                          className="bg-[#18181c] border border-[#27272a] rounded px-1.5 py-0.5 text-[11px] text-[#f4f4f5] outline-none"
                          value={Math.round(liveValue)}
                          onChange={(e) => handleValueChange(Number(e.target.value), true)}
                        >
                          {TIME_SLICE_DISTRIBUTIONS.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      );
                    } else if (isTimeSlice && param.key === 'interpolation') {
                      modeDropdown = (
                        <select
                          aria-label={param.label}
                          className="bg-[#18181c] border border-[#27272a] rounded px-1.5 py-0.5 text-[11px] text-[#f4f4f5] outline-none"
                          value={Math.round(liveValue)}
                          onChange={(e) => handleValueChange(Number(e.target.value), true)}
                        >
                          {TIME_SLICE_INTERPOLATIONS.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      );
                    } else if (isTimeSlice && param.key === 'maskType') {
                      modeDropdown = (
                        <select
                          aria-label={param.label}
                          className="bg-[#18181c] border border-[#27272a] rounded px-1.5 py-0.5 text-[11px] text-[#f4f4f5] outline-none"
                          value={Math.round(liveValue)}
                          onChange={(e) => handleValueChange(Number(e.target.value), true)}
                        >
                          {TIME_SLICE_MASK_TYPES.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      );
                    }

                    return (
                      <div
                        key={param.key}
                        className={`rounded-md p-1.5 transition-colors ${
                          hasKeyframes
                            ? 'bg-amber-500/5 border border-amber-500/20'
                            : 'hover:bg-[#18181c]/50'
                        }`}
                      >
                        {/* Parameter Header: Stopwatch + Label + Keyframe Controls + Value */}
                        <div className="flex items-center justify-between text-[11px] gap-2 mb-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {/* Stopwatch toggle button */}
                            <button
                              type="button"
                              onClick={toggleStopwatch}
                              disabled={locked}
                              title={
                                hasKeyframes
                                  ? 'Cronômetro ligado (animado) — clique para remover animação'
                                  : 'Ativar cronômetro de keyframes para este parâmetro'
                              }
                              className={`p-0.5 rounded transition-colors cursor-pointer ${
                                hasKeyframes
                                  ? 'text-amber-400 bg-amber-400/20'
                                  : 'text-[#52525b] hover:text-[#a1a1aa]'
                              }`}
                            >
                              <Timer size={12} className={hasKeyframes ? 'fill-amber-400' : ''} />
                            </button>

                            <span
                              className={`truncate font-medium ${
                                hasKeyframes ? 'text-amber-300' : 'text-[#a1a1aa]'
                              }`}
                              title={param.label}
                            >
                              {param.label}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {/* Keyframe management controls when animated */}
                            {hasKeyframes && (
                              <div className="flex items-center gap-0.5 bg-[#09090b] px-1 py-0.5 rounded border border-[#27272a]">
                                <button
                                  type="button"
                                  disabled={!prevKf || locked}
                                  onClick={() => prevKf && onSeek && onSeek(clip.startTime + prevKf.time)}
                                  title="Keyframe anterior deste parâmetro"
                                  className="text-[#71717a] hover:text-white disabled:opacity-20 cursor-pointer p-0.5"
                                >
                                  <ChevronLeft size={10} />
                                </button>

                                <button
                                  type="button"
                                  disabled={locked}
                                  onClick={toggleKeyframeAtPlayhead}
                                  title={
                                    isAtKeyframe
                                      ? 'Remover keyframe desta posição (agulha)'
                                      : 'Adicionar keyframe na agulha'
                                  }
                                  className={`p-0.5 rounded cursor-pointer ${
                                    isAtKeyframe ? 'text-amber-400' : 'text-[#52525b] hover:text-amber-300'
                                  }`}
                                >
                                  <Diamond
                                    size={10}
                                    className={isAtKeyframe ? 'fill-amber-400' : ''}
                                  />
                                </button>

                                <button
                                  type="button"
                                  disabled={!nextKf || locked}
                                  onClick={() => nextKf && onSeek && onSeek(clip.startTime + nextKf.time)}
                                  title="Próximo keyframe deste parâmetro"
                                  className="text-[#71717a] hover:text-white disabled:opacity-20 cursor-pointer p-0.5"
                                >
                                  <ChevronRight size={10} />
                                </button>

                                {onOpenGraphForParam && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenGraphForParam(effect.id, param.key)}
                                    title="Abrir no Graph Editor"
                                    className="text-[#60a5fa] hover:text-white p-0.5 cursor-pointer ml-0.5 border-l border-[#27272a] pl-1"
                                  >
                                    <Spline size={10} />
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Reset individual param */}
                            <button
                              type="button"
                              onClick={() => {
                                handleValueChange(param.def, true);
                              }}
                              title="Redefinir valor para padrão"
                              className="text-[#52525b] hover:text-[#a1a1aa] p-0.5 cursor-pointer"
                            >
                              <RotateCcw size={10} />
                            </button>

                            {/* Numeric display */}
                            <span
                              className={`fx-param-value font-mono-code text-[11px] min-w-[36px] text-right ${
                                hasKeyframes ? 'text-amber-300 font-semibold' : 'text-[#f4f4f5]'
                              }`}
                            >
                              {Number.isInteger(param.step) ? Math.round(liveValue) : liveValue.toFixed(1)}
                              {param.unit || ''}
                            </span>
                          </div>
                        </div>

                        {/* Slider or Specialized Dropdown */}
                        {modeDropdown ? (
                          <div className="pt-0.5">{modeDropdown}</div>
                        ) : (
                          <input
                            type="range"
                            className={`studio-slider w-full ${hasKeyframes ? 'is-animated' : ''}`}
                            min={param.min}
                            max={param.max}
                            step={param.step}
                            value={liveValue}
                            disabled={locked}
                            aria-label={`${definition.label} ${param.label}`}
                            onChange={(e) => handleValueChange(Number(e.target.value), false)}
                            onPointerUp={() => handleValueChange(liveValue, true)}
                            onKeyUp={() => handleValueChange(liveValue, true)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        );
      })}

      <button
        type="button"
        className="effect-clear-all w-full py-2 rounded-lg border border-dashed border-[#27272a] hover:border-red-500/40 text-xs text-[#71717a] hover:text-red-400 transition-colors cursor-pointer disabled:opacity-40"
        disabled={locked}
        onClick={() => onChangeEffects([])}
      >
        Remover todos os efeitos
      </button>
    </div>
  );
};
