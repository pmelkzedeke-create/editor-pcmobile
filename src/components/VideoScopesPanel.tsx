import React, { useEffect, useRef, useState } from 'react';
import { Activity, X } from 'lucide-react';

export type ScopeMode = 'histogram' | 'waveform' | 'vectorscope';

interface VideoScopesPanelProps {
  sourceCanvas: HTMLCanvasElement | null;
  currentTime: number;
  falseColor: boolean;
  onToggleFalseColor: () => void;
  onClose: () => void;
}

export const VideoScopesPanel: React.FC<VideoScopesPanelProps> = ({
  sourceCanvas,
  currentTime,
  falseColor,
  onToggleFalseColor,
  onClose,
}) => {
  const [mode, setMode] = useState<ScopeMode>('histogram');
  const scopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const scopeCanvas = scopeCanvasRef.current;
    if (!scopeCanvas || !sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) {
      return;
    }
    const ctx = scopeCanvas.getContext('2d');
    if (!ctx) return;

    if (!sampleCanvasRef.current) {
      sampleCanvasRef.current = document.createElement('canvas');
    }
    const sw = 128;
    const sh = 72;
    const sampleCanvas = sampleCanvasRef.current;
    sampleCanvas.width = sw;
    sampleCanvas.height = sh;
    const sCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!sCtx) return;

    sCtx.drawImage(sourceCanvas, 0, 0, sw, sh);
    const pixels = sCtx.getImageData(0, 0, sw, sh).data;

    const w = scopeCanvas.width;
    const h = scopeCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, w, h);

    // Graticule grid
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let g = 0.25; g < 1; g += 0.25) {
      ctx.beginPath();
      ctx.moveTo(0, h * g);
      ctx.lineTo(w, h * g);
      ctx.stroke();
    }

    if (mode === 'histogram') {
      const rBins = new Uint32Array(256);
      const gBins = new Uint32Array(256);
      const bBins = new Uint32Array(256);
      const yBins = new Uint32Array(256);

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const luma = Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b));
        rBins[r]++;
        gBins[g]++;
        bBins[b]++;
        yBins[luma]++;
      }

      let maxCount = 1;
      for (let i = 1; i < 255; i++) {
        maxCount = Math.max(maxCount, rBins[i], gBins[i], bBins[i], yBins[i]);
      }

      const drawChannel = (bins: Uint32Array, stroke: string, fill: string) => {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < 256; i++) {
          const x = (i / 255) * w;
          const norm = Math.min(1, bins[i] / maxCount);
          const y = h - Math.pow(norm, 0.65) * (h - 8);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      };

      drawChannel(rBins, '#ef4444', 'rgba(239,68,68,0.28)');
      drawChannel(gBins, '#10b981', 'rgba(16,185,129,0.28)');
      drawChannel(bBins, '#3b82f6', 'rgba(59,130,246,0.28)');
      drawChannel(yBins, '#e4e4e7', 'rgba(244,244,245,0.14)');
    } else if (mode === 'waveform') {
      ctx.fillStyle = 'rgba(52, 211, 153, 0.22)';
      for (let x = 0; x < sw; x++) {
        const plotX = (x / sw) * w;
        for (let y = 0; y < sh; y++) {
          const idx = (y * sw + x) * 4;
          const r = pixels[idx];
          const g = pixels[idx + 1];
          const b = pixels[idx + 2];
          const ire = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          const plotY = h - 4 - ire * (h - 8);
          ctx.fillRect(plotX, plotY, 2, 1.5);
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText('100 IRE', 4, 10);
      ctx.fillText('50 IRE', 4, h * 0.5 - 2);
      ctx.fillText('0 IRE', 4, h - 4);
    } else if (mode === 'vectorscope') {
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.44;

      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
      ctx.stroke();

      // Skin tone line (~123 deg in vectorscope space)
      const skinAngle = (-123 * Math.PI) / 180;
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(skinAngle) * radius, cy + Math.sin(skinAngle) * radius);
      ctx.stroke();

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i] / 255;
        const g = pixels[i + 1] / 255;
        const b = pixels[i + 2] / 255;
        const cb = -0.1146 * r - 0.3854 * g + 0.5 * b;
        const cr = 0.5 * r - 0.4542 * g - 0.0458 * b;
        const px = cx + cb * radius * 1.9;
        const py = cy - cr * radius * 1.9;
        ctx.fillStyle = `rgba(${pixels[i]}, ${pixels[i + 1]}, ${pixels[i + 2]}, 0.35)`;
        ctx.fillRect(px, py, 1.8, 1.8);
      }
    }
  }, [sourceCanvas, currentTime, mode]);

  return (
    <div
      data-testid="video-scopes-panel"
      className="absolute right-3 top-11 z-30 w-64 rounded-xl bg-[#121215]/95 border border-[#27272a] shadow-2xl p-2.5 backdrop-blur-md select-none"
    >
      <div className="flex items-center justify-between gap-1 mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#f4f4f5]">
          <Activity className="w-3.5 h-3.5 text-[#38bdf8]" />
          <span>Scopes Rec.709</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleFalseColor}
            title="Mapa de Exposição False Color (IRE)"
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium border cursor-pointer ${
              falseColor
                ? 'bg-amber-500/20 border-amber-400/60 text-amber-300'
                : 'bg-[#18181c] border-[#27272a] text-[#a1a1aa]'
            }`}
          >
            False Color
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar Scopes"
            className="p-0.5 rounded text-[#71717a] hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-[#09090b] border border-[#27272a] mb-2">
        {(
          [
            ['histogram', 'Histograma'],
            ['waveform', 'Waveform'],
            ['vectorscope', 'Vectorscope'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={`py-1 rounded text-[10px] font-medium cursor-pointer ${
              mode === id
                ? 'bg-[#27272a] text-[#f4f4f5]'
                : 'text-[#71717a] hover:text-[#a1a1aa]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <canvas
        ref={scopeCanvasRef}
        width={236}
        height={118}
        className="w-full h-[118px] rounded-lg border border-[#27272a] block bg-[#09090b]"
      />
    </div>
  );
};
