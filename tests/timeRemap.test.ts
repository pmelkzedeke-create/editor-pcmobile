import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimeRemap, createRemapPreset, evaluateRemap, getClipSourceTime, getClipPlaybackRate, insertRemapKeyframe, sliceTimeRemap } from '../src/utils/timeRemap';
import type { TimelineClip } from '../src/types/editor';

const base = { id: 'video', type: 'video', startTime: 2, duration: 6, trimStart: 2, maxDuration: 12, speed: 1 } as TimelineClip;
const close = (actual: number, expected: number, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('source time accounts for source trim and playback speed', () => {
  close(getClipSourceTime({ ...base, speed: 2 }, 2), 6);
  close(getClipSourceTime(base, -2), 2);
  close(getClipSourceTime(base, 20), 8);
});

test('default remap reproduces original timing', () => {
  const remap = createTimeRemap(base);
  for (let i = 0; i <= 60; i++) close(evaluateRemap(remap, i / 10), i / 10 + 2);
});

test('reverse has negative velocity and maps endpoints correctly', () => {
  const clip = { ...base, timeRemap: createRemapPreset(base, 'reverse', 0) };
  close(getClipSourceTime(clip, 0), 8);
  close(getClipSourceTime(clip, 6), 2);
  close(getClipPlaybackRate(clip, 3), -1);
});

test('freeze holds exactly the source frame under the playhead', () => {
  const clip = { ...base, timeRemap: createRemapPreset(base, 'freeze', 2.5) };
  for (let i = 0; i <= 6; i++) close(getClipSourceTime(clip, i), 4.5);
  close(getClipPlaybackRate(clip, 2), 0);
});

test('slow motion uses one quarter of the source in the same timeline duration', () => {
  const clip = { ...base, timeRemap: createRemapPreset(base, 'slow', 0) };
  close(getClipSourceTime(clip, 6), 3.5);
  close(getClipPlaybackRate(clip, 3), 0.25);
});

test('bezier interpolation produces smooth non-linear time', () => {
  const remap = createTimeRemap(base);
  remap.keyframes[0].interpolation = 'bezier';
  close(evaluateRemap(remap, 0), 2);
  close(evaluateRemap(remap, 6), 8);
  close(evaluateRemap(remap, 3), 5);
  assert.ok(evaluateRemap(remap, 1) < 3);
  assert.ok(evaluateRemap(remap, 5) > 7);
});

test('inserting a keyframe preserves a Bezier ramp', () => {
  const clip = { ...base, timeRemap: createRemapPreset(base, 'ramp', 0) };
  const inserted = insertRemapKeyframe(clip, 3.1, 30);
  assert.equal(inserted.keyframes.length, 5);
  for (let i = 0; i <= 180; i++) close(evaluateRemap(inserted, i / 30), getClipSourceTime(clip, i / 30));
});

test('inserting at an existing keyframe does not create duplicates', () => {
  const clip = { ...base, timeRemap: createTimeRemap(base) };
  assert.equal(insertRemapKeyframe(clip, 0, 30).keyframes.length, 2);
  assert.equal(insertRemapKeyframe(clip, 6, 30).keyframes.length, 2);
});

test('splitting a ramp preserves both halves of its timing curve', () => {
  const clip = { ...base, timeRemap: createRemapPreset(base, 'ramp', 0) };
  const first = sliceTimeRemap(clip, 0, 2.7)!;
  const second = sliceTimeRemap(clip, 2.7, clip.duration)!;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60 * 2.7;
    close(evaluateRemap(first, t), getClipSourceTime(clip, t));
    const u = i / 60 * 3.3;
    close(evaluateRemap(second, u), getClipSourceTime(clip, u + 2.7));
  }
});

test('trimming a custom Bezier preserves its handles and source time', () => {
  const remap = createTimeRemap(base);
  remap.keyframes[0].interpolation = 'bezier';
  remap.keyframes[0].outHandle = { x: 0.2, y: 0.6 };
  remap.keyframes[1].inHandle = { x: 0.4, y: 0.15 };
  const clip = { ...base, timeRemap: remap };
  const trimmed = sliceTimeRemap(clip, 1.2, 4.8)!;
  for (let i = 0; i <= 80; i++) close(evaluateRemap(trimmed, i / 80 * 3.6), evaluateRemap(remap, i / 80 * 3.6 + 1.2));
});

test('extending a remapped clip holds its last frame', () => {
  const clip = { ...base, timeRemap: createRemapPreset(base, 'reverse', 0) };
  const extended = sliceTimeRemap(clip, 0, 9)!;
  close(evaluateRemap(extended, 8), 2);
  close(evaluateRemap(extended, 9), 2);
});

test('hold interpolation preserves discrete source jumps', () => {
  const remap = createTimeRemap(base);
  remap.keyframes[0].interpolation = 'hold';
  close(evaluateRemap(remap, 5.99), 2);
  close(evaluateRemap(remap, 6), 8);
});

test('disabled remapping leaves normal speed intact', () => {
  const remap = createRemapPreset(base, 'reverse', 0);
  remap.enabled = false;
  close(getClipSourceTime({ ...base, timeRemap: remap }, 2), 4);
  close(getClipPlaybackRate({ ...base, timeRemap: remap }, 2), 1);
});