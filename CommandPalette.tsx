import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Command, Search, Settings2, X } from 'lucide-react';
import { ASPECT_RATIOS, AspectRatioKey, ProjectState } from '../types/editor';

export interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  run: () => void;
}

export const CommandPaletteModal: React.FC<{
  commands: PaletteCommand[];
  onClose: () => void;
}> = ({ commands, onClose }) => {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        (c.shortcut && c.shortcut.toLowerCase().includes(q))
    );
  }, [commands, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-start justify-center pt-16 p-4"
      onClick={onClose}
    >
      <div
        data-testid="command-palette"
        className="w-full max-w-lg bg-[#121215] border border-[#3f3f46] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3.5 py-2.5 border-b border-[#27272a] flex items-center gap-2.5">
          <Search className="w-4 h-4 text-[#60a5fa] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && filtered[activeIdx]) {
                e.preventDefault();
                filtered[activeIdx].run();
                onClose();
              }
            }}
            placeholder="Buscar comando, ferramenta, camada ou efeito..."
            aria-label="Buscar comando"
            className="flex-1 bg-transparent text-xs text-[#f4f4f5] outline-none"
          />
          <kbd className="font-mono-code text-[10px] px-1.5 py-0.5 rounded bg-[#1c1c21] text-[#71717a]">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-[#27272a]/50">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#71717a]">
              Nenhum comando encontrado para "{query}"
            </div>
          ) : (
            filtered.map((cmd, idx) => (
              <button
                key={cmd.id}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => {
                  cmd.run();
                  onClose();
                }}
                className={`w-full px-3.5 py-2.5 flex items-center justify-between text-left text-xs transition-colors cursor-pointer ${
                  idx === activeIdx
                    ? 'bg-[#2563eb]/20 text-[#f4f4f5]'
                    : 'text-[#a1a1aa] hover:bg-[#18181c]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Command className="w-3.5 h-3.5 text-[#3b82f6] shrink-0" />
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#1c1c21] text-[#71717a] shrink-0">
                    {cmd.category}
                  </span>
                  <span className="truncate font-medium">{cmd.label}</span>
                </div>
                {cmd.shortcut && (
                  <kbd className="font-mono-code text-[10px] px-2 py-0.5 rounded bg-[#1c1c21] border border-[#27272a] text-[#d4d4d8] shrink-0">
                    {cmd.shortcut}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export const CompositionSettingsModal: React.FC<{
  project: ProjectState;
  onSave: (patch: Partial<ProjectState>, compName?: string) => void;
  onClose: () => void;
}> = ({ project, onSave, onClose }) => {
  const activeComp = project.compositions?.find((c) => c.id === project.activeCompId);
  const [compName, setCompName] = useState(activeComp?.name || 'Composição Principal');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioKey>(project.aspectRatio);
  const [customWidth, setCustomWidth] = useState(project.customWidth || 1920);
  const [customHeight, setCustomHeight] = useState(project.customHeight || 1080);
  const [fps, setFps] = useState<24 | 30 | 60 | 120>(project.fps);
  const [bgColor, setBgColor] = useState(project.backgroundColor || '#000000');
  const [transparentBg, setTransparentBg] = useState(!!project.transparentBg);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        data-testid="comp-settings-modal"
        className="w-full max-w-md bg-[#121215] border border-[#27272a] rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-[#27272a] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-[#3b82f6]" />
            <h3 className="text-sm font-semibold text-[#f4f4f5]">
              Configurações da Composição
            </h3>
          </div>
          <button onClick={onClose} className="p-1 text-[#71717a] hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3.5 text-xs">
          <div>
            <label className="text-[#a1a1aa] block mb-1">Nome da Composição</label>
            <input
              type="text"
              aria-label="Nome da composição"
              value={compName}
              onChange={(e) => setCompName(e.target.value)}
              className="w-full bg-[#18181c] border border-[#27272a] rounded-lg px-3 py-1.5 text-[#f4f4f5] outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[#a1a1aa] block mb-1">Preset de Resolução</label>
              <select
                aria-label="Preset de resolução"
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as AspectRatioKey)}
                className="w-full bg-[#18181c] border border-[#27272a] rounded-lg px-2.5 py-1.5 text-[#f4f4f5]"
              >
                {(Object.keys(ASPECT_RATIOS) as AspectRatioKey[]).map((k) => (
                  <option key={k} value={k}>
                    {ASPECT_RATIOS[k].label} ({ASPECT_RATIOS[k].width}×{ASPECT_RATIOS[k].height})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[#a1a1aa] block mb-1">Taxa de Quadros (FPS)</label>
              <select
                aria-label="FPS da composição"
                value={fps}
                onChange={(e) => setFps(Number(e.target.value) as 24 | 30 | 60 | 120)}
                className="w-full bg-[#18181c] border border-[#27272a] rounded-lg px-2.5 py-1.5 text-[#f4f4f5]"
              >
                <option value={24}>24 FPS (Cinema)</option>
                <option value={30}>30 FPS (Padrão)</option>
                <option value={60}>60 FPS (Fluido)</option>
              </select>
            </div>
          </div>

          {aspectRatio === 'custom' && (
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[#a1a1aa] block mb-1">Largura (px)</label>
                <input
                  type="number"
                  min={120}
                  max={7680}
                  value={customWidth}
                  onChange={(e) => setCustomWidth(Number(e.target.value))}
                  className="w-full bg-[#18181c] border border-[#27272a] rounded-lg px-2.5 py-1.5 text-[#f4f4f5]"
                />
              </div>
              <div>
                <label className="text-[#a1a1aa] block mb-1">Altura (px)</label>
                <input
                  type="number"
                  min={120}
                  max={4320}
                  value={customHeight}
                  onChange={(e) => setCustomHeight(Number(e.target.value))}
                  className="w-full bg-[#18181c] border border-[#27272a] rounded-lg px-2.5 py-1.5 text-[#f4f4f5]"
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#18181c] border border-[#27272a]">
            <div className="flex items-center gap-2.5">
              <input
                type="color"
                aria-label="Cor de fundo da composição"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="w-8 h-7 rounded border border-[#3f3f46] cursor-pointer"
              />
              <span>Cor de Fundo</span>
            </div>

            <button
              type="button"
              aria-pressed={transparentBg}
              onClick={() => setTransparentBg((v) => !v)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium border cursor-pointer ${
                transparentBg
                  ? 'bg-[#2563eb]/20 border-[#3b82f6] text-[#60a5fa]'
                  : 'bg-[#09090b] border-[#27272a] text-[#a1a1aa]'
              }`}
            >
              {transparentBg ? 'Fundo Alfa Transparente: ON' : 'Fundo Alfa Transparente: OFF'}
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-[#1c1c21] text-[#a1a1aa] hover:text-white cursor-pointer"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                onSave(
                  {
                    aspectRatio,
                    customWidth,
                    customHeight,
                    fps,
                    backgroundColor: bgColor,
                    transparentBg,
                  },
                  compName
                );
                onClose();
              }}
              className="px-4 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#3b82f6] text-white font-semibold cursor-pointer"
            >
              Aplicar na Composição
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
