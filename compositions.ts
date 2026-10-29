import {
  ASPECT_RATIOS,
  AspectRatioKey,
  Composition,
  ProjectState,
  TimelineClip,
  Track,
} from '../types/editor';
import { DEFAULT_FILTERS, uid } from '../utils/mediaHelpers';
import { resolveClipAnimation } from './keyframes';

export const PROJECT_SCHEMA_VERSION = 2; // ProjectState contract version (independent of file format v3)

export function getProjectDimensions(project: Pick<ProjectState, 'aspectRatio' | 'customWidth' | 'customHeight'>): {
  width: number;
  height: number;
  label: string;
} {
  if (project.aspectRatio === 'custom') {
    const w = Math.max(120, Math.min(7680, Math.round((project.customWidth || 1920) / 2) * 2));
    const h = Math.max(120, Math.min(4320, Math.round((project.customHeight || 1080) / 2) * 2));
    return { width: w, height: h, label: `${w}×${h}` };
  }
  const spec = ASPECT_RATIOS[project.aspectRatio] || ASPECT_RATIOS['16:9'];
  return { width: spec.width, height: spec.height, label: spec.label };
}

/**
 * Ensures top-level active composition fields and `compositions[]` stay cleanly synchronized
 * so single-comp & multi-comp workflows + JSON save/load are 100% consistent.
 */
export function syncActiveComposition(project: ProjectState): ProjectState {
  const activeId = project.activeCompId || 'comp-main';
  const currentComp: Composition = {
    id: activeId,
    name:
      project.compositions?.find((c) => c.id === activeId)?.name ||
      'Composição Principal',
    aspectRatio: project.aspectRatio,
    customWidth: project.customWidth,
    customHeight: project.customHeight,
    fps: project.fps,
    backgroundColor: project.backgroundColor || '#000000',
    transparentBg: !!project.transparentBg,
    tracks: project.tracks,
    clips: project.clips,
    markers: project.markers,
    workArea: project.workArea,
  };

  const others = (project.compositions || []).filter((c) => c.id !== activeId);
  const existingIdx = (project.compositions || []).findIndex((c) => c.id === activeId);
  const nextComps = [...others];
  if (existingIdx >= 0) nextComps.splice(existingIdx, 0, currentComp);
  else nextComps.unshift(currentComp);

  return {
    ...project,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    activeCompId: activeId,
    compositions: nextComps,
  };
}

export function switchActiveComposition(project: ProjectState, targetCompId: string): ProjectState {
  const synced = syncActiveComposition(project);
  const target = synced.compositions?.find((c) => c.id === targetCompId);
  if (!target) return synced;
  return {
    ...synced,
    activeCompId: target.id,
    aspectRatio: target.aspectRatio,
    customWidth: target.customWidth,
    customHeight: target.customHeight,
    fps: target.fps,
    backgroundColor: target.backgroundColor || '#000000',
    transparentBg: !!target.transparentBg,
    tracks: target.tracks,
    clips: target.clips,
    markers: target.markers,
    workArea: target.workArea,
  };
}

export function createNewComposition(
  project: ProjectState,
  options?: {
    name?: string;
    aspectRatio?: AspectRatioKey;
    customWidth?: number;
    customHeight?: number;
    fps?: 24 | 30 | 60 | 120;
    backgroundColor?: string;
  }
): ProjectState {
  const synced = syncActiveComposition(project);
  const newId = uid('comp');
  const count = (synced.compositions?.length || 1) + 1;
  const newComp: Composition = {
    id: newId,
    name: options?.name || `Composição ${count}`,
    aspectRatio: options?.aspectRatio || synced.aspectRatio,
    customWidth: options?.customWidth ?? synced.customWidth,
    customHeight: options?.customHeight ?? synced.customHeight,
    fps: options?.fps || synced.fps,
    backgroundColor: options?.backgroundColor || '#000000',
    transparentBg: false,
    tracks: [
      { id: uid('track-t'), name: 'T1 • Títulos', type: 'text', muted: false, hidden: false, locked: false },
      { id: uid('track-s'), name: 'S1 • Formas', type: 'shape', muted: false, hidden: false, locked: false },
      { id: uid('track-v'), name: 'V1 • Vídeo Principal', type: 'video', muted: false, hidden: false, locked: false },
      { id: uid('track-a'), name: 'A1 • Áudio', type: 'audio', muted: false, hidden: false, locked: false },
    ],
    clips: [],
    markers: [],
  };

  return switchActiveComposition(
    {
      ...synced,
      compositions: [...(synced.compositions || []), newComp],
    },
    newId
  );
}

/**
 * Pre-composes one or more clips from the active composition into a new nested Composition,
 * replacing them on the timeline with a single `'precomp'` layer.
 */
export function precomposeClips(
  project: ProjectState,
  clipIds: string[],
  precompName?: string
): { nextProject: ProjectState; precompClipId: string } | null {
  const synced = syncActiveComposition(project);
  const chosen = synced.clips.filter((c) => clipIds.includes(c.id));
  if (chosen.length === 0) return null;

  const minStart = Math.min(...chosen.map((c) => c.startTime));
  const maxEnd = Math.max(...chosen.map((c) => c.startTime + c.duration));
  const span = Math.max(0.5, Number((maxEnd - minStart).toFixed(4)));

  const shiftedClips: TimelineClip[] = chosen.map((c) => ({
    ...c,
    startTime: Number((c.startTime - minStart).toFixed(4)),
  }));

  const usedTrackIds = new Set(shiftedClips.map((c) => c.trackId));
  const subTracks: Track[] = synced.tracks
    .filter((t) => usedTrackIds.has(t.id))
    .map((t) => ({ ...t }));

  const subCompId = uid('precomp');
  const subComp: Composition = {
    id: subCompId,
    name: precompName || `Pré-comp ${(synced.compositions?.length || 1)}`,
    aspectRatio: synced.aspectRatio,
    customWidth: synced.customWidth,
    customHeight: synced.customHeight,
    fps: synced.fps,
    backgroundColor: '#000000',
    transparentBg: true,
    tracks: subTracks,
    clips: shiftedClips,
    markers: [],
  };

  const firstTrack =
    synced.tracks.find((t) => t.id === chosen[0].trackId && t.type !== 'audio') ||
    synced.tracks.find((t) => t.type === 'video') ||
    synced.tracks[0];

  const precompClipId = uid('clip-pre');
  const precompClip: TimelineClip = {
    id: precompClipId,
    trackId: firstTrack.id,
    precompId: subCompId,
    type: 'precomp',
    name: subComp.name,
    startTime: minStart,
    duration: span,
    trimStart: 0,
    maxDuration: span * 4,
    x: 0,
    y: 0,
    scale: 100,
    rotation: 0,
    opacity: 100,
    flipH: false,
    flipV: false,
    fitMode: 'contain',
    speed: 1,
    motionPreset: 'none',
    filters: { ...DEFAULT_FILTERS },
    transitionIn: 'none',
    transitionInDuration: 0,
    transitionOut: 'none',
    transitionOutDuration: 0,
    volume: 100,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
  };

  const remainingClips = synced.clips.filter((c) => !clipIds.includes(c.id));
  const nextActiveClips = [...remainingClips, precompClip];

  const updated = syncActiveComposition({
    ...synced,
    clips: nextActiveClips,
    compositions: [...(synced.compositions || []), subComp],
  });

  return { nextProject: updated, precompClipId };
}

export interface WorldTransform2D {
  xPx: number;
  yPx: number;
  anchorOffsetXPx: number;
  anchorOffsetYPx: number;
  scaleX: number;
  scaleY: number;
  rotationRad: number;
  skewRad: number;
  opacityFactor: number;
  perspectiveScale: number;
  tiltCosX: number;
  tiltCosY: number;
}

/**
 * Resolves full hierarchical parent chain (`clip.parentId`) with cycle detection,
 * 2.5D depth perspective projection (`z`), 3D axis tilt (`rotationX`, `rotationY`),
 * independent `scaleX`/`scaleY`, and Anchor Point (`anchorX`, `anchorY`).
 */
export function resolveWorldTransform(
  clip: TimelineClip,
  allClipsMap: Map<string, TimelineClip>,
  canvasWidth: number,
  canvasHeight: number,
  globalTime: number,
  fps: number,
  audioLevel = 0
): WorldTransform2D {
  const chain: TimelineClip[] = [];
  const visited = new Set<string>();
  let cursor: TimelineClip | undefined = clip;
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    chain.unshift(cursor); // Root ancestor first, child last
    cursor = cursor.parentId ? allClipsMap.get(cursor.parentId) : undefined;
  }

  let worldX = canvasWidth / 2;
  let worldY = canvasHeight / 2;
  let worldScaleX = 1;
  let worldScaleY = 1;
  let worldRot = 0;
  let worldSkew = 0;
  let perspectiveScale = 1;
  let tiltCosX = 1;
  let tiltCosY = 1;
  let anchorOffsetXPx = 0;
  let anchorOffsetYPx = 0;
  let opacityFactor = 1;

  chain.forEach((node, idx) => {
    const isLeaf = idx === chain.length - 1;
    const anim = resolveClipAnimation(node, globalTime, fps, idx + 1, audioLevel);

    const localDx = (anim.x / 100) * canvasWidth;
    const localDy = (anim.y / 100) * canvasHeight;

    // Transform local offset by accumulated parent transform
    const cosR = Math.cos(worldRot);
    const sinR = Math.sin(worldRot);
    worldX += (localDx * worldScaleX) * cosR - (localDy * worldScaleY) * sinR;
    worldY += (localDx * worldScaleX) * sinR + (localDy * worldScaleY) * cosR;

    worldRot += (anim.rotation * Math.PI) / 180;
    worldSkew += (anim.skew * Math.PI) / 180;
    worldScaleX *= anim.scaleX / 100;
    worldScaleY *= anim.scaleY / 100;

    // 2.5D perspective camera depth factor (focal length = 900px)
    const zClamped = Math.max(-750, Math.min(1800, anim.z));
    perspectiveScale *= 900 / Math.max(120, 900 + zClamped);
    tiltCosY *= Math.max(0.08, Math.cos((anim.rotationY * Math.PI) / 180));
    tiltCosX *= Math.max(0.08, Math.cos((anim.rotationX * Math.PI) / 180));

    if (isLeaf) {
      opacityFactor = anim.opacity / 100;
      anchorOffsetXPx = (anim.anchorX / 100) * canvasWidth;
      anchorOffsetYPx = (anim.anchorY / 100) * canvasHeight;
    }
  });

  return {
    xPx: worldX,
    yPx: worldY,
    anchorOffsetXPx,
    anchorOffsetYPx,
    scaleX: worldScaleX * perspectiveScale * tiltCosY,
    scaleY: worldScaleY * perspectiveScale * tiltCosX,
    rotationRad: worldRot,
    skewRad: worldSkew,
    opacityFactor,
    perspectiveScale,
    tiltCosX,
    tiltCosY,
  };
}

export function validateAndNormalizeProject(raw: unknown): {
  project?: ProjectState;
  error?: string;
} {
  if (!raw || typeof raw !== 'object') {
    return { error: 'O arquivo não contém um objeto JSON válido.' };
  }
  const candidate = raw as Partial<ProjectState>;
  if (!Array.isArray(candidate.tracks) || !Array.isArray(candidate.clips)) {
    return { error: 'Estrutura incompatível: faltam listas "tracks" ou "clips".' };
  }
  const fps: 24 | 30 | 60 | 120 =
    candidate.fps === 24 || candidate.fps === 60 || candidate.fps === 120 ? candidate.fps : 30;
  const aspectRatio: AspectRatioKey =
    candidate.aspectRatio && candidate.aspectRatio in ASPECT_RATIOS
      ? candidate.aspectRatio
      : '16:9';

  const normalized = syncActiveComposition({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectName: typeof candidate.projectName === 'string' && candidate.projectName.trim()
      ? candidate.projectName
      : 'Projeto Recuperado',
    aspectRatio,
    customWidth: candidate.customWidth,
    customHeight: candidate.customHeight,
    backgroundColor: candidate.backgroundColor || '#000000',
    transparentBg: !!candidate.transparentBg,
    fps,
    assetRegistry: Array.isArray(candidate.assetRegistry) ? candidate.assetRegistry : undefined,
    tracks: candidate.tracks,
    clips: candidate.clips,
    markers: Array.isArray(candidate.markers) ? candidate.markers : [],
    workArea: candidate.workArea,
    activeCompId: candidate.activeCompId,
    compositions: Array.isArray(candidate.compositions) ? candidate.compositions : undefined,
    customPresets: Array.isArray(candidate.customPresets) ? candidate.customPresets : undefined,
  });

  return { project: normalized };
}


