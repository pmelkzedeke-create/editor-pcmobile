import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EASING_PRESETS,
  evaluateEasing,
  invertCurveValues,
  mirrorCurveTiming,
  scaleCurveIntensity,
  smoothCurveKeyframes,
} from '../src/core/easing';
import {
  evaluateMotionBehaviorDelta,
  evaluateSafeExpression,
  validateSafeExpression,
} from '../src/core/expressions';
import {
  deleteKeyframesFromTrack,
  evaluateClipVolume,
  evaluatePropertyTrack,
  resolveClipAnimation,
  shiftSelectedKeyframes,
  upsertKeyframeOnClip,
} from '../src/core/keyframes';
import {
  createNewComposition,
  precomposeClips,
  resolveWorldTransform,
  switchActiveComposition,
  validateAndNormalizeProject,
} from '../src/core/compositions';
import {
  computeAudioEnvelopeFromChannel,
  detectBeatsFromEnvelope,
  sampleStereoAudioMeter,
} from '../src/core/audioAnalysis';
import {
  buildSubtitleClips,
  parseSubtitles,
  serializeClipsToSubtitles,
} from '../src/core/subtitles';
import {
  createEffect,
  evaluateEffectParams,
} from '../src/utils/sapphireEffects';
import {
  buildRotationGizmoPatch,
  buildScaleGizmoPatch,
  snapCanvasPosition,
} from '../src/utils/canvasGizmos';
import { buildInitialWorkspace } from '../src/utils/initialProject';
import type { TimelineClip } from '../src/types/editor';

const sampleClip = (): TimelineClip => ({
  ...buildInitialWorkspace().project.clips[0],
  x: 10,
  y: -5,
  scale: 100,
  rotation: 0,
  opacity: 100,
  startTime: 0,
  duration: 4,
});

test('all 16 mathematical easing presets satisfy endpoints and distinct profiles', () => {
  for (const preset of EASING_PRESETS) {
    assert.equal(evaluateEasing(preset.id, 0, preset.outHandle, preset.inHandle), 0);
    assert.equal(evaluateEasing(preset.id, 1, preset.outHandle, preset.inHandle), 1);
  }
  assert.ok(evaluateEasing('overshoot', 0.65) > 1, 'overshoot exceeds 1 before settling');
  assert.ok(evaluateEasing('elastic', 0.2) > 1, 'elastic overshoots 1 on first oscillation');
  assert.ok(evaluateEasing('elastic', 0.35) < 1, 'elastic rebounds below 1 on second half-cycle');
  assert.equal(evaluateEasing('hold', 0.99), 0);
  assert.equal(evaluateEasing('hold', 1), 1);
  assert.ok(evaluateEasing('ease-in', 0.25) < 0.25);
  assert.ok(evaluateEasing('ease-out', 0.25) > 0.25);
});

test('curve editing strictly preserves unselected keyframes and unrelated properties', () => {
  let clip = sampleClip();
  clip = { ...clip, keyframes: upsertKeyframeOnClip(clip, 'scale', 0, 50, 'linear') };
  clip = { ...clip, keyframes: upsertKeyframeOnClip(clip, 'scale', 2, 150, 'linear') };
  clip = { ...clip, keyframes: upsertKeyframeOnClip(clip, 'x', 0, -20, 'linear') };
  clip = { ...clip, keyframes: upsertKeyframeOnClip(clip, 'x', 2, 40, 'linear') };

  const scaleTrack = clip.keyframes!.find((t) => t.property === 'scale')!;
  const firstId = scaleTrack.keyframes[0].id;
  const secondId = scaleTrack.keyframes[1].id;

  // Smooth ONLY the first keyframe; second keyframe and 'x' track remain untouched
  const smoothed = smoothCurveKeyframes(scaleTrack.keyframes, new Set([firstId]));
  assert.equal(smoothed[0].easing, 'bezier');
  assert.equal(smoothed[1].easing, 'linear');

  // Shift ONLY second keyframe
  const shiftedTracks = shiftSelectedKeyframes(clip, 'scale', new Set([secondId]), 0.5, 25);
  const updatedScale = shiftedTracks.find((t) => t.property === 'scale')!;
  const untouchedX = shiftedTracks.find((t) => t.property === 'x')!;
  assert.equal(updatedScale.keyframes[0].time, 0);
  assert.equal(updatedScale.keyframes[0].value, 50);
  assert.equal(updatedScale.keyframes[1].time, 2.5);
  assert.equal(updatedScale.keyframes[1].value, 175);
  assert.equal(untouchedX.keyframes[1].value, 40);

  // Invert, mirror & scale intensity
  assert.equal(invertCurveValues(scaleTrack.keyframes)[0].value, 150);
  assert.equal(mirrorCurveTiming(scaleTrack.keyframes)[0].value, 150);
  assert.equal(scaleCurveIntensity(scaleTrack.keyframes, 2)[1].value, 250);

  const afterDel = deleteKeyframesFromTrack(clip, 'scale', new Set([firstId]));
  assert.equal(afterDel.find((t) => t.property === 'scale')!.keyframes.length, 1);
});

test('keyframe loop modes cycle, pingpong and offset interpolate accurately', () => {
  const keys = [
    { id: 'k1', time: 0, value: 0, easing: 'linear' as const },
    { id: 'k2', time: 1, value: 100, easing: 'linear' as const },
  ];
  assert.ok(Math.abs(evaluatePropertyTrack({ property: 'x', keyframes: keys, loop: 'cycle' }, 1.25, 0) - 25) < 1e-4);
  assert.ok(Math.abs(evaluatePropertyTrack({ property: 'x', keyframes: keys, loop: 'pingpong' }, 1.25, 0) - 75) < 1e-4);
  assert.ok(Math.abs(evaluatePropertyTrack({ property: 'x', keyframes: keys, loop: 'offset' }, 2.5, 0) - 250) < 1e-4);
});

test('safe expression engine evaluates procedural motion and rejects unsafe syntax cleanly', () => {
  const ctx = {
    time: 1.5,
    relTime: 0.5,
    value: 100,
    duration: 4,
    fps: 30,
    index: 1,
    audioLevel: 0.8,
    seed: 11,
  };
  const a = evaluateSafeExpression('wiggle(3, 20)', ctx);
  const b = evaluateSafeExpression('wiggle(3, 20)', ctx);
  assert.equal(a.error, null);
  assert.equal(a.value, b.value, 'wiggle is strictly deterministic');
  assert.notEqual(a.value, 100);

  const audioReactive = evaluateSafeExpression('value + audioLevel * 50', ctx);
  assert.equal(audioReactive.value, 140);

  // Rejects unknown globals / arbitrary code safely without eval
  assert.ok(validateSafeExpression('window.alert(1)') !== null);
  assert.ok(validateSafeExpression('10 + (2 * 5') !== null);
});

test('Motion Stack & Parenting world matrix resolve deterministically and resist cycles', () => {
  const parent: TimelineClip = { ...sampleClip(), id: 'parent', x: 20, y: 10, scale: 200, rotation: 90 };
  const child: TimelineClip = { ...sampleClip(), id: 'child', parentId: 'parent', x: 10, y: 0, scale: 50 };
  // Introduce intentional cycle on parent to ensure cycle guard terminates cleanly
  parent.parentId = 'child';

  const map = new Map([
    [parent.id, parent],
    [child.id, child],
  ]);
  const world = resolveWorldTransform(child, map, 1000, 1000, 0.5, 30, 0.5);
  assert.ok(Number.isFinite(world.xPx) && Number.isFinite(world.yPx));

  const springDelta = evaluateMotionBehaviorDelta(
    { id: 'b1', type: 'spring-in', enabled: true, property: 'y', intensity: 40, duration: 1, damping: 6, frequency: 8, delay: 0 },
    0,
    0,
    5
  );
  assert.equal(springDelta, 40);

  const animated = resolveClipAnimation(
    {
      ...sampleClip(),
      motionStack: [
        { id: 'b2', type: 'audio-pulse', enabled: true, property: 'scale', intensity: 30, duration: 4, damping: 4, frequency: 1, delay: 0 },
      ],
    },
    0.5,
    30,
    1,
    0.5
  );
  assert.equal(animated.scaleX, 115);
});

test('multi-composition creation, pre-composing, validation & audio beat detection work end-to-end', () => {
  const ws = buildInitialWorkspace();
  const withSecond = createNewComposition(ws.project, { name: 'Cena 2 — Intro 4K', aspectRatio: '4k', fps: 60 });
  assert.equal(withSecond.compositions!.length, 2);
  assert.equal(withSecond.fps, 60);

  const backToMain = switchActiveComposition(withSecond, 'comp-main');
  assert.equal(backToMain.clips.length, ws.project.clips.length);

  const pre = precomposeClips(backToMain, ['clip-v1-1', 'clip-v1-2'], 'Sub-Cena Neon');
  assert.ok(pre);
  assert.ok(pre.nextProject.clips.some((c) => c.type === 'precomp' && c.name === 'Sub-Cena Neon'));

  const validated = validateAndNormalizeProject(JSON.parse(JSON.stringify(pre.nextProject)));
  assert.ok(validated.project);
  assert.equal(validated.project.compositions!.length, 3);

  // Beat detection on synthetic 120 BPM pulse (beats every 0.5s)
  const sr = 8000;
  const pcm = new Float32Array(sr * 3);
  for (let beat = 0; beat < 6; beat++) {
    const start = Math.floor(beat * 0.5 * sr);
    for (let i = 0; i < 400 && start + i < pcm.length; i++) {
      pcm[start + i] = Math.exp(-i / 120) * Math.sin(i * 0.4);
    }
  }
  const env = computeAudioEnvelopeFromChannel(pcm, sr, 60);
  const beats = detectBeatsFromEnvelope(env, 60, 1.25, 0.35);
  assert.ok(beats.length >= 4, `expected rhythmic beats, got ${beats.length}`);
});

test('audio volume keyframes and stereo VU meter evaluate accurately over time', () => {
  let clip = sampleClip();
  clip = { ...clip, keyframes: upsertKeyframeOnClip(clip, 'volume', 0, 20, 'linear') };
  clip = { ...clip, keyframes: upsertKeyframeOnClip(clip, 'volume', 2, 100, 'linear') };

  assert.equal(Math.round(evaluateClipVolume(clip, 0)), 20);
  assert.equal(Math.round(evaluateClipVolume(clip, 1)), 60);
  assert.equal(Math.round(evaluateClipVolume(clip, 2)), 100);

  const ws = buildInitialWorkspace();
  const assetsMap = new Map(ws.assets.map((a) => [a.id, a]));
  const meterMuted = sampleStereoAudioMeter(ws.project, assetsMap, 1.0, true);
  assert.equal(meterMuted.left, 0);
  assert.equal(meterMuted.db, -60);

  const meterActive = sampleStereoAudioMeter(ws.project, assetsMap, 1.0, false);
  assert.ok(meterActive.left > 0 && meterActive.right > 0);
  assert.ok(meterActive.db > -60);
});

test('canvas gizmos snap to center/neighbors and update keyframed scale & rotation', () => {
  const snappedCenter = snapCanvasPosition(0.9, -1.1, [{ id: 'other', x: 25, y: -30 }], 'self', false);
  assert.equal(snappedCenter.x, 0);
  assert.equal(snappedCenter.y, 0);
  assert.equal(snappedCenter.snapLineX, 50);
  assert.equal(snappedCenter.snapLineY, 50);

  const snappedNeighbor = snapCanvasPosition(24.4, -29.2, [{ id: 'other', x: 25, y: -30 }], 'self', false);
  assert.equal(snappedNeighbor.x, 25);
  assert.equal(snappedNeighbor.y, -30);

  let clip = sampleClip();
  clip = { ...clip, keyframes: upsertKeyframeOnClip(clip, 'scale', 0, 100, 'linear') };
  const scalePatch = buildScaleGizmoPatch(clip, 1.5, 145.4);
  assert.equal(scalePatch.scale, 145);
  assert.equal(scalePatch.keyframes?.find((k) => k.property === 'scale')?.keyframes.length, 2);

  const rotPatch = buildRotationGizmoPatch(clip, 1.5, 28, true);
  assert.equal(rotPatch.rotation, 30);
});

test('expanded expression engine supports conditionals, comparisons, loopOut, posterizeTime and lerp', () => {
  const ctx = {
    time: 1.5,
    relTime: 0.75,
    value: 100,
    duration: 4,
    fps: 30,
    index: 1,
    audioLevel: 0.6,
    seed: 7,
  };

  const condTrue = evaluateSafeExpression('if(audioLevel > 0.4, value + 50, value - 20)', ctx);
  assert.equal(condTrue.error, null);
  assert.equal(condTrue.value, 150);

  const condFalse = evaluateSafeExpression('if(audioLevel <= 0.4, value + 50, value - 20)', ctx);
  assert.equal(condFalse.error, null);
  assert.equal(condFalse.value, 80);

  const loopOutVal = evaluateSafeExpression('loopOut(1.0, 40)', ctx);
  assert.equal(loopOutVal.error, null);
  assert.equal(Math.round(loopOutVal.value), 130);

  const posterized = evaluateSafeExpression('posterizeTime(4, 20)', ctx);
  assert.equal(posterized.error, null);
  assert.equal(posterized.value, 115);

  const lerped = evaluateSafeExpression('lerp(10, 90, 0.25)', ctx);
  assert.equal(lerped.error, null);
  assert.equal(lerped.value, 30);
});

test('subtitles engine parses and serializes .srt and .vtt accurately', () => {
  const srtSample = `1
00:00:01,000 --> 00:00:03,500
Olá, bem-vindo ao Editor Pro!

2
00:00:04,000 --> 00:00:06,250
Renderização WebCodecs em tempo real.`;

  const cues = parseSubtitles(srtSample);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startTime, 1);
  assert.equal(cues[0].endTime, 3.5);
  assert.equal(cues[1].text, 'Renderização WebCodecs em tempo real.');

  const clips = buildSubtitleClips(cues, 'track-t1');
  assert.equal(clips.length, 2);
  assert.equal(clips[0].duration, 2.5);
  assert.equal(clips[1].startTime, 4);

  const vttOut = serializeClipsToSubtitles(clips, 'vtt');
  assert.ok(vttOut.startsWith('WEBVTT'));
  assert.ok(vttOut.includes('00:00:01.000 --> 00:00:03.500'));

  const reparsed = parseSubtitles(vttOut);
  assert.equal(reparsed.length, 2);
  assert.equal(reparsed[0].text, 'Olá, bem-vindo ao Editor Pro!');
});

test('new studio effects instantiate and evaluate keyframed parameters cleanly', () => {
  const newTypes = [
    'S_RadialBlur',
    'S_TurbulentDisplace',
    'S_BulgeTwirl',
    'S_CornerPin',
    'S_Halation',
    'S_ThresholdInvert',
    'S_BevelEmboss',
    'S_Particles',
  ];
  for (const type of newTypes) {
    const fx = createEffect(type);
    assert.ok(fx, `effect ${type} should be registered`);
    const evaluated = evaluateEffectParams(fx, 1.0);
    assert.ok(Object.keys(evaluated).length > 0);
  }
});


