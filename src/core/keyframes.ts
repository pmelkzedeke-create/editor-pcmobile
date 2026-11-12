import type {
  AnimatableProperty,
  EasingName,
  PropertyKeyframe,
  PropertyTrack,
  TimelineClip,
} from '../types/editor';
import { DEFAULT_IN_HANDLE, DEFAULT_OUT_HANDLE, evaluateEasing } from './easing';
import { evaluateMotionBehaviorDelta, evaluateSafeExpression } from './expressions';

export interface AnimatablePropertyMeta {
  key: AnimatableProperty;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  group: 'transform' | 'shape' | 'mask' | 'text';
}

export const ANIMATABLE_PROPERTIES: AnimatablePropertyMeta[] = [
  { key: 'x', label: 'Posição X', unit: '%', min: -120, max: 120, step: 0.5, group: 'transform' },
  { key: 'y', label: 'Posição Y', unit: '%', min: -120, max: 120, step: 0.5, group: 'transform' },
  { key: 'z', label: 'Profundidade Z', unit: 'px', min: -1200, max: 1200, step: 5, group: 'transform' },
  { key: 'anchorX', label: 'Âncora X', unit: '%', min: -100, max: 100, step: 0.5, group: 'transform' },
  { key: 'anchorY', label: 'Âncora Y', unit: '%', min: -100, max: 100, step: 0.5, group: 'transform' },
  { key: 'scale', label: 'Escala Uniforme', unit: '%', min: 0, max: 300, step: 1, group: 'transform' },
  { key: 'scaleX', label: 'Escala X', unit: '%', min: 0, max: 300, step: 1, group: 'transform' },
  { key: 'scaleY', label: 'Escala Y', unit: '%', min: 0, max: 300, step: 1, group: 'transform' },
  { key: 'scaleZ', label: 'Escala Z 3D', unit: '%', min: 0, max: 300, step: 1, group: 'transform' },
  { key: 'rotation', label: 'Rotação 2D (Z)', unit: '°', min: -720, max: 720, step: 1, group: 'transform' },
  { key: 'rotationX', label: 'Rotação 3D X', unit: '°', min: -360, max: 360, step: 1, group: 'transform' },
  { key: 'rotationY', label: 'Rotação 3D Y', unit: '°', min: -360, max: 360, step: 1, group: 'transform' },
  { key: 'rotationZ', label: 'Rotação 3D Z', unit: '°', min: -360, max: 360, step: 1, group: 'transform' },
  { key: 'opacity', label: 'Opacidade', unit: '%', min: 0, max: 100, step: 1, group: 'transform' },
  { key: 'skew', label: 'Inclinação (Skew)', unit: '°', min: -60, max: 60, step: 0.5, group: 'transform' },
  { key: 'trimStartPct', label: 'Trim Start', unit: '%', min: 0, max: 100, step: 1, group: 'shape' },
  { key: 'trimEndPct', label: 'Trim End', unit: '%', min: 0, max: 100, step: 1, group: 'shape' },
  { key: 'strokeWidth', label: 'Espessura Traço', unit: 'px', min: 0, max: 40, step: 0.5, group: 'shape' },
  { key: 'strokeDashOffset', label: 'Deslocamento Tracejado', unit: 'px', min: -500, max: 500, step: 1, group: 'shape' },
  { key: 'maskFeather', label: 'Feather Máscara', unit: 'px', min: 0, max: 120, step: 1, group: 'mask' },
  { key: 'maskExpansion', label: 'Expansão Máscara', unit: 'px', min: -80, max: 80, step: 1, group: 'mask' },
  { key: 'letterSpacing', label: 'Tracking Texto', unit: 'px', min: -10, max: 40, step: 0.5, group: 'text' },
  { key: 'cameraFov', label: 'FOV Câmera', unit: '°', min: 15, max: 120, step: 1, group: 'transform' },
  { key: 'cameraFocus', label: 'Foco Câmera', unit: 'px', min: 50, max: 2000, step: 10, group: 'transform' },
  { key: 'cameraAperture', label: 'Abertura Câmera (DOF)', unit: '', min: 0, max: 50, step: 0.5, group: 'transform' },
  { key: 'lightIntensity', label: 'Intensidade Luz 3D', unit: '', min: 0, max: 10, step: 0.1, group: 'transform' },
  { key: 'lightDistance', label: 'Alcance Luz 3D', unit: 'px', min: 50, max: 2500, step: 10, group: 'transform' },
  { key: 'dropShadowDistance', label: 'Distância Sombra', unit: 'px', min: 0, max: 100, step: 1, group: 'transform' },
  { key: 'dropShadowBlur', label: 'Desfoque Sombra', unit: 'px', min: 0, max: 100, step: 1, group: 'transform' },
  { key: 'dropShadowOpacity', label: 'Opacidade Sombra', unit: '%', min: 0, max: 100, step: 1, group: 'transform' },
  { key: 'volume', label: 'Volume de Áudio', unit: '%', min: 0, max: 200, step: 1, group: 'transform' },
];

export const ANIMATABLE_PROP_MAP = new Map(ANIMATABLE_PROPERTIES.map((p) => [p.key, p]));

const kfId = () => `pkf-${Math.random().toString(36).slice(2, 9)}`;

export function getClipBasePropertyValue(clip: TimelineClip, prop: AnimatableProperty): number {
  switch (prop) {
    case 'x':
      return clip.x;
    case 'y':
      return clip.y;
    case 'z':
      return clip.z ?? 0;
    case 'anchorX':
      return clip.anchorX ?? 0;
    case 'anchorY':
      return clip.anchorY ?? 0;
    case 'scale':
      return clip.scale;
    case 'scaleX':
      return clip.unlinkScale ? (clip.scaleX ?? clip.scale) : clip.scale;
    case 'scaleY':
      return clip.unlinkScale ? (clip.scaleY ?? clip.scale) : clip.scale;
    case 'scaleZ':
      return clip.scaleZ ?? clip.scale;
    case 'rotation':
      return clip.rotation;
    case 'rotationX':
      return clip.rotationX ?? 0;
    case 'rotationY':
      return clip.rotationY ?? 0;
    case 'rotationZ':
      return clip.rotationZ ?? clip.rotation;
    case 'opacity':
      return clip.opacity;
    case 'skew':
      return clip.skew ?? 0;
    case 'trimStartPct':
      return clip.shapeData?.trimStart ?? 0;
    case 'trimEndPct':
      return clip.shapeData?.trimEnd ?? 100;
    case 'strokeWidth':
      return clip.shapeData?.strokeWidth ?? 3;
    case 'strokeDashOffset':
      return clip.shapeData?.strokeDashOffset ?? 0;
    case 'maskFeather':
      return clip.masks?.[0]?.feather ?? 0;
    case 'maskExpansion':
      return clip.masks?.[0]?.expansion ?? 0;
    case 'letterSpacing':
      return clip.textStyle?.letterSpacing ?? 0;
    case 'cameraFov':
      return clip.cameraData?.fov ?? 50;
    case 'cameraFocus':
      return clip.cameraData?.focusDistance ?? 600;
    case 'cameraAperture':
      return clip.cameraData?.aperture ?? 0;
    case 'lightIntensity':
      return clip.lightData?.intensity ?? 1.5;
    case 'lightDistance':
      return clip.lightData?.distance ?? 800;
    case 'dropShadowDistance':
      return clip.dropShadow?.distance ?? 15;
    case 'dropShadowBlur':
      return clip.dropShadow?.blur ?? 12;
    case 'dropShadowOpacity':
      return clip.dropShadow?.opacity ?? 60;
    case 'volume':
      return clip.volume ?? 100;
  }
}

export function applyBasePropertyPatch(clip: TimelineClip, prop: AnimatableProperty, val: number): Partial<TimelineClip> {
  switch (prop) {
    case 'x':
      return { x: val };
    case 'y':
      return { y: val };
    case 'z':
      return { z: val };
    case 'anchorX':
      return { anchorX: val };
    case 'anchorY':
      return { anchorY: val };
    case 'scale':
      return clip.unlinkScale ? { scale: val } : { scale: val, scaleX: val, scaleY: val, scaleZ: val };
    case 'scaleX':
      return { unlinkScale: true, scaleX: val, scaleY: clip.scaleY ?? clip.scale };
    case 'scaleY':
      return { unlinkScale: true, scaleY: val, scaleX: clip.scaleX ?? clip.scale };
    case 'scaleZ':
      return { scaleZ: val };
    case 'rotation':
      return { rotation: val };
    case 'rotationX':
      return { rotationX: val };
    case 'rotationY':
      return { rotationY: val };
    case 'rotationZ':
      return { rotationZ: val };
    case 'opacity':
      return { opacity: Math.max(0, Math.min(100, val)) };
    case 'skew':
      return { skew: val };
    case 'trimStartPct':
      return clip.shapeData ? { shapeData: { ...clip.shapeData, trimStart: val } } : {};
    case 'trimEndPct':
      return clip.shapeData ? { shapeData: { ...clip.shapeData, trimEnd: val } } : {};
    case 'strokeWidth':
      return clip.shapeData ? { shapeData: { ...clip.shapeData, strokeWidth: val } } : {};
    case 'strokeDashOffset':
      return clip.shapeData ? { shapeData: { ...clip.shapeData, strokeDashOffset: val } } : {};
    case 'maskFeather':
      return clip.masks?.length
        ? { masks: clip.masks.map((m, i) => (i === 0 ? { ...m, feather: val } : m)) }
        : {};
    case 'maskExpansion':
      return clip.masks?.length
        ? { masks: clip.masks.map((m, i) => (i === 0 ? { ...m, expansion: val } : m)) }
        : {};
    case 'letterSpacing':
      return clip.textStyle ? { textStyle: { ...clip.textStyle, letterSpacing: val } } : {};
    case 'cameraFov':
      return clip.cameraData ? { cameraData: { ...clip.cameraData, fov: val } } : {};
    case 'cameraFocus':
      return clip.cameraData ? { cameraData: { ...clip.cameraData, focusDistance: val } } : {};
    case 'cameraAperture':
      return clip.cameraData ? { cameraData: { ...clip.cameraData, aperture: val } } : {};
    case 'lightIntensity':
      return clip.lightData ? { lightData: { ...clip.lightData, intensity: val } } : {};
    case 'lightDistance':
      return clip.lightData ? { lightData: { ...clip.lightData, distance: val } } : {};
    case 'dropShadowDistance':
      return clip.dropShadow ? { dropShadow: { ...clip.dropShadow, distance: val } } : {};
    case 'dropShadowBlur':
      return clip.dropShadow ? { dropShadow: { ...clip.dropShadow, blur: val } } : {};
    case 'dropShadowOpacity':
      return clip.dropShadow ? { dropShadow: { ...clip.dropShadow, opacity: val } } : {};
    case 'volume':
      return { volume: Math.max(0, Math.min(200, val)) };
  }
}

export function sortPropertyKeyframes(keys: PropertyKeyframe[]): PropertyKeyframe[] {
  return [...keys].sort((a, b) => a.time - b.time);
}

/**
 * Evaluates a single PropertyTrack at localTime with support for cycle, pingpong, and offset loops.
 */
export function evaluatePropertyTrack(
  track: PropertyTrack | undefined,
  localTime: number,
  fallbackValue: number
): number {
  if (!track || track.keyframes.length === 0) return fallbackValue;
  const keys = sortPropertyKeyframes(track.keyframes);
  if (keys.length === 1) return keys[0].value;

  const first = keys[0];
  const last = keys[keys.length - 1];
  const span = last.time - first.time;

  let t = localTime;
  let valueOffset = 0;

  if (span > 1e-5 && t > last.time && track.loop && track.loop !== 'none') {
    const elapsed = t - first.time;
    const cycleIndex = Math.floor(elapsed / span);
    const rem = elapsed - cycleIndex * span;
    if (track.loop === 'cycle') {
      t = first.time + rem;
    } else if (track.loop === 'pingpong') {
      t = cycleIndex % 2 === 0 ? first.time + rem : last.time - rem;
    } else if (track.loop === 'offset') {
      t = first.time + rem;
      valueOffset = cycleIndex * (last.value - first.value);
    }
  }

  if (t <= first.time) return first.value + valueOffset;
  if (t >= last.time) return last.value + valueOffset;

  let idx = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].time && t < keys[i + 1].time) {
      idx = i;
      break;
    }
  }
  const a = keys[idx];
  const b = keys[idx + 1];
  const dt = Math.max(1e-6, b.time - a.time);
  const rawP = (t - a.time) / dt;
  const easedP = evaluateEasing(a.easing, rawP, a.outHandle, b.inHandle);
  return a.value + (b.value - a.value) * easedP + valueOffset;
}

export function getPropertyVelocity(
  track: PropertyTrack | undefined,
  localTime: number,
  fallbackValue: number
): number {
  if (!track || track.keyframes.length < 2) return 0;
  const eps = 0.005;
  const v0 = evaluatePropertyTrack(track, Math.max(0, localTime - eps), fallbackValue);
  const v1 = evaluatePropertyTrack(track, localTime + eps, fallbackValue);
  return (v1 - v0) / (2 * eps);
}

export interface ResolvedClipAnimation {
  x: number;
  y: number;
  z: number;
  anchorX: number;
  anchorY: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotation: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  opacity: number;
  skew: number;
  trimStartPct: number;
  trimEndPct: number;
  strokeWidth: number;
  strokeDashOffset: number;
  maskFeather: number;
  maskExpansion: number;
  letterSpacing: number;
  cameraFov: number;
  cameraFocus: number;
  cameraAperture: number;
  lightIntensity: number;
  lightDistance: number;
  dropShadowDistance: number;
  dropShadowBlur: number;
  dropShadowOpacity: number;
  volume: number;
}

export function evaluateClipVolume(clip: TimelineClip, localTime: number): number {
  const track = clip.keyframes?.find((t) => t.property === 'volume');
  const raw = evaluatePropertyTrack(track, localTime, clip.volume ?? 100);
  return Math.max(0, Math.min(200, raw));
}

function hashSeed(id: string): number {
  let h = 1;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return h;
}

/**
 * Single authoritative animation resolver shared by Live Canvas, RAM Cache, Graph Editor, and Video Export.
 */
export function resolveClipAnimation(
  clip: TimelineClip,
  globalTime: number,
  fps: number,
  layerIndex = 1,
  audioLevel = 0
): ResolvedClipAnimation {
  const relTime = Math.max(0, globalTime - clip.startTime);
  const trackMap = new Map<string, PropertyTrack>();
  if (clip.keyframes) {
    for (const tr of clip.keyframes) trackMap.set(tr.property, tr);
  }
  const seed = hashSeed(clip.id);

  const evalProp = (prop: AnimatableProperty): number => {
    const base = getClipBasePropertyValue(clip, prop);
    const track = trackMap.get(prop);
    let val = evaluatePropertyTrack(track, relTime, base);

    if (track?.expression && track.expressionEnabled !== false) {
      const exprOut = evaluateSafeExpression(track.expression, {
        time: globalTime,
        relTime,
        value: val,
        duration: clip.duration,
        fps,
        index: layerIndex,
        audioLevel,
        seed,
      });
      if (!exprOut.error) val = exprOut.value;
    }

    if (clip.motionStack?.length) {
      for (const beh of clip.motionStack) {
        if (beh.enabled && beh.property === prop) {
          val += evaluateMotionBehaviorDelta(beh, relTime, audioLevel, seed);
        }
      }
    }

    return val;
  };

  const uniformScale = evalProp('scale');
  const rawScaleX = clip.unlinkScale || trackMap.has('scaleX') || clip.motionStack?.some((b) => b.enabled && b.property === 'scaleX')
    ? evalProp('scaleX')
    : uniformScale;
  const rawScaleY = clip.unlinkScale || trackMap.has('scaleY') || clip.motionStack?.some((b) => b.enabled && b.property === 'scaleY')
    ? evalProp('scaleY')
    : uniformScale;

  // Also apply 'scale' motion behaviors symmetrically when scale is linked
  const scaleBehDelta =
    clip.unlinkScale
      ? (clip.motionStack || [])
          .filter((b) => b.enabled && b.property === 'scale')
          .reduce((acc, b) => acc + evaluateMotionBehaviorDelta(b, relTime, audioLevel, seed), 0)
      : 0;

  return {
    x: evalProp('x'),
    y: evalProp('y'),
    z: evalProp('z'),
    anchorX: evalProp('anchorX'),
    anchorY: evalProp('anchorY'),
    scaleX: Math.max(0, rawScaleX + scaleBehDelta),
    scaleY: Math.max(0, rawScaleY + scaleBehDelta),
    scaleZ: Math.max(0, evalProp('scaleZ')),
    rotation: evalProp('rotation'),
    rotationX: evalProp('rotationX'),
    rotationY: evalProp('rotationY'),
    rotationZ: evalProp('rotationZ'),
    opacity: Math.max(0, Math.min(100, evalProp('opacity'))),
    skew: evalProp('skew'),
    trimStartPct: Math.max(0, Math.min(100, evalProp('trimStartPct'))),
    trimEndPct: Math.max(0, Math.min(100, evalProp('trimEndPct'))),
    strokeWidth: Math.max(0, evalProp('strokeWidth')),
    strokeDashOffset: evalProp('strokeDashOffset'),
    maskFeather: Math.max(0, evalProp('maskFeather')),
    maskExpansion: evalProp('maskExpansion'),
    letterSpacing: evalProp('letterSpacing'),
    cameraFov: Math.max(10, Math.min(140, evalProp('cameraFov'))),
    cameraFocus: Math.max(10, evalProp('cameraFocus')),
    cameraAperture: Math.max(0, evalProp('cameraAperture')),
    lightIntensity: Math.max(0, evalProp('lightIntensity')),
    lightDistance: Math.max(10, evalProp('lightDistance')),
    dropShadowDistance: Math.max(0, evalProp('dropShadowDistance')),
    dropShadowBlur: Math.max(0, evalProp('dropShadowBlur')),
    dropShadowOpacity: Math.max(0, Math.min(100, evalProp('dropShadowOpacity'))),
    volume: Math.max(0, Math.min(200, evalProp('volume'))),
  };
}

/**
 * Adds or updates a keyframe on `property` at `localTime` without touching any other property or unselected keyframes.
 */
export function upsertKeyframeOnClip(
  clip: TimelineClip,
  property: AnimatableProperty,
  localTime: number,
  value: number,
  easing: EasingName = 'ease-in-out'
): PropertyTrack[] {
  const tracks = clip.keyframes ? [...clip.keyframes] : [];
  const tClamped = Number(Math.max(0, Math.min(clip.duration, localTime)).toFixed(4));
  const idx = tracks.findIndex((tr) => tr.property === property);

  if (idx === -1) {
    tracks.push({
      property,
      keyframes: [
        {
          id: kfId(),
          time: tClamped,
          value,
          easing,
          outHandle: { ...DEFAULT_OUT_HANDLE },
          inHandle: { ...DEFAULT_IN_HANDLE },
        },
      ],
    });
    return tracks;
  }

  const existing = tracks[idx];
  const nearIdx = existing.keyframes.findIndex((k) => Math.abs(k.time - tClamped) < 0.018);
  const nextKeys =
    nearIdx >= 0
      ? existing.keyframes.map((k, i) => (i === nearIdx ? { ...k, value } : k))
      : sortPropertyKeyframes([
          ...existing.keyframes,
          {
            id: kfId(),
            time: tClamped,
            value,
            easing,
            outHandle: { ...DEFAULT_OUT_HANDLE },
            inHandle: { ...DEFAULT_IN_HANDLE },
          },
        ]);

  tracks[idx] = { ...existing, keyframes: nextKeys };
  return tracks;
}

export function deleteKeyframesFromTrack(
  clip: TimelineClip,
  property: AnimatableProperty | string,
  keyIds: Set<string>
): PropertyTrack[] {
  return (clip.keyframes || [])
    .map((tr) =>
      tr.property === property
        ? { ...tr, keyframes: tr.keyframes.filter((k) => !keyIds.has(k.id)) }
        : tr
    )
    .filter((tr) => tr.keyframes.length > 0 || !!tr.expression);
}

export function shiftSelectedKeyframes(
  clip: TimelineClip,
  property: AnimatableProperty,
  keyIds: Set<string>,
  deltaTime: number,
  deltaValue = 0
): PropertyTrack[] {
  return (clip.keyframes || []).map((tr) => {
    if (tr.property !== property) return tr;
    const updated = sortPropertyKeyframes(
      tr.keyframes.map((k) =>
        keyIds.has(k.id)
          ? {
              ...k,
              time: Number(Math.max(0, Math.min(clip.duration, k.time + deltaTime)).toFixed(4)),
              value: Number((k.value + deltaValue).toFixed(4)),
            }
          : k
      )
    );
    return { ...tr, keyframes: updated };
  });
}

export function slicePropertyTracks(
  tracks: PropertyTrack[] | undefined,
  from: number,
  to: number
): PropertyTrack[] | undefined {
  if (!tracks?.length) return undefined;
  return tracks.map((tr) => {
    if (tr.keyframes.length === 0) return { ...tr };
    const startVal = evaluatePropertyTrack(tr, from, tr.keyframes[0].value);
    const endVal = evaluatePropertyTrack(tr, to, tr.keyframes[tr.keyframes.length - 1].value);
    const inner = tr.keyframes
      .filter((k) => k.time > from + 0.01 && k.time < to - 0.01)
      .map((k) => ({ ...k, id: kfId(), time: Number((k.time - from).toFixed(4)) }));
    return {
      ...tr,
      keyframes: [
        { id: kfId(), time: 0, value: Number(startVal.toFixed(4)), easing: 'linear' },
        ...inner,
        { id: kfId(), time: Number((to - from).toFixed(4)), value: Number(endVal.toFixed(4)), easing: 'linear' },
      ],
    };
  });
}
