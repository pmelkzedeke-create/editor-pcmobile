import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MotionAnalysis, TimelineClip } from '../src/types/editor';
import { estimateCameraTranslation, matchPatch, sampleMotion, stabilizationOffset } from '../src/core/vision/motion';
import { clonePatchPixels, removeBackgroundPixels } from '../src/core/vision/pixels';
import { cleanupRectAtTime } from '../src/core/vision/sourceEffects';
import { PreviewFrameCache } from '../src/utils/previewCache';
import { setWebmDuration } from '../src/utils/webmDuration';

function texture(dx = 0, dy = 0) {
  const w = 128;
  const h = 96;
  const pixels = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = Math.sin((x - dx) * 12.9898 + (y - dy) * 78.233) * 43758.5453;
      pixels[y * w + x] = Math.floor((n - Math.floor(n)) * 255);
    }
  }
  return { width: w, height: h, pixels };
}

test('point tracker measures actual translation and rejects textureless patches', () => {
  const ref = texture();
  const frame = texture(7, -4);
  const point = matchPatch(ref, frame, 64, 48, 64, 48, 6, 16);
  assert.equal(point.x, 71);
  assert.equal(point.y, 44);
  assert.ok(point.confidence > 0.99);
  const flat = { ...ref, pixels: new Float32Array(128 * 96).fill(100) };
  assert.equal(matchPatch(flat, flat, 50, 50, 50, 50).confidence, 0);
});

test('global camera estimator measures translation by multi-point consensus', () => {
  const camera = estimateCameraTranslation(texture(), texture(-5, 3));
  assert.ok(Math.abs(camera.dx + 5) < 0.05, `dx=${camera.dx}`);
  assert.ok(Math.abs(camera.dy - 3) < 0.05, `dy=${camera.dy}`);
  assert.ok(camera.confidence > 0.99);
});

function motion(): MotionAnalysis {
  return {
    kind: 'camera', mediaId: 'source', sourceWidth: 256, sourceHeight: 144,
    start: 0, end: 2, sampleRate: 15,
    samples: Array.from({ length: 31 }, (_, i) => ({ time: i / 15, x: (i % 2 ? 6 : -6) / 256 + i * 0.001, y: 0, confidence: 1 })),
  };
}

test('stabilization removes measured high-frequency shake without removing a pan', () => {
  const analysis = motion();
  let before = 0;
  let after = 0;
  for (let i = 4; i < 26; i++) {
    const time = i / 15;
    const raw = sampleMotion(analysis, time);
    const correction = stabilizationOffset(analysis, time, 0.4, 100);
    const next = sampleMotion(analysis, (i + 1) / 15);
    const nextCorrection = stabilizationOffset(analysis, (i + 1) / 15, 0.4, 100);
    before += (next.x - raw.x) ** 2;
    after += (next.x + nextCorrection.x - raw.x - correction.x) ** 2;
  }
  assert.ok(after < before * 0.15, `${after} vs ${before}`);
  assert.equal(stabilizationOffset(analysis, 1, 0.4, 0).x, 0);
  const early = sampleMotion(analysis, 0.4);
  const late = sampleMotion(analysis, 1.6);
  assert.ok(late.x + stabilizationOffset(analysis, 1.6, 0.4, 100).x > early.x + stabilizationOffset(analysis, 0.4, 0.4, 100).x);
});

test('motion sampling is deterministic, source-time based and clamps to analyzed endpoints', () => {
  const analysis = motion();
  assert.deepEqual(sampleMotion(analysis, -10), analysis.samples[0]);
  assert.deepEqual(sampleMotion(analysis, 20), analysis.samples[30]);
  assert.deepEqual(sampleMotion(analysis, 0.7), sampleMotion(analysis, 0.7));
  assert.ok(Number.isFinite(sampleMotion(analysis, 0.731).x));
});

test('auto border removal produces real alpha and preserves enclosed foreground colors', () => {
  const w = 40;
  const h = 30;
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 8; y < 23; y++) for (let x = 12; x < 29; x++) {
    const i = (y * w + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 20;
  }
  const whiteIsland = (15 * w + 20) * 4;
  d[whiteIsland] = d[whiteIsland + 1] = d[whiteIsland + 2] = 255;
  removeBackgroundPixels(d, w, h, { enabled: true, tolerance: 30, softness: 15, color: null, connected: true });
  assert.equal(d[3], 0, 'background truly becomes transparent');
  assert.equal(d[(10 * w + 15) * 4 + 3], 255, 'subject remains');
  assert.equal(d[whiteIsland + 3], 255, 'same-color detail inside the subject is preserved');
});

test('object clone replaces only selected pixels with neighboring texture', () => {
  const w = 60;
  const h = 40;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) { d[p * 4] = 20; d[p * 4 + 1] = 100; d[p * 4 + 2] = 180; d[p * 4 + 3] = 255; }
  for (let y = 10; y < 20; y++) for (let x = 12; x < 24; x++) { const i = (y * w + x) * 4; d[i] = 240; d[i + 1] = 0; d[i + 2] = 0; }
  clonePatchPixels(d, w, h, { x: 0.2, y: 0.25, width: 0.2, height: 0.25 }, 0.35, 0, 0);
  assert.equal(d[(15 * w + 18) * 4], 20);
  assert.equal(d[(15 * w + 18) * 4 + 2], 180);
  assert.equal(d[(2 * w + 2) * 4 + 1], 100, 'unrelated area untouched');
});

test('cleanup follows the measured source trajectory relative to the selection reference time', () => {
  const track: MotionAnalysis = { ...motion(), kind: 'point', samples: [{ time: 0, x: 0.2, y: 0.3, confidence: 1 }, { time: 1, x: 0.5, y: 0.4, confidence: 1 }] };
  const clip = { vfx: { tracking: track, cleanup: { enabled: true, rect: { x: 0.3, y: 0.3, width: 0.2, height: 0.1 }, mode: 'clone', sourceOffsetX: 0.3, sourceOffsetY: 0, feather: 10, followTrack: true, referenceTime: 0.5 } } } as TimelineClip;
  const rect = cleanupRectAtTime(clip, 1)!;
  assert.ok(Math.abs(rect.x - 0.45) < 0.0001);
  assert.ok(Math.abs(rect.y - 0.35) < 0.0001);
});

test('automatic RAM cache evicts distant frames and never exceeds its frame budget', () => {
  const cache = new PreviewFrameCache(30, 160, 90);
  for (let i = 0; i < 720; i++) cache.storeAutomatic(i, new Blob(['frame']), [], i);
  assert.equal(cache.frames.size, 600);
  assert.ok(cache.has(719 / 30));
  assert.equal(cache.has(0), false);
  assert.equal(cache.bytes, 600 * 5);
  cache.clear();
  assert.equal(cache.bytes, 0);
});

test('WebM duration correction includes the final frame without changing the media payload', () => {
  // Minimal EBML Segment > Info > TimestampScale + existing float64 Duration.
  const bytes = new Uint8Array([
    0x18, 0x53, 0x80, 0x67, 0x97,
    0x15, 0x49, 0xa9, 0x66, 0x92,
    0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40,
    0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  assert.equal(setWebmDuration(bytes.buffer, 1.93), true);
  assert.equal(new DataView(bytes.buffer).getFloat64(20, false), 1930);
  assert.equal(bytes[0], 0x18);
  assert.equal(setWebmDuration(new ArrayBuffer(4), 2), false);
});