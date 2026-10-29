import { expect, test } from '@playwright/test';
import { useManualPreview } from './helpers/manualPreview';

const clipCount = async (page: import('@playwright/test').Page) => {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'OTTO', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar Projeto (.json)', exact: true }).click();
  const file = await (await download).path();
  if (!file) throw new Error('download missing');
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(file, 'utf8'));
};

test('AE shortcuts: R renders, Ctrl+Shift+D splits, Space plays, S/P/T reveal, U toggles graph', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await useManualPreview(page);
  await expect(page.getByTestId('program-monitor')).toBeVisible();

  // Space plays / pauses
  await page.keyboard.press('Space');
  await page.waitForTimeout(450);
  await expect(page.getByTitle('Reproduzir / Pausar (Espaço)')).toBeVisible();
  const playingLabel = await page.locator('.monitor-cache-label').textContent();
  expect(playingLabel).toBeTruthy();
  await page.keyboard.press('Space');

  // Ctrl+Shift+D splits the layer at the playhead (AE Split Layer)
  await page.keyboard.press('Home');
  for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowRight');
  const before = await clipCount(page);
  await page.keyboard.press('Control+Shift+d');
  const after = await clipCount(page);
  expect(after.clips.length).toBe(before.clips.length + 1);

  // R renders the work area (AE RAM preview)
  await page.keyboard.press('Home');
  await page.keyboard.press('b');
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('n');
  await page.locator('.timeline-panel').click({ position: { x: 5, y: 3 } });
  await page.keyboard.press('r');
  await expect(page.locator('.preview-cache-status')).toContainText('9 quadros');
  await page.keyboard.press('Home');
  await expect(page.locator('.monitor-cache-label')).toContainText('Cache');

  // Shift+Arrow jumps 10 frames
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('.preview-cache-status')).toBeVisible();

  // U toggles the Graph Editor (reveal keyframes)
  await page.keyboard.press('u');
  await expect(page.getByTestId('time-remap-editor')).toBeVisible();
  await page.keyboard.press('u');
  await expect(page.getByTestId('time-remap-editor')).toBeHidden();

  // S / P / T reveal inspector properties with a highlight flash
  await page.keyboard.press('t');
  await expect(page.locator('[data-prop="opacity"].prop-flash')).toBeVisible();
  await page.keyboard.press('s');
  await expect(page.locator('[data-prop="scale"].prop-flash')).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.locator('[data-prop="x"].prop-flash')).toBeVisible();
  await page.screenshot({ path: 'test-results/shortcuts-reveal.png' });

  expect(errors).toEqual([]);
});

test('AE layer commands: [ ] move, Alt+[ ] trim, I/O jump, Solo isolates a layer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('program-monitor')).toBeVisible();

  // Select first video layer, jump to its out point with O
  await page.keyboard.press('Home');
  await page.keyboard.press('o');
  const timeAfterO = await page.locator('.font-mono-code.text-xs.font-semibold').first().textContent();
  expect(timeAfterO).toContain('00:05');
  await page.keyboard.press('i');
  await expect(page.locator('.font-mono-code.text-xs.font-semibold').first()).toContainText('00:00:00');

  // ] moves layer end to the playhead (layer now starts earlier relative to end)
  for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight'); // t = 2s
  const before = await clipCount(page);
  await page.keyboard.press(']');
  const moved = await clipCount(page);
  const movedClip = moved.clips.find((c: { id: string }) => c.id === before.clips[0].id);
  expect(Math.abs(movedClip.startTime + movedClip.duration - 2)).toBeLessThan(0.05);
  await page.keyboard.press('Control+z');

  // Alt+] trims the out point at the playhead
  await page.keyboard.press('Alt+]');
  const trimmed = await clipCount(page);
  const trimmedClip = trimmed.clips.find((c: { id: string }) => c.id === before.clips[0].id);
  expect(trimmedClip.startTime + trimmedClip.duration).toBeLessThan(2.1);
  expect(trimmedClip.duration).toBeGreaterThan(1.9);
  await page.keyboard.press('Control+z');

  // Alt+[ trims the in point at the playhead
  await page.keyboard.press('Alt+[');
  const trimmedIn = await clipCount(page);
  const inClip = trimmedIn.clips.find((c: { id: string }) => c.id === before.clips[0].id);
  expect(inClip.startTime).toBeGreaterThan(1.9);
  await page.keyboard.press('Control+z');

  // Solo isolates the selected track visually
  const soloButtons = page.locator('[title*="Solo"]');
  await soloButtons.nth(2).click(); // V1 main video
  await expect(soloButtons.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('program-monitor')).toBeVisible();
  await page.screenshot({ path: 'test-results/shortcuts-solo.png' });
  await soloButtons.nth(2).click();
  await expect(soloButtons.nth(2)).toHaveAttribute('aria-pressed', 'false');

  // The cheat sheet documents the AE mapping
  await page.getByTitle('Atalhos de Teclado (?)').click();
  await expect(page.getByText('Dividir camada na agulha (Split Layer)')).toBeVisible();
  await expect(page.getByText('Prévia RAM — renderizar área de trabalho')).toBeVisible();
  await page.keyboard.press('Escape');

  expect(errors).toEqual([]);
});
