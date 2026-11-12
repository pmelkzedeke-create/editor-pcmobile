import React, { useRef, useState } from 'react';
import { AlertTriangle, FolderOpen, Link2, X } from 'lucide-react';
import type { PersistedAsset } from '../types/editor';

interface MissingMediaModalProps {
  missing: PersistedAsset[];
  onRelink: (assetId: string, file: File) => Promise<boolean>;
  onDismiss: () => void;
}

export const MissingMediaModal: React.FC<MissingMediaModalProps> = ({
  missing,
  onRelink,
  onDismiss,
}) => {
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  if (missing.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Mídias ausentes"
    >
      <div className="w-full max-w-lg bg-[#121215] border border-[#27272a] rounded-xl shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#27272a] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#f59e0b]" />
            <h3 className="text-sm font-semibold text-[#f4f4f5]">
              {missing.length} mídia(s) ausente(s)
            </h3>
          </div>
          <button
            onClick={onDismiss}
            aria-label="Fechar aviso de mídias ausentes"
            className="p-1 rounded text-[#71717a] hover:text-[#f4f4f5] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-xs text-[#a1a1aa] leading-relaxed">
            A timeline foi preservada integralmente (posições, efeitos, keyframes e
            transições). Selecione novamente cada arquivo para restaurar a mídia — o
            vínculo com os clipes é mantido automaticamente.
          </p>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {missing.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center gap-3 p-2.5 rounded-lg bg-[#18181c] border border-[#27272a]"
              >
                <div className="w-9 h-9 rounded bg-[#27272a] flex items-center justify-center shrink-0">
                  <Link2 className="w-4 h-4 text-[#f59e0b]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-[#f4f4f5] truncate">{asset.name}</p>
                  <p className="text-[10px] text-[#71717a]">
                    {asset.type === 'video' ? 'Vídeo' : asset.type === 'image' ? 'Imagem' : 'Áudio'}
                    {asset.duration ? ` • ${asset.duration.toFixed(1)}s` : ''}
                    {failedId === asset.id && (
                      <span className="text-[#fca5a5]"> • arquivo incompatível</span>
                    )}
                  </p>
                </div>

                <button
                  disabled={pendingId === asset.id}
                  onClick={() => inputRefs.current[asset.id]?.click()}
                  className="px-2.5 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#3b82f6] text-white text-[11px] font-semibold flex items-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  {pendingId === asset.id ? 'Relinkando…' : 'Relinkar'}
                </button>

                <input
                  ref={(el) => {
                    inputRefs.current[asset.id] = el;
                  }}
                  type="file"
                  accept="video/*,image/*,audio/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setPendingId(asset.id);
                    setFailedId(null);
                    const ok = await onRelink(asset.id, file);
                    setPendingId(null);
                    if (!ok) setFailedId(asset.id);
                  }}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-1">
            <button
              onClick={onDismiss}
              className="px-3.5 py-1.5 rounded-lg bg-[#1c1c21] hover:bg-[#27272a] text-xs text-[#a1a1aa] hover:text-[#f4f4f5] cursor-pointer"
            >
              Continuar mesmo assim
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
