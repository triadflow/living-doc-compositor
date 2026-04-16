import { expect, test } from '@playwright/test';
import { openGuide, openLocalCompositor, openTopMenu, expectNoMissingI18nKeys } from './helpers.mjs';

test('boots, opens the Guide, and switches locales', async ({ page }) => {
  await openLocalCompositor(page);

  await openGuide(page);
  await expect(page.locator('#guide-panel')).toContainText('What is this?');
  await expect(page.locator('#guide-panel')).toContainText('Use the prompt builder');
  await expectNoMissingI18nKeys(page.locator('#guide-panel'));
  await page.locator('#guide-close').click();
  await expect(page.locator('#guide-overlay')).not.toHaveClass(/open/);

  await openTopMenu(page);
  await page.locator('.top-menu-lang-btn[data-locale="nl"]').click();
  await openGuide(page);
  await expect(page.locator('#guide-panel')).toContainText('Wat is dit?');
  await expect(page.locator('#guide-panel')).toContainText('Gebruik de prompt builder');
  await page.locator('#guide-close').click();

  await openTopMenu(page);
  await page.locator('.top-menu-lang-btn[data-locale="id"]').click();
  await openGuide(page);
  await expect(page.locator('#guide-panel')).toContainText('Apa ini?');
  await expect(page.locator('#guide-panel')).toContainText('Gunakan prompt builder');
  await expectNoMissingI18nKeys(page.locator('#guide-panel'));
});

test('composes a section and reflects document edits in JSON preview', async ({ page }) => {
  await openLocalCompositor(page);

  await page.locator('[data-ct-id="tooling-surface"]').click();
  await expect(page.locator('.visual-section-card').filter({ hasText: 'Tooling Surface' })).toBeVisible();

  await page.locator('#doc-title').fill('E2E Living Doc');
  await page.locator('#doc-objective').fill('Verify GUI contract updates the canonical JSON preview.');

  await page.locator('.preview-tab[data-tab="json"]').click();
  await expect(page.locator('.json-preview')).toContainText('"title": "E2E Living Doc"');
  await expect(page.locator('.json-preview')).toContainText('"objective": "Verify GUI contract updates the canonical JSON preview."');
  await expect(page.locator('.json-preview')).toContainText('"convergenceType": "tooling-surface"');
});

test('applies a starter template and exposes prompt context', async ({ page }) => {
  await openLocalCompositor(page);

  await page.locator('[data-rail-mode="templates"]').click();
  await page.locator('.template-card-action[data-template-file="living-doc-template-starter-ship-feature.json"]').click();

  await expect(page.locator('#doc-title')).toHaveValue('Ship a Feature');
  await expect(page.locator('.visual-section-card').filter({ hasText: 'Design–Code–Spec Flow' })).toBeVisible();

  const prompt = page.locator('#prompt-output');
  await expect(prompt).toHaveValue(/Document identity:/);
  await expect(prompt).toHaveValue(/Convergence type definitions used by this document:/);
  await expect(prompt).toHaveValue(/Template semantics:/);
  await expect(prompt).toHaveValue(/promptGuidance/);

  await page.locator('#copy-prompt').click();
  await expect(page.locator('#copy-prompt')).toHaveText('Copied');
});
