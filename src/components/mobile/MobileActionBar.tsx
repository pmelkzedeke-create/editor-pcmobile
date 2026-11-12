import React from 'react';
import {
  Film,
  Music,
  Scissors,
  Sliders,
  Sparkles,
  SquareDashed,
  Type,
} from 'lucide-react';
import type { MobileDrawer } from '../../hooks/useResponsiveLayout';

interface MobileActionBarProps {
  activeDrawer: MobileDrawer;
  onSelectDrawer: (drawer: MobileDrawer) => void;
  onSplitAtPlayhead: () => void;
  hasSelectedClip: boolean;
  selectedClipName?: string;
}

export const MobileActionBar: React.FC<MobileActionBarProps> = ({
  activeDrawer,
  onSelectDrawer,
  onSplitAtPlayhead,
  hasSelectedClip,
  selectedClipName,
}) => {
  const items: {
    id: MobileDrawer | 'split';
    label: string;
    icon: React.ReactNode;
    action?: () => void;
    badge?: string;
  }[] = [
    {
      id: 'media',
      label: 'Mídia',
      icon: <Film className="w-5 h-5" />,
    },
    {
      id: 'split',
      label: 'Dividir',
      icon: <Scissors className="w-5 h-5 text-red-400" />,
      action: onSplitAtPlayhead,
    },
    {
      id: 'text',
      label: 'Texto',
      icon: <Type className="w-5 h-5" />,
    },
    {
      id: 'effects',
      label: 'Efeitos',
      icon: <Sparkles className="w-5 h-5" />,
    },
    {
      id: 'shapes',
      label: 'Formas',
      icon: <SquareDashed className="w-5 h-5" />,
    },
    {
      id: 'audio',
      label: 'Áudio',
      icon: <Music className="w-5 h-5" />,
    },
    {
      id: 'inspector',
      label: hasSelectedClip ? 'Editar' : 'Ajustes',
      icon: <Sliders className="w-5 h-5" />,
      badge: hasSelectedClip ? '●' : undefined,
    },
  ];

  return (
    <nav
      data-testid="mobile-action-bar"
      aria-label="Barra de ações mobile"
      style={{ height: 'var(--mobile-bar-h)' }}
      className="shrink-0 bg-[#121215] border-t border-[#27272a] px-1 pt-1 z-50 select-none pb-[env(safe-area-inset-bottom)] box-border"
    >
      <div className="h-14 flex items-center justify-around gap-0.5 overflow-x-auto no-scrollbar">
        {items.map((item) => {
          const isCurrent = activeDrawer === item.id;
          const isSplit = item.id === 'split';

          return (
            <button
              key={item.id}
              onClick={() => {
                if (isSplit) {
                  item.action?.();
                } else {
                  onSelectDrawer(item.id as MobileDrawer);
                }
              }}
              title={item.id === 'inspector' && selectedClipName ? `Editar ${selectedClipName}` : item.label}
              className={`flex-1 min-w-[46px] max-w-[72px] h-full py-1 px-0.5 rounded-lg flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer active:scale-95 ${
                isCurrent
                  ? 'bg-white/10 text-white font-semibold'
                  : 'text-[#a1a1aa] active:bg-white/5'
              }`}
            >
              <div className="relative">
                <span className={isCurrent ? 'text-white' : ''}>{item.icon}</span>
                {item.badge && (
                  <span className="absolute -top-1 -right-1 text-[8px] text-amber-400 font-bold">
                    {item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] leading-tight truncate max-w-[64px]">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
