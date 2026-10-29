import { useMemo, useState } from 'react';
import {
  ChevronDown,
  Copy,
  Download,
  Film,
  Plus,
  Save,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import type {
  ColorAdjustments,
  SavedMotionPreset,
  TransitionType,
} from '../types/editor';
import { BUILTIN_MOTION_PRESETS } from '../core/motionPresets';
import { COLOR_PRESETS, TRANSITION_OPTIONS, uid } from '../utils/mediaHelpers';
import { EFFECT_CATEGORIES, EFFECT_DEFINITIONS, EFFECT_PRESETS } from '../utils/sapphireEffects';
import type { EffectPreset } from '../utils/sapphireEffects';

interface EffectsBrowserProps {
  targetName: string | null;
  customPresets: SavedMotionPreset[];
  onChangeCustomPresets: (presets: SavedMotionPreset[]) => void;
  onSaveLayerAsPreset: (name: string) => void;
  onApplyMotionPreset: (preset: SavedMotionPreset) => void;
  onApplyEffect: (type: string) => void;
  onApplyPreset: (preset: EffectPreset) => void;
  onApplyColorPreset: (filters: ColorAdjustments) => void;
  onApplyTransitionPreset: (type: TransitionType) => void;
}

type BrowserTab = 'sapphire' | 'presets' | 'color' | 'transitions';

export function EffectsBrowser({
  targetName,
  customPresets,
  onChangeCustomPresets,
  onSaveLayerAsPreset,
  onApplyMotionPreset,
  onApplyEffect,
  onApplyPreset,
  onApplyColorPreset,
  onApplyTransitionPreset,
}: EffectsBrowserProps) {
  const [tab, setTab] = useState<BrowserTab>('sapphire');
  const [query, setQuery] = useState('');
  const [presetQuery, setPresetQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() =>
    BUILTIN_MOTION_PRESETS.filter((p) => p.favorite).map((p) => p.id)
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return EFFECT_DEFINITIONS.filter(
      (effect) =>
        !term ||
        effect.label.toLowerCase().includes(term) ||
        effect.description.toLowerCase().includes(term) ||
        effect.category.toLowerCase().includes(term)
    );
  }, [query]);

  const allMotionPresets = useMemo(
    () => [...customPresets, ...BUILTIN_MOTION_PRESETS],
    [customPresets]
  );

  const presetCategories = useMemo(
    () => ['Todos', ...Array.from(new Set(allMotionPresets.map((p) => p.category)))],
    [allMotionPresets]
  );

  const filteredMotionPresets = useMemo(() => {
    const q = presetQuery.trim().toLowerCase();
    return allMotionPresets.filter((p) => {
      if (onlyFavorites && !favoriteIds.includes(p.id) && !p.favorite) return false;
      if (selectedCategory !== 'Todos' && p.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [allMotionPresets, presetQuery, selectedCategory, onlyFavorites, favoriteIds]);

  const toggleFavorite = (id: string) => {
    setFavoriteIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="effects-browser">
      <div className="browser-tabs" role="tablist">
        {([
          ['sapphire', 'Sapphire'],
          ['presets', 'Presets'],
          ['color', 'Cores'],
          ['transitions', 'Transições'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="browser-target" title={targetName || undefined}>
        {targetName ? (
          <>
            Aplicar em <strong>{targetName}</strong>
          </>
        ) : (
          'Selecione uma camada na linha do tempo'
        )}
      </p>

      {tab === 'sapphire' && (
        <>
          <div className="browser-search">
            <Search size={12} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar efeito (glow, glitch, filme...)"
              aria-label="Buscar efeito Sapphire"
            />
          </div>

          <div className="browser-scroll">
            <div className="preset-strip">
              <span className="browser-section-title">
                <Wand2 size={11} />
                Looks prontos
              </span>
              {EFFECT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className="preset-chip"
                  onClick={() => onApplyPreset(preset)}
                  title={preset.description}
                >
                  <Sparkles size={11} />
                  {preset.label}
                </button>
              ))}
            </div>

            {EFFECT_CATEGORIES.map((category) => {
              const items = filtered.filter((effect) => effect.category === category);
              if (!items.length) return null;
              const isCollapsed = collapsed.includes(category);
              return (
                <section key={category} className="effect-category">
                  <button
                    className="category-header"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((prev) =>
                        prev.includes(category)
                          ? prev.filter((c) => c !== category)
                          : [...prev, category]
                      )
                    }
                  >
                    <ChevronDown size={12} className={isCollapsed ? 'rotate-[-90deg]' : ''} />
                    <span>{category}</span>
                    <small>{items.length}</small>
                  </button>
                  {!isCollapsed && (
                    <div className="effect-list">
                      {items.map((effect) => (
                        <button
                          key={effect.type}
                          className="effect-item"
                          onClick={() => onApplyEffect(effect.type)}
                          title={effect.description}
                        >
                          <span className={`effect-swatch bg-gradient-to-br ${effect.gradient}`} />
                          <span className="effect-text">
                            <strong>{effect.label}</strong>
                            <small>{effect.description}</small>
                          </span>
                          <Plus size={12} />
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
            {!filtered.length && (
              <p className="browser-empty">Nenhum efeito encontrado para "{query}".</p>
            )}
          </div>
        </>
      )}

      {tab === 'presets' && (
        <div className="flex flex-col flex-1 min-h-0 gap-2 p-2.5 overflow-hidden">
          <div className="browser-search">
            <Search size={12} />
            <input
              value={presetQuery}
              onChange={(e) => setPresetQuery(e.target.value)}
              placeholder="Buscar preset de animação..."
              aria-label="Buscar preset de animação"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <select
              aria-label="Categoria de preset"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="flex-1 bg-[#18181c] border border-[#27272a] rounded px-2 py-1 text-[11px] text-[#f4f4f5]"
            >
              {presetCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <button
              aria-pressed={onlyFavorites}
              onClick={() => setOnlyFavorites((v) => !v)}
              title="Filtrar favoritos"
              className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 cursor-pointer ${
                onlyFavorites
                  ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                  : 'bg-[#18181c] border-[#27272a] text-[#a1a1aa]'
              }`}
            >
              <Star size={11} className={onlyFavorites ? 'fill-amber-300' : ''} />
            </button>
          </div>

          {/* Save current layer as Custom Preset + Export / Import JSON */}
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            <button
              onClick={() => onSaveLayerAsPreset(`Preset Custom ${customPresets.length + 1}`)}
              disabled={!targetName}
              className="py-1 px-1.5 rounded bg-[#2563eb]/20 hover:bg-[#2563eb]/35 border border-[#3b82f6]/50 text-[#93c5fd] font-medium flex items-center justify-center gap-1 disabled:opacity-35 cursor-pointer"
            >
              <Save size={10} /> Salvar
            </button>

            <button
              onClick={() => {
                const blob = new Blob([JSON.stringify(customPresets, null, 2)], {
                  type: 'application/json',
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'cinecorte-presets.json';
                a.click();
              }}
              className="py-1 px-1.5 rounded bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-white flex items-center justify-center gap-1 cursor-pointer"
            >
              <Download size={10} /> Exportar
            </button>

            <label className="py-1 px-1.5 rounded bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-white flex items-center justify-center gap-1 cursor-pointer">
              <Upload size={10} /> Importar
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const parsed = JSON.parse(await file.text());
                    if (Array.isArray(parsed)) {
                      onChangeCustomPresets([...parsed, ...customPresets]);
                    }
                  } catch {
                    // ignore invalid file
                  }
                }}
              />
            </label>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
            {filteredMotionPresets.map((preset) => {
              const isCustom = customPresets.some((cp) => cp.id === preset.id);
              const isFav = favoriteIds.includes(preset.id);
              return (
                <div
                  key={preset.id}
                  className="p-2 rounded-lg bg-[#18181c] border border-[#27272a] hover:border-[#3f3f46] flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <button
                      onClick={() => onApplyMotionPreset(preset)}
                      className="flex items-center gap-2 text-left min-w-0 flex-1 cursor-pointer"
                    >
                      <span
                        className={`w-6 h-6 rounded shrink-0 bg-gradient-to-br ${preset.gradient}`}
                      />
                      <span className="min-w-0">
                        <strong className="text-xs text-[#f4f4f5] block truncate">
                          {preset.name}
                        </strong>
                        <small className="text-[10px] text-[#71717a] block truncate">
                          {preset.category} • v{preset.version}
                        </small>
                      </span>
                    </button>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => toggleFavorite(preset.id)}
                        title="Favoritar preset"
                        className="p-1 text-[#71717a] hover:text-amber-300 cursor-pointer"
                      >
                        <Star
                          size={11}
                          className={isFav ? 'text-amber-400 fill-amber-400' : ''}
                        />
                      </button>

                      <button
                        onClick={() =>
                          onChangeCustomPresets([
                            {
                              ...preset,
                              id: uid('preset'),
                              name: `${preset.name} (Cópia)`,
                            },
                            ...customPresets,
                          ])
                        }
                        title="Duplicar para meus presets"
                        className="p-1 text-[#71717a] hover:text-white cursor-pointer"
                      >
                        <Copy size={11} />
                      </button>

                      {isCustom &&
                        (confirmDeleteId === preset.id ? (
                          <button
                            onClick={() => {
                              onChangeCustomPresets(
                                customPresets.filter((item) => item.id !== preset.id)
                              );
                              setConfirmDeleteId(null);
                            }}
                            className="px-1.5 py-0.5 rounded bg-red-600 text-[9px] text-white font-semibold cursor-pointer"
                          >
                            Confirmar
                          </button>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(preset.id)}
                            title="Excluir preset personalizado"
                            className="p-1 text-[#71717a] hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 size={11} />
                          </button>
                        ))}
                    </div>
                  </div>
                  <p className="text-[10px] text-[#a1a1aa] leading-snug">
                    {preset.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'color' && (
        <div className="browser-scroll">
          <span className="browser-section-title">
            <Film size={11} />
            LUTs de cinema
          </span>
          <div className="lut-grid">
            {COLOR_PRESETS.map((lut) => (
              <button
                key={lut.id}
                onClick={() => onApplyColorPreset(lut.filters)}
                className="lut-card"
              >
                <span className={`lut-preview bg-gradient-to-r ${lut.gradient}`}>
                  <i>{lut.badge}</i>
                </span>
                <small>{lut.name}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'transitions' && (
        <div className="browser-scroll">
          <span className="browser-section-title">
            <Sparkles size={11} />
            Entrada e saída
          </span>
          <div className="transition-list">
            {TRANSITION_OPTIONS.map((transition) => (
              <button
                key={transition.id}
                onClick={() => onApplyTransitionPreset(transition.id)}
                className="transition-item"
              >
                <span>
                  <strong>{transition.label}</strong>
                  <small>{transition.desc}</small>
                </span>
                <Plus size={12} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
