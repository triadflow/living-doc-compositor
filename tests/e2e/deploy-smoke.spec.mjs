import { expect, test } from '@playwright/test';

const baseURL = process.env.BASE_URL;

test.describe('published GitHub Pages smoke', () => {
  test.skip(!baseURL, 'BASE_URL is required for deployment smoke tests');

  function pageURL(pathname) {
    return new URL(pathname, baseURL.endsWith('/') ? baseURL : `${baseURL}/`).href;
  }

  test('loads public landing pages and compositor guide without runtime errors', async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];
    const failedResponses = [];

    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedResponses.push(`${response.status()} ${response.url()}`);
      }
    });

    for (const pathname of ['index.html', 'index.nl.html']) {
      const response = await page.goto(pageURL(pathname));
      expect(response?.ok(), `${pathname} should return a successful response`).toBeTruthy();
      await expect(page.locator('body')).toContainText('Living Doc Compositor');
    }

    const response = await page.goto(pageURL('living-doc-compositor.html'));
    expect(response?.ok(), 'living-doc-compositor.html should return a successful response').toBeTruthy();
    await expect(page.locator('#top-bar')).toContainText('Living Doc Compositor');
    await page.locator('[data-rail-mode="guide"]').click();
    await expect(page.locator('#guide-panel')).toContainText('What is this?');
    await expect(page.locator('#guide-panel')).not.toContainText(/guide[A-Z][A-Za-z0-9]*/);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
