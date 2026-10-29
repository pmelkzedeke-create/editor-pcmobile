import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function createVideo(page: Page, mode: 'point' | 'camera' | 'cutout'): Promise<Buffer> {
  const bytes = await page.evaluate(async (kind) => {
    const { encodeVisionVideo } = await import('/tests/fixtures/visionVideo.ts');
    return encodeVisionVideo(kind);
  }, mode);
  return Buffer.from(bytes);
}

async function importFixture(page: Page, mode: 'point' | 'camera' | 'cutout') {
  const bytes = await createVideo(page, mode);
  await page.getByRole('button', { name: 'OTTO', exact: true }).click();
  await page.getByRole('button', { name: 'Novo Projeto em Branco', exact: true }).click();
  await page.locator('input[type="file"][accept^="video/*,image/*,audio/*"]').first().setInputFiles({ name: `vision-${mode}.webm`, mimeType: 'video/webm', buffer: bytes });
  const asset = page.locator('[draggable="true"]').filter({ has: page.getByText(`vision-${mode}.webm`, { exact: true }) });
  await expect(asset).toBeVisible();
  await asset.getByTitle('Adicionar à linha do tempo').click();
  await page.getByRole('button', { name: /VFX · Recorte/ }).click();
  await expect(page.getByTestId('motion-tools-panel')).toBeVisible();
}

async function downloadProject(page: Page) {
  await page.getByRole('button', { name: 'OTTO', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Salvar Projeto (.json)', exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error('Projeto nao foi salvo');
  return { path, project: JSON.parse(await readFile(path, 'utf8')) };
}

test('automatic cache follows scrubbing and playback without R and pauses on demand', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const auto = page.getByRole('button', { name: 'Cache automatico da timeline' });
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.preview-cache-status')).toContainText(/\d+ quadros/);
  await expect(page.locator('.monitor-cache-label')).toContainText('Cache');
  await page.keyboard.press('Home');
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('.font-mono-code.text-xs.font-semibold').first()).toContainText('00:04:00');
  await expect(page.locator('.monitor-cache-label')).toContainText('Cache');
  const before = Number((await page.locator('.preview-cache-status').innerText()).match(/(\d+) quadros/)?.[1]);
  await page.keyboard.press('Space');
  await page.waitForTimeout(650);
  await page.keyboard.press('Space');
  await expect.poll(async () => Number((await page.locator('.preview-cache-status').innerText()).match(/(\d+) quadros/)?.[1] || 0)).toBeGreaterThan(before);
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('Limpar cache da previa', { exact: true }).click();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('cached-range')).toHaveCount(0);
  await auto.click();
  await expect(page.getByTestId('cached-range').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/auto-preview-timeline.png' });
  expect(errors).toEqual([]);
});

test('local cutout and object cleanup change pixels, undo, persist and reach a decoded export', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await importFixture(page, 'cutout');
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
  const sourceCanvas = page.getByTestId('vision-source-canvas');
  const pixel = (x: number, y: number) => sourceCanvas.evaluate((c: HTMLCanvasElement, p) => [...c.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data], { x, y });
  await expect.poll(() => pixel(110, 60)).toEqual([expect.any(Number), expect.any(Number), expect.any(Number), 255]);
  await page.getByRole('switch', { name: 'Ativar remocao de fundo', exact: true }).click();
  await expect.poll(async () => (await pixel(10, 10))[3]).toBe(0);
  await expect.poll(async () => (await pixel(110, 60))[3]).toBe(255);
  await page.screenshot({ path: 'test-results/vfx-background-cutout.png' });
  await page.getByRole('switch', { name: 'Ativar remocao de fundo', exact: true }).click();
  await page.getByRole('switch', { name: 'Ativar remocao de objeto', exact: true }).click();
  await expect.poll(async () => (await pixel(110, 60))[1]).toBeGreaterThan(200);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('switch', { name: 'Ativar remocao de objeto', exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Control+y');
  await expect(page.getByRole('switch', { name: 'Ativar remocao de objeto', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: 'test-results/vfx-object-clone.png' });
  const saved = await downloadProject(page);
  expect(saved.project.clips[0].vfx.cleanup.enabled).toBe(true);
  await page.getByRole('button', { name: 'OTTO', exact: true }).click();
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles(saved.path);
  await expect(page.getByRole('button', { name: /VFX · Recorte/ })).toBeVisible();
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByRole('button', { name: /HD 720p/ }).click();
  const videoFile = page.waitForEvent('download');
  await page.getByRole('button', { name: /Renderizar e Baixar V/ }).click();
  await videoFile;
  const player = page.getByTestId('exported-video-preview');
  await expect(player).toBeVisible();
  const decoded = await player.evaluate(async (v: HTMLVideoElement) => {
    const { seekVideoFrame } = await import('/src/utils/previewCache.ts');
    await seekVideoFrame(v, 0.5);
    const c = document.createElement('canvas'); c.width = 256; c.height = 144;
    const ctx = c.getContext('2d')!; ctx.drawImage(v, 0, 0, 256, 144);
    return { pixel: [...ctx.getImageData(110, 60, 1, 1).data], width: v.videoWidth, duration: v.duration };
  });
  expect(decoded.pixel[1]).toBeGreaterThan(190);
  expect(decoded.width).toBe(1280);
  expect(decoded.duration).toBeCloseTo(saved.project.clips[0].duration, 2);
  expect(errors).toEqual([]);
});

test('real video point tracking and camera stabilization produce measured, saved data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await importFixture(page, 'point');
  await page.getByRole('button', { name: 'Analisar ponto selecionado', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reanalisar ponto', exact: true })).toBeVisible();
  await expect(page.locator('.vision-ready')).toContainText(/\d+ amostras/);
  const pointProject = await downloadProject(page);
  const tracking = pointProject.project.clips[0].vfx.tracking;
  expect(tracking.samples.length).toBeGreaterThan(20);
  const dx = tracking.samples[tracking.samples.length - 1].x - tracking.samples[0].x;
  expect(dx).toBeGreaterThan(0.08);
  expect(dx).toBeLessThan(0.15);
  expect(tracking.samples.every((p: { confidence: number }) => p.confidence > 0.55)).toBe(true);
  await page.screenshot({ path: 'test-results/vfx-point-tracking.png' });

  // Convert actual motion into another layer's X/Y keyframes, with Undo support.
  await page.getByRole('button', { name: 'Texto', exact: true }).first().click();
  await page.getByRole('button', { name: /Titulo Cinematografico|Título Cinematográfico/ }).click();
  await page.locator('.timeline-panel [class*="group/clip"]').filter({ hasText: 'vision-point.webm' }).click({ position: { x: 40, y: 12 } });
  await page.getByLabel('Camada para receber tracking').selectOption({ label: 'Texto • Título Cinematográfico' });
  await page.getByRole('button', { name: 'Converter em keyframes X/Y', exact: true }).click();
  const baked = await downloadProject(page);
  const target = baked.project.clips.find((c: { type: string }) => c.type === 'text');
  expect(target.keyframes.find((tr: { property: string }) => tr.property === 'x').keyframes.length).toBeGreaterThan(20);
  await page.keyboard.press('Control+z');
  const undone = await downloadProject(page);
  expect(undone.project.clips.find((c: { type: string }) => c.type === 'text').keyframes).toBeUndefined();

  // A different clip containing actual camera shake, not a canned trajectory.
  await page.getByRole('button', { name: 'Mídia', exact: true }).click();
  await importFixture(page, 'camera');
  await page.getByRole('button', { name: 'Analisar e estabilizar', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Ativar estabilizacao', exact: true })).toHaveAttribute('aria-checked', 'true');
  const stabilized = await downloadProject(page);
  const stabilization = stabilized.project.clips[0].vfx.stabilization;
  expect(stabilization.analysis.samples.length).toBeGreaterThan(20);
  const xs = stabilization.analysis.samples.map((p: { x: number }) => p.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.01);
  await page.getByLabel('Forca da estabilizacao').fill('0');
  await page.screenshot({ path: 'test-results/vfx-camera-stabilization.png' });
  expect(errors).toEqual([]);
});

test('motion analysis can be cancelled without overwriting the project', async ({ page }) => {
  await page.goto('/');
  await importFixture(page, 'camera');
  await page.getByRole('button', { name: 'Analisar e estabilizar', exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar analise de movimento', exact: true }).click();
  await expect(page.locator('.vision-progress')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Ativar estabilizacao', exact: true })).toHaveCount(0);
  const saved = await downloadProject(page);
  expect(saved.project.clips[0].vfx?.stabilization).toBeUndefined();
});

test('VFX remains accessible on a narrow viewport and rejects a textureless tracking point', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await importFixture(page, 'cutout');
  // Leave the inspector before opening its responsive, reusable tool dialog.
  await page.getByRole('button', { name: 'Transf', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Abrir ferramentas VFX', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ferramentas VFX', exact: true });
  await expect(dialog).toBeVisible();
  const source = dialog.getByTestId('vision-source-view');
  const box = await source.boundingBox();
  if (!box) throw new Error('Source selection missing');
  await source.click({ position: { x: box.width * 0.45, y: box.height * 0.42 } });
  await dialog.getByRole('button', { name: 'Analisar ponto selecionado', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('sem textura');
  await expect(dialog.locator('.vision-ready')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/vfx-responsive-tools.png' });
  await page.getByRole('button', { name: 'Fechar ferramentas VFX', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('measured stabilization reduces rendered jitter and matches the encoded output', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { encodeVisionVideo } = await import('/tests/fixtures/visionVideo.ts');
    const { parseUploadedMediaFile, createClipFromAsset, DEFAULT_FILTERS } = await import('/src/utils/mediaHelpers.ts');
    const { analyzeMotion } = await import('/src/core/vision/analyzeMotion.ts');
    const { MediaElementPool, renderFrameToCanvas, exportProjectToVideoFile } = await import('/src/utils/compositor.ts');
    const { prepareMediaFrame, seekVideoFrame } = await import('/src/utils/previewCache.ts');
    const { validateAndNormalizeProject } = await import('/src/core/compositions.ts');
    const bytes = await encodeVisionVideo('camera');
    const asset = await parseUploadedMediaFile(new File([new Uint8Array(bytes)], 'shaky.webm', { type: 'video/webm' }));
    if (!asset) throw new Error('Fixture video did not decode');
    const signal = new AbortController().signal;
    const plain = { ...createClipFromAsset(asset, 'v1', 0), duration: 0.8, transitionIn: 'none', transitionOut: 'none', motionPreset: 'none', filters: { ...DEFAULT_FILTERS }, muted: true };
    const analysis = await analyzeMotion(asset, plain, 'camera', { x: 0.5, y: 0.5, time: 0 }, signal, () => {});
    const stable = { ...plain, vfx: { stabilization: { enabled: true, strength: 100, smoothing: 0.4, crop: 0, analysis } } };
    const project = { projectName: 'Stabilized render test', fps: 30, aspectRatio: '16:9', tracks: [{ id: 'v1', name: 'Video', type: 'video', hidden: false, muted: true, locked: false }], clips: [stable], markers: [] };
    const normalized = validateAndNormalizeProject(JSON.parse(JSON.stringify(project))).project;
    if (!normalized) throw new Error('Project failed validation');
    const assets = new Map([[asset.id, asset]]);
    const pool = new MediaElementPool();
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d')!;
    const frame = async (clip: typeof plain, time: number) => {
      const snapshot = { ...normalized, clips: [clip] };
      await prepareMediaFrame(snapshot, assets, pool, time, signal);
      renderFrameToCanvas(ctx, 320, 180, snapshot.tracks, snapshot.clips, assets, pool, time);
      return ctx.getImageData(60, 35, 200, 110).data;
    };
    const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
    const plainA = await frame(plain, 4 / 15);
    const plainB = await frame(plain, 5 / 15);
    const stableA = await frame(stable, 4 / 15);
    const stableB = await frame(stable, 5 / 15);
    const output = await exportProjectToVideoFile(normalized, [asset], '720p', () => {}, signal);
    const video = document.createElement('video');
    const url = URL.createObjectURL(output.blob); video.src = url; video.muted = true;
    await seekVideoFrame(video, 4 / 15, signal);
    ctx.drawImage(video, 0, 0, 320, 180);
    const decoded = ctx.getImageData(60, 35, 200, 110).data;
    const metrics = { originalJitter: difference(plainA, plainB), stabilizedJitter: difference(stableA, stableB), exportDifference: difference(stableA, decoded), duration: video.duration, preservedSamples: normalized.clips[0].vfx!.stabilization!.analysis.samples.length };
    pool.dispose(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
    return metrics;
  });
  expect(result.stabilizedJitter).toBeLessThan(result.originalJitter * 0.5);
  expect(result.exportDifference).toBeLessThan(10);
  expect(result.duration).toBeCloseTo(0.8, 2);
  expect(result.preservedSamples).toBeGreaterThan(8);
});