import type { ProjectState, PropertyTrack, TimelineClip } from '../../types/editor';
import { getProjectDimensions, resolveWorldTransform } from '../compositions';
import { getClipSourceTime } from '../../utils/timeRemap';
import { evaluatePropertyTrack } from '../keyframes';
import { sampleMotion } from './motion';

/** Bake measured source displacement into the target's own X/Y animation tracks. */
export function trackingToKeyframes(source: TimelineClip, target: TimelineClip, project: ProjectState): PropertyTrack[] {
  const analysis = source.vfx?.tracking;
  if (!analysis?.samples.length) throw new Error('Analise o ponto antes de vincular uma camada.');
  if (target.parentId) throw new Error('Desvincule o pai da camada de destino antes de aplicar o movimento.');
  const start = Math.max(source.startTime, target.startTime);
  const end = Math.min(source.startTime + source.duration, target.startTime + target.duration);
  if (end - start < 1 / project.fps) throw new Error('As camadas precisam se sobrepor na timeline.');
  const spec = getProjectDimensions(project);
  const factor = source.fitMode === 'cover'
    ? Math.max(spec.width / analysis.sourceWidth, spec.height / analysis.sourceHeight)
    : Math.min(spec.width / analysis.sourceWidth, spec.height / analysis.sourceHeight);
  const map = new Map(project.clips.map((c) => [c.id, c]));
  const origin = sampleMotion(analysis, getClipSourceTime(source, start - source.startTime));
  const tracks: PropertyTrack[] = (['x', 'y'] as const).map((property) => ({
    property,
    keyframes: (target.keyframes?.find((tr) => tr.property === property)?.keyframes || [])
      .filter((k) => k.time < start - target.startTime - 0.001 || k.time > end - target.startTime + 0.001),
  }));
  const count = Math.ceil((end - start) * project.fps);
  for (let i = 0; i <= count; i++) {
    const time = Math.min(end - 0.00001, start + i / project.fps);
    const point = sampleMotion(analysis, getClipSourceTime(source, time - source.startTime));
    const world = resolveWorldTransform(source, map, spec.width, spec.height, time, project.fps);
    const dx = (point.x - origin.x) * analysis.sourceWidth * factor * world.scaleX;
    const dy = (point.y - origin.y) * analysis.sourceHeight * factor * world.scaleY;
    const x = dx * Math.cos(world.rotationRad) - dy * Math.sin(world.rotationRad);
    const y = dx * Math.sin(world.rotationRad) + dy * Math.cos(world.rotationRad);
    for (let t = 0; t < tracks.length; t++) {
      const property = tracks[t].property;
      const old = target.keyframes?.find((tr) => tr.property === property);
      const base = evaluatePropertyTrack(old, time - target.startTime, property === 'x' ? target.x : target.y);
      tracks[t].keyframes.push({ id: `track-${property}-${i}`, time: time - target.startTime, value: base + (t === 0 ? x / spec.width : y / spec.height) * 100, easing: 'linear' });
    }
  }
  return [...(target.keyframes || []).filter((tr) => tr.property !== 'x' && tr.property !== 'y'), ...tracks.map((tr) => ({ ...tr, keyframes: tr.keyframes.sort((a, b) => a.time - b.time) }))];
}