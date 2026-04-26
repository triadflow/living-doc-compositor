import { expect } from '@playwright/test';

const SETTINGS_STORAGE_KEY = 'living-doc-compositor-settings';

export async function openLocalCompositor(
  page,
  {
    preferManifest = false,
    includeSiblingDiscovery = false,
  } = {},
) {
  await page.addInitScript(({ settingsStorageKey, preferManifest, includeSiblingDiscovery }) => {
    localStorage.clear();
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      preferManifest,
      includeSiblingDiscovery,
    }));
  }, { settingsStorageKey: SETTINGS_STORAGE_KEY, preferManifest, includeSiblingDiscovery });
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
