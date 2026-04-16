import { expect } from '@playwright/test';

export async function openLocalCompositor(page) {
  await page.addInitScript(() => {
    localStorage.clear();
  });
  await page.goto('/docs/living-doc-compositor.html');
  await expect(page.locator('#top-bar')).toContainText('Living Doc Compositor');
  await expect(page.locator('[data-rail-mode="structure"]')).toBeVisible();
}

export async function openTopMenu(page) {
  await page.locator('#top-menu-toggle').click();
  await expect(page.locator('.top-menu-panel')).toBeVisible();
}

export async function openGuide(page) {
  await page.locator('[data-rail-mode="guide"]').click();
  await expect(page.locator('#guide-overlay')).toHaveClass(/open/);
  await expect(page.locator('#guide-panel')).toBeVisible();
}

export async function expectNoMissingI18nKeys(locator) {
  await expect(locator).not.toContainText(/guide[A-Z][A-Za-z0-9]*|newDocHint|loadHint|exportHint|htmlHint|shareToolHint/);
}
