import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Code2,
  Copy,
  Diamond,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Link2,
  Link2Off,
  Plus,
  RotateCcw,
  Sliders,
  Spline,
  Timer,
  Trash2,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import {
  AnimatableProperty,
  BlendMode,
  ClipEffect,
  LayerMask,
  MotionBehavior,
  MotionBehaviorType,
  MotionPreset,
  MediaAsset,
  ProjectState,
  TextAnimation,
  TimelineClip,
  TrackMatteMode,
  TransitionType,
  VectorShapeKind,
} from '../types/editor';
import { EffectControls } from './EffectControls';
import { MotionToolsPanel } from './MotionToolsPanel';
import { getProjectDimensions } from '../core/compositions';
import { MOTION_BEHAVIOR_DEFS, validateSafeExpression } from '../core/expressions';
import {
  evaluatePropertyTrack,
  getClipBasePropertyValue,
  upsertKeyframeOnClip,
} from '../core/keyframes';
import { createDefaultMask } from '../core/shapesAndMasks';
import {
  DEFAULT_FILTERS,
  formatTimecode,
  TRANSITION_OPTIONS,
  uid,
} from '../utils/mediaHelpers';

interface InspectorPanelProps {
  assetsMap: Map<string, MediaAsset>;
  onAnalysisBusy: (busy: boolean) => void;
  onPausePlayback: () => void;
  project: ProjectState;
  currentTime: number;
  selectedClip: TimelineClip | null;
  allClips: TimelineClip[];
  onOpenTimeRemap: () => void;
  onOpenPropertyGraph: () => void;
  trackLocked: boolean;
  onOpenEffectsBrowser: () => void;
  effectsFocusToken: number;
  propertyFocus: { prop: string; nonce: number };
  onChangeEffects: (clipId: string, effects: ClipEffect[], commit?: boolean) => void;
  fps: number;
  totalDuration: number;
  clipCount: number;
  onUpdateClipLive: (clipId: string, patch: Partial<TimelineClip>) => void;
  onCommitHistory: () => void;
  onChangeClipSpeed: (clipId: string, newSpeed: number) => void;
  onDuplicateClip: (clipId: string) => void;
  onDeleteClip: (clipId: string) => void;
  isMobileDrawer?: boolean;
}

type InspectorTab = 'main' | 'anim' | 'shapeMask' | 'color' | 'fx' | 'effects' | 'vision';

const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'source-over', label: 'Normal' },
  { id: 'multiply', label: 'Multiply (Multiplicar)' },
  { id: 'screen', label: 'Screen (Divisão)' },
  { id: 'overlay', label: 'Overlay (Sobrepor)' },
  { id: 'soft-light', label: 'Soft Light (Luz Suave)' },
  { id: 'hard-light', label: 'Hard Light (Luz Direta)' },
  { id: 'color-dodge', label: 'Color Dodge (Superexposição)' },
  { id: 'color-burn', label: 'Color Burn' },
  { id: 'lighten', label: 'Lighten (Clarear)' },
  { id: 'darken', label: 'Darken (Escurecer)' },
  { id: 'difference', label: 'Difference (Diferença)' },
  { id: 'exclusion', label: 'Exclusion' },
  { id: 'luminosity', label: 'Luminosity' },
];

interface SliderRowProps {
  propKey?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hasKeyframes?: boolean;
  onAddKeyframe?: () => void;
  onChange: (val: number) => void;
  onCommit: () => void;
}

const SliderRow: React.FC<SliderRowProps> = ({
  propKey,
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  hasKeyframes,
  onAddKeyframe,
  onChange,
  onCommit,
}) => (
  <div className="flex flex-col gap-1 rounded-md px-1 -mx-1" data-prop={propKey}>
    <div className="flex items-center justify-between text-[11px]">
      <div className="flex items-center gap-1">
        {onAddKeyframe && (
          <button
            type="button"
            onClick={onAddKeyframe}
            title={`Inserir/atualizar keyframe em ${label}`}
            aria-label={`Keyframe ${label}`}
            className={`p-0.5 rounded transition-colors cursor-pointer ${
              hasKeyframes
                ? 'text-amber-400 hover:text-amber-300'
                : 'text-[#52525b] hover:text-[#60a5fa]'
            }`}
          >
            <Diamond className={`w-3 h-3 ${hasKeyframes ? 'fill-amber-400' : ''}`} />
          </button>
        )}
        <span className="text-[#a1a1aa]">{label}</span>
      </div>
      <span className="font-mono-code text-[#f4f4f5]">
        {Number.isInteger(step) ? Math.round(value) : value.toFixed(1)}
        {unit}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      onMouseUp={onCommit}
      onTouchEnd={onCommit}
      className="studio-slider w-full"
    />
  </div>
);

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  assetsMap,
  onAnalysisBusy,
  onPausePlayback,
  project,
  currentTime,
  selectedClip,
  allClips,
  onOpenTimeRemap,
  onOpenPropertyGraph,
  trackLocked,
  onOpenEffectsBrowser,
  effectsFocusToken,
  propertyFocus,
  onChangeEffects,
  fps,
  totalDuration,
  clipCount,
  onUpdateClipLive,
  onCommitHistory,
  onChangeClipSpeed,
  onDuplicateClip,
  onDeleteClip,
  isMobileDrawer = false,
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>('main');
  const [exprProp, setExprProp] = useState<AnimatableProperty>('y');
  const [behType, setBehType] = useState<MotionBehaviorType>('spring-in');
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (effectsFocusToken > 0) setActiveTab('effects');
  }, [effectsFocusToken]);

  useEffect(() => {
    if (!propertyFocus.nonce || !propertyFocus.prop) return;
    setActiveTab('main');
    const timer = setTimeout(() => {
      const node = panelRef.current?.querySelector(`[data-prop="${propertyFocus.prop}"]`);
      if (!node) return;
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      node.classList.remove('prop-flash');
      void (node as HTMLElement).offsetWidth;
      node.classList.add('prop-flash');
    }, 60);
    return () => clearTimeout(timer);
  }, [propertyFocus, selectedClip?.type]);

  const spec = getProjectDimensions(project);

  if (!selectedClip) {
    return (
      <aside
        className={
          isMobileDrawer
            ? 'w-full h-full p-4 flex flex-col justify-between select-none bg-transparent'
            : 'w-[296px] shrink-0 bg-[#121215] border-l border-[#27272a] p-4 flex flex-col justify-between select-none'
        }
      >
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Sliders className="w-4 h-4 text-[#3b82f6]" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#f4f4f5]">
              Propriedades da Composição
            </h2>
          </div>

          <div className="rounded-lg bg-[#18181c] border border-[#27272a] p-3 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#71717a]">Resolução</span>
              <span className="font-mono-code text-[#f4f4f5]">
                {spec.width}×{spec.height}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#71717a]">Proporção</span>
              <span className="font-mono-code text-[#f4f4f5]">{spec.label}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#71717a]">Quadros / seg</span>
              <span className="font-mono-code text-[#f4f4f5]">{fps} FPS</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#71717a]">Duração Total</span>
              <span className="font-mono-code text-[#f4f4f5]">
                {formatTimecode(totalDuration, true, fps)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#71717a]">Camadas Ativas</span>
              <span className="font-mono-code text-[#f4f4f5]">{clipCount}</span>
            </div>
          </div>

          <div className="mt-4 p-3 rounded-lg bg-[#18181c]/60 border border-[#27272a]/70 text-[11px] text-[#71717a] leading-relaxed">
            Clique em qualquer camada na <strong className="text-[#a1a1aa]">Timeline</strong> ou no{' '}
            <strong className="text-[#a1a1aa]">Monitor</strong> para animar keyframes, adicionar máscaras, formas, Motion Stack, expressões e efeitos.
          </div>
        </div>

        <div className="pt-3 border-t border-[#27272a] text-[10px] text-[#71717a] space-y-1 font-mono-code">
          <div className="flex justify-between">
            <span>Reproduzir / Pausar</span>
            <span className="text-[#a1a1aa]">Espaço</span>
          </div>
          <div className="flex justify-between">
            <span>Dividir Camada</span>
            <span className="text-[#a1a1aa]">Ctrl+Shift+D</span>
          </div>
          <div className="flex justify-between">
            <span>Paleta de Comandos</span>
            <span className="text-[#a1a1aa]">Ctrl+K</span>
          </div>
          <div className="flex justify-between">
            <span>Prévia RAM</span>
            <span className="text-[#a1a1aa]">R</span>
          </div>
          <div className="flex justify-between">
            <span>Escala / Posição / Opacidade</span>
            <span className="text-[#a1a1aa]">S / P / T</span>
          </div>
          <div className="flex justify-between">
            <span>Keyframes (Graph Editor)</span>
            <span className="text-[#a1a1aa]">U</span>
          </div>
        </div>
      </aside>
    );
  }

  const isAudio = selectedClip.type === 'audio';
  const isText = selectedClip.type === 'text' && !!selectedClip.textStyle;
  const isShape = selectedClip.type === 'shape' && !!selectedClip.shapeData;
  const isSolid = selectedClip.type === 'solid';
  const localTime = Math.max(0, Math.min(selectedClip.duration, currentTime - selectedClip.startTime));

  const keyframeHelper = (prop: AnimatableProperty) => {
    const tr = selectedClip.keyframes?.find((t) => t.property === prop);
    const hasKf = !!tr && tr.keyframes.length > 0;
    const base = getClipBasePropertyValue(selectedClip, prop);
    const valNow = hasKf ? evaluatePropertyTrack(tr, localTime, base) : base;
    return {
      hasKf,
      valNow,
      toggleKf: () => {
        const next = upsertKeyframeOnClip(selectedClip, prop, localTime, valNow, 'ease-in-out');
        onUpdateClipLive(selectedClip.id, { keyframes: next });
        onCommitHistory();
      },
      changeVal: (v: number, patch: Partial<TimelineClip>) => {
        if (hasKf) {
          const next = upsertKeyframeOnClip(selectedClip, prop, localTime, v, 'ease-in-out');
          onUpdateClipLive(selectedClip.id, { ...patch, keyframes: next });
        } else {
          onUpdateClipLive(selectedClip.id, patch);
        }
      },
    };
  };

  const activeExprTrack = selectedClip.keyframes?.find((t) => t.property === exprProp);
  const exprError = activeExprTrack?.expression
    ? validateSafeExpression(activeExprTrack.expression)
    : null;

  const typeBadge =
    selectedClip.type === 'video'
      ? 'Camada de Vídeo'
      : selectedClip.type === 'image'
      ? 'Camada de Imagem'
      : selectedClip.type === 'text'
      ? 'Camada de Texto'
      : selectedClip.type === 'shape'
      ? 'Forma Vetorial'
      : selectedClip.type === 'solid'
      ? 'Camada Sólida'
      : selectedClip.type === 'adjustment'
      ? 'Camada de Ajuste'
      : selectedClip.type === 'null'
      ? 'Objeto Nulo'
      : selectedClip.type === 'precomp'
      ? 'Pré-Composição'
      : 'Faixa de Áudio';

  return (
    <aside
      ref={panelRef}
      className={
        isMobileDrawer
          ? 'w-full h-full flex flex-col select-none overflow-hidden bg-transparent border-0'
          : 'w-[296px] shrink-0 bg-[#121215] border-l border-[#27272a] flex flex-col h-full select-none'
      }
    >
      {/* Editable Layer Name Header + Quick Actions */}
      <div className="p-2.5 border-b border-[#27272a] flex items-center justify-between gap-1.5 shrink-0">
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-mono-code uppercase tracking-wider text-[#3b82f6] block">
            {typeBadge}
          </span>
          <input
            type="text"
            aria-label="Nome da camada"
            value={selectedClip.name}
            onChange={(e) => onUpdateClipLive(selectedClip.id, { name: e.target.value })}
            onBlur={onCommitHistory}
            className="w-full bg-transparent hover:bg-[#1c1c21] focus:bg-[#1c1c21] rounded px-1 -mx-1 py-0.5 text-xs font-semibold text-[#f4f4f5] outline-none truncate"
          />
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => {
              onUpdateClipLive(selectedClip.id, {
                enabled: selectedClip.enabled === false ? true : false,
              });
              onCommitHistory();
            }}
            title={selectedClip.enabled === false ? 'Ativar camada' : 'Desativar camada'}
            className="p-1.5 rounded-md text-[#a1a1aa] hover:text-white hover:bg-[#1c1c21] cursor-pointer"
          >
            {selectedClip.enabled === false ? (
              <EyeOff className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={() => onDuplicateClip(selectedClip.id)}
            title="Duplicar Camada (Ctrl+D)"
            className="p-1.5 rounded-md text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21] transition-colors cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDeleteClip(selectedClip.id)}
            title="Excluir Camada (Delete)"
            className="p-1.5 rounded-md text-[#a1a1aa] hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Contextual Tabs */}
      {!isAudio && (
        <div className="px-2.5 pt-2 shrink-0">
          <div className="grid grid-cols-6 gap-0.5 p-0.5 rounded-lg bg-[#09090b] border border-[#27272a]">
            {(
              [
                ['main', isText ? 'Texto' : 'Transf'],
                ['anim', 'Animar'],
                ['shapeMask', isShape ? 'Forma' : 'Máscara'],
                ['color', 'Cor'],
                ['fx', 'Trans'],
                ['effects', `FX${selectedClip.effects?.length ? `(${selectedClip.effects.length})` : ''}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`py-1 rounded text-[10px] font-medium truncate transition-colors cursor-pointer ${
                  activeTab === id
                    ? 'bg-[#27272a] text-[#f4f4f5]'
                    : 'text-[#71717a] hover:text-[#a1a1aa]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {(selectedClip.type === 'video' || selectedClip.type === 'image') && <button className={`vision-entry ${activeTab === 'vision' ? 'active' : ''}`} onClick={() => setActiveTab('vision')}><Zap size={13} /><span>VFX · Recorte, tracking e estabilizacao</span><ArrowUpRight size={12} /></button>}
        </div>
      )}

      {/* Scrollable Inspector Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
        {activeTab === 'vision' && (selectedClip.type === 'video' || selectedClip.type === 'image') && <MotionToolsPanel key={selectedClip.id} clip={selectedClip} asset={selectedClip.mediaId ? assetsMap.get(selectedClip.mediaId) : undefined} project={project} currentTime={currentTime} locked={trackLocked} onUpdate={onUpdateClipLive} onCommit={onCommitHistory} onBusy={onAnalysisBusy} onPause={onPausePlayback} />}
        {/* AUDIO INSPECTOR */}
        {isAudio && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#18181c] border border-[#27272a]">
              <span className="text-xs font-medium text-[#f4f4f5]">Áudio Ativo</span>
              <button
                onClick={() => {
                  onUpdateClipLive(selectedClip.id, { muted: !selectedClip.muted });
                  onCommitHistory();
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
                  selectedClip.muted
                    ? 'bg-[#ef4444]/15 text-[#ef4444]'
                    : 'bg-[#059669]/20 text-[#34d399]'
                }`}
              >
                {selectedClip.muted ? (
                  <>
                    <VolumeX className="w-3.5 h-3.5" /> Silenciado
                  </>
                ) : (
                  <>
                    <Volume2 className="w-3.5 h-3.5" /> Ligado
                  </>
                )}
              </button>
            </div>

            {(() => {
              const volKf = keyframeHelper('volume');
              return (
                <SliderRow
                  propKey="volume"
                  label="Volume"
                  value={volKf.valNow}
                  min={0}
                  max={200}
                  unit="%"
                  hasKeyframes={volKf.hasKf}
                  onAddKeyframe={volKf.toggleKf}
                  onChange={(val) => volKf.changeVal(val, { volume: val })}
                  onCommit={onCommitHistory}
                />
              );
            })()}
            <button
              type="button"
              onClick={onOpenPropertyGraph}
              className="w-full py-1.5 px-2.5 rounded-lg bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-[11px] font-medium text-[#60a5fa] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Spline className="w-3.5 h-3.5" />
              Curvas de Automação de Volume (Graph Editor)
            </button>
            <SliderRow
              label="Fade In (Entrada)"
              value={selectedClip.fadeIn}
              min={0}
              max={5}
              step={0.1}
              unit="s"
              onChange={(val) => onUpdateClipLive(selectedClip.id, { fadeIn: val })}
              onCommit={onCommitHistory}
            />
            <SliderRow
              label="Fade Out (Saída)"
              value={selectedClip.fadeOut}
              min={0}
              max={5}
              step={0.1}
              unit="s"
              onChange={(val) => onUpdateClipLive(selectedClip.id, { fadeOut: val })}
              onCommit={onCommitHistory}
            />
            <SliderRow
              label="Balanço Estéreo (Pan L/R)"
              value={selectedClip.pan ?? 0}
              min={-100}
              max={100}
              unit="%"
              onChange={(val) => onUpdateClipLive(selectedClip.id, { pan: val })}
              onCommit={onCommitHistory}
            />
            <div className="p-2.5 rounded-lg bg-[#18181c] border border-[#27272a] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#f4f4f5]">EQ 3-Bandas & Dinâmica</span>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateClipLive(selectedClip.id, {
                      audioCompressor: !selectedClip.audioCompressor,
                    });
                    onCommitHistory();
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium border cursor-pointer ${
                    selectedClip.audioCompressor
                      ? 'bg-[#2563eb]/20 border-[#2563eb]/50 text-[#60a5fa]'
                      : 'bg-[#09090b] border-[#27272a] text-[#71717a]'
                  }`}
                >
                  Compressor {selectedClip.audioCompressor ? 'ON' : 'OFF'}
                </button>
              </div>
              <SliderRow
                label="Graves (Low)"
                value={selectedClip.eqLow ?? 0}
                min={-12}
                max={12}
                step={0.5}
                unit="dB"
                onChange={(val) => onUpdateClipLive(selectedClip.id, { eqLow: val })}
                onCommit={onCommitHistory}
              />
              <SliderRow
                label="Médios (Mid)"
                value={selectedClip.eqMid ?? 0}
                min={-12}
                max={12}
                step={0.5}
                unit="dB"
                onChange={(val) => onUpdateClipLive(selectedClip.id, { eqMid: val })}
                onCommit={onCommitHistory}
              />
              <SliderRow
                label="Agudos (High)"
                value={selectedClip.eqHigh ?? 0}
                min={-12}
                max={12}
                step={0.5}
                unit="dB"
                onChange={(val) => onUpdateClipLive(selectedClip.id, { eqHigh: val })}
                onCommit={onCommitHistory}
              />
            </div>
          </div>
        )}

        {/* TAB 1: TRANSFORM + COMPOSITING + TEXT LAB */}
        {!isAudio && activeTab === 'main' && (
          <div className="space-y-3">
            {/* Layer Switches: Solo, Shy, Guide Layer & Label Color */}
            <div className="p-2 rounded-lg bg-[#18181c] border border-[#27272a] space-y-2">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-[#a1a1aa] font-medium">Chaves da Camada</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title="Solo: isola esta camada na composição"
                    onClick={() => {
                      onUpdateClipLive(selectedClip.id, { solo: !selectedClip.solo });
                      onCommitHistory();
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${
                      selectedClip.solo
                        ? 'bg-amber-500/20 border-amber-400/60 text-amber-300'
                        : 'bg-[#09090b] border-[#27272a] text-[#71717a]'
                    }`}
                  >
                    Solo
                  </button>
                  <button
                    type="button"
                    title="Shy: oculta na timeline quando 'Ocultar Shy' está ativo"
                    onClick={() => {
                      onUpdateClipLive(selectedClip.id, { shy: !selectedClip.shy });
                      onCommitHistory();
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${
                      selectedClip.shy
                        ? 'bg-sky-500/20 border-sky-400/60 text-sky-300'
                        : 'bg-[#09090b] border-[#27272a] text-[#71717a]'
                    }`}
                  >
                    Shy
                  </button>
                  <button
                    type="button"
                    title="Camada-Guia: visível na prévia, excluída na exportação final"
                    onClick={() => {
                      onUpdateClipLive(selectedClip.id, { guideLayer: !selectedClip.guideLayer });
                      onCommitHistory();
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${
                      selectedClip.guideLayer
                        ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                        : 'bg-[#09090b] border-[#27272a] text-[#71717a]'
                    }`}
                  >
                    Guia
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#71717a]">Cor da Etiqueta</span>
                <div className="flex items-center gap-1">
                  {['#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4'].map(
                    (col) => (
                      <button
                        key={col}
                        type="button"
                        aria-label={`Cor da camada ${col}`}
                        onClick={() => {
                          onUpdateClipLive(selectedClip.id, { labelColor: col });
                          onCommitHistory();
                        }}
                        style={{ backgroundColor: col }}
                        className={`w-3.5 h-3.5 rounded-full cursor-pointer transition-transform ${
                          selectedClip.labelColor === col
                            ? 'ring-2 ring-white scale-110'
                            : 'opacity-75 hover:opacity-100'
                        }`}
                      />
                    )
                  )}
                </div>
              </div>
            </div>
            {isSolid && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-[#18181c] border border-[#27272a]">
                <span className="text-xs text-[#a1a1aa]">Cor do Sólido</span>
                <input
                  type="color"
                  aria-label="Cor da camada sólida"
                  value={selectedClip.solidColor || '#2563eb'}
                  onChange={(e) => onUpdateClipLive(selectedClip.id, { solidColor: e.target.value })}
                  onBlur={onCommitHistory}
                  className="w-9 h-7 rounded cursor-pointer"
                />
              </div>
            )}

            {/* Text Lab controls when layer is text */}
            {isText && selectedClip.textStyle && (
              <div className="space-y-3 pb-3 border-b border-[#27272a]">
                <textarea
                  rows={2}
                  aria-label="Conteúdo do texto"
                  value={selectedClip.textStyle.text}
                  onChange={(e) =>
                    onUpdateClipLive(selectedClip.id, {
                      name: `Texto • ${e.target.value.slice(0, 18) || 'Sem título'}`,
                      textStyle: { ...selectedClip.textStyle!, text: e.target.value },
                    })
                  }
                  onBlur={onCommitHistory}
                  className="w-full bg-[#18181c] border border-[#27272a] focus:border-[#3b82f6] rounded-lg p-2 text-xs text-[#f4f4f5] outline-none resize-none"
                />

                <div className="grid grid-cols-2 gap-2">
                  <select
                    aria-label="Família tipográfica"
                    value={selectedClip.textStyle.fontFamily}
                    onChange={(e) => {
                      onUpdateClipLive(selectedClip.id, {
                        textStyle: { ...selectedClip.textStyle!, fontFamily: e.target.value },
                      });
                      onCommitHistory();
                    }}
                    className="bg-[#18181c] border border-[#27272a] rounded px-2 py-1.5 text-xs text-[#f4f4f5]"
                  >
                    <option value="Inter">Inter Sans</option>
                    <option value="JetBrains Mono">JetBrains Mono</option>
                    <option value="Georgia">Georgia Serif</option>
                    <option value="Impact">Impact Display</option>
                  </select>

                  <select
                    aria-label="Animação de texto"
                    value={selectedClip.textStyle.animation}
                    onChange={(e) => {
                      onUpdateClipLive(selectedClip.id, {
                        textStyle: {
                          ...selectedClip.textStyle!,
                          animation: e.target.value as TextAnimation,
                        },
                      });
                      onCommitHistory();
                    }}
                    className="bg-[#18181c] border border-[#27272a] rounded px-2 py-1.5 text-xs text-[#f4f4f5]"
                  >
                    <option value="fade-up">Subir Suave</option>
                    <option value="stagger-chars">Por Caractere</option>
                    <option value="stagger-words">Por Palavra</option>
                    <option value="tracking-in">Tracking Cinético</option>
                    <option value="mask-reveal">Revelação Máscara</option>
                    <option value="pop">Pop Elástico</option>
                    <option value="typewriter">Digitação</option>
                    <option value="glow">Pulso Neon</option>
                    <option value="none">Nenhuma</option>
                  </select>
                </div>

                <SliderRow
                  label="Tamanho da Fonte"
                  value={selectedClip.textStyle.fontSize}
                  min={14}
                  max={140}
                  unit="px"
                  onChange={(val) =>
                    onUpdateClipLive(selectedClip.id, {
                      textStyle: { ...selectedClip.textStyle!, fontSize: val },
                    })
                  }
                  onCommit={onCommitHistory}
                />

                <SliderRow
                  label="Tracking / Kerning"
                  value={keyframeHelper('letterSpacing').valNow}
                  min={-6}
                  max={36}
                  step={0.5}
                  unit="px"
                  hasKeyframes={keyframeHelper('letterSpacing').hasKf}
                  onAddKeyframe={keyframeHelper('letterSpacing').toggleKf}
                  onChange={(val) =>
                    keyframeHelper('letterSpacing').changeVal(val, {
                      textStyle: { ...selectedClip.textStyle!, letterSpacing: val },
                    })
                  }
                  onCommit={onCommitHistory}
                />

                <SliderRow
                  label="Entrelinha"
                  value={selectedClip.textStyle.lineHeightMultiplier ?? 1.24}
                  min={0.8}
                  max={2.4}
                  step={0.05}
                  unit="x"
                  onChange={(val) =>
                    onUpdateClipLive(selectedClip.id, {
                      textStyle: { ...selectedClip.textStyle!, lineHeightMultiplier: val },
                    })
                  }
                  onCommit={onCommitHistory}
                />

                <SliderRow
                  label="Texto em Caminho Curvo (Arc)"
                  value={selectedClip.textStyle.pathArc ?? 0}
                  min={-60}
                  max={60}
                  unit="%"
                  onChange={(val) =>
                    onUpdateClipLive(selectedClip.id, {
                      textStyle: { ...selectedClip.textStyle!, pathArc: val },
                    })
                  }
                  onCommit={onCommitHistory}
                />

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-[#a1a1aa] block mb-1">Preenchimento</label>
                    <input
                      type="color"
                      value={selectedClip.textStyle.color}
                      onChange={(e) =>
                        onUpdateClipLive(selectedClip.id, {
                          textStyle: { ...selectedClip.textStyle!, color: e.target.value },
                        })
                      }
                      onBlur={onCommitHistory}
                      className="w-full h-7 rounded bg-[#18181c] border border-[#27272a] cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#a1a1aa] block mb-1">Fundo</label>
                    <input
                      type="color"
                      value={selectedClip.textStyle.backgroundColor}
                      onChange={(e) =>
                        onUpdateClipLive(selectedClip.id, {
                          textStyle: { ...selectedClip.textStyle!, backgroundColor: e.target.value },
                        })
                      }
                      onBlur={onCommitHistory}
                      className="w-full h-7 rounded bg-[#18181c] border border-[#27272a] cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#a1a1aa] block mb-1">Contorno</label>
                    <input
                      type="color"
                      value={selectedClip.textStyle.strokeColor}
                      onChange={(e) =>
                        onUpdateClipLive(selectedClip.id, {
                          textStyle: { ...selectedClip.textStyle!, strokeColor: e.target.value },
                        })
                      }
                      onBlur={onCommitHistory}
                      className="w-full h-7 rounded bg-[#18181c] border border-[#27272a] cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex bg-[#18181c] rounded-md border border-[#27272a] p-0.5">
                    {(['left', 'center', 'right'] as const).map((align) => (
                      <button
                        key={align}
                        onClick={() => {
                          onUpdateClipLive(selectedClip.id, {
                            textStyle: { ...selectedClip.textStyle!, textAlign: align },
                          });
                          onCommitHistory();
                        }}
                        className={`p-1.5 rounded cursor-pointer ${
                          selectedClip.textStyle!.textAlign === align
                            ? 'bg-[#27272a] text-[#f4f4f5]'
                            : 'text-[#71717a]'
                        }`}
                      >
                        {align === 'left' && <AlignLeft className="w-3.5 h-3.5" />}
                        {align === 'center' && <AlignCenter className="w-3.5 h-3.5" />}
                        {align === 'right' && <AlignRight className="w-3.5 h-3.5" />}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => {
                      const prev = selectedClip.textStyle!.animator;
                      onUpdateClipLive(selectedClip.id, {
                        textStyle: {
                          ...selectedClip.textStyle!,
                          animator: {
                            enabled: !prev?.enabled,
                            unit: prev?.unit || 'char',
                            rangeStart: 0,
                            rangeEnd: 100,
                            offsetX: prev?.offsetX ?? 0,
                            offsetY: prev?.offsetY ?? 38,
                            scale: prev?.scale ?? 70,
                            rotation: prev?.rotation ?? 0,
                            opacity: prev?.opacity ?? 0,
                            tracking: prev?.tracking ?? 4,
                          },
                        },
                      });
                      onCommitHistory();
                    }}
                    className={`px-2 py-1 rounded text-[11px] font-medium border cursor-pointer ${
                      selectedClip.textStyle.animator?.enabled
                        ? 'bg-[#2563eb]/20 border-[#3b82f6] text-[#60a5fa]'
                        : 'bg-[#18181c] border-[#27272a] text-[#a1a1aa]'
                    }`}
                  >
                    Animador 3D/Char
                  </button>
                </div>
              </div>
            )}

            {/* Spatial Transform with Keyframe Diamonds */}
            <SliderRow
              propKey="x"
              label="Posição Horizontal (X)"
              value={keyframeHelper('x').valNow}
              min={-100}
              max={100}
              step={0.5}
              unit="%"
              hasKeyframes={keyframeHelper('x').hasKf}
              onAddKeyframe={keyframeHelper('x').toggleKf}
              onChange={(val) => keyframeHelper('x').changeVal(val, { x: val })}
              onCommit={onCommitHistory}
            />
            <SliderRow
              propKey="y"
              label="Posição Vertical (Y)"
              value={keyframeHelper('y').valNow}
              min={-100}
              max={100}
              step={0.5}
              unit="%"
              hasKeyframes={keyframeHelper('y').hasKf}
              onAddKeyframe={keyframeHelper('y').toggleKf}
              onChange={(val) => keyframeHelper('y').changeVal(val, { y: val })}
              onCommit={onCommitHistory}
            />
            <SliderRow
              propKey="z"
              label="Profundidade 2.5D (Z)"
              value={keyframeHelper('z').valNow}
              min={-600}
              max={600}
              step={5}
              unit="px"
              hasKeyframes={keyframeHelper('z').hasKf}
              onAddKeyframe={keyframeHelper('z').toggleKf}
              onChange={(val) => keyframeHelper('z').changeVal(val, { z: val })}
              onCommit={onCommitHistory}
            />

            {/* Scale (Linked or Independent X/Y) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[#71717a]">Escala</span>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateClipLive(selectedClip.id, {
                      unlinkScale: !selectedClip.unlinkScale,
                      scaleX: selectedClip.scaleX ?? selectedClip.scale,
                      scaleY: selectedClip.scaleY ?? selectedClip.scale,
                    });
                    onCommitHistory();
                  }}
                  title="Alternar escala vinculada ou independente por eixo"
                  className="text-[10px] text-[#60a5fa] flex items-center gap-1 cursor-pointer"
                >
                  {selectedClip.unlinkScale ? <Link2Off size={11} /> : <Link2 size={11} />}
                  {selectedClip.unlinkScale ? 'Eixos X/Y Livres' : 'Proporcional'}
                </button>
              </div>

              {!selectedClip.unlinkScale ? (
                <SliderRow
                  propKey="scale"
                  label="Escala (Zoom)"
                  value={keyframeHelper('scale').valNow}
                  min={0}
                  max={280}
                  unit="%"
                  hasKeyframes={keyframeHelper('scale').hasKf}
                  onAddKeyframe={keyframeHelper('scale').toggleKf}
                  onChange={(val) =>
                    keyframeHelper('scale').changeVal(val, { scale: val, scaleX: val, scaleY: val })
                  }
                  onCommit={onCommitHistory}
                />
              ) : (
                <>
                  <SliderRow
                    propKey="scale"
                    label="Escala Eixo X"
                    value={keyframeHelper('scaleX').valNow}
                    min={0}
                    max={280}
                    unit="%"
                    hasKeyframes={keyframeHelper('scaleX').hasKf}
                    onAddKeyframe={keyframeHelper('scaleX').toggleKf}
                    onChange={(val) => keyframeHelper('scaleX').changeVal(val, { scaleX: val })}
                    onCommit={onCommitHistory}
                  />
                  <SliderRow
                    label="Escala Eixo Y"
                    value={keyframeHelper('scaleY').valNow}
                    min={0}
                    max={280}
                    unit="%"
                    hasKeyframes={keyframeHelper('scaleY').hasKf}
                    onAddKeyframe={keyframeHelper('scaleY').toggleKf}
                    onChange={(val) => keyframeHelper('scaleY').changeVal(val, { scaleY: val })}
                    onCommit={onCommitHistory}
                  />
                </>
              )}
            </div>

            <SliderRow
              propKey="rotation"
              label="Rotação 2D (Z)"
              value={keyframeHelper('rotation').valNow}
              min={-360}
              max={360}
              unit="°"
              hasKeyframes={keyframeHelper('rotation').hasKf}
              onAddKeyframe={keyframeHelper('rotation').toggleKf}
              onChange={(val) => keyframeHelper('rotation').changeVal(val, { rotation: val })}
              onCommit={onCommitHistory}
            />

            <div className="grid grid-cols-2 gap-2">
              <SliderRow
                label="Inclinar 3D X"
                value={keyframeHelper('rotationX').valNow}
                min={-75}
                max={75}
                unit="°"
                hasKeyframes={keyframeHelper('rotationX').hasKf}
                onAddKeyframe={keyframeHelper('rotationX').toggleKf}
                onChange={(val) => keyframeHelper('rotationX').changeVal(val, { rotationX: val })}
                onCommit={onCommitHistory}
              />
              <SliderRow
                label="Inclinar 3D Y"
                value={keyframeHelper('rotationY').valNow}
                min={-75}
                max={75}
                unit="°"
                hasKeyframes={keyframeHelper('rotationY').hasKf}
                onAddKeyframe={keyframeHelper('rotationY').toggleKf}
                onChange={(val) => keyframeHelper('rotationY').changeVal(val, { rotationY: val })}
                onCommit={onCommitHistory}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <SliderRow
                label="Âncora X"
                value={keyframeHelper('anchorX').valNow}
                min={-50}
                max={50}
                unit="%"
                hasKeyframes={keyframeHelper('anchorX').hasKf}
                onAddKeyframe={keyframeHelper('anchorX').toggleKf}
                onChange={(val) => keyframeHelper('anchorX').changeVal(val, { anchorX: val })}
                onCommit={onCommitHistory}
              />
              <SliderRow
                label="Âncora Y"
                value={keyframeHelper('anchorY').valNow}
                min={-50}
                max={50}
                unit="%"
                hasKeyframes={keyframeHelper('anchorY').hasKf}
                onAddKeyframe={keyframeHelper('anchorY').toggleKf}
                onChange={(val) => keyframeHelper('anchorY').changeVal(val, { anchorY: val })}
                onCommit={onCommitHistory}
              />
            </div>

            <SliderRow
              propKey="opacity"
              label="Opacidade"
              value={keyframeHelper('opacity').valNow}
              min={0}
              max={100}
              unit="%"
              hasKeyframes={keyframeHelper('opacity').hasKf}
              onAddKeyframe={keyframeHelper('opacity').toggleKf}
              onChange={(val) => keyframeHelper('opacity').changeVal(val, { opacity: val })}
              onCommit={onCommitHistory}
            />

            {/* Parenting, Blend Mode & Track Matte */}
            <div className="pt-2 border-t border-[#27272a] space-y-2 text-xs">
              <div>
                <label className="text-[11px] text-[#a1a1aa] block mb-1">
                   Camada Pai (Parenting)
                </label>
                <select
                  aria-label="Camada Pai"
                  value={selectedClip.parentId || ''}
                  onChange={(e) => {
                    onUpdateClipLive(selectedClip.id, {
                      parentId: e.target.value || null,
                    });
                    onCommitHistory();
                  }}
                  className="w-full bg-[#18181c] border border-[#27272a] rounded-md px-2 py-1.5 text-xs text-[#f4f4f5]"
                >
                  <option value="">Nenhum (Independente)</option>
                  {allClips
                    .filter((c) => c.id !== selectedClip.id && c.type !== 'audio')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-[#a1a1aa] block mb-1">Mesclagem</label>
                  <select
                    aria-label="Modo de mesclagem"
                    value={selectedClip.blendMode || 'source-over'}
                    onChange={(e) => {
                      onUpdateClipLive(selectedClip.id, {
                        blendMode: e.target.value as BlendMode,
                      });
                      onCommitHistory();
                    }}
                    className="w-full bg-[#18181c] border border-[#27272a] rounded-md px-2 py-1.5 text-xs text-[#f4f4f5]"
                  >
                    {BLEND_MODES.map((bm) => (
                      <option key={bm.id} value={bm.id}>
                        {bm.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-[#a1a1aa] block mb-1">Track Matte</label>
                  <select
                    aria-label="Track Matte"
                    value={selectedClip.trackMatte || 'none'}
                    onChange={(e) => {
                      onUpdateClipLive(selectedClip.id, {
                        trackMatte: e.target.value as TrackMatteMode,
                      });
                      onCommitHistory();
                    }}
                    className="w-full bg-[#18181c] border border-[#27272a] rounded-md px-2 py-1.5 text-xs text-[#f4f4f5]"
                  >
                    <option value="none">Sem Matte</option>
                    <option value="alpha">Alpha Matte (Acima)</option>
                    <option value="alpha-inverted">Alpha Invertido</option>
                    <option value="luma">Luma Matte (Acima)</option>
                    <option value="luma-inverted">Luma Invertido</option>
                  </select>
                </div>
              </div>
            </div>

            {(selectedClip.type === 'video' || selectedClip.type === 'image') && (
              <>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    onClick={() => {
                      onUpdateClipLive(selectedClip.id, { flipH: !selectedClip.flipH });
                      onCommitHistory();
                    }}
                    className={`py-1.5 px-2 rounded-md border text-xs flex items-center justify-center gap-1.5 cursor-pointer ${
                      selectedClip.flipH
                        ? 'bg-[#2563eb]/20 border-[#2563eb] text-[#60a5fa]'
                        : 'bg-[#18181c] border-[#27272a] text-[#a1a1aa]'
                    }`}
                  >
                    <FlipHorizontal2 className="w-3.5 h-3.5" /> Espelhar H
                  </button>
                  <button
                    onClick={() => {
                      onUpdateClipLive(selectedClip.id, { flipV: !selectedClip.flipV });
                      onCommitHistory();
                    }}
                    className={`py-1.5 px-2 rounded-md border text-xs flex items-center justify-center gap-1.5 cursor-pointer ${
                      selectedClip.flipV
                        ? 'bg-[#2563eb]/20 border-[#2563eb] text-[#60a5fa]'
                        : 'bg-[#18181c] border-[#27272a] text-[#a1a1aa]'
                    }`}
                  >
                    <FlipVertical2 className="w-3.5 h-3.5" /> Espelhar V
                  </button>
                </div>

                <div>
                  <label className="text-[11px] text-[#a1a1aa] block mb-1">
                    Movimento de Câmera
                  </label>
                  <select
                    value={selectedClip.motionPreset}
                    onChange={(e) => {
                      onUpdateClipLive(selectedClip.id, {
                        motionPreset: e.target.value as MotionPreset,
                      });
                      onCommitHistory();
                    }}
                    className="w-full bg-[#18181c] border border-[#27272a] rounded-md px-2.5 py-1.5 text-xs text-[#f4f4f5] outline-none"
                  >
                    <option value="none">Estático (Sem movimento)</option>
                    <option value="zoom-in">Zoom In Cinematográfico</option>
                    <option value="zoom-out">Zoom Out Revelação</option>
                    <option value="pan-right">Panorâmica Direita</option>
                    <option value="pan-left">Panorâmica Esquerda</option>
                  </select>
                </div>

                {selectedClip.timeRemap?.enabled ? (
                  <button
                    type="button"
                    onClick={onOpenTimeRemap}
                    className="inspector-remap-button"
                  >
                    <Timer className="w-3.5 h-3.5 text-[#60a5fa]" />
                    <span>Time Remapping ativo</span>
                    <ArrowUpRight className="w-3.5 h-3.5 ml-auto text-[#71717a]" />
                  </button>
                ) : (
                  <SliderRow
                    label="Velocidade de Reprodução"
                    value={selectedClip.speed}
                    min={0.25}
                    max={2.5}
                    step={0.25}
                    unit="x"
                    onChange={(val) => onChangeClipSpeed(selectedClip.id, val)}
                    onCommit={onCommitHistory}
                  />
                )}
              </>
            )}

            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <button
                onClick={onOpenPropertyGraph}
                className="py-1.5 px-2 rounded-md bg-[#2563eb]/20 hover:bg-[#2563eb]/30 border border-[#3b82f6]/50 text-[11px] font-medium text-[#93c5fd] flex items-center justify-center gap-1 cursor-pointer"
              >
                <Spline className="w-3 h-3" /> Graph Editor
              </button>
              <button
                onClick={() => {
                  onUpdateClipLive(selectedClip.id, {
                    x: 0,
                    y: 0,
                    z: 0,
                    anchorX: 0,
                    anchorY: 0,
                    scale: 100,
                    scaleX: 100,
                    scaleY: 100,
                    rotation: 0,
                    rotationX: 0,
                    rotationY: 0,
                    opacity: 100,
                  });
                  onCommitHistory();
                }}
                className="py-1.5 px-2 rounded-md bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-[11px] text-[#a1a1aa] hover:text-[#f4f4f5] flex items-center justify-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" /> Resetar
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: MOTION STACK + SAFE EXPRESSIONS */}
        {!isAudio && activeTab === 'anim' && (
          <div className="space-y-3.5 text-xs">
            <div className="p-2.5 rounded-lg bg-[#18181c] border border-[#27272a] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#f4f4f5] flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> Motion Stack
                </span>
                <button
                  onClick={() => {
                    const def = MOTION_BEHAVIOR_DEFS.find((d) => d.type === behType)!;
                    const created: MotionBehavior = {
                      id: uid('beh'),
                      type: def.type,
                      enabled: true,
                      property: def.defaultProperty,
                      ...def.defaults,
                    };
                    onUpdateClipLive(selectedClip.id, {
                      motionStack: [...(selectedClip.motionStack || []), created],
                    });
                    onCommitHistory();
                  }}
                  className="px-2 py-0.5 rounded bg-[#2563eb] hover:bg-[#3b82f6] text-white text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Plus size={11} /> Empilhar
                </button>
              </div>

              <select
                aria-label="Escolher comportamento procedural"
                value={behType}
                onChange={(e) => setBehType(e.target.value as MotionBehaviorType)}
                className="w-full bg-[#09090b] border border-[#27272a] rounded px-2 py-1.5 text-xs text-[#f4f4f5]"
              >
                {MOTION_BEHAVIOR_DEFS.map((b) => (
                  <option key={b.type} value={b.type}>
                    {b.label} — {b.description}
                  </option>
                ))}
              </select>

              {(selectedClip.motionStack || []).map((beh, idx) => {
                const list = selectedClip.motionStack || [];
                return (
                  <div
                    key={beh.id}
                    className="p-2 rounded bg-[#09090b] border border-[#27272a] space-y-2"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium text-[#93c5fd] truncate">
                        {MOTION_BEHAVIOR_DEFS.find((d) => d.type === beh.type)?.label || beh.type}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <button
                          disabled={idx === 0}
                          onClick={() => {
                            const next = [...list];
                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                            onUpdateClipLive(selectedClip.id, { motionStack: next });
                            onCommitHistory();
                          }}
                          className="p-1 text-[#71717a] hover:text-white disabled:opacity-30 cursor-pointer"
                        >
                          <ArrowUp size={11} />
                        </button>
                        <button
                          disabled={idx === list.length - 1}
                          onClick={() => {
                            const next = [...list];
                            [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                            onUpdateClipLive(selectedClip.id, { motionStack: next });
                            onCommitHistory();
                          }}
                          className="p-1 text-[#71717a] hover:text-white disabled:opacity-30 cursor-pointer"
                        >
                          <ArrowDown size={11} />
                        </button>
                        <button
                          onClick={() => {
                            onUpdateClipLive(selectedClip.id, {
                              motionStack: list.filter((item) => item.id !== beh.id),
                            });
                            onCommitHistory();
                          }}
                          className="p-1 text-[#71717a] hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>

                    <select
                      value={beh.property}
                      onChange={(e) => {
                        onUpdateClipLive(selectedClip.id, {
                          motionStack: list.map((item) =>
                            item.id === beh.id
                              ? { ...item, property: e.target.value as AnimatableProperty }
                              : item
                          ),
                        });
                        onCommitHistory();
                      }}
                      className="w-full bg-[#18181c] border border-[#27272a] rounded px-1.5 py-1 text-[11px] text-[#f4f4f5]"
                    >
                      <option value="x">Posição X</option>
                      <option value="y">Posição Y</option>
                      <option value="scale">Escala</option>
                      <option value="scaleX">Escala X</option>
                      <option value="scaleY">Escala Y</option>
                      <option value="rotation">Rotação</option>
                      <option value="opacity">Opacidade</option>
                    </select>

                    <SliderRow
                      label="Intensidade"
                      value={beh.intensity}
                      min={-120}
                      max={120}
                      onChange={(val) =>
                        onUpdateClipLive(selectedClip.id, {
                          motionStack: list.map((item) =>
                            item.id === beh.id ? { ...item, intensity: val } : item
                          ),
                        })
                      }
                      onCommit={onCommitHistory}
                    />
                    <SliderRow
                      label="Amortecimento (Damping)"
                      value={beh.damping}
                      min={0.5}
                      max={16}
                      step={0.5}
                      onChange={(val) =>
                        onUpdateClipLive(selectedClip.id, {
                          motionStack: list.map((item) =>
                            item.id === beh.id ? { ...item, damping: val } : item
                          ),
                        })
                      }
                      onCommit={onCommitHistory}
                    />
                    <SliderRow
                      label="Frequência"
                      value={beh.frequency}
                      min={0.2}
                      max={20}
                      step={0.2}
                      unit="Hz"
                      onChange={(val) =>
                        onUpdateClipLive(selectedClip.id, {
                          motionStack: list.map((item) =>
                            item.id === beh.id ? { ...item, frequency: val } : item
                          ),
                        })
                      }
                      onCommit={onCommitHistory}
                    />
                    <SliderRow
                      label="Atraso (Delay)"
                      value={beh.delay}
                      min={0}
                      max={5}
                      step={0.05}
                      unit="s"
                      onChange={(val) =>
                        onUpdateClipLive(selectedClip.id, {
                          motionStack: list.map((item) =>
                            item.id === beh.id ? { ...item, delay: val } : item
                          ),
                        })
                      }
                      onCommit={onCommitHistory}
                    />
                  </div>
                );
              })}
            </div>

            {/* Safe Expression Engine */}
            <div className="p-2.5 rounded-lg bg-[#18181c] border border-[#27272a] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#f4f4f5] flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5 text-[#34d399]" /> Expressão Segura
                </span>
                <select
                  aria-label="Propriedade da expressão"
                  value={exprProp}
                  onChange={(e) => setExprProp(e.target.value as AnimatableProperty)}
                  className="bg-[#09090b] border border-[#27272a] rounded px-1.5 py-0.5 text-[11px] text-[#f4f4f5]"
                >
                  <option value="x">Posição X</option>
                  <option value="y">Posição Y</option>
                  <option value="scale">Escala</option>
                  <option value="rotation">Rotação</option>
                  <option value="opacity">Opacidade</option>
                </select>
              </div>

              <textarea
                rows={2}
                aria-label="Código da expressão procedural"
                placeholder="Ex: wiggle(3, 12) ou value + audioLevel * 25"
                value={activeExprTrack?.expression || ''}
                onChange={(e) => {
                  const text = e.target.value;
                  const others = (selectedClip.keyframes || []).filter(
                    (t) => t.property !== exprProp
                  );
                  const updated = {
                    property: exprProp,
                    keyframes: activeExprTrack?.keyframes || [],
                    loop: activeExprTrack?.loop,
                    expression: text,
                    expressionEnabled: true,
                  };
                  onUpdateClipLive(selectedClip.id, { keyframes: [...others, updated] });
                }}
                onBlur={onCommitHistory}
                className="w-full font-mono-code bg-[#09090b] border border-[#27272a] focus:border-[#34d399] rounded p-2 text-[11px] text-[#f4f4f5] outline-none resize-none"
              />

              {exprError && (
                <p role="note" className="text-[10px] text-[#fca5a5] bg-[#ef4444]/15 border border-[#ef4444]/30 rounded p-1.5">
                  {exprError}
                </p>
              )}

              <div className="flex flex-wrap gap-1">
                {[
                  ['Wiggle', 'wiggle(3, 14)'],
                  ['Oscilar', 'oscillate(1.2, 18)'],
                  ['Áudio Beat', 'value + audioLevel * 28'],
                  ['Spring', 'spring(-35, 5, 9)'],
                  ['PingPong', 'pingpong(1.2, 20)'],
                ].map(([lbl, snippet]) => (
                  <button
                    key={lbl}
                    onClick={() => {
                      const others = (selectedClip.keyframes || []).filter(
                        (t) => t.property !== exprProp
                      );
                      onUpdateClipLive(selectedClip.id, {
                        keyframes: [
                          ...others,
                          {
                            property: exprProp,
                            keyframes: activeExprTrack?.keyframes || [],
                            expression: snippet,
                            expressionEnabled: true,
                          },
                        ],
                      });
                      onCommitHistory();
                    }}
                    className="px-2 py-0.5 rounded bg-[#09090b] hover:bg-[#27272a] border border-[#27272a] text-[10px] text-[#a1a1aa] hover:text-white cursor-pointer"
                  >
                    + {lbl}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: VECTOR SHAPE + LAYER MASKS */}
        {!isAudio && activeTab === 'shapeMask' && (
          <div className="space-y-3.5 text-xs">
            {isShape && selectedClip.shapeData && (
              <div className="p-2.5 rounded-lg bg-[#18181c] border border-[#27272a] space-y-2.5">
                <span className="font-semibold text-[#60a5fa] block">
                  Geometria Vetorial, Trim Paths & Repeater
                </span>

                <div className="grid grid-cols-2 gap-2">
                  <select
                    aria-label="Tipo de forma vetorial"
                    value={selectedClip.shapeData.kind}
                    onChange={(e) => {
                      onUpdateClipLive(selectedClip.id, {
                        shapeData: {
                          ...selectedClip.shapeData!,
                          kind: e.target.value as VectorShapeKind,
                        },
                      });
                      onCommitHistory();
                    }}
                    className="bg-[#09090b] border border-[#27272a] rounded px-2 py-1 text-xs text-[#f4f4f5]"
                  >
                    <option value="rect">Retângulo</option>
                    <option value="ellipse">Elipse</option>
                    <option value="polygon">Polígono</option>
                    <option value="star">Estrela</option>
                    <option value="line">Linha</option>
                    <option value="path">Curva Bézier</option>
                  </select>

                  <select
                    aria-label="Modo de preenchimento"
                    value={selectedClip.shapeData.fillMode}
                    onChange={(e) => {
                      onUpdateClipLive(selectedClip.id, {
                        shapeData: {
                          ...selectedClip.shapeData!,
                          fillMode: e.target.value as 'solid' | 'linear-gradient' | 'radial-gradient' | 'none',
                        },
                      });
                      onCommitHistory();
                    }}
                    className="bg-[#09090b] border border-[#27272a] rounded px-2 py-1 text-xs text-[#f4f4f5]"
                  >
                    <option value="solid">Sólido</option>
                    <option value="linear-gradient">Gradiente Linear</option>
                    <option value="radial-gradient">Gradiente Radial</option>
                    <option value="none">Sem Preenchimento</option>
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-[#71717a] block">Cor 1</label>
                    <input
                      type="color"
                      value={selectedClip.shapeData.fillColor}
                      onChange={(e) =>
                        onUpdateClipLive(selectedClip.id, {
                          shapeData: { ...selectedClip.shapeData!, fillColor: e.target.value },
                        })
                      }
                      onBlur={onCommitHistory}
                      className="w-full h-7 rounded cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#71717a] block">Cor 2</label>
                    <input
                      type="color"
                      value={selectedClip.shapeData.gradientColor2}
                      onChange={(e) =>
                        onUpdateClipLive(selectedClip.id, {
                          shapeData: { ...selectedClip.shapeData!, gradientColor2: e.target.value },
                        })
                      }
                      onBlur={onCommitHistory}
                      className="w-full h-7 rounded cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#71717a] block">Contorno</label>
                    <input
                      type="color"
                      value={selectedClip.shapeData.strokeColor}
                      onChange={(e) =>
                        onUpdateClipLive(selectedClip.id, {
                          shapeData: { ...selectedClip.shapeData!, strokeColor: e.target.value },
                        })
                      }
                      onBlur={onCommitHistory}
                      className="w-full h-7 rounded cursor-pointer"
                    />
                  </div>
                </div>

                <SliderRow
                  label="Largura da Forma"
                  value={selectedClip.shapeData.width}
                  min={4}
                  max={100}
                  unit="%"
                  onChange={(val) =>
                    onUpdateClipLive(selectedClip.id, {
                      shapeData: { ...selectedClip.shapeData!, width: val },
                    })
                  }
                  onCommit={onCommitHistory}
                />
                <SliderRow
                  label="Altura da Forma"
                  value={selectedClip.shapeData.height}
                  min={4}
                  max={100}
                  unit="%"
                  onChange={(val) =>
                    onUpdateClipLive(selectedClip.id, {
                      shapeData: { ...selectedClip.shapeData!, height: val },
                    })
                  }
                  onCommit={onCommitHistory}
                />
                <SliderRow
                  label="Espessura do Contorno"
                  value={keyframeHelper('strokeWidth').valNow}
                  min={0}
                  max={36}
                  step={0.5}
                  unit="px"
                  hasKeyframes={keyframeHelper('strokeWidth').hasKf}
                  onAddKeyframe={keyframeHelper('strokeWidth').toggleKf}
                  onChange={(val) =>
                    keyframeHelper('strokeWidth').changeVal(val, {
                      shapeData: { ...selectedClip.shapeData!, strokeWidth: val },
                    })
                  }
                  onCommit={onCommitHistory}
                />
                <SliderRow
                  label="Trim Paths — Início"
                  value={keyframeHelper('trimStartPct').valNow}
                  min={0}
                  max={100}
                  unit="%"
                  hasKeyframes={keyframeHelper('trimStartPct').hasKf}
                  onAddKeyframe={keyframeHelper('trimStartPct').toggleKf}
                  onChange={(val) =>
                    keyframeHelper('trimStartPct').changeVal(val, {
                      shapeData: { ...selectedClip.shapeData!, trimStart: val },
                    })
                  }
                  onCommit={onCommitHistory}
                />
                <SliderRow
                  label="Trim Paths — Fim"
                  value={keyframeHelper('trimEndPct').valNow}
                  min={0}
                  max={100}
                  unit="%"
                  hasKeyframes={keyframeHelper('trimEndPct').hasKf}
                  onAddKeyframe={keyframeHelper('trimEndPct').toggleKf}
                  onChange={(val) =>
                    keyframeHelper('trimEndPct').changeVal(val, {
                      shapeData: { ...selectedClip.shapeData!, trimEnd: val },
                    })
                  }
                  onCommit={onCommitHistory}
                />
                <SliderRow
                  label="Repeater — Cópias"
                  value={selectedClip.shapeData.repeaterCopies}
                  min={1}
                  max={16}
                  onChange={(val) =>
                    onUpdateClipLive(selectedClip.id, {
                      shapeData: { ...selectedClip.shapeData!, repeaterCopies: val },
                    })
                  }
                  onCommit={onCommitHistory}
                />
                {selectedClip.shapeData.repeaterCopies > 1 && (
                  <>
                    <SliderRow
                      label="Repeater — Deslocamento X"
                      value={selectedClip.shapeData.repeaterOffsetX}
                      min={-150}
                      max={150}
                      unit="px"
                      onChange={(val) =>
                        onUpdateClipLive(selectedClip.id, {
                          shapeData: { ...selectedClip.shapeData!, repeaterOffsetX: val },
                        })
                      }
                      onCommit={onCommitHistory}
                    />
                    <SliderRow
                      label="Repeater — Rotação / Cópia"
                      value={selectedClip.shapeData.repeaterRotation}
                      min={-90}
                      max={90}
                      unit="°"
                      onChange={(val) =>
                        onUpdateClipLive(selectedClip.id, {
                          shapeData: { ...selectedClip.shapeData!, repeaterRotation: val },
                        })
                      }
                      onCommit={onCommitHistory}
                    />
                  </>
                )}
              </div>
            )}

            {/* Layer Masks Section */}
            <div className="p-2.5 rounded-lg bg-[#18181c] border border-[#27272a] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#f4f4f5]">Máscaras de Recorte Real</span>
                <div className="flex gap-1">
                  {(['rect', 'ellipse', 'star'] as const).map((mkKind) => (
                    <button
                      key={mkKind}
                      onClick={() => {
                        const existing = selectedClip.masks || [];
                        onUpdateClipLive(selectedClip.id, {
                          masks: [
                            ...existing,
                            createDefaultMask(mkKind, existing.length + 1),
                          ],
                        });
                        onCommitHistory();
                      }}
                      className="px-2 py-0.5 rounded bg-[#2563eb] hover:bg-[#3b82f6] text-white text-[10px] font-medium cursor-pointer"
                    >
                      + {mkKind === 'rect' ? 'Ret' : mkKind === 'ellipse' ? 'Elipse' : 'Estrela'}
                    </button>
                  ))}
                </div>
              </div>

              {!(selectedClip.masks || []).length && (
                <p className="text-[11px] text-[#71717a]">
                  Nenhuma máscara ativa. Adicione uma máscara retangular, elíptica ou estrela para recortar pixels reais com feather e expansão.
                </p>
              )}

              {(selectedClip.masks || []).map((mask: LayerMask, mIdx: number) => {
                const masks = selectedClip.masks || [];
                const updateMask = (patch: Partial<LayerMask>, commit = false) => {
                  onUpdateClipLive(selectedClip.id, {
                    masks: masks.map((item) => (item.id === mask.id ? { ...item, ...patch } : item)),
                  });
                  if (commit) onCommitHistory();
                };

                return (
                  <div
                    key={mask.id}
                    className="p-2 rounded bg-[#09090b] border border-[#27272a] space-y-2"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-[#fbbf24]">{mask.name}</span>
                      <div className="flex items-center gap-1">
                        <select
                          aria-label={`Modo da ${mask.name}`}
                          value={mask.mode}
                          onChange={(e) =>
                            updateMask({ mode: e.target.value as LayerMask['mode'] }, true)
                          }
                          className="bg-[#18181c] border border-[#27272a] rounded px-1.5 py-0.5 text-[10px] text-[#f4f4f5]"
                        >
                          <option value="add">Adicionar</option>
                          <option value="subtract">Subtrair</option>
                          <option value="intersect">Interseção</option>
                        </select>

                        <button
                          onClick={() => updateMask({ inverted: !mask.inverted }, true)}
                          className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${
                            mask.inverted
                              ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                              : 'bg-[#18181c] border-[#27272a] text-[#a1a1aa]'
                          }`}
                        >
                          Inverter
                        </button>

                        <button
                          onClick={() => {
                            onUpdateClipLive(selectedClip.id, {
                              masks: masks.filter((item) => item.id !== mask.id),
                            });
                            onCommitHistory();
                          }}
                          aria-label={`Excluir ${mask.name}`}
                          className="p-1 text-[#71717a] hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>

                    <SliderRow
                      label="Largura Máscara"
                      value={mask.width}
                      min={5}
                      max={150}
                      unit="%"
                      onChange={(val) => updateMask({ width: val })}
                      onCommit={onCommitHistory}
                    />
                    <SliderRow
                      label="Altura Máscara"
                      value={mask.height}
                      min={5}
                      max={150}
                      unit="%"
                      onChange={(val) => updateMask({ height: val })}
                      onCommit={onCommitHistory}
                    />
                    <SliderRow
                      label="Posição X Máscara"
                      value={mask.x}
                      min={-60}
                      max={60}
                      unit="%"
                      onChange={(val) => updateMask({ x: val })}
                      onCommit={onCommitHistory}
                    />
                    <SliderRow
                      label="Posição Y Máscara"
                      value={mask.y}
                      min={-60}
                      max={60}
                      unit="%"
                      onChange={(val) => updateMask({ y: val })}
                      onCommit={onCommitHistory}
                    />
                    <SliderRow
                      label="Feather (Suavidade)"
                      value={mIdx === 0 ? keyframeHelper('maskFeather').valNow : mask.feather}
                      min={0}
                      max={90}
                      unit="px"
                      hasKeyframes={mIdx === 0 ? keyframeHelper('maskFeather').hasKf : false}
                      onAddKeyframe={mIdx === 0 ? keyframeHelper('maskFeather').toggleKf : undefined}
                      onChange={(val) => updateMask({ feather: val })}
                      onCommit={onCommitHistory}
                    />
                    <SliderRow
                      label="Expansão"
                      value={mIdx === 0 ? keyframeHelper('maskExpansion').valNow : mask.expansion}
                      min={-60}
                      max={60}
                      unit="px"
                      hasKeyframes={mIdx === 0 ? keyframeHelper('maskExpansion').hasKf : false}
                      onAddKeyframe={mIdx === 0 ? keyframeHelper('maskExpansion').toggleKf : undefined}
                      onChange={(val) => updateMask({ expansion: val })}
                      onCommit={onCommitHistory}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 4: COLOR GRADING */}
        {!isAudio && activeTab === 'color' && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#a1a1aa]">
                Preset: <strong className="text-[#f4f4f5]">{selectedClip.filters.presetName}</strong>
              </span>
              <button
                onClick={() => {
                  onUpdateClipLive(selectedClip.id, { filters: { ...DEFAULT_FILTERS } });
                  onCommitHistory();
                }}
                className="text-[11px] text-[#3b82f6] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" /> Resetar
              </button>
            </div>

            <SliderRow
              label="Brilho"
              value={selectedClip.filters.brightness}
              min={30}
              max={180}
              unit="%"
              onChange={(val) =>
                onUpdateClipLive(selectedClip.id, {
                  filters: { ...selectedClip.filters, brightness: val, presetName: 'Custom' },
                })
              }
              onCommit={onCommitHistory}
            />
            <SliderRow
              label="Contraste"
              value={selectedClip.filters.contrast}
              min={40}
              max={200}
              unit="%"
              onChange={(val) =>
                onUpdateClipLive(selectedClip.id, {
                  filters: { ...selectedClip.filters, contrast: val, presetName: 'Custom' },
                })
              }
              onCommit={onCommitHistory}
            />
            <SliderRow
              label="Saturação"
              value={selectedClip.filters.saturation}
              min={0}
              max={220}
              unit="%"
              onChange={(val) =>
                onUpdateClipLive(selectedClip.id, {
                  filters: { ...selectedClip.filters, saturation: val, presetName: 'Custom' },
                })
              }
              onCommit={onCommitHistory}
            />
            <SliderRow
              label="Temperatura (Frio / Quente)"
              value={selectedClip.filters.temperature}
              min={-100}
              max={100}
              onChange={(val) =>
                onUpdateClipLive(selectedClip.id, {
                  filters: { ...selectedClip.filters, temperature: val, presetName: 'Custom' },
                })
              }
              onCommit={onCommitHistory}
            />
            <SliderRow
              label="Matiz (Hue)"
              value={selectedClip.filters.hue}
              min={-180}
              max={180}
              unit="°"
              onChange={(val) =>
                onUpdateClipLive(selectedClip.id, {
                  filters: { ...selectedClip.filters, hue: val, presetName: 'Custom' },
                })
              }
              onCommit={onCommitHistory}
            />
            <SliderRow
              label="Desfoque (Blur)"
              value={selectedClip.filters.blur}
              min={0}
              max={16}
              step={0.5}
              unit="px"
              onChange={(val) =>
                onUpdateClipLive(selectedClip.id, {
                  filters: { ...selectedClip.filters, blur: val, presetName: 'Custom' },
                })
              }
              onCommit={onCommitHistory}
            />
            <SliderRow
              label="Vinheta Cinematográfica"
              value={selectedClip.filters.vignette}
              min={0}
              max={100}
              unit="%"
              onChange={(val) =>
                onUpdateClipLive(selectedClip.id, {
                  filters: { ...selectedClip.filters, vignette: val, presetName: 'Custom' },
                })
              }
              onCommit={onCommitHistory}
            />
          </div>
        )}

        {/* TAB 5: TRANSITIONS & CLIP AUDIO */}
        {!isAudio && activeTab === 'fx' && (
          <div className="space-y-3.5">
            <div>
              <label className="text-[11px] text-[#a1a1aa] block mb-1">
                Transição de Entrada
              </label>
              <select
                value={selectedClip.transitionIn}
                onChange={(e) => {
                  onUpdateClipLive(selectedClip.id, {
                    transitionIn: e.target.value as TransitionType,
                    transitionInDuration:
                      e.target.value === 'none'
                        ? 0
                        : Math.max(0.4, selectedClip.transitionInDuration),
                  });
                  onCommitHistory();
                }}
                className="w-full bg-[#18181c] border border-[#27272a] rounded-md px-2.5 py-1.5 text-xs text-[#f4f4f5] outline-none"
              >
                {TRANSITION_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {selectedClip.transitionIn !== 'none' && (
              <SliderRow
                label="Duração da Entrada"
                value={selectedClip.transitionInDuration}
                min={0.1}
                max={2.5}
                step={0.1}
                unit="s"
                onChange={(val) =>
                  onUpdateClipLive(selectedClip.id, { transitionInDuration: val })
                }
                onCommit={onCommitHistory}
              />
            )}

            <div>
              <label className="text-[11px] text-[#a1a1aa] block mb-1">
                Transição de Saída
              </label>
              <select
                value={selectedClip.transitionOut}
                onChange={(e) => {
                  onUpdateClipLive(selectedClip.id, {
                    transitionOut: e.target.value as TransitionType,
                    transitionOutDuration:
                      e.target.value === 'none'
                        ? 0
                        : Math.max(0.4, selectedClip.transitionOutDuration),
                  });
                  onCommitHistory();
                }}
                className="w-full bg-[#18181c] border border-[#27272a] rounded-md px-2.5 py-1.5 text-xs text-[#f4f4f5] outline-none"
              >
                {TRANSITION_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {selectedClip.transitionOut !== 'none' && (
              <SliderRow
                label="Duração da Saída"
                value={selectedClip.transitionOutDuration}
                min={0.1}
                max={2.5}
                step={0.1}
                unit="s"
                onChange={(val) =>
                  onUpdateClipLive(selectedClip.id, { transitionOutDuration: val })
                }
                onCommit={onCommitHistory}
              />
            )}

            {selectedClip.type === 'video' && (
              <>
                <div className="h-px bg-[#27272a]" />
                {(() => {
                  const volKf = keyframeHelper('volume');
                  return (
                    <SliderRow
                      propKey="volume"
                      label="Volume do Vídeo"
                      value={volKf.valNow}
                      min={0}
                      max={200}
                      unit="%"
                      hasKeyframes={volKf.hasKf}
                      onAddKeyframe={volKf.toggleKf}
                      onChange={(val) => volKf.changeVal(val, { volume: val })}
                      onCommit={onCommitHistory}
                    />
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* TAB 6: SAPPHIRE / PIXEL EFFECT STACK */}
        {!isAudio && activeTab === 'effects' && (
          <EffectControls
            clip={selectedClip}
            locked={trackLocked}
            currentTime={currentTime}
            fps={fps}
            onOpenBrowser={onOpenEffectsBrowser}
            onChangeEffects={(effects, commit) => onChangeEffects(selectedClip.id, effects, commit)}
          />
        )}
      </div>
    </aside>
  );
};
