import type { MotionAnalysis, MotionSample } from '../../types/editor';

export interface GrayFrame {
  width: number;
  height: number;
  pixels: Float32Array;
}

export function toGray(data: Uint8ClampedArray, width: number, height: number): GrayFrame {
  const pixels = new Float32Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  }
  return { width, height, pixels };
}

/** Zero-mean normalized patch correlation: insensitive to uniform lighting shifts. */
export function matchPatch(
  reference: GrayFrame,
  current: GrayFrame,
  referenceX: number,
  referenceY: number,
  predictedX: number,
  predictedY: number,
  radius = 6,
  searchRadius = 16
): { x: number; y: number; confidence: number } {
  const { width: w, height: h } = current;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const rx = Math.round(clamp(referenceX, radius, w - radius - 1));
  const ry = Math.round(clamp(referenceY, radius, h - radius - 1));
  const patch: number[] = [];
  for (let y = -radius; y <= radius; y += 2) {
    for (let x = -radius; x <= radius; x += 2) patch.push(reference.pixels[(ry + y) * w + rx + x]);
  }
  const mean = patch.reduce((s, p) => s + p, 0) / patch.length;
  const variance = patch.reduce((s, p) => s + (p - mean) ** 2, 0);
  if (variance / patch.length < 8) return { x: rx, y: ry, confidence: 0 };

  let bestScore = -2;
  let bestX = predictedX;
  let bestY = predictedY;
  const xmin = Math.max(radius, Math.round(predictedX - searchRadius));
  const xmax = Math.min(w - radius - 1, Math.round(predictedX + searchRadius));
  const ymin = Math.max(radius, Math.round(predictedY - searchRadius));
  const ymax = Math.min(h - radius - 1, Math.round(predictedY + searchRadius));
  const scoreAt = (cx: number, cy: number) => {
    let sum = 0;
    let sumSq = 0;
    let correlation = 0;
    let k = 0;
    for (let y = -radius; y <= radius; y += 2) {
      for (let x = -radius; x <= radius; x += 2) {
        const value = current.pixels[(cy + y) * w + cx + x];
        sum += value;
        sumSq += value * value;
        correlation += (patch[k++] - mean) * value;
      }
    }
    const norm = Math.sqrt(variance * Math.max(0, sumSq - sum * sum / patch.length));
    return norm < 1e-6 ? -1 : correlation / norm;
  };

  // Search every integer displacement. Skipping odd offsets misses small details
  // on highly textured footage; subsampling is restricted to the patch pixels.
  for (let y = ymin; y <= ymax; y++) {
    for (let x = xmin; x <= xmax; x++) {
      const score = scoreAt(x, y);
      if (score > bestScore) { bestScore = score; bestX = x; bestY = y; }
    }
  }
  return { x: bestX, y: bestY, confidence: Math.max(0, Math.min(1, bestScore)) };
}

const median = (values: number[]) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered.length ? ordered[Math.floor(ordered.length / 2)] : 0;
};

/** Multi-point consensus rejects foreground motion; estimates translation ONLY. */
export function estimateCameraTranslation(previous: GrayFrame, current: GrayFrame) {
  const candidates: { dx: number; dy: number; confidence: number }[] = [];
  for (let gy = 1; gy <= 3; gy++) {
    for (let gx = 1; gx <= 4; gx++) {
      const x = Math.round(gx / 5 * previous.width);
      const y = Math.round(gy / 4 * previous.height);
      const found = matchPatch(previous, current, x, y, x, y, 6, 14);
      if (found.confidence >= 0.72) {
        candidates.push({ dx: found.x - x, dy: found.y - y, confidence: found.confidence });
      }
    }
  }
  if (candidates.length < 3) return { dx: 0, dy: 0, confidence: 0 };
  const dx = median(candidates.map((p) => p.dx));
  const dy = median(candidates.map((p) => p.dy));
  const inliers = candidates.filter((p) => Math.hypot(p.dx - dx, p.dy - dy) <= 2.5);
  if (inliers.length < 3) return { dx: 0, dy: 0, confidence: 0 };
  return {
    dx: inliers.reduce((s, p) => s + p.dx, 0) / inliers.length,
    dy: inliers.reduce((s, p) => s + p.dy, 0) / inliers.length,
    confidence: inliers.reduce((s, p) => s + p.confidence, 0) / inliers.length,
  };
}

export function sampleMotion(analysis: MotionAnalysis | undefined, time: number): MotionSample {
  const fallback: MotionSample = { time, x: 0, y: 0, confidence: 0 };
  if (!analysis?.samples.length) return fallback;
  const samples = analysis.samples;
  if (time <= samples[0].time) return samples[0];
  if (time >= samples[samples.length - 1].time) return samples[samples.length - 1];
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].time <= time) lo = mid; else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const t = (time - a.time) / Math.max(1e-8, b.time - a.time);
  return { time, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, confidence: Math.min(a.confidence, b.confidence) };
}

/** Subtract the measured high-frequency trajectory while preserving a smooth pan. */
export function stabilizationOffset(analysis: MotionAnalysis, time: number, smoothing: number, strength: number) {
  const raw = sampleMotion(analysis, time);
  const window = Math.max(0.05, smoothing);
  let sum = 0;
  let x = 0;
  let y = 0;
  for (const s of analysis.samples) {
    const distance = Math.abs(s.time - time);
    if (distance > window) continue;
    const weight = 1 - distance / (window + 1e-6);
    sum += weight;
    x += s.x * weight;
    y += s.y * weight;
  }
  const factor = Math.max(0, Math.min(1, strength / 100));
  if (factor === 0) return { x: 0, y: 0 };
  return { x: (sum ? x / sum - raw.x : 0) * factor, y: (sum ? y / sum - raw.y : 0) * factor };
}