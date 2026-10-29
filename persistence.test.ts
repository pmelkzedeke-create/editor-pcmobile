import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MediaAsset, ProjectState, TimelineClip, Track } from '../src/types/editor';
import { validateAndNormalizeProject } from '../src/core/compositions';
import { mediaStore, registerAssetBlob } from '../src/core/persistence/mediaStore';
import {
  buildProjectPackage,
  detectMissingMedia,
  loadPersistedSession,
  parseProjectPackage,
  persistSession,
  rehydrateAssetsFromRegistry,
  toPersistedAsset,
} from '../src/core/persistence/projectIO';

// Browser API shims: the persistence layer only depends on standard Blob/URL/localStorage
// surfaces, so the same code paths run in Node tests and in the browser.
if (typeof URL.createObjectURL !== 'function') {
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () =>
    `blob:mock-${Math.random().toString(36).slice(2)}`;
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
}
const storageMap = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => storageMap.get(k) ?? null,
  setItem: (k: string, v: string) => void storageMap.set(k, v),
  removeItem: (k: string) => void storageMap.delete(k),
  clear: () => storageMap.clear(),
};

const track: Track = {
  id: 'track-v1',
  name: 'V1',
  type: 'video',
  muted: false,
  hidden: false,
  locked: false,
};

const clipFor = (mediaId: string): TimelineClip => ({
  id: `clip-${mediaId}`,
  trackId: 'track-v1',
  mediaId,
  type: 'video',
  name: 'Clipe de teste',
  startTime: 1.5,
  duration: 4,
  trimStart: 0.25,
  maxDuration: 12,
  x: 0,
  y: 0,
  scale: 100,
  rotation: 0,
  opacity: 100,
  flipH: false,
  flipV: false,
  fitMode: 'cover',
  speed: 1,
  motionPreset: 'none',
  filters: {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    hue: 0,
    blur: 0,
    vignette: 0,
    temperature: 0,
    presetName: 'Original',
  },
  transitionIn: 'fade',
  transitionInDuration: 0.5,
  transitionOut: 'fade',
  transitionOutDuration: 0.5,
  volume: 100,
  muted: false,
  fadeIn: 0,
  fadeOut: 0,
});

const makeProject = (mediaIds: string[]): ProjectState => ({
  projectName: 'Projeto de Persistência',
  aspectRatio: '16:9',
  fps: 30,
  tracks: [track],
  clips: mediaIds.map(clipFor),
  markers: [{ id: 'mk-1', time: 2, label: 'M1', color: '#38bdf8' }],
});

const makeAsset = (id: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({
  id,
  name: `${id}.webm`,
  type: 'video',
  url: 'blob:session-only-url',
  duration: 12,
  width: 1280,
  height: 720,
  size: 2048,
  mimeType: 'video/webm',
  storageKey: id,
  status: 'ready',
  ...extra,
});

test('project descriptors never carry blob URLs; binaries live in the media store', async () => {
  const asset = makeAsset('media-alpha');
  const blob = new Blob([new Uint8Array(4096)], { type: 'video/webm' });
  await registerAssetBlob(asset.id, blob);

  const descriptor = toPersistedAsset(asset);
  assert.equal(descriptor.url, undefined, 'no runtime URL is serialized');
  assert.equal(JSON.stringify(descriptor).includes('blob:'), false, 'no blob URL leaks into JSON');
  assert.equal(descriptor.storageKey, 'media-alpha');

  const stored = await mediaStore.get('media-alpha');
  assert.ok(stored, 'binary is recoverable from the media store');
  assert.equal(stored.size, 4096);
});

test('detectMissingMedia reports clips pointing at absent assets and clears after restore', () => {
  const project = makeProject(['media-alpha', 'media-gone']);
  const assets = [makeAsset('media-alpha'), makeAsset('media-gone', { status: 'missing', url: '' })];

  const missing = detectMissingMedia(project, assets);
  assert.deepEqual(missing, ['media-gone']);

  const allResolved = detectMissingMedia(project, [
    makeAsset('media-alpha'),
    makeAsset('media-gone'),
  ]);
  assert.deepEqual(allResolved, []);

  // Clips referencing ids with no descriptor at all are also reported.
  const orphans = detectMissingMedia(makeProject(['media-unknown']), []);
  assert.deepEqual(orphans, ['media-unknown']);
});

test('validateAndNormalizeProject preserves the asset registry and rejects invalid payloads', () => {
  const registry = [toPersistedAsset(makeAsset('media-alpha'))];
  const valid = validateAndNormalizeProject({
    projectName: 'Com registro',
    aspectRatio: '16:9',
    fps: 30,
    tracks: [track],
    clips: [clipFor('media-alpha')],
    markers: [],
    assetRegistry: registry,
  });
  assert.ok(valid.project);
  assert.equal(valid.project.assetRegistry?.length, 1);
  assert.equal(valid.project.assetRegistry?.[0].id, 'media-alpha');
  assert.equal(valid.project.schemaVersion, 2);

  // Legacy payload without schemaVersion still migrates.
  const legacy = validateAndNormalizeProject({
    projectName: 'Legado',
    aspectRatio: '16:9',
    fps: 30,
    tracks: [track],
    clips: [],
    markers: [],
  });
  assert.ok(legacy.project);

  assert.equal(validateAndNormalizeProject(null).project, undefined);
  assert.equal(validateAndNormalizeProject({ tracks: 'x', clips: [] }).project, undefined);
});

test('session autosave roundtrip restores media binaries after a reload', async () => {
  storageMap.clear();
  const asset = makeAsset('media-session');
  await registerAssetBlob(asset.id, new Blob([new Uint8Array(1024)], { type: 'video/webm' }));

  const project = makeProject(['media-session']);
  const saved = await persistSession(project, [asset]);
  assert.equal(saved.ok, true);

  const restored = await loadPersistedSession();
  assert.ok(restored, 'session is recoverable');
  assert.equal(restored.project.clips.length, 1);
  assert.equal(restored.project.clips[0].startTime, 1.5);
  assert.equal(restored.missing.length, 0);
  assert.equal(restored.assets[0].status, 'ready');
  assert.ok(restored.assets[0].url, 'asset is rehydrated with a usable URL');
  assert.equal(restored.assets[0].duration, 12);
});

test('session marks vanished binaries as missing instead of discarding the project', async () => {
  storageMap.clear();
  const asset = makeAsset('media-vanishing');
  await registerAssetBlob(asset.id, new Blob([new Uint8Array(512)]));
  await persistSession(makeProject(['media-vanishing']), [asset]);

  await mediaStore.delete('media-vanishing'); // simulate storage loss / other device
  const restored = await loadPersistedSession();
  assert.ok(restored);
  assert.equal(restored.missing.length, 1, 'user is told the media is gone');
  assert.equal(restored.missing[0].id, 'media-vanishing');
  assert.equal(restored.assets[0].status, 'missing');
  assert.equal(restored.project.clips.length, 1, 'timeline is preserved for relinking');
});

test('portable package embeds small media, omits oversized media and reimports faithfully', async () => {
  storageMap.clear();
  const small = makeAsset('media-small');
  const big = makeAsset('media-big', { size: 50 * 1024 * 1024 });
  await registerAssetBlob(small.id, new Blob([new Uint8Array(2048)], { type: 'video/webm' }));
  await registerAssetBlob(big.id, new Blob([new Uint8Array(9000)], { type: 'video/webm' }));

  const project = makeProject(['media-small', 'media-big']);
  const { blob, filename, omittedCount } = await buildProjectPackage(project, [small, big], {
    embedLimitBytes: 4096,
  });
  assert.ok(filename.endsWith('.ottoproj.json'));
  assert.equal(omittedCount, 1, 'oversized asset is reported, never silently dropped');

  const pkg = JSON.parse(await blob.text());
  assert.equal(pkg.format, 'cinecorte-project');
  assert.ok(pkg.media['media-small'], 'small media is embedded');
  assert.equal(pkg.media['media-big'], undefined);
  assert.deepEqual(pkg.omitted, ['media-big']);

  await mediaStore.clear();
  storageMap.clear();
  const file = new File([blob], filename, { type: 'application/json' });
  const imported = await parseProjectPackage(file);
  assert.equal(imported.project.clips.length, 2);
  assert.equal(imported.missing.length, 1);
  assert.equal(imported.missing[0].id, 'media-big');
  assert.equal(imported.warnings.length, 1, 'user gets an explicit relink warning');
  const readyAsset = imported.assets.find((a) => a.id === 'media-small');
  assert.equal(readyAsset?.status, 'ready');
  assert.ok(await mediaStore.get('media-small'), 'embedded media lands in the media store');
});

test('parseProjectPackage rejects malformed files with clear errors', async () => {
  const badJson = new File(['{ not json'], 'quebrado.json', { type: 'application/json' });
  await assert.rejects(() => parseProjectPackage(badJson), /JSON válido/);

  const wrongShape = new File([JSON.stringify({ format: 'outro-app', project: {} })], 'x.json', {
    type: 'application/json',
  });
  await assert.rejects(() => parseProjectPackage(wrongShape), /inválid|desconhecido/);
});

test('rehydrateAssetsFromRegistry rebuilds only what the media store still holds', async () => {
  await mediaStore.clear();
  const present = makeAsset('media-here');
  await registerAssetBlob(present.id, new Blob([new Uint8Array(256)]));
  const registry = [toPersistedAsset(present), toPersistedAsset(makeAsset('media-absent'))];

  const { assets, missing } = await rehydrateAssetsFromRegistry(registry);
  assert.equal(assets.length, 2);
  assert.deepEqual(missing.map((m) => m.id), ['media-absent']);
  assert.equal(assets.find((a) => a.id === 'media-here')?.status, 'ready');
});
