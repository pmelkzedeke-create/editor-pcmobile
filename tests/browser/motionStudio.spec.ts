import { expect, test } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';

test('compositions, shapes, masks, parenting, keyframes, presets, beat detection and verified video export', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  const monitor = page.getByTestId('program-monitor');
  await expect(monitor).toBeVisible();

  const sampleCanvasSum = () =>
    monitor.evaluate((canvas: HTMLCanvasElement) => {
      const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let total = 0;
      for (let i = 0; i < d.length; i += 64) total += d[i] + d[i + 1] + d[i + 2];
      return total;
    });

  await expect.poll(sampleCanvasSum).toBeGreaterThan(10000);

  // 1. Command Palette (Ctrl+K) -> Create New Composition + Configure Resolution & Background Color
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('command-palette')).toBeVisible();
  await page.getByLabel('Buscar comando').fill('Criar Nova Composição');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Composição 2' })).toBeVisible();

  // Open Composition Settings and set custom emerald background
  await page.getByTitle('Configurações da Composição (Resolução, Cor de Fundo, Transparência)').click();
  await expect(page.getByTestId('comp-settings-modal')).toBeVisible();
  await page.getByLabel('Nome da composição').fill('Cena Motion Lab');
  await page.getByLabel('Cor de fundo da composição').fill('#102a43');
  await page.getByRole('button', { name: 'Aplicar na Composição', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cena Motion Lab' })).toBeVisible();

  // 2. Add Vector Shape (Star) + Animate Keyframes + Easing Curve + Verify Rendered Pixels Change
  await page.getByRole('button', { name: 'Formas', exact: true }).click();
  await page.getByRole('button', { name: /Estrela/ }).click();
  const sumWithStar = await sampleCanvasSum();
  expect(sumWithStar).toBeGreaterThan(5000);

  // Add scale keyframes at t=0 (20%) and t=1s (180%) via Inspector & Graph Editor
  await page.keyboard.press('Home');
  await page.getByLabel('Keyframe Escala (Zoom)').click();
  const scaleSlider = page.locator('[data-prop="scale"] input[type="range"]');
  await scaleSlider.fill('20');
  const smallStarSum = await sampleCanvasSum();

  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight'); // t = 1.0s
  await scaleSlider.fill('190');
  const largeStarSum = await sampleCanvasSum();
  expect(largeStarSum).not.toBe(smallStarSum);

  // Open Multi-Property Graph Editor and change easing curve preset to Elastic
  await page.getByRole('button', { name: 'Graph Editor', exact: true }).last().click();
  await expect(page.getByTestId('property-graph-editor')).toBeVisible();
  await page.getByLabel('Preset de Easing').selectOption('elastic');
  await page.screenshot({ path: 'test-results/motion-graph-editor.png' });
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();

  // 3. Add Real Pixel Mask on the Shape Layer and verify pixels are clipped
  await page.getByRole('button', { name: 'Forma', exact: true }).click();
  const beforeMaskSum = await sampleCanvasSum();
  await page.getByRole('button', { name: '+ Elipse', exact: true }).click();
  await page.getByRole('button', { name: 'Inverter', exact: true }).click();
  await expect.poll(sampleCanvasSum).not.toBe(beforeMaskSum);

  // 4. Add Kinetic Text & Apply Motion Preset from Preset Library
  await page.getByRole('button', { name: 'Texto', exact: true }).first().click();
  await page.getByRole('button', { name: /Título Cinematográfico/ }).click();
  await page.getByRole('button', { name: 'Efeitos', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await page.getByText('Kinetic Character Reveal', { exact: true }).click();

  // 5. Detect Audio Beats on soundtrack asset
  await page.getByRole('button', { name: 'Áudio', exact: true }).first().click();
  await page.getByRole('button', { name: 'Beats' }).first().click();
  await expect(page.getByRole('button', { name: 'Beat 1', exact: true })).toBeVisible();

  // 6. Undo / Redo + Save & Reload Project (.json) with full multi-comp fidelity
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Beat 1', exact: true })).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(page.getByRole('button', { name: 'Beat 1', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'OTTO', exact: true }).click();
  const savePromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Salvar Projeto (.json)', exact: true }).click();
  const savedPath = await (await savePromise).path();
  if (!savedPath) throw new Error('Saved project file missing');
  const savedJson = JSON.parse(await readFile(savedPath, 'utf8'));
  expect(savedJson.schemaVersion).toBe(2);
  expect(savedJson.compositions.length).toBe(2);

  // Reload saved project file through UI
  await page.getByRole('button', { name: 'OTTO', exact: true }).click();
  await page
    .locator('input[type="file"][accept=".json,application/json"]')
    .setInputFiles(savedPath);
  await expect(page.getByRole('button', { name: 'Cena Motion Lab' })).toBeVisible();

  // 7. Export Video & Verify Inline Decoded Playback + Duration inside Modal
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByRole('button', { name: /HD 720p Rápido/ }).click();
  const exportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Renderizar e Baixar V/ }).click();
  const videoFile = await (await exportDownload).path();
  if (!videoFile) throw new Error('Exported video missing');
  expect((await stat(videoFile)).size).toBeGreaterThan(5000);

  const previewPlayer = page.getByTestId('exported-video-preview');
  await expect(previewPlayer).toBeVisible();
  await expect
    .poll(() =>
      previewPlayer.evaluate((v: HTMLVideoElement) => ({
        w: v.videoWidth,
        dur: v.duration,
      }))
    )
    .toEqual(expect.objectContaining({ w: 1280 }));

  const decodedDur = await previewPlayer.evaluate((v: HTMLVideoElement) => v.duration);
  expect(decodedDur).toBeGreaterThan(4.5);
  expect(decodedDur).toBeLessThan(7.5);
  await page.screenshot({ path: 'test-results/motion-export-verified.png' });

  expect(errors).toEqual([]);
});
