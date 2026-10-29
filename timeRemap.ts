import type { RemapHandle, TimeRemap, TimeRemapKeyframe, TimelineClip } from '../types/editor';

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const DEFAULT_REMAP_HANDLE: RemapHandle = { x: 1 / 3, y: 0 };
const keyId = () => `kf-${Math.random().toString(36).slice(2, 10)}`;

type Point = { x: number; y: number };
type Curve = [Point, Point, Point, Point];
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const cubic = (a: number, b: number, c: number, d: number, t: number) => {
  const r = 1 - t;
  return r * r * r * a + 3 * r * r * t * b + 3 * r * t * t * c + t * t * t * d;
};

export function segmentCurve(a: TimeRemapKeyframe, b: TimeRemapKeyframe): Curve {
  const dt = b.time - a.time;
  const ds = b.sourceTime - a.sourceTime;
  const out = a.outHandle || DEFAULT_REMAP_HANDLE;
  const incoming = b.inHandle || DEFAULT_REMAP_HANDLE;
  return [
    { x: a.time, y: a.sourceTime },
    { x: a.time + dt * out.x, y: a.sourceTime + ds * out.y },
    { x: b.time - dt * incoming.x, y: b.sourceTime - ds * incoming.y },
    { x: b.time, y: b.sourceTime },
  ];
}

function parameterAtTime(curve: Curve, time: number) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(curve[0].x, curve[1].x, curve[2].x, curve[3].x, mid) < time) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function evaluateRemap(remap: TimeRemap, localTime: number): number {
  const keys = remap.keyframes;
  if (!keys.length) return remap.sourceStart;
  if (localTime <= keys[0].time) return keys[0].sourceTime;
  if (localTime >= keys[keys.length - 1].time) return keys[keys.length - 1].sourceTime;
  const index = keys.findIndex((_, i) => i < keys.length - 1 && localTime < keys[i + 1].time);
  const a = keys[Math.max(0, index)];
  const b = keys[Math.max(0, index) + 1];
  if (a.interpolation === 'hold') return a.sourceTime;
  if (a.interpolation === 'linear') {
    return a.sourceTime + (b.sourceTime - a.sourceTime) * ((localTime - a.time) / (b.time - a.time));
  }
  const curve = segmentCurve(a, b);
  return cubic(curve[0].y, curve[1].y, curve[2].y, curve[3].y, parameterAtTime(curve, localTime));
}

export function getClipSourceTime(clip: TimelineClip, localTime: number): number {
  const time = clip.timeRemap?.enabled
    ? evaluateRemap(clip.timeRemap, clamp(localTime, 0, clip.duration))
    : clip.trimStart + clamp(localTime, 0, clip.duration) * clip.speed;
  return clamp(time, 0, clip.maxDuration);
}

export function getClipPlaybackRate(clip: TimelineClip, localTime: number): number {
  if (!clip.timeRemap?.enabled) return clip.speed;
  const a = clamp(localTime - 0.001, 0, clip.duration);
  const b = clamp(localTime + 0.001, 0, clip.duration);
  return b > a ? (getClipSourceTime(clip, b) - getClipSourceTime(clip, a)) / (b - a) : 0;
}

export function createTimeRemap(clip: TimelineClip): TimeRemap {
  const sourceStart = clip.trimStart;
  const sourceEnd = Math.min(clip.maxDuration, sourceStart + clip.duration * clip.speed);
  return {
    enabled: true,
    sourceStart,
    sourceEnd,
    keyframes: [
      { id: keyId(), time: 0, sourceTime: sourceStart, interpolation: 'linear' },
      { id: keyId(), time: clip.duration, sourceTime: sourceEnd, interpolation: 'linear' },
    ],
  };
}

export type RemapPreset = 'normal' | 'ramp' | 'slow' | 'reverse' | 'freeze';

export function createRemapPreset(clip: TimelineClip, preset: RemapPreset, localTime: number): TimeRemap {
  const base = clip.timeRemap || createTimeRemap(clip);
  const start = base.sourceStart;
  const span = Math.max(0, base.sourceEnd - start);
  let points: [number, number][] = [[0, 0], [1, 1]];
  if (preset === 'ramp') points = [[0, 0], [0.23, 0.38], [0.77, 0.62], [1, 1]];
  if (preset === 'slow') points = [[0, 0], [1, 0.25]];
  if (preset === 'reverse') points = [[0, 1], [1, 0]];
  if (preset === 'freeze') {
    const value = span > 0 ? (getClipSourceTime(clip, localTime) - start) / span : 0;
    points = [[0, value], [1, value]];
  }
  return {
    ...base,
    enabled: true,
    keyframes: points.map(([time, source]) => ({
      id: keyId(), time: time * clip.duration, sourceTime: start + source * span,
      interpolation: preset === 'ramp' ? 'bezier' : preset === 'freeze' ? 'hold' : 'linear',
    })),
  };
}

const splitCurve = (c: Curve, t: number): [Curve, Curve] => {
  const ab = mix(c[0], c[1], t);
  const bc = mix(c[1], c[2], t);
  const cd = mix(c[2], c[3], t);
  const abc = mix(ab, bc, t);
  const bcd = mix(bc, cd, t);
  const point = mix(abc, bcd, t);
  return [[c[0], ab, abc, point], [point, bcd, cd, c[3]]];
};

// Split the actual Bezier curve, not just its endpoints, so trims preserve timing.
export function sliceTimeRemap(clip: TimelineClip, from: number, to: number): TimeRemap | undefined {
  const remap = clip.timeRemap;
  if (!remap) return undefined;
  const keys = remap.keyframes;
  const result: TimeRemapKeyframe[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    const left = Math.max(from, a.time);
    const right = Math.min(to, b.time);
    if (right <= left) continue;
    const first: TimeRemapKeyframe = {
      ...a, id: keyId(), time: left - from, sourceTime: evaluateRemap(remap, left),
    };
    const last: TimeRemapKeyframe = {
      ...b, id: keyId(), time: right - from, sourceTime: evaluateRemap(remap, right),
    };
    if (a.interpolation === 'bezier') {
      const curve = segmentCurve(a, b);
      const u0 = parameterAtTime(curve, left);
      const u1 = parameterAtTime(curve, right);
      const head = splitCurve(curve, u1)[0];
      const sub = splitCurve(head, u1 > 0 ? u0 / u1 : 0)[1];
      const dt = right - left;
      const ds = last.sourceTime - first.sourceTime;
      first.outHandle = { x: (sub[1].x - left) / dt, y: Math.abs(ds) > 1e-8 ? (sub[1].y - first.sourceTime) / ds : 0 };
      last.inHandle = { x: (right - sub[2].x) / dt, y: Math.abs(ds) > 1e-8 ? (last.sourceTime - sub[2].y) / ds : 0 };
    }
    if (result.length) Object.assign(result[result.length - 1], { interpolation: first.interpolation, outHandle: first.outHandle });
    else result.push(first);
    result.push(last);
  }
  if (!result.length) {
    result.push({ id: keyId(), time: 0, sourceTime: evaluateRemap(remap, from), interpolation: 'hold' });
  }
  if (result[0].time > 0) result.unshift({ id: keyId(), time: 0, sourceTime: evaluateRemap(remap, from), interpolation: 'hold' });
  if (result[result.length - 1].time < to - from) {
    result.push({ id: keyId(), time: to - from, sourceTime: evaluateRemap(remap, to), interpolation: 'hold' });
  }
  return { ...remap, keyframes: result };
}

export function insertRemapKeyframe(clip: TimelineClip, localTime: number, fps: number): TimeRemap {
  const remap = clip.timeRemap || createTimeRemap(clip);
  const time = clamp(Math.round(localTime * fps) / fps, 0, clip.duration);
  if (remap.keyframes.some((k) => Math.abs(k.time - time) < 0.5 / fps)) return remap;
  // Exact curve subdivision makes adding a keyframe a non-destructive operation.
  const a = sliceTimeRemap({ ...clip, timeRemap: remap }, 0, time)!;
  const b = sliceTimeRemap({ ...clip, timeRemap: remap }, time, clip.duration)!;
  const seam = { ...a.keyframes[a.keyframes.length - 1], interpolation: b.keyframes[0].interpolation, outHandle: b.keyframes[0].outHandle };
  return { ...remap, enabled: true, keyframes: [...a.keyframes.slice(0, -1), seam, ...b.keyframes.slice(1).map((k) => ({ ...k, time: k.time + time }))] };
}