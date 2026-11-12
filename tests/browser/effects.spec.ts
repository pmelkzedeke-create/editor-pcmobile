import { expect, test } from '@playwright/test';
import { useManualPreview } from './helpers/manualPreview';

const sampleBrightness = (canvas: HTMLCanvasElement) => {
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let total = 0;
  for (let i = 0; i < pixels.length; i += 160) total += pixels[i] + pixels[i + 1] + pixels[i + 2];
  return total;
};

test('Sapphire effects stack, render, reorder and persist in the project', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await useManualPreview(page);
  const monitor = page.getByTestId('program-monitor');
  await expect(monitor).toBeVisible();
  await expect.poll(() => monitor.evaluate(sampleBrightness)).toBeGreaterThan(10000);
  const clean = await monitor.evaluate(sampleBrightness);

  await page.getByRole('button', { name: 'Efeitos', exact: true }).first().click();
  await page.getByLabel('Buscar efeito Sapphire').fill('glow');
  await expect(page.locator('.effect-item')).toHaveCount(1);
  await page.locator('.effect-item').click();

  await expect(page.getByTestId('effect-controls')).toBeVisible();
  await expect(page.getByTestId('effect-controls')).toContainText('S_Glow');
  await expect.poll(() => monitor.evaluate(sampleBrightness)).toBeGreaterThan(clean * 1.02);
  const glowing = await monitor.evaluate(sampleBrightness);
  await page.screenshot({ path: 'test-results/effects-glow.png' });

  // Disabling an effect must restore the original frame exactly.
  await page.getByRole('button', { name: 'Desativar S_Glow', exact: true }).click();
  await expect.poll(() => monitor.evaluate(sampleBrightness)).toBe(clean);
  await page.getByRole('button', { name: 'Ativar S_Glow', exact: true }).click();
  await expect.poll(() => monitor.evaluate(sampleBrightness)).toBe(glowing);

  const intensity = page.getByLabel('S_Glow Intensidade', { exact: true });
  await intensity.fill('200');
  await expect.poll(() => monitor.evaluate(sampleBrightness)).toBeGreaterThan(glowing);
  await expect(page.locator('.fx-param-value').first()).toContainText('200%');

  await page.getByLabel('Buscar efeito Sapphire').fill('mosaic');
  await page.locator('.effect-item').click();
  await expect(page.locator('.effect-stack-item')).toHaveCount(2);
  const stacked = await monitor.evaluate(sampleBrightness);

  // Effect order changes the look, exactly like the After Effects stack.
  await page.getByRole('button', { name: 'Mover efeito para cima' }).nth(1).click();
  await expect(page.locator('.effect-stack-item .fx-name').first()).toContainText('S_Mosaic');
  await expect.poll(() => monitor.evaluate(sampleBrightness)).not.toBe(stacked);

  await page.getByRole('button', { name: 'Remover S_Mosaic', exact: true }).click();
  await expect(page.locator('.effect-stack-item')).toHaveCount(1);

  await page.getByRole('button', { name: 'Efeitos', exact: true }).first().click();
  await page.getByRole('button', { name: 'VHS Retro', exact: true }).click();
  await expect(page.locator('.effect-stack-item')).toHaveCount(4);
  await expect(page.locator('.fx-clip-badge').first()).toContainText('fx 4');
  await page.screenshot({ path: 'test-results/effects-vhs.png' });

  await page.keyboard.press('Control+z');
  await expect(page.locator('.effect-stack-item')).toHaveCount(1);
  await page.keyboard.press('Control+y');
  await expect(page.locator('.effect-stack-item')).toHaveCount(4);

  await page.keyboard.press('Home');
  await page.keyboard.press('b');
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('n');
  await page.getByRole('button', { name: /Renderizar previa/ }).click();
  await expect(page.locator('.preview-cache-status')).toContainText('12 quadros');
  await page.keyboard.press('Home');
  await expect(page.locator('.monitor-cache-label')).toContainText('Cache');

  await page.getByRole('button', { name: 'OTTO', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Salvar Projeto (.json)', exact: true }).click();
  const file = await (await download).path();
  expect(file).toBeTruthy();
  expect(errors).toEqual([]);
});

test('effects render deterministically and reach the exported video', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { buildInitialWorkspace } = await import('/src/utils/initialProject.ts');
    const { renderFrameToCanvas, MediaElementPool } = await import('/src/utils/compositor.ts');
    const { createEffect, EFFECT_DEFINITIONS } = await import('/src/utils/sapphireEffects.ts');
    const { prepareMediaFrame } = await import('/src/utils/previewCache.ts');
    const workspace = buildInitialWorkspace();
    const assets = new Map(workspace.assets.map((asset) => [asset.id, asset]));
    const signal = new AbortController().signal;
    const baseClip = { ...workspace.project.clips[0], startTime: 0, duration: 4, transitionIn: 'none', transitionOut: 'none', motionPreset: 'none' };

    const draw = async (clip: unknown, time: number) => {
      const project = { ...workspace.project, clips: [clip as never] };
      const pool = new MediaElementPool();
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext('2d')!;
      await prepareMediaFrame(project, assets, pool, time, signal);
      renderFrameToCanvas(context, 320, 180, project.tracks, project.clips, assets, pool, time);
      pool.dispose();
      const data = context.getImageData(0, 0, 320, 180).data;
      const hash = await crypto.subtle.digest('SHA-256', data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      return { hash: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join(''), sum };
    };

    const plain = await draw(baseClip, 1);
    const changed: string[] = [];
    const broken: string[] = [];
    for (const definition of EFFECT_DEFINITIONS) {
      // For S_TimeSlice on a static image, enable mask or offset so temporal slices produce measurable difference on a single static frame
      const overrides = definition.type === 'S_TimeSlice' ? { maskType: 1, maskFeather: 6 } : {};
      const clip = { ...baseClip, effects: [createEffect(definition.type, overrides)] };
      const first = await draw(clip, 1);
      const repeat = await draw(clip, 1);
      if (first.hash !== plain.hash) changed.push(definition.type);
      // Identical inputs must produce identical output, otherwise exports would flicker.
      if (first.hash !== repeat.hash || !Number.isFinite(first.sum) || first.sum === 0) broken.push(definition.type);
    }
    const animated = await draw({ ...baseClip, effects: [createEffect('S_LightLeak')] }, 2.5);
    const animatedStart = await draw({ ...baseClip, effects: [createEffect('S_LightLeak')] }, 0.2);
    return { total: EFFECT_DEFINITIONS.length, changed: changed.length, broken, animates: animated.hash !== animatedStart.hash };
  });
  expect(result.broken).toEqual([]);
  expect(result.changed).toBe(result.total);
  expect(result.animates).toBe(true);

  const exported = await page.evaluate(async () => {
    const { buildInitialWorkspace } = await import('/src/utils/initialProject.ts');
    const { exportProjectToVideoFile } = await import('/src/utils/compositor.ts');
    const { createEffect } = await import('/src/utils/sapphireEffects.ts');
    const { seekVideoFrame } = await import('/src/utils/previewCache.ts');
    const workspace = buildInitialWorkspace();
    const clip = {
      ...workspace.project.clips[0],
      startTime: 0,
      duration: 1,
      transitionIn: 'none',
      transitionOut: 'none',
      effects: [createEffect('S_Glow', { brightness: 200, size: 90 }), createEffect('S_LensFlare')],
    };
    const plainClip = { ...clip, effects: [] };
    const measure = async (target: unknown) => {
      const output = await exportProjectToVideoFile({ ...workspace.project, clips: [target as never] }, workspace.assets, '720p', () => {}, new AbortController().signal);
      const video = document.createElement('video');
      video.src = URL.createObjectURL(output.blob);
      video.muted = true;
      await seekVideoFrame(video, 0.4, new AbortController().signal);
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const context = canvas.getContext('2d')!;
      context.drawImage(video, 0, 0, 160, 90);
      const data = context.getImageData(0, 0, 160, 90).data;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) total += data[i] + data[i + 1] + data[i + 2];
      URL.revokeObjectURL(video.src);
      video.removeAttribute('src');
      video.load();
      return { size: output.blob.size, brightness: total / (data.length / 4) };
    };
    const withEffects = await measure(clip);
    const withoutEffects = await measure(plainClip);
    return { size: withEffects.size, bright: withEffects.brightness, plain: withoutEffects.brightness };
  });
  expect(exported.size).toBeGreaterThan(5000);
  expect(exported.bright).toBeGreaterThan(exported.plain * 1.05);
});
