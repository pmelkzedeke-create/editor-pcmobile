import React from 'react';
import type { MediaAsset, ProjectState } from '../types/editor';
import { sampleStereoAudioMeter } from '../core/audioAnalysis';

interface AudioVuMeterProps {
  project: ProjectState;
  assetsMap: Map<string, MediaAsset>;
  currentTime: number;
  masterMuted: boolean;
  compact?: boolean;
}

export const AudioVuMeter: React.FC<AudioVuMeterProps> = ({
  project,
  assetsMap,
  currentTime,
  masterMuted,
  compact = false,
}) => {
  const meter = sampleStereoAudioMeter(project, assetsMap, currentTime, masterMuted);
  const pctL = Math.min(100, Math.round((meter.left / 1.15) * 100));
  const pctR = Math.min(100, Math.round((meter.right / 1.15) * 100));
  const dbLabel = meter.db <= -59 ? '-∞ dB' : `${meter.db > 0 ? '+' : ''}${meter.db.toFixed(1)} dB`;

  return (
    <div
      data-testid="audio-vu-meter"
      title={`Nível de Áudio Master: ${dbLabel}${meter.clipping ? ' (CLIPPING!)' : ''}`}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#09090b] border ${
        meter.clipping ? 'border-[#ef4444]/80' : 'border-[#27272a]'
      } select-none`}
    >
      <div className="flex flex-col gap-1 w-14 sm:w-20">
        <div className="h-1.5 w-full rounded-xs bg-[#18181c] overflow-hidden relative">
          <div
            style={{ width: `${pctL}%` }}
            className="h-full transition-[width] duration-75 bg-gradient-to-r from-[#10b981] via-[#f59e0b] to-[#ef4444]"
          />
        </div>
        <div className="h-1.5 w-full rounded-xs bg-[#18181c] overflow-hidden relative">
          <div
            style={{ width: `${pctR}%` }}
            className="h-full transition-[width] duration-75 bg-gradient-to-r from-[#10b981] via-[#f59e0b] to-[#ef4444]"
          />
        </div>
      </div>
      {!compact && (
        <span
          className={`font-mono-code text-[10px] w-12 text-right ${
            meter.clipping
              ? 'text-[#ef4444] font-bold'
              : meter.db > -6
              ? 'text-[#fbbf24]'
              : 'text-[#71717a]'
          }`}
        >
          {meter.clipping ? 'CLIP!' : dbLabel}
        </span>
      )}
    </div>
  );
};
