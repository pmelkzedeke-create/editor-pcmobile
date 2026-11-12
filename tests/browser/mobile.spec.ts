import { expect, test, type Page } from '@playwright/test';

const PHONE = { width: 390, height: 844 };
const PHONE_LANDSCAPE = { width: 844, height: 390 };
const TABLET = { width: 820, height: 1180 };

test.use({ hasTouch: true, isMobile: true });

async function noHorizontalOverflow(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw).toBeLessThanOrEqual(cw);
}

/** Real touch drag through CDP (Playwright's touchscreen only has tap). */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const steps = 8;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('phone portrait: bottom bar, panels as sheets and no horizontal overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(PHONE);
  await page.goto('/');

  const bar = page.getByTestId('mobile-action-bar');
  await expect(bar).toBeVisible();
  await expect(page.getByTestId('program-monitor')).toBeVisible();
  await noHorizontalOverflow(page);

  // Panels that used to disappear on phones are reachable from the bar.
  await bar.getByRole('button', { name: 'Efeitos' }).tap();
  const sheet = page.getByTestId('mobile-bottom-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByPlaceholder(/Buscar efeito/)).toBeVisible();
  // tapping the same item again closes it
  await bar.getByRole('button', { name: 'Efeitos' }).tap();
  await expect(sheet).toHaveCount(0);

  await bar.getByRole('button', { name: /Editar|Ajustes/ }).tap();
  await expect(sheet).toBeVisible();
  await page.getByRole('button', { name: 'Fechar painel' }).tap();
  await expect(sheet).toHaveCount(0);
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('phone: dragging the ruler with a finger moves the playhead', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');
  const timecode = page.locator('.font-mono-code').filter({ hasText: /^\d\d:\d\d:\d\d$/ }).first();
  const before = await timecode.textContent();
  const ruler = page.locator('.timeline-panel .cursor-pointer.touch-none').first();
  const box = (await ruler.boundingBox())!;
  await touchDrag(page, { x: box.x + 40, y: box.y + box.height / 2 }, { x: box.x + 220, y: box.y + box.height / 2 });
  await expect.poll(async () => timecode.textContent()).not.toBe(before);
});

test('phone landscape: preview and timeline sit side by side', async ({ page }) => {
  await page.setViewportSize(PHONE_LANDSCAPE);
  await page.goto('/');
  const monitor = (await page.getByTestId('program-monitor').boundingBox())!;
  const timeline = (await page.locator('.timeline-panel').boundingBox())!;
  expect(timeline.x).toBeGreaterThanOrEqual(monitor.x + monitor.width - 1);
  await expect(page.getByTestId('mobile-action-bar')).toBeVisible();
  await noHorizontalOverflow(page);
});

test('tablet portrait uses sheets instead of cramped side panels', async ({ page }) => {
  await page.setViewportSize(TABLET);
  await page.goto('/');
  await expect(page.getByTestId('mobile-action-bar')).toBeVisible();
  const monitor = (await page.getByTestId('program-monitor').boundingBox())!;
  expect(monitor.width).toBeGreaterThan(TABLET.width * 0.85);
  await noHorizontalOverflow(page);
});

test('touch devices see the add-to-timeline button without hovering', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');
  await page.getByTestId('mobile-action-bar').getByRole('button', { name: 'Mídia' }).tap();
  const add = page.getByTitle('Adicionar à linha do tempo').first();
  await expect(add).toBeVisible();
  await expect.poll(() => add.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
});
