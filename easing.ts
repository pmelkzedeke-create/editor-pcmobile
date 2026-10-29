import type { CurveHandle, EasingName, PropertyKeyframe } from '../types/editor';

export interface EasingPresetMeta {
  id: EasingName;
  label: string;
  outHandle: CurveHandle;
  inHandle: CurveHandle;
}

export const DEFAULT_OUT_HANDLE: CurveHandle = { x: 0.33, y: 0 };
export const DEFAULT_IN_HANDLE: CurveHandle = { x: 0.33, y: 0 };

export const EASING_PRESETS: EasingPresetMeta[] = [
  { id: 'linear', label: 'Linear', outHandle: { x: 0.33, y: 0.33 }, inHandle: { x: 0.33, y: 0.33 } },
  { id: 'smooth', label: 'Smooth', outHandle: { x: 0.42, y: 0 }, inHandle: { x: 0.42, y: 0 } },
  { id: 'ease-in', label: 'Ease In', outHandle: { x: 0.48, y: 0 }, inHandle: { x: 0.1, y: 0.1 } },
  { id: 'ease-out', label: 'Ease Out', outHandle: { x: 0.1, y: 0.1 }, inHandle: { x: 0.48, y: 0 } },
  { id: 'ease-in-out', label: 'Easy Ease', outHandle: { x: 0.42, y: 0 }, inHandle: { x: 0.42, y: 0 } },
  { id: 'power', label: 'Power (Quart)', outHandle: { x: 0.76, y: 0 }, inHandle: { x: 0.76, y: 0 } },
  { id: 'expo', label: 'Expo', outHandle: { x: 0.87, y: 0 }, inHandle: { x: 0.87, y: 0 } },
  { id: 'circ', label: 'Circ', outHandle: { x: 0.85, y: 0.15 }, inHandle: { x: 0.85, y: 0.15 } },
  { id: 'back', label: 'Back', outHandle: { x: 0.36, y: -0.35 }, inHandle: { x: 0.36, y: -0.35 } },
  { id: 'overshoot', label: 'Overshoot', outHandle: { x: 0.2, y: 0.2 }, inHandle: { x: 0.34, y: -0.42 } },
  { id: 'elastic', label: 'Elastic', outHandle: { x: 0.2, y: 0.2 }, inHandle: { x: 0.5, y: -0.5 } },
  { id: 'bounce', label: 'Bounce', outHandle: { x: 0.2, y: 0.2 }, inHandle: { x: 0.4, y: 0 } },
  { id: 'spring', label: 'Spring', outHandle: { x: 0.15, y: 0.3 }, inHandle: { x: 0.45, y: -0.3 } },
  { id: 'cinematic', label: 'Cinematic', outHandle: { x: 0.65, y: 0 }, inHandle: { x: 0.85, y: 0 } },
  { id: 'hold', label: 'Hold (Degrau)', outHandle: { x: 0.33, y: 0 }, inHandle: { x: 0.33, y: 0 } },
  { id: 'bezier', label: 'Custom Bézier', outHandle: { x: 0.35, y: 0 }, inHandle: { x: 0.35, y: 0 } },
];

export interface SavedCurvePreset {
  id: string;
  name: string;
  favorite: boolean;
  outHandle: CurveHandle;
  inHandle: CurveHandle;
}

const bounceOut = (t: number): number => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const u = t - 1.5 / d1;
    return n1 * u * u + 0.75;
  }
  if (t < 2.5 / d1) {
    const u = t - 2.25 / d1;
    return n1 * u * u + 0.9375;
  }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
};

const cubicScalar = (a: number, b: number, c: number, d: number, u: number): number => {
  const r = 1 - u;
  return r * r * r * a + 3 * r * r * u * b + 3 * r * u * u * c + u * u * u * d;
};

export function solveCubicBezierProgress(outH: CurveHandle, inH: CurveHandle, progress: number): number {
  const x = Math.max(0, Math.min(1, progress));
  const x1 = Math.max(0.001, Math.min(0.999, outH.x));
  const y1 = outH.y;
  const x2 = Math.max(0.001, Math.min(0.999, 1 - inH.x));
  const y2 = 1 - inH.y;

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) * 0.5;
    if (cubicScalar(0, x1, x2, 1, mid) < x) lo = mid;
    else hi = mid;
  }
  return cubicScalar(0, y1, y2, 1, (lo + hi) * 0.5);
}

/**
 * Mathematically evaluates normalized progress p in [0, 1] using named easing or custom Bézier handles.
 */
export function evaluateEasing(
  easing: EasingName,
  rawProgress: number,
  outHandle?: CurveHandle,
  inHandle?: CurveHandle
): number {
  const t = Math.max(0, Math.min(1, rawProgress));
  if (t <= 0) return 0;
  if (easing === 'hold') return t >= 1 ? 1 : 0;
  if (t >= 1) return 1;

  switch (easing) {
    case 'linear':
      return t;
    case 'smooth':
      return t * t * (3 - 2 * t);
    case 'ease-in':
      return t * t * t;
    case 'ease-out':
      return 1 - Math.pow(1 - t, 3);
    case 'ease-in-out':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'power':
      return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
    case 'expo':
      return t < 0.5
        ? Math.pow(2, 20 * t - 10) / 2
        : (2 - Math.pow(2, -20 * t + 10)) / 2;
    case 'circ':
      return t < 0.5
        ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
        : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;
    case 'back': {
      const c1 = 1.70158;
      const c2 = c1 * 1.525;
      return t < 0.5
        ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
        : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
    }
    case 'overshoot': {
      const c1 = 2.1;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    case 'elastic': {
      const c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }
    case 'bounce':
      return bounceOut(t);
    case 'spring':
      return 1 - Math.exp(-6.5 * t) * Math.cos(11 * t);
    case 'cinematic':
      return solveCubicBezierProgress({ x: 0.65, y: 0 }, { x: 0.85, y: 0 }, t);
    case 'bezier':
    default:
      return solveCubicBezierProgress(
        outHandle || DEFAULT_OUT_HANDLE,
        inHandle || DEFAULT_IN_HANDLE,
        t
      );
  }
}

export function invertCurveValues(keys: PropertyKeyframe[]): PropertyKeyframe[] {
  if (keys.length < 2) return keys;
  const minV = Math.min(...keys.map((k) => k.value));
  const maxV = Math.max(...keys.map((k) => k.value));
  return keys.map((k) => ({ ...k, value: Number((maxV - (k.value - minV)).toFixed(4)) }));
}

export function mirrorCurveTiming(keys: PropertyKeyframe[]): PropertyKeyframe[] {
  if (keys.length < 2) return keys;
  const t0 = keys[0].time;
  const tEnd = keys[keys.length - 1].time;
  return [...keys]
    .reverse()
    .map((k) => ({
      ...k,
      time: Number((t0 + (tEnd - k.time)).toFixed(4)),
      outHandle: k.inHandle ? { ...k.inHandle } : undefined,
      inHandle: k.outHandle ? { ...k.outHandle } : undefined,
    }));
}

export function smoothCurveKeyframes(keys: PropertyKeyframe[], selectedIds?: Set<string>): PropertyKeyframe[] {
  return keys.map((k) => {
    if (selectedIds && selectedIds.size > 0 && !selectedIds.has(k.id)) return k;
    return {
      ...k,
      easing: 'bezier',
      outHandle: { x: 0.38, y: 0 },
      inHandle: { x: 0.38, y: 0 },
    };
  });
}

export function scaleCurveIntensity(keys: PropertyKeyframe[], factor: number): PropertyKeyframe[] {
  if (keys.length === 0) return keys;
  const anchor = keys[0].value;
  return keys.map((k) => ({
    ...k,
    value: Number((anchor + (k.value - anchor) * factor).toFixed(4)),
  }));
}
