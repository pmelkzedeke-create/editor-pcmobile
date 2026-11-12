import type { TimelineClip } from '../types/editor';
import { upsertKeyframeOnClip } from '../core/keyframes';

export interface SnapResult {
  x: number;
  y: number;
  /** Canvas percentage (0..100) of active vertical guide line, or null */
  snapLineX: number | null;
  /** Canvas percentage (0..100) of active horizontal guide line, or null */
  snapLineY: number | null;
}

const SNAP_THRESHOLD_PCT = 1.6;

/**
 * Computes magnetic snapping for clip X/Y coordinates (where 0,0 is canvas center)
 * against canvas center (0%), thirds (-16.67%, +16.67%), and other active clips.
 */
export function snapCanvasPosition(
  rawX: number,
  rawY: number,
  otherClips: { id: string; x: number; y: number }[],
  activeClipId: string,
  disableSnap = false
): SnapResult {
  if (disableSnap) {
    return {
      x: Math.round(rawX * 10) / 10,
      y: Math.round(rawY * 10) / 10,
      snapLineX: null,
      snapLineY: null,
    };
  }

  const xTargets = [0, -16.7, 16.7, ...otherClips.filter((c) => c.id !== activeClipId).map((c) => c.x)];
  const yTargets = [0, -16.7, 16.7, ...otherClips.filter((c) => c.id !== activeClipId).map((c) => c.y)];

  let bestX = Math.round(rawX * 10) / 10;
  let snapLineX: number | null = null;
  let minDx = SNAP_THRESHOLD_PCT;

  for (const target of xTargets) {
    const d = Math.abs(rawX - target);
    if (d <= minDx) {
      minDx = d;
      bestX = Math.round(target * 10) / 10;
      snapLineX = 50 + target;
    }
  }

  let bestY = Math.round(rawY * 10) / 10;
  let snapLineY: number | null = null;
  let minDy = SNAP_THRESHOLD_PCT;

  for (const target of yTargets) {
    const d = Math.abs(rawY - target);
    if (d <= minDy) {
      minDy = d;
      bestY = Math.round(target * 10) / 10;
      snapLineY = 50 + target;
    }
  }

  return { x: bestX, y: bestY, snapLineX, snapLineY };
}

/**
 * Computes a patch for uniform or unlinked scale when dragging a corner handle.
 */
export function buildScaleGizmoPatch(
  clip: TimelineClip,
  localTime: number,
  newScale: number
): Partial<TimelineClip> {
  const clamped = Math.max(5, Math.min(400, Math.round(newScale)));
  let keyframes = clip.keyframes;

  if (clip.keyframes?.some((k) => k.property === 'scale')) {
    keyframes = upsertKeyframeOnClip(clip, 'scale', localTime, clamped, 'ease-in-out');
  }
  if (clip.unlinkScale) {
    if (clip.keyframes?.some((k) => k.property === 'scaleX')) {
      keyframes = upsertKeyframeOnClip({ ...clip, keyframes }, 'scaleX', localTime, clamped, 'ease-in-out');
    }
    if (clip.keyframes?.some((k) => k.property === 'scaleY')) {
      keyframes = upsertKeyframeOnClip({ ...clip, keyframes }, 'scaleY', localTime, clamped, 'ease-in-out');
    }
  }

  return {
    scale: clamped,
    scaleX: clamped,
    scaleY: clamped,
    ...(keyframes ? { keyframes } : {}),
  };
}

/**
 * Computes a patch for rotation when dragging the rotation handle or two-finger rotating.
 */
export function buildRotationGizmoPatch(
  clip: TimelineClip,
  localTime: number,
  newRotationDeg: number,
  snapAngle = false
): Partial<TimelineClip> {
  const rounded = snapAngle
    ? Math.round(newRotationDeg / 15) * 15
    : Math.round(newRotationDeg);
  const clamped = Math.max(-720, Math.min(720, rounded));
  let keyframes = clip.keyframes;

  if (clip.keyframes?.some((k) => k.property === 'rotation')) {
    keyframes = upsertKeyframeOnClip(clip, 'rotation', localTime, clamped, 'ease-in-out');
  }

  return {
    rotation: clamped,
    rotationZ: clamped,
    ...(keyframes ? { keyframes } : {}),
  };
}
