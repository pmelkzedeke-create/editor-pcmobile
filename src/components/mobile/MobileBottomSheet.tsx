import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface MobileBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Sheet height as a CSS length (default 48dvh). */
  height?: string;
  /** Modal sheets dim the screen; non-modal ones let the preview stay interactive. */
  modal?: boolean;
}

/**
 * Bottom sheet that sits above the mobile action bar (var(--mobile-bar-h)).
 * Non-modal by default so the monitor/timeline stay usable while a panel is open.
 * Swipe the handle/header down to dismiss.
 */
export const MobileBottomSheet: React.FC<MobileBottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  height = '48dvh',
  modal = false,
}) => {
  const startYRef = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      startYRef.current = null;
      setDragY(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    startYRef.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startYRef.current === null) return;
    setDragY(Math.max(0, e.clientY - startYRef.current));
  };
  const endDrag = () => {
    if (startYRef.current === null) return;
    startYRef.current = null;
    setDragY((y) => {
      if (y > 90) onClose();
      return 0;
    });
  };

  return (
    <div
      className="fixed inset-x-0 top-0 z-40 flex flex-col justify-end pointer-events-none"
      style={{ bottom: 'var(--mobile-bar-h, 0px)' }}
      role="dialog"
      aria-modal={modal}
      aria-label={title}
    >
      {modal && (
        <div
          className="absolute inset-0 bg-black/55 pointer-events-auto"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        data-testid="mobile-bottom-sheet"
        style={{
          height,
          maxHeight: '100%',
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragY ? 'none' : 'transform 180ms ease-out',
        }}
        className="relative pointer-events-auto w-full bg-[#141418] border-t border-white/15 rounded-t-2xl shadow-[0_-12px_40px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden"
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="shrink-0 select-none touch-none cursor-grab"
        >
          <div className="w-full pt-2 pb-1 flex justify-center">
            <div className="w-10 h-1 bg-white/30 rounded-full" />
          </div>
          <div className="px-4 pb-2 border-b border-white/10 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#f4f4f5] truncate">
                {title}
              </h3>
              {subtitle && <p className="text-[10px] text-[#71717a] truncate">{subtitle}</p>}
            </div>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onClose}
              aria-label="Fechar painel"
              className="w-9 h-9 -mr-2 rounded-full bg-white/10 active:bg-white/20 text-[#f4f4f5] flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden overscroll-contain">{children}</div>
      </div>
    </div>
  );
};
