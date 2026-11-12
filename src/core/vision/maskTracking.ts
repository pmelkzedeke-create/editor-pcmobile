import type { LayerMask, MediaAsset, TimelineClip } from '../../types/editor';
import { checkAborted, seekVideoFrame } from '../../utils/previewCache';
import { visibleSourceRange } from './analyzeMotion';
import { matchPatch, toGray } from './motion';

export interface MaskTrackProgress {
  done: number;
  total: number;
  time: number;
  confidence: number;
}

/**
 * Tracks a LayerMask across frames of a video clip using robust normalized patch correlation,
 * updating its position (x, y) and dimensions (width, height) over time.
 */
export async function trackMaskOverVideo(opts: {
  asset: MediaAsset;
  clip: TimelineClip;
  mask: LayerMask;
  fps: number;
  referenceTime: number;
  direction: 1 | -1;
  signal: AbortSignal;
  onProgress: (p: MaskTrackProgress) => void;
}): Promise<{
  updatedMask: LayerMask;
  trackedFramesCount: number;
  keyframes: { time: number; x: number; y: number; width: number; height: number }[];
}> {
  const { asset, clip, mask, direction, signal, onProgress } = opts;
  if (asset.type !== 'video' || !asset.url) {
    throw new Error('O rastreamento de máscara requer um clipe de vídeo importado.');
  }

  const range = visibleSourceRange(clip, asset.duration);
  const sampleRate = Math.max(10, Math.min(30, opts.fps));
  const totalSteps = Math.max(1, Math.ceil((range.end - range.start) * sampleRate));

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = asset.url;

  const canvas = document.createElement('canvas');
  const W = 256;
  const H = Math.max(48, Math.round((W * (asset.height || 720)) / (asset.width || 1280)));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas indisponível para rastreamento.');

  const refTime = Math.max(range.start, Math.min(range.end, opts.referenceTime));

  // Convert mask center from % coordinates to pixels
  const maskCx = (50 + mask.x) / 100;
  const maskCy = (50 + mask.y) / 100;
  const initPxX = Math.round(Math.max(10, Math.min(W - 10, maskCx * W)));
  const initPxY = Math.round(Math.max(10, Math.min(H - 10, maskCy * H)));

  const keyframes: { time: number; x: number; y: number; width: number; height: number }[] = [];

  const readFrame = async (t: number) => {
    checkAborted(signal);
    await seekVideoFrame(video, t, signal);
    ctx.drawImage(video, 0, 0, W, H);
    return toGray(ctx.getImageData(0, 0, W, H).data, W, H);
  };

  try {
    const refFrame = await readFrame(refTime);

    // Initial keyframe
    keyframes.push({
      time: refTime,
      x: mask.x,
      y: mask.y,
      width: mask.width,
      height: mask.height,
    });

    let currentMaskX = mask.x;
    let currentMaskY = mask.y;
    let currentMaskW = mask.width;
    let currentMaskH = mask.height;
    let prevPxX = initPxX;
    let prevPxY = initPxY;

    const times: number[] = [];
    const stepSec = 1 / sampleRate;

    if (direction === 1) {
      for (let t = refTime + stepSec; t <= range.end; t += stepSec) times.push(t);
    } else {
      for (let t = refTime - stepSec; t >= range.start; t -= stepSec) times.push(t);
    }

    let processed = 0;
    for (const t of times) {
      checkAborted(signal);
      const frame = await readFrame(t);

      // Track center point patch
      const result = matchPatch(refFrame, frame, initPxX, initPxY, prevPxX, prevPxY, 8, 22);

      if (result.confidence > 0.45) {
        const dxPx = result.x - prevPxX;
        const dyPx = result.y - prevPxY;

        // Convert delta in pixels to % of canvas
        const dxPct = (dxPx / W) * 100;
        const dyPct = (dyPx / H) * 100;

        currentMaskX += dxPct;
        currentMaskY += dyPct;
        prevPxX = result.x;
        prevPxY = result.y;

        keyframes.push({
          time: t,
          x: Math.round(currentMaskX * 10) / 10,
          y: Math.round(currentMaskY * 10) / 10,
          width: Math.round(currentMaskW * 10) / 10,
          height: Math.round(currentMaskH * 10) / 10,
        });
      }

      processed++;
      onProgress({
        done: processed,
        total: totalSteps,
        time: t,
        confidence: result.confidence,
      });

      if (processed % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    return {
      updatedMask: {
        ...mask,
        x: Math.round(currentMaskX * 10) / 10,
        y: Math.round(currentMaskY * 10) / 10,
        width: Math.round(currentMaskW * 10) / 10,
        height: Math.round(currentMaskH * 10) / 10,
      },
      trackedFramesCount: keyframes.length,
      keyframes,
    };
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    canvas.width = canvas.height = 1;
  }
}
