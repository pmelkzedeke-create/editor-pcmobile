import React from 'react';
import {
  AlertCircle,
  FileVideo,
  FileAudio,
  Box,
  Image as ImageIcon,
  Loader2,
  X,
} from 'lucide-react';

export interface MediaLoadingState {
  active: boolean;
  filename: string;
  sizeBytes: number;
  stage: string;
  percent: number; // 0..100
  error?: string | null;
  cancel?: () => void;
}

interface MediaLoadingModalProps {
  state: MediaLoadingState | null;
  onClose?: () => void;
}

export const MediaLoadingModal: React.FC<MediaLoadingModalProps> = ({ state, onClose }) => {
  if (!state || (!state.active && !state.error)) return null;

  const isError = !!state.error;
  const isVideo = /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(state.filename);
  const isAudio = /\.(mp3|wav|ogg|aac|m4a|flac)$/i.test(state.filename);
  const is3D = /\.(glb|gltf)$/i.test(state.filename);

  const formattedSize =
    state.sizeBytes > 0
      ? state.sizeBytes > 1024 * 1024
        ? `${(state.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
        : `${(state.sizeBytes / 1024).toFixed(0)} KB`
      : '';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200 select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Carregando Mídia"
    >
      <div className="w-full max-w-md bg-[#121215]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.15)] overflow-hidden">
        {/* Header Strip */}
        <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#f5f5f7]">
              {isError ? 'Falha na Mídia' : 'Processando Mídia'}
            </h3>
          </div>

          {(state.cancel || isError) && (
            <button
              onClick={() => {
                if (isError && onClose) onClose();
                else state.cancel?.();
              }}
              title="Cancelar operação"
              className="p-1 rounded-md text-[#a1a1aa] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="p-6 flex flex-col items-center text-center space-y-4">
          {/* Animated Icon Ring */}
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-b from-white/15 to-white/5 border border-white/20 flex items-center justify-center shadow-lg">
              {isError ? (
                <AlertCircle className="w-8 h-8 text-rose-400" />
              ) : is3D ? (
                <Box className="w-8 h-8 text-indigo-400 animate-pulse" />
              ) : isVideo ? (
                <FileVideo className="w-8 h-8 text-sky-400 animate-pulse" />
              ) : isAudio ? (
                <FileAudio className="w-8 h-8 text-emerald-400 animate-pulse" />
              ) : (
                <ImageIcon className="w-8 h-8 text-amber-400 animate-pulse" />
              )}
            </div>

            {!isError && (
              <div className="absolute -inset-1.5 rounded-3xl border border-white/25 border-t-white animate-spin pointer-events-none" />
            )}
          </div>

          {/* File Name & Size */}
          <div className="space-y-1 max-w-xs">
            <p className="text-sm font-semibold text-[#f5f5f7] truncate">
              {state.filename}
            </p>
            {formattedSize && (
              <p className="font-mono-code text-[11px] text-[#71717a]">
                {formattedSize}
              </p>
            )}
          </div>

          {/* Stage Description / Error */}
          {isError ? (
            <div className="w-full p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-left text-xs text-rose-200">
              <p className="font-medium text-rose-300">Erro durante a leitura:</p>
              <p className="mt-0.5 text-[11px] text-rose-200/90 leading-relaxed">
                {state.error}
              </p>
            </div>
          ) : (
            <div className="w-full space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#a1a1aa] flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                  {state.stage || 'Processando quadros...'}
                </span>
                <span className="font-mono-code text-white font-bold text-sm">
                  {Math.round(state.percent)}%
                </span>
              </div>

              {/* Liquid Glow Progress Bar */}
              <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden relative">
                <div
                  style={{ width: `${Math.max(3, Math.min(100, state.percent))}%` }}
                  className="h-full bg-gradient-to-r from-sky-400 via-indigo-300 to-white transition-all duration-150 shadow-[0_0_12px_rgba(255,255,255,0.7)]"
                />
              </div>
            </div>
          )}

          {/* Action Footer */}
          <div className="w-full pt-2 flex items-center justify-end gap-2">
            {isError ? (
              <button
                onClick={onClose}
                className="w-full py-2 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Fechar
              </button>
            ) : state.cancel ? (
              <button
                onClick={state.cancel}
                className="w-full py-2 px-4 rounded-xl bg-white/10 hover:bg-white/20 active:scale-98 text-white text-xs font-semibold transition-colors cursor-pointer border border-white/10 hover:border-white/20"
              >
                Cancelar Carregamento
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
