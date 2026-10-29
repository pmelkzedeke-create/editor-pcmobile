import type { Page } from '@playwright/test';

/** Exact work-area count assertions must isolate manual preview from Auto look-ahead. */
export async function useManualPreview(page: Page) {
  const auto = page.getByRole('button', { name: 'Cache automatico da timeline', exact: true });
  if (await auto.getAttribute('aria-pressed') === 'true') await auto.click();
  const clear = page.getByLabel('Limpar cache da previa', { exact: true });
  if (await clear.isEnabled()) await clear.click();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}