import type { NormalizedRect, TimelineClip } from '../../types/editor';
import { clonePatchPixels, removeBackgroundPixels } from './pixels';
import { sampleMotion, stabilizationOffset } from './motion';

export function cleanupRectAtTime(clip: TimelineClip, sourceTime: number): NormalizedRect | null {
  const cleanup = clip.vfx?.cleanup;
  if (!cleanup) return null;
  const tracking = clip.vfx?.tracking;
  if (!cleanup.followTrack || !tracking?.samples.length) return cleanup.rect;
  const origin = sampleMotion(tracking, cleanup.referenceTime ?? tracking.samples[0].time);
  const current = sampleMotion(tracking, sourceTime);
  return { ...cleanup.rect, x: cleanup.rect.x + current.x - origin.x, y: cleanup.rect.y + current.y - origin.y };
}

/** One reusable source surface per media pool; never bakes VFX into source files. */
export class SourceEffectsProcessor {
  private canvas: HTMLCanvasElement | null = null;
  private secondary: HTMLCanvasElement | null = null;

  process(source: CanvasImageSource, sourceW: number, sourceH: number, clip: TimelineClip, sourceTime: number, maxSide: number): CanvasImageSource {
    const vfx = clip.vfx;
    if (!vfx?.background?.enabled && !vfx?.cleanup?.enabled && !vfx?.stabilization?.enabled) return source;
    const factor = Math.min(1, maxSide / Math.max(sourceW, sourceH));
    const w = Math.max(2, Math.round(sourceW * factor));
    const h = Math.max(2, Math.round(sourceH * factor));
    this.canvas ??= document.createElement('canvas');
    this.secondary ??= document.createElement('canvas');
    const canvas = this.canvas;
    const secondary = this.secondary;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (secondary.width !== w || secondary.height !== h) { secondary.width = w; secondary.height = h; }
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    const cleanup = vfx.cleanup;
    const rect = cleanupRectAtTime(clip, sourceTime);
    if (cleanup?.enabled && rect) {
      if (cleanup.mode === 'clone') {
        const image = ctx.getImageData(0, 0, w, h);
        clonePatchPixels(image.data, w, h, rect, cleanup.sourceOffsetX, cleanup.sourceOffsetY, cleanup.feather);
        ctx.putImageData(image, 0, 0);
      } else {
        const copy = secondary.getContext('2d')!;
        copy.clearRect(0, 0, w, h);
        copy.drawImage(canvas, 0, 0);
        const x = Math.max(0, rect.x * w);
        const y = Math.max(0, rect.y * h);
        const rw = Math.min(w - x, rect.width * w);
        const rh = Math.min(h - y, rect.height * h);
        if (rw > 1 && rh > 1) {
          ctx.save();
          ctx.beginPath(); ctx.rect(x, y, rw, rh); ctx.clip();
          if (cleanup.mode === 'blur') {
            ctx.filter = `blur(${Math.max(3, Math.min(rw, rh) * 0.16)}px)`;
            ctx.drawImage(secondary, 0, 0);
          } else {
            const cols = Math.max(2, Math.round(rw / Math.max(4, w / 48)));
            const rows = Math.max(2, Math.round(cols * rh / rw));
            copy.clearRect(0, 0, w, h);
            copy.drawImage(canvas, x, y, rw, rh, 0, 0, cols, rows);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(secondary, 0, 0, cols, rows, x, y, rw, rh);
          }
          ctx.restore();
        }
      }
    }
    if (vfx.background?.enabled) {
      const image = ctx.getImageData(0, 0, w, h);
      removeBackgroundPixels(image.data, w, h, vfx.background);
      ctx.putImageData(image, 0, 0);
    }
    const stabilization = vfx.stabilization;
    if (stabilization?.enabled) {
      const delta = stabilizationOffset(stabilization.analysis, sourceTime, stabilization.smoothing, stabilization.strength);
      const copy = secondary.getContext('2d')!;
      copy.clearRect(0, 0, w, h); copy.drawImage(canvas, 0, 0);
      const crop = 1 + stabilization.crop / 100;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(crop, crop);
      ctx.drawImage(secondary, -w / 2 + delta.x * w, -h / 2 + delta.y * h);
      ctx.restore();
    }
    return canvas;
  }

  dispose() {
    if (this.canvas) this.canvas.width = this.canvas.height = 1;
    if (this.secondary) this.secondary.width = this.secondary.height = 1;
    this.canvas = this.secondary = null;
  }
}