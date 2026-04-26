import { expect, test } from '@playwright/test';
import { openLocalCompositor, openTopMenu } from './helpers.mjs';

test('loads a sanitized local library manifest and opens an editable entry', async ({ page }) => {
  await openLocalCompositor(page, {
    preferManifest: true,
    includeSiblingDiscovery: false,
  });

  await openTopMenu(page);
  await page.locator('#top-settings').click();
  await page.locator('#settings-library-manifest').fill('../tests/fixtures/living-doc-library.local.json');
  await page.locator('#settings-refresh-library').click();

  await expect(page.locator('.settings-status')).toContainText('Loaded');
  await expect(page.locator('.settings-status')).toContainText('1');
  await page.locator('#settings-cancel').click();

  await page.locator('[data-rail-mode="library"]').click();
  await expect(page.locator('.lib-item[data-lib-idx]')).toContainText('Fixture Feature Living Doc');

  await page.locator('#library-search').fill('fixture');
  await expect(page.locator('.lib-item[data-lib-idx]')).toHaveCount(1);
  await page.locator('.lib-item[data-lib-idx]').click();

  await expect(page.locator('#doc-title')).toHaveValue('Fixture Feature Living Doc');
  await expect(page.locator('.visual-section-card').filter({ hasText: 'Tooling Surface' })).toBeVisible();
});
