import React, { useRef, useState } from 'react';
import {
  Activity,
  Box,
  Camera,
  Circle,
  Crosshair,
  Film,
  Hexagon,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  Minus,
  Monitor,
  Music,
  Pause,
  PenTool,
  Play,
  Plus,
  Sparkles,
  Square,
  Star,
  Type,
  Upload,
  Video,
  Wand2,
} from 'lucide-react';
import {
  ColorAdjustments,
  LeftSidebarTab,
  MediaAsset,
  SavedMotionPreset,
  TransitionType,
  VectorShapeKind,
} from '../types/editor';
import { formatTimecode, TEXT_PRESETS, TextPresetItem } from '../utils/mediaHelpers';
import { EffectsBrowser } from './EffectsBrowser';
import type { EffectPreset } from '../utils/sapphireEffects';

interface MediaSidebarProps {
  activeTab: LeftSidebarTab;
  onChangeTab: (tab: LeftSidebarTab) => void;
  assets: MediaAsset[];
  customPresets: SavedMotionPreset[];
  onChangeCustomPresets: (presets: SavedMotionPreset[]) => void;
  onSaveLayerAsPreset: (name: string) => void;
  onApplyMotionPreset: (preset: SavedMotionPreset) => void;
  onUploadFiles: (files: FileList | File[]) => void;
  onAddAssetToTimeline: (asset: MediaAsset) => void;
  onAddShapeLayer: (kind: VectorShapeKind) => void;
  onAddSpecialLayer: (kind: 'solid' | 'adjustment' | 'null') => void;
  onPrecomposeSelected: () => void;
  onDetectAudioBeats: (asset: MediaAsset) => void;
  onAddTextPreset: (preset: TextPresetItem) => void;
  onApplyColorPreset: (filters: ColorAdjustments) => void;
  onApplyTransitionPreset: (type: TransitionType) => void;
  onApplyEffect: (type: string) => void;
  onApplyPreset: (preset: EffectPreset) => void;
  targetName: string | null;
  isRecordingSource: 'camera' | 'screen' | null;
  recordingSeconds: number;
  onStartRecording: (source: 'camera' | 'screen') => void;
  onStopRecording: () => void;
  isMobileDrawer?: boolean;
}

export const MediaSidebar: React.FC<MediaSidebarProps> = ({
  activeTab,
  onChangeTab,
  assets,
  customPresets,
  onChangeCustomPresets,
  onSaveLayerAsPreset,
  onApplyMotionPreset,
  onUploadFiles,
  onAddAssetToTimeline,
  onAddShapeLayer,
  onAddSpecialLayer,
  onPrecomposeSelected,
  onDetectAudioBeats,
  onAddTextPreset,
  onApplyColorPreset,
  onApplyTransitionPreset,
  onApplyEffect,
  onApplyPreset,
  targetName,
  isRecordingSource,
  recordingSeconds,
  onStartRecording,
  onStopRecording,
  isMobileDrawer = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [auditionId, setAuditionId] = useState<string | null>(null);
  const auditionAudioRef = useRef<HTMLAudioElement | null>(null);

  const visualAssets = assets.filter(
    (a) => a.type === 'video' || a.type === 'image' || a.type === 'svg' || a.type === 'lottie'
  );
  const model3dAssets = assets.filter((a) => a.type === 'model3d');
  const audioAssets = assets.filter((a) => a.type === 'audio');

  const toggleAudition = (asset: MediaAsset) => {
    if (auditionId === asset.id) {
      auditionAudioRef.current?.pause();
      setAuditionId(null);
      return;
    }
    if (auditionAudioRef.current) {
      auditionAudioRef.current.pause();
    }
    const audio = new Audio(asset.url);
    audio.volume = 0.8;
    audio.onended = () => setAuditionId(null);
    audio.play().catch(() => {});
    auditionAudioRef.current = audio;
    setAuditionId(asset.id);
  };

  const navItems: { id: LeftSidebarTab; label: string; icon: React.ReactNode }[] = [
    { id: 'media', label: 'Mídia', icon: <Film className="w-4 h-4" /> },
    { id: 'shapes', label: 'Formas', icon: <Hexagon className="w-4 h-4" /> },
    { id: 'text', label: 'Texto', icon: <Type className="w-4 h-4" /> },
    { id: 'effects', label: 'Efeitos', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'audio', label: 'Áudio', icon: <Music className="w-4 h-4" /> },
  ];

  const shapeTools: { kind: VectorShapeKind; label: string; desc: string; icon: React.ReactNode }[] = [
    { kind: 'rect', label: 'Retângulo', desc: 'Cantos arredondáveis & gradiente', icon: <Square className="w-4 h-4 text-[#60a5fa]" /> },
    { kind: 'ellipse', label: 'Elipse / Círculo', desc: 'Anéis, HUDs e formas radiais', icon: <Circle className="w-4 h-4 text-[#a78bfa]" /> },
    { kind: 'polygon', label: 'Polígono', desc: 'Lados configuráveis (3..12)', icon: <Hexagon className="w-4 h-4 text-[#34d399]" /> },
    { kind: 'star', label: 'Estrela', desc: 'Pontas e raio interno editáveis', icon: <Star className="w-4 h-4 text-[#fbbf24]" /> },
    { kind: 'line', label: 'Linha / Traço', desc: 'Ideal para Trim Paths e divisores', icon: <Minus className="w-4 h-4 text-[#38bdf8]" /> },
    { kind: 'path', label: 'Curva Bézier', desc: 'Vértices e tangentes editáveis', icon: <PenTool className="w-4 h-4 text-[#f472b6]" /> },
  ];

  return (
    <aside
      className={
        isMobileDrawer
          ? 'w-full h-full flex flex-col select-none overflow-hidden bg-transparent border-0'
          : 'w-[300px] shrink-0 bg-[#121215] border-r border-[#27272a] flex h-full select-none'
      }
    >
      {/* Icon Rail or Mobile Horizontal Tabs */}
      {isMobileDrawer ? (
        <nav className="w-full shrink-0 bg-[#0d0d10] border-b border-[#27272a] px-2 py-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onChangeTab(item.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                  active
                    ? 'bg-[#1c1c21] text-[#f4f4f5] border border-[#27272a]'
                    : 'text-[#71717a] hover:text-[#a1a1aa]'
                }`}
              >
                <span className={active ? 'text-[#3b82f6]' : ''}>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      ) : (
        <nav className="w-14 shrink-0 bg-[#0d0d10] border-r border-[#27272a] py-2.5 flex flex-col items-center gap-1.5">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onChangeTab(item.id)}
                className={`w-11 py-2 rounded-lg flex flex-col items-center gap-1 text-[10px] font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#1c1c21] text-[#f4f4f5] border border-[#27272a]'
                    : 'text-[#71717a] hover:text-[#a1a1aa]'
                }`}
              >
                <span className={active ? 'text-[#3b82f6]' : ''}>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Active Drawer Content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full overflow-hidden">
        {activeTab === 'media' && (
          <div className="flex flex-col h-full p-3 gap-3 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#a1a1aa]">
                Projeto
              </h2>
              <span className="font-mono-code text-[11px] text-[#71717a]">
                {visualAssets.length} itens
              </span>
            </div>

            {/* Upload Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files?.length) {
                  onUploadFiles(e.dataTransfer.files);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-lg border border-dashed p-3 text-center transition-colors cursor-pointer ${
                isDragOver
                  ? 'border-[#3b82f6] bg-[#2563eb]/10'
                  : 'border-[#27272a] hover:border-[#3f3f46] bg-[#18181c]'
              }`}
            >
              <Upload className="w-4 h-4 mx-auto mb-1 text-[#3b82f6]" />
              <p className="text-xs font-medium text-[#f4f4f5]">
                Importar Vídeo, Foto, Áudio, 3D ou Lottie
              </p>
              <p className="text-[10px] text-[#71717a] mt-0.5">
                Arraste arquivos ou clique (MP4, WebM, PNG, SVG, MP3, GLB, GLTF, JSON)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="video/*,image/*,audio/*,.glb,.gltf,.json,.svg"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    onUploadFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
              />
            </div>

            {/* Live Webcam / Screen Capture Row */}
            {isRecordingSource ? (
              <button
                onClick={onStopRecording}
                className="w-full py-2 px-3 rounded-lg bg-[#ef4444]/15 border border-[#ef4444] text-[#fca5a5] text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current text-[#ef4444]" />
                <span>
                  Parar Gravação ({formatTimecode(recordingSeconds, false)})
                </span>
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => onStartRecording('camera')}
                  className="py-1.5 px-2 rounded-lg bg-[#1c1c21] hover:bg-[#27272a] border border-[#27272a] text-[11px] font-medium text-[#f4f4f5] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5 text-[#ef4444]" />
                  <span>Câmera</span>
                </button>
                <button
                  onClick={() => onStartRecording('screen')}
                  className="py-1.5 px-2 rounded-lg bg-[#1c1c21] hover:bg-[#27272a] border border-[#27272a] text-[11px] font-medium text-[#f4f4f5] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Monitor className="w-3.5 h-3.5 text-[#38bdf8]" />
                  <span>Tela</span>
                </button>
              </div>
            )}

            {/* 3D Models Section */}
            {model3dAssets.length > 0 && (
              <div>
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300 mb-1.5">
                  Modelos 3D ({model3dAssets.length})
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {model3dAssets.map((asset) => (
                    <div
                      key={asset.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-asset-id', asset.id);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onDoubleClick={() => onAddAssetToTimeline(asset)}
                      className="group relative rounded-lg overflow-hidden bg-[#1e1b4b] border border-indigo-500/40 hover:border-indigo-400 transition-all cursor-grab active:cursor-grabbing"
                    >
                      <div className="aspect-video relative overflow-hidden">
                        {asset.thumbnail ? (
                          <img src={asset.thumbnail} alt={asset.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-indigo-300">
                            <Box className="w-6 h-6" />
                          </div>
                        )}
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-indigo-600 font-mono-code text-[9px] text-white font-bold">
                          3D
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddAssetToTimeline(asset);
                          }}
                          title="Adicionar modelo 3D à timeline"
                          className="opacity-0 group-hover:opacity-100 absolute top-1 right-1 w-6 h-6 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-md transition-opacity cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="p-1.5">
                        <p className="text-[11px] font-medium text-[#f4f4f5] truncate">{asset.name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2-Column Visual Media Grid */}
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              {visualAssets.map((asset) => (
                <div
                  key={asset.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-asset-id', asset.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onDoubleClick={() => onAddAssetToTimeline(asset)}
                  className="group relative rounded-lg overflow-hidden bg-[#18181c] border border-[#27272a] hover:border-[#3f3f46] transition-all cursor-grab active:cursor-grabbing"
                >
                  <div className="aspect-video bg-[#09090b] relative overflow-hidden">
                    {asset.thumbnail ? (
                      <img
                        src={asset.thumbnail}
                        alt={asset.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#71717a]">
                        {asset.type === 'video' ? (
                          <Film className="w-5 h-5" />
                        ) : (
                          <ImageIcon className="w-5 h-5" />
                        )}
                      </div>
                    )}

                    <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/75 font-mono-code text-[9px] text-[#f4f4f5]">
                      {formatTimecode(asset.duration, false)}
                    </span>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddAssetToTimeline(asset);
                      }}
                      title="Adicionar à linha do tempo"
                      className="opacity-0 group-hover:opacity-100 absolute top-1 right-1 w-6 h-6 rounded-md bg-[#2563eb] hover:bg-[#3b82f6] text-white flex items-center justify-center shadow-md transition-opacity cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="p-1.5">
                    <p className="text-[11px] font-medium text-[#f4f4f5] truncate">
                      {asset.name}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'shapes' && (
          <div className="flex flex-col h-full p-3 gap-3 overflow-y-auto">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#a1a1aa] mb-1">
                Formas Vetoriais & Bézier
              </h2>
              <p className="text-[11px] text-[#71717a] mb-2.5">
                Suportam Preenchimento Gradiente, Contorno, Trim Paths e Repeater no Inspetor.
              </p>

              <div className="grid grid-cols-2 gap-2">
                {shapeTools.map((tool) => (
                  <button
                    key={tool.kind}
                    onClick={() => onAddShapeLayer(tool.kind)}
                    className="p-2.5 rounded-lg bg-[#18181c] hover:bg-[#1c1c21] border border-[#27272a] hover:border-[#3b82f6] text-left flex flex-col gap-1.5 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      {tool.icon}
                      <Plus className="w-3 h-3 text-[#71717a]" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-[#f4f4f5]">{tool.label}</p>
                      <p className="text-[10px] text-[#71717a] leading-tight mt-0.5">{tool.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="h-px bg-[#27272a]" />

            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#a1a1aa] mb-2">
                Camadas de Composição & Controle
              </h2>
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={() => onAddSpecialLayer('solid')}
                  className="w-full px-3 py-2 rounded-lg bg-[#18181c] hover:bg-[#1c1c21] border border-[#27272a] hover:border-[#3b82f6] flex items-center justify-between text-left cursor-pointer"
                >
                  <div>
                    <p className="text-xs font-medium text-[#f4f4f5]">Camada Sólida (Solid)</p>
                    <p className="text-[10px] text-[#71717a]">Fundo colorido para vinhetas, máscaras e mattes</p>
                  </div>
                  <Square className="w-4 h-4 text-[#3b82f6] fill-[#3b82f6]/30" />
                </button>

                <button
                  onClick={() => onAddSpecialLayer('adjustment')}
                  className="w-full px-3 py-2 rounded-lg bg-[#18181c] hover:bg-[#1c1c21] border border-[#27272a] hover:border-[#f472b6] flex items-center justify-between text-left cursor-pointer"
                >
                  <div>
                    <p className="text-xs font-medium text-[#f4f4f5]">Camada de Ajuste (Adjustment)</p>
                    <p className="text-[10px] text-[#71717a]">Aplica efeitos e LUTs em todas as camadas abaixo</p>
                  </div>
                  <Wand2 className="w-4 h-4 text-[#f472b6]" />
                </button>

                <button
                  onClick={() => onAddSpecialLayer('null')}
                  className="w-full px-3 py-2 rounded-lg bg-[#18181c] hover:bg-[#1c1c21] border border-[#27272a] hover:border-[#fbbf24] flex items-center justify-between text-left cursor-pointer"
                >
                  <div>
                    <p className="text-xs font-medium text-[#f4f4f5]">Objeto Nulo (Null Controller)</p>
                    <p className="text-[10px] text-[#71717a]">Controlador invisível para hierarquia Pai/Filho</p>
                  </div>
                  <Crosshair className="w-4 h-4 text-[#fbbf24]" />
                </button>

                <button
                  onClick={onPrecomposeSelected}
                  className="w-full px-3 py-2 rounded-lg bg-[#18181c] hover:bg-[#1c1c21] border border-[#27272a] hover:border-[#34d399] flex items-center justify-between text-left cursor-pointer"
                >
                  <div>
                    <p className="text-xs font-medium text-[#f4f4f5]">Pré-compor Camada (Pre-compose)</p>
                    <p className="text-[10px] text-[#71717a]">Agrupa em sub-composição aninhada (Ctrl+Shift+C)</p>
                  </div>
                  <Layers className="w-4 h-4 text-[#34d399]" />
                </button>
              </div>
            </div>

            <div className="h-px bg-[#27272a]" />

            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-300 mb-2">
                Camadas 3D Profissionais
              </h2>
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={() => onAddSpecialLayer('model3d' as any)}
                  className="w-full px-3 py-2 rounded-lg bg-[#1e1b4b] hover:bg-[#25215e] border border-indigo-500/40 hover:border-indigo-400 flex items-center justify-between text-left cursor-pointer"
                >
                  <div>
                    <p className="text-xs font-medium text-[#f4f4f5]">Modelo 3D (Cubo)</p>
                    <p className="text-[10px] text-indigo-300">Geometria procedural com sombras reais</p>
                  </div>
                  <Box className="w-4 h-4 text-indigo-400" />
                </button>

                <button
                  onClick={() => onAddSpecialLayer('camera' as any)}
                  className="w-full px-3 py-2 rounded-lg bg-[#18181c] hover:bg-[#1c1c21] border border-[#27272a] hover:border-sky-400 flex items-center justify-between text-left cursor-pointer"
                >
                  <div>
                    <p className="text-xs font-medium text-[#f4f4f5]">Câmera 3D Profissional</p>
                    <p className="text-[10px] text-[#71717a]">FOV, foco, profundidade de campo e órbita</p>
                  </div>
                  <Video className="w-4 h-4 text-sky-400" />
                </button>

                <button
                  onClick={() => onAddSpecialLayer('light' as any)}
                  className="w-full px-3 py-2 rounded-lg bg-[#18181c] hover:bg-[#1c1c21] border border-[#27272a] hover:border-amber-400 flex items-center justify-between text-left cursor-pointer"
                >
                  <div>
                    <p className="text-xs font-medium text-[#f4f4f5]">Luz 3D (Direcional/Ponto)</p>
                    <p className="text-[10px] text-[#71717a]">Iluminação com sombras reais na cena 3D</p>
                  </div>
                  <Lightbulb className="w-4 h-4 text-amber-400" />
                </button>

                <p className="text-[10px] text-[#71717a] leading-relaxed px-1">
                  Importe arquivos <span className="text-indigo-300 font-mono">.GLB</span> ou{' '}
                  <span className="text-indigo-300 font-mono">.GLTF</span> na aba Mídia para usar modelos reais.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'text' && (
          <div className="flex flex-col h-full p-3 gap-2.5 overflow-y-auto">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#a1a1aa]">
              Text Lab & Tipografia Cinética
            </h2>
            <p className="text-[11px] text-[#71717a]">
              Insira títulos, legendas e lower thirds com animadores por caractere, palavra, linha e arco curvo.
            </p>

            <div className="flex flex-col gap-2 pt-1">
              {TEXT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => onAddTextPreset(preset)}
                  className="group w-full text-left p-3 rounded-lg bg-[#18181c] hover:bg-[#1c1c21] border border-[#27272a] hover:border-[#3b82f6] transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-[#f4f4f5]">
                      {preset.label}
                    </span>
                    <span className="w-5 h-5 rounded bg-[#27272a] group-hover:bg-[#2563eb] text-white flex items-center justify-center transition-colors">
                      <Plus className="w-3 h-3" />
                    </span>
                  </div>
                  <div className="py-2.5 px-2 rounded bg-[#09090b] border border-[#27272a]/70 text-center overflow-hidden">
                    <span
                      style={{
                        color: preset.style.color,
                        fontFamily: preset.style.fontFamily,
                        fontWeight: preset.style.fontWeight,
                        WebkitTextStroke:
                          preset.style.strokeWidth > 0
                            ? `1px ${preset.style.strokeColor}`
                            : undefined,
                      }}
                      className="text-xs tracking-wide truncate block"
                    >
                      {preset.previewText}
                    </span>
                  </div>
                  <p className="text-[10px] text-[#71717a] mt-1.5">{preset.subtitle}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'effects' && (
          <EffectsBrowser
            targetName={targetName}
            customPresets={customPresets}
            onChangeCustomPresets={onChangeCustomPresets}
            onSaveLayerAsPreset={onSaveLayerAsPreset}
            onApplyMotionPreset={onApplyMotionPreset}
            onApplyEffect={onApplyEffect}
            onApplyPreset={onApplyPreset}
            onApplyColorPreset={onApplyColorPreset}
            onApplyTransitionPreset={onApplyTransitionPreset}
          />
        )}

        {activeTab === 'audio' && (
          <div className="flex flex-col h-full p-3 gap-2.5 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#a1a1aa]">
                Áudio & Sincronização de Batidas
              </h2>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-[11px] text-[#3b82f6] hover:underline cursor-pointer"
              >
                + Importar
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) onUploadFiles(e.target.files);
                }}
              />
            </div>

            <div className="flex flex-col gap-2 pt-1">
              {audioAssets.map((asset) => {
                const isAuditioning = auditionId === asset.id;
                return (
                  <div
                    key={asset.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-asset-id', asset.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    className="p-2.5 rounded-lg bg-[#18181c] border border-[#27272a] hover:border-[#3f3f46] flex flex-col gap-2 cursor-grab active:cursor-grabbing"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => toggleAudition(asset)}
                        title={isAuditioning ? 'Pausar prévia' : 'Ouvir prévia'}
                        className="w-7 h-7 shrink-0 rounded-full bg-[#27272a] hover:bg-[#059669] text-[#f4f4f5] flex items-center justify-center transition-colors cursor-pointer"
                      >
                        {isAuditioning ? (
                          <Pause className="w-3 h-3" />
                        ) : (
                          <Play className="w-3 h-3 ml-0.5" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-[#f4f4f5] truncate">
                          {asset.name}
                        </p>
                        <p className="font-mono-code text-[10px] text-[#71717a]">
                          {formatTimecode(asset.duration, false)}
                        </p>
                      </div>
                      <button
                        onClick={() => onDetectAudioBeats(asset)}
                        title="Detectar batidas e criar marcadores rítmicos"
                        className="px-1.5 h-6 shrink-0 rounded-md bg-[#1c1c21] hover:bg-[#27272a] border border-[#27272a] text-[#34d399] text-[10px] font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <Activity className="w-3 h-3" /> Beats
                      </button>
                      <button
                        onClick={() => onAddAssetToTimeline(asset)}
                        title="Inserir na faixa de áudio"
                        className="w-6 h-6 shrink-0 rounded-md bg-[#059669] hover:bg-[#10b981] text-white flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Mini Waveform Preview */}
                    {asset.waveform && (
                      <div className="h-6 flex items-center gap-[2px] px-1 bg-[#09090b] rounded">
                        {asset.waveform.slice(0, 40).map((val, idx) => (
                          <div
                            key={idx}
                            style={{ height: `${Math.max(16, val * 90)}%` }}
                            className={`flex-1 rounded-full ${
                              isAuditioning ? 'bg-[#10b981]' : 'bg-[#059669]/65'
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
