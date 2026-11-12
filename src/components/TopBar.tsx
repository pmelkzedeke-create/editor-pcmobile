import React, { useState } from 'react';
import {
  Activity,
  AlignCenterHorizontal,
  AlignCenterVertical,
  Clapperboard,
  Command,
  CopyPlus,
  Download,
  FilePlus2,
  FolderOpen,
  HelpCircle,
  Layers,
  Moon,
  Package,
  PackageOpen,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Settings2,
  Sun,
  Undo2,
} from 'lucide-react';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  Composition,
  SaveStatus,
  StudioTheme,
} from '../types/editor';

interface TopBarProps {
  projectName: string;
  onChangeProjectName: (name: string) => void;
  aspectRatio: AspectRatioKey;
  onChangeAspectRatio: (ratio: AspectRatioKey) => void;
  fps: 24 | 30 | 60 | 120;
  onChangeFps: (fps: 24 | 30 | 60 | 120) => void;
  compositions: Composition[];
  activeCompId: string;
  onSelectComposition: (compId: string) => void;
  onNewComposition: () => void;
  onOpenCompSettings: () => void;
  onOpenCommandPalette: () => void;
  onAlignSelected: (mode: 'center-h' | 'center-v' | 'left' | 'right' | 'top' | 'bottom') => void;
  onStaggerClips: () => void;
  onDuplicateProject: () => void;
  hasAutosave: boolean;
  onRecoverAutosave: () => void;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  missingMediaCount: number;
  onSaveNow: () => void;
  onExportPackage: () => void;
  onImportPackage: (file: File) => void;
  theme: StudioTheme;
  onToggleTheme: () => void;
  liveFps: number;
  cacheBytes: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onNewEmptyProject: () => void;
  onSaveProjectJson: () => void;
  onLoadProjectJson: (file: File) => void;
  onOpenShortcuts: () => void;
  onOpenExport: () => void;
  /** Phone/tablet: tools hidden from the bar are exposed in the menu. */
  compact?: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  projectName,
  onChangeProjectName,
  aspectRatio,
  onChangeAspectRatio,
  fps,
  onChangeFps,
  compositions,
  activeCompId,
  onSelectComposition,
  onNewComposition,
  onOpenCompSettings,
  onOpenCommandPalette,
  onAlignSelected,
  onStaggerClips,
  onDuplicateProject,
  hasAutosave,
  onRecoverAutosave,
  saveStatus,
  lastSavedAt,
  missingMediaCount,
  onSaveNow,
  onExportPackage,
  onImportPackage,
  theme,
  onToggleTheme,
  liveFps,
  cacheBytes,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onNewEmptyProject,
  onSaveProjectJson,
  onLoadProjectJson,
  onOpenShortcuts,
  onOpenExport,
  compact = false,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [compMenuOpen, setCompMenuOpen] = useState(false);

  const cycleFps = () => {
    const next: 24 | 30 | 60 | 120 = fps === 24 ? 30 : fps === 30 ? 60 : fps === 60 ? 120 : 24;
    onChangeFps(next);
  };

  return (
    <header className="shrink-0 bg-[#121215] border-b border-[#27272a] flex flex-col z-30 pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div className="h-12 px-3 flex items-center justify-between gap-2">
        {/* Left: Brand Menu, Project Name, Undo/Redo & Studio Menus */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              title="Menu do Projeto (OTTO)"
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#1c1c21] hover:bg-[#27272a] border border-[#27272a] transition-colors cursor-pointer"
            >
              <div className="w-6 h-6 rounded-md bg-white text-black flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_1px_3px_rgba(0,0,0,0.45)]">
                <Clapperboard className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-semibold tracking-[0.22em] text-[#f5f5f7] hidden sm:inline">
                OTTO
              </span>
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute left-0 top-11 w-64 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain rounded-lg bg-[#18181c] border border-[#27272a] shadow-2xl py-1.5 z-50 text-xs">
                  {compact && (
                    <>
                      <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-[#71717a]">
                        Formato &amp; Quadros
                      </div>
                      <div className="px-3 pb-2 flex flex-wrap gap-1">
                        {(['16:9', '9:16', '1:1', '4:5', '4k'] as AspectRatioKey[]).map((key) => (
                          <button
                            key={key}
                            onClick={() => {
                              setMenuOpen(false);
                              onChangeAspectRatio(key);
                            }}
                            className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium cursor-pointer ${
                              aspectRatio === key
                                ? 'bg-[#2563eb] text-white'
                                : 'bg-[#09090b] text-[#a1a1aa] border border-[#27272a]'
                            }`}
                          >
                            {ASPECT_RATIOS[key].label}
                          </button>
                        ))}
                        <button
                          onClick={cycleFps}
                          className="px-2.5 py-1.5 rounded-md bg-[#09090b] border border-[#27272a] font-mono-code text-[11px] text-[#a1a1aa] cursor-pointer"
                        >
                          {fps} FPS
                        </button>
                      </div>
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          onAlignSelected('center-h');
                        }}
                        className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left text-[#f4f4f5] active:bg-[#27272a] cursor-pointer"
                      >
                        <AlignCenterHorizontal className="w-3.5 h-3.5 text-[#a1a1aa]" />
                        <span>Centralizar Horizontalmente</span>
                      </button>
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          onAlignSelected('center-v');
                        }}
                        className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left text-[#f4f4f5] active:bg-[#27272a] cursor-pointer"
                      >
                        <AlignCenterVertical className="w-3.5 h-3.5 text-[#a1a1aa]" />
                        <span>Centralizar Verticalmente</span>
                      </button>
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          onStaggerClips();
                        }}
                        className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left text-[#f4f4f5] active:bg-[#27272a] cursor-pointer"
                      >
                        <Layers className="w-3.5 h-3.5 text-[#a1a1aa]" />
                        <span>Stagger (sequenciar camadas)</span>
                      </button>
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          onOpenCommandPalette();
                        }}
                        className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left text-[#f4f4f5] active:bg-[#27272a] cursor-pointer"
                      >
                        <Command className="w-3.5 h-3.5 text-[#60a5fa]" />
                        <span>Paleta de Comandos</span>
                      </button>
                      <div className="my-1 h-px bg-[#27272a]" />
                    </>
                  )}
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onNewEmptyProject();
                    }}
                    className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
                  >
                    <FilePlus2 className="w-3.5 h-3.5 text-[#a1a1aa]" />
                    <span>Novo Projeto em Branco</span>
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onDuplicateProject();
                    }}
                    className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
                  >
                    <CopyPlus className="w-3.5 h-3.5 text-[#a1a1aa]" />
                    <span>Duplicar Projeto</span>
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onNewComposition();
                    }}
                    className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
                  >
                    <Layers className="w-3.5 h-3.5 text-[#60a5fa]" />
                    <span>Nova Composição</span>
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenCompSettings();
                    }}
                    className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
                  >
                    <Settings2 className="w-3.5 h-3.5 text-[#a1a1aa]" />
                    <span>Configurações da Composição...</span>
                  </button>
                  <div className="my-1 h-px bg-[#27272a]" />
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onSaveNow();
                    }}
                    className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5 text-[#10b981]" />
                    <span>Salvar Agora</span>
                    <span className="ml-auto font-mono-code text-[9px] text-[#71717a]">Ctrl+S</span>
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onExportPackage();
                    }}
                    title="Inclui as mídias para abrir em outro computador"
                    className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
                  >
                    <Package className="w-3.5 h-3.5 text-[#60a5fa]" />
                    <span>Exportar Pacote de Projeto…</span>
                  </button>
                  <label className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer">
                    <PackageOpen className="w-3.5 h-3.5 text-[#60a5fa]" />
                    <span>Abrir Pacote de Projeto…</span>
                    <input
                      type="file"
                      accept=".json,.ottoproj.json,application/json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) onImportPackage(file);
                        setMenuOpen(false);
                      }}
                    />
                  </label>
                  <div className="my-1 h-px bg-[#27272a]" />
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onSaveProjectJson();
                    }}
                    className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5 text-[#a1a1aa]" />
                    <span>Salvar Projeto (.json)</span>
                  </button>
                  <label className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer">
                    <FolderOpen className="w-3.5 h-3.5 text-[#a1a1aa]" />
                    <span>Abrir Projeto (.json)</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onLoadProjectJson(file);
                        setMenuOpen(false);
                      }}
                    />
                  </label>
                  {hasAutosave && (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onRecoverAutosave();
                      }}
                      className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-[#34d399] hover:bg-[#27272a] cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Recuperar Autosave</span>
                    </button>
                  )}
                  <div className="my-1 h-px bg-[#27272a]" />
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onToggleTheme();
                    }}
                    className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
                  >
                    {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-[#a1a1aa]" />}
                    <span>{theme === 'dark' ? 'Alternar para Tema Claro' : 'Alternar para Tema Escuro'}</span>
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenShortcuts();
                    }}
                    className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-[#a1a1aa]" />
                    <span>Atalhos de Teclado (?)</span>
                  </button>
                </div>
              </>
            )}
          </div>

          <input
            type="text"
            value={projectName}
            onChange={(e) => onChangeProjectName(e.target.value)}
            aria-label="Nome do projeto"
            className="bg-transparent hover:bg-[#1c1c21] focus:bg-[#1c1c21] border border-transparent focus:border-[#3f3f46] rounded-md px-1.5 sm:px-2 py-1 text-xs font-medium text-[#f4f4f5] outline-none w-20 xs:w-28 sm:w-36 md:w-44 truncate transition-colors"
            placeholder="Nome do projeto..."
          />

          {/* Visible Save Status (never lose work silently) */}
          <div
            aria-live="polite"
            data-testid="save-status"
            className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-1 rounded-md bg-[#09090b] border border-[#27272a] text-[10px] whitespace-nowrap shrink-0"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                saveStatus === 'error'
                  ? 'bg-[#ef4444]'
                  : saveStatus === 'saving'
                  ? 'bg-[#f59e0b] animate-pulse'
                  : saveStatus === 'dirty'
                  ? 'bg-[#f59e0b]'
                  : 'bg-[#10b981]'
              }`}
            />
            <span
              data-testid="save-status-text"
              className={`hidden sm:inline ${
                saveStatus === 'error'
                  ? 'text-[#fca5a5]'
                  : saveStatus === 'dirty'
                  ? 'text-[#fbbf24]'
                  : 'text-[#a1a1aa]'
              }`}
            >
              {saveStatus === 'error'
                ? 'Erro ao salvar'
                : saveStatus === 'saving'
                ? 'Salvando…'
                : saveStatus === 'dirty'
                ? 'Alterações não salvas'
                : lastSavedAt
                ? `Salvo ${new Date(lastSavedAt).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : 'Tudo salvo'}
            </span>
            {missingMediaCount > 0 && (
              <span
                title={`${missingMediaCount} mídia(s) ausente(s) — clique para relinkar`}
                className="ml-0.5 px-1 sm:px-1.5 py-0.5 rounded bg-[#f59e0b]/20 text-[#fbbf24] font-semibold text-[9px] sm:text-[10px]"
              >
                {missingMediaCount} <span className="hidden sm:inline">mídia ausente</span>
              </span>
            )}
          </div>

          {/* Undo / Redo */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title="Desfazer (Ctrl+Z)"
              className="p-2 sm:p-1.5 rounded-md text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              title="Refazer (Ctrl+Y)"
              className="p-2 sm:p-1.5 rounded-md text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Alignment & Layer Sequencing Tools */}
          <div className="hidden xl:flex items-center gap-1 pl-1 border-l border-[#27272a]">
            <button
              onClick={() => onAlignSelected('center-h')}
              title="Centralizar Horizontalmente"
              className="p-1.5 rounded text-[#a1a1aa] hover:text-white hover:bg-[#1c1c21] cursor-pointer"
            >
              <AlignCenterHorizontal className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onAlignSelected('center-v')}
              title="Centralizar Verticalmente"
              className="p-1.5 rounded text-[#a1a1aa] hover:text-white hover:bg-[#1c1c21] cursor-pointer"
            >
              <AlignCenterVertical className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onStaggerClips}
              title="Stagger / Sequenciar camadas em escada (0.25s)"
              className="px-2 py-1 rounded text-[11px] text-[#a1a1aa] hover:text-white hover:bg-[#1c1c21] cursor-pointer"
            >
              Stagger
            </button>
          </div>
        </div>

        {/* Center: Format, Resolution Settings & FPS */}
        <div className="hidden lg:flex items-center gap-1.5">
          <div className="flex items-center bg-[#09090b] p-0.5 rounded-lg border border-[#27272a]">
            {(['16:9', '9:16', '1:1', '4:5', '4k'] as AspectRatioKey[]).map((key) => {
              const active = aspectRatio === key;
              return (
                <button
                  key={key}
                  onClick={() => onChangeAspectRatio(key)}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#27272a] text-[#f4f4f5]'
                      : 'text-[#71717a] hover:text-[#a1a1aa]'
                  }`}
                >
                  {ASPECT_RATIOS[key].label}
                </button>
              );
            })}
          </div>

          <button
            onClick={cycleFps}
            title="Alternar taxa de quadros (24 / 30 / 60 FPS)"
            className="px-2.5 py-1 rounded-lg bg-[#09090b] hover:bg-[#1c1c21] border border-[#27272a] font-mono-code text-[11px] text-[#a1a1aa] hover:text-[#f4f4f5] transition-colors cursor-pointer"
          >
            {fps} FPS
          </button>

          <button
            onClick={onOpenCompSettings}
            title="Configurações da Composição (Resolução, Cor de Fundo, Transparência)"
            className="p-1.5 rounded-lg bg-[#09090b] hover:bg-[#1c1c21] border border-[#27272a] text-[#a1a1aa] hover:text-white cursor-pointer"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Command Palette, Performance HUD, Theme, Shortcuts & Export */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onOpenCommandPalette}
            title="Paleta de Comandos (Ctrl+K)"
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#09090b] hover:bg-[#1c1c21] border border-[#27272a] text-[11px] text-[#a1a1aa] hover:text-[#f4f4f5] cursor-pointer"
          >
            <Command className="w-3 h-3 text-[#60a5fa]" />
            <span>Comandos</span>
            <kbd className="font-mono-code text-[9px] text-[#71717a]">Ctrl+K</kbd>
          </button>

          <div
            title="Monitor de Desempenho e Memória de Cache"
            className="hidden xl:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#09090b] border border-[#27272a] font-mono-code text-[10px] text-[#a1a1aa]"
          >
            <Activity className="w-3 h-3 text-[#10b981]" />
            <span>{liveFps}fps</span>
            <span className="text-[#52525b]">•</span>
            <span>{(cacheBytes / (1024 * 1024)).toFixed(1)}MB</span>
          </div>

          <button
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Alternar para Tema Claro' : 'Alternar para Tema Escuro'}
            className="hidden sm:flex p-1.5 rounded-lg text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21] cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            onClick={onOpenShortcuts}
            title="Atalhos de Teclado (?)"
            className="hidden sm:flex p-1.5 rounded-lg text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#1c1c21] border border-transparent hover:border-[#27272a] transition-colors cursor-pointer"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenExport}
            className="flex items-center gap-2 px-3 sm:px-3.5 py-2 sm:py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#3b82f6] text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span className={compact ? 'hidden min-[420px]:inline' : undefined}>Exportar</span>
          </button>
        </div>
      </div>

      {/* Multi-Composition Tabs Bar (shown when multiple comps exist or toggled) */}
      {(compositions.length > 1 || compMenuOpen) && (
        <div className="h-7 px-3 bg-[#0d0d10] border-t border-[#27272a] flex items-center gap-1 overflow-x-auto text-[11px]">
          {compositions.map((comp) => {
            const active = comp.id === activeCompId;
            return (
              <button
                key={comp.id}
                onClick={() => onSelectComposition(comp.id)}
                className={`px-2.5 py-0.5 rounded flex items-center gap-1.5 shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#2563eb]/20 text-[#60a5fa] border border-[#2563eb]/50 font-semibold'
                    : 'text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#18181c]'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>{comp.name}</span>
              </button>
            );
          })}
          <button
            onClick={() => {
              setCompMenuOpen(true);
              onNewComposition();
            }}
            title="Criar nova composição"
            className="px-2 py-0.5 rounded text-[#71717a] hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3 h-3" /> Nova Comp
          </button>
        </div>
      )}
    </header>
  );
};
