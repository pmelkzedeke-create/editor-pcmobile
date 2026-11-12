import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/** Generates a short real WebM recording to use as user media. */
async function makeTestVideo(page: import('@playwright/test').Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d')!;
    const stream = canvas.captureStream(15);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks: Blob[] = [];
    const recording = new Promise<Blob>((resolve) => {
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    });
    recorder.start(100);
    const timer = setInterval(() => {
      context.fillStyle = `hsl(${performance.now() % 360}, 70%, 50%)`;
      context.fillRect(0, 0, 160, 90);
    }, 50);
    await new Promise((resolve) => setTimeout(resolve, 900));
    recorder.stop();
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    const blob = await recording;
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
}

test('autosave status is visible and media survives reload through session recovery', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await expect(page.getByTestId('program-monitor')).toBeVisible();

  const video = await makeTestVideo(page);
  await page
    .locator('input[type="file"][accept^="video/*,image/*,audio/*"]')
    .first()
    .setInputFiles({ name: 'cena-do-usuario.webm', mimeType: 'video/webm', buffer: video });

  await expect(page.getByText('cena-do-usuario.webm', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar à linha do tempo' }).first().click();

  // Save status must move through dirty -> saved (never silent).
  await expect(page.getByTestId('save-status-text')).toContainText('não salvas');
  await expect(page.getByTestId('save-status-text')).toContainText(/Salvo \d/);

  // Interrupted session: reload keeps the persisted session and offers recovery.
  await page.reload();
  await expect(page.getByTestId('recovery-banner')).toBeVisible();
  await page.getByTestId('recover-session').click();

  // The uploaded media binary and its timeline clip both come back.
  await expect(page.getByText('cena-do-usuario.webm', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('save-status-text')).toContainText(/Salvo|Tudo salvo/);
  await expect(page.locator('.timeline-panel')).toBeVisible();
  expect(errors).toEqual([]);
});

test('missing media is detected after storage loss and relinked without breaking the timeline', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  const video = await makeTestVideo(page);
  await page
    .locator('input[type="file"][accept^="video/*,image/*,audio/*"]')
    .first()
    .setInputFiles({ name: 'midia-que-vai-sumir.webm', mimeType: 'video/webm', buffer: video });
  await expect(page.getByText('midia-que-vai-sumir.webm', { exact: true }).first()).toBeVisible();
  // Wait for a completed save before simulating storage loss.
  await expect(page.getByTestId('save-status-text')).toContainText(/Salvo \d/);

  // Simulate media storage loss on another machine: descriptors stay, binaries vanish.
  await page.evaluate(async () => {
    const { mediaStore } = await import('/src/core/persistence/mediaStore.ts');
    for (const key of await mediaStore.listKeys()) await mediaStore.delete(key);
  });

  await page.reload();
  await expect(page.getByTestId('recovery-banner')).toBeVisible();
  await page.getByTestId('recover-session').click();

  // Project is preserved and the user is asked to relink explicitly.
  const modal = page.getByRole('dialog', { name: 'Mídias ausentes' });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('midia-que-vai-sumir.webm');
  await expect(modal).toContainText('timeline foi preservada');

  await modal.locator('input[type="file"]').setInputFiles({
    name: 'midia-que-vai-sumir.webm',
    mimeType: 'video/webm',
    buffer: video,
  });

  await expect(modal).toBeHidden();
  await expect(page.getByText('midia-que-vai-sumir.webm', { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('portable package exports media and reimports the full timeline', async ({ page }) => {
  await page.goto('/');
  const video = await makeTestVideo(page);
  await page
    .locator('input[type="file"][accept^="video/*,image/*,audio/*"]')
    .first()
    .setInputFiles({ name: 'pacote-clip.webm', mimeType: 'video/webm', buffer: video });
  await expect(page.getByText('pacote-clip.webm', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('save-status-text')).toContainText(/Salvo \d/);

  await page.getByRole('button', { name: 'OTTO', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar Pacote de Projeto…', exact: true }).click();
  const savedPackage = await download;
  const path = await savedPackage.path();
  if (!path) throw new Error('Pacote de projeto não foi gerado');
  expect(savedPackage.suggestedFilename()).toMatch(/\.ottoproj\.json$/);

  const pkg = JSON.parse(await readFile(path, 'utf8'));
  expect(pkg.format).toBe('cinecorte-project');
  expect(pkg.formatVersion).toBe(3);
  expect(Object.keys(pkg.media).length).toBeGreaterThanOrEqual(1);

  // Fresh session: open the package through the UI.
  await page.getByRole('button', { name: 'OTTO', exact: true }).click();
  await page.getByRole('button', { name: 'Novo Projeto em Branco', exact: true }).click();
  await page.getByRole('button', { name: 'OTTO', exact: true }).click();
  await page.locator('input[type="file"][accept=".json,.ottoproj.json,application/json"]').setInputFiles(path);

  await expect(page.getByText('pacote-clip.webm', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Mídias ausentes' })).toHaveCount(0);
});
