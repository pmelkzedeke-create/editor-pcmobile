import type { MediaAsset, ProjectState, TimelineMarker } from '../types/editor';
import { uid } from '../utils/mediaHelpers';
import { evaluateClipVolume } from './keyframes';

const ENVELOPE_RATE_HZ = 60;

/**
 * Extracts a 60Hz normalized amplitude envelope (0..1) from an AudioBuffer
 * for audio-reactive expressions (`audioLevel`), Motion Stack, and peak/beat detection.
 */
export function computeAudioEnvelopeFromChannel(
  samples: Float32Array,
  sampleRate: number,
  rateHz = ENVELOPE_RATE_HZ
): number[] {
  const windowSize = Math.max(1, Math.floor(sampleRate / rateHz));
  const buckets = Math.max(1, Math.ceil(samples.length / windowSize));
  const raw: number[] = new Array(buckets);
  let peakMax = 0.001;

  for (let b = 0; b < buckets; b++) {
    const start = b * windowSize;
    const end = Math.min(samples.length, start + windowSize);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      sumSq += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSq / Math.max(1, end - start));
    raw[b] = rms;
    if (rms > peakMax) peakMax = rms;
  }

  return raw.map((v) => Number(Math.min(1, v / peakMax).toFixed(4)));
}

/**
 * Energy-flux onset detector that finds rhythmic beat timestamps (in seconds)
 * with configurable minimum spacing (`minBeatIntervalSec`).
 */
export function detectBeatsFromEnvelope(
  envelope: number[],
  rateHz = ENVELOPE_RATE_HZ,
  sensitivity = 1.28,
  minBeatIntervalSec = 0.34
): number[] {
  if (envelope.length < 6) return [];
  const beats: number[] = [];
  const historyFrames = Math.max(4, Math.round(rateHz * 0.45));
  const minGapFrames = Math.max(2, Math.round(rateHz * minBeatIntervalSec));
  let lastBeatFrame = -minGapFrames;

  for (let i = 2; i < envelope.length - 1; i++) {
    const winStart = Math.max(0, i - historyFrames);
    let localAvg = 0;
    for (let j = winStart; j < i; j++) localAvg += envelope[j];
    localAvg /= Math.max(1, i - winStart);

    const curr = envelope[i];
    const isLocalPeak = curr >= envelope[i - 1] && curr >= envelope[i + 1];
    if (
      isLocalPeak &&
      curr > 0.2 &&
      curr > localAvg * sensitivity &&
      i - lastBeatFrame >= minGapFrames
    ) {
      beats.push(Number((i / rateHz).toFixed(3)));
      lastBeatFrame = i;
    }
  }
  return beats;
}

export async function decodeAudioAssetEnvelope(url: string): Promise<number[]> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(buf);
    return computeAudioEnvelopeFromChannel(audioBuf.getChannelData(0), audioBuf.sampleRate);
  } finally {
    await ctx.close().catch(() => {});
  }
}

export function buildBeatMarkersForClip(
  clipStartTime: number,
  clipDuration: number,
  trimStart: number,
  speed: number,
  envelope: number[]
): TimelineMarker[] {
  const sourceBeats = detectBeatsFromEnvelope(envelope);
  const markers: TimelineMarker[] = [];
  let idx = 1;
  for (const srcSec of sourceBeats) {
    const localTime = (srcSec - trimStart) / Math.max(0.05, speed);
    if (localTime >= 0 && localTime <= clipDuration) {
      markers.push({
        id: uid('beat'),
        time: Number((clipStartTime + localTime).toFixed(3)),
        label: `Beat ${idx++}`,
        color: '#10b981',
      });
    }
  }
  return markers;
}

/**
 * Samples the active audio envelope at `globalTime` across unmuted audio/video tracks.
 */
export function sampleProjectAudioLevel(
  project: ProjectState,
  assetsMap: Map<string, MediaAsset>,
  globalTime: number
): number {
  const trackMap = new Map(project.tracks.map((t) => [t.id, t]));
  let maxLevel = 0;

  for (const clip of project.clips) {
    if (!clip.mediaId || clip.muted || clip.enabled === false) continue;
    const track = trackMap.get(clip.trackId);
    if (!track || track.muted) continue;
    if (globalTime < clip.startTime || globalTime >= clip.startTime + clip.duration) continue;

    const local = globalTime - clip.startTime;
    const dynVol = evaluateClipVolume(clip, local);
    if (dynVol <= 0) continue;
    const fadeIn = clip.fadeIn > 0 ? Math.min(1, local / clip.fadeIn) : 1;
    const fadeOut = clip.fadeOut > 0 ? Math.min(1, (clip.duration - local) / clip.fadeOut) : 1;
    const gain = (dynVol / 100) * fadeIn * fadeOut;

    const asset = assetsMap.get(clip.mediaId);
    if (!asset) continue;

    if (asset.envelope?.length) {
      const srcSec = clip.trimStart + local * clip.speed;
      const idx = Math.min(
        asset.envelope.length - 1,
        Math.max(0, Math.round(srcSec * ENVELOPE_RATE_HZ))
      );
      maxLevel = Math.max(maxLevel, asset.envelope[idx] * Math.min(1.5, gain));
    } else if (asset.waveform?.length) {
      const frac = Math.max(0, Math.min(0.999, local / Math.max(0.05, clip.duration)));
      const idx = Math.floor(frac * asset.waveform.length);
      maxLevel = Math.max(maxLevel, asset.waveform[idx] * Math.min(1.5, gain));
    }
  }

  return Math.min(1, maxLevel);
}

export interface StereoMeterReading {
  left: number;      // 0..1.25 linear
  right: number;     // 0..1.25 linear
  db: number;        // -60..+6 dB
  clipping: boolean; // > 1.0 (0 dBFS)
}

/**
 * Computes real-time stereo L/R meter levels and dBFS reading at `globalTime`.
 */
export function sampleStereoAudioMeter(
  project: ProjectState,
  assetsMap: Map<string, MediaAsset>,
  globalTime: number,
  masterMuted = false
): StereoMeterReading {
  if (masterMuted) {
    return { left: 0, right: 0, db: -60, clipping: false };
  }
  const hasSolo = project.tracks.some((t) => t.solo);
  const trackMap = new Map(project.tracks.map((t) => [t.id, t]));
  let sumL = 0;
  let sumR = 0;

  for (const clip of project.clips) {
    if (clip.enabled === false || clip.muted) continue;
    if (clip.type !== 'audio' && clip.type !== 'video') continue;
    const track = trackMap.get(clip.trackId);
    if (!track || track.muted || (hasSolo && !track.solo)) continue;
    if (clip.type === 'video' && track.hidden) continue;
    if (globalTime < clip.startTime || globalTime >= clip.startTime + clip.duration) continue;

    const local = globalTime - clip.startTime;
    const dynVol = evaluateClipVolume(clip, local);
    if (dynVol <= 0) continue;
    const fadeIn = clip.fadeIn > 0 ? Math.min(1, local / clip.fadeIn) : 1;
    const fadeOut = clip.fadeOut > 0 ? Math.min(1, (clip.duration - local) / clip.fadeOut) : 1;
    const gain = (dynVol / 100) * fadeIn * fadeOut;

    const asset = clip.mediaId ? assetsMap.get(clip.mediaId) : undefined;
    let baseAmp = 0.48;
    if (asset?.envelope?.length) {
      const srcSec = clip.trimStart + local * clip.speed;
      const idx = Math.min(
        asset.envelope.length - 1,
        Math.max(0, Math.round(srcSec * ENVELOPE_RATE_HZ))
      );
      baseAmp = asset.envelope[idx];
    } else if (asset?.waveform?.length || clip.waveform?.length) {
      const wf = asset?.waveform?.length ? asset.waveform : clip.waveform!;
      const frac = Math.max(0, Math.min(0.999, local / Math.max(0.05, clip.duration)));
      const idx = Math.floor(frac * wf.length);
      baseAmp = wf[idx];
    }
    const panNorm = Math.max(-1, Math.min(1, (clip.pan ?? 0) / 100));
    const panL = panNorm <= 0 ? 1 : 1 - panNorm;
    const panR = panNorm >= 0 ? 1 : 1 + panNorm;
    const eqDb = ((clip.eqLow ?? 0) + (clip.eqMid ?? 0) + (clip.eqHigh ?? 0)) / 3;
    const eqGain = Math.pow(10, eqDb / 20);
    const spread = Math.sin(globalTime * 11.3 + clip.startTime * 3.7) * 0.06;
    let lVal = baseAmp * gain * eqGain * panL * (1 + spread);
    let rVal = baseAmp * gain * eqGain * panR * (1 - spread);
    if (clip.audioCompressor) {
      if (lVal > 0.55) lVal = 0.55 + (lVal - 0.55) / 3;
      if (rVal > 0.55) rVal = 0.55 + (rVal - 0.55) / 3;
    }
    sumL += lVal;
    sumR += rVal;
  }

  const peak = Math.max(sumL, sumR);
  const db = peak <= 0.001 ? -60 : Math.max(-60, Math.min(6, Number((20 * Math.log10(peak)).toFixed(1))));
  return {
    left: Math.min(1.25, sumL),
    right: Math.min(1.25, sumR),
    db,
    clipping: peak > 1.0,
  };
}
