import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

let renderedHtmlUrl;

test.beforeAll(async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-e2e-ai-render-'));
  const jsonPath = path.join(tmpDir, 'ai-enhanced-doc.json');
  const htmlPath = path.join(tmpDir, 'ai-enhanced-doc.html');
  await copyFile('tests/fixtures/ai-enhanced-doc.json', jsonPath);
  execFileSync(process.execPath, ['scripts/render-living-doc.mjs', jsonPath], { stdio: 'inherit' });
  renderedHtmlUrl = pathToFileURL(htmlPath).href;
});

test('renders document-grounded local AI advisory regions for the first three convergence types', async ({ page }) => {
  await page.goto(renderedHtmlUrl);

  await expect(page.locator('h1')).toContainText('AI Enhanced Fixture Living Doc');
  await expect(page.locator('#surface-flow .section-ai')).toContainText('Section advisory');
  await expect(page.locator('#verification-main .section-ai')).toContainText('Verification Brief');
  await expect(page.locator('#proof-ladder .section-ai')).toContainText('Proof State Brief');
  await expect(page.locator('[data-ai-run="surface-flow"]')).toHaveText('Run section pass');
  await expect(page.locator('#surface-flow [data-ai-task-block="surface-flow:surface-brief"] .section-ai-slot')).toHaveText('Section brief');
  await expect(page.locator('#surface-flow [data-ai-task-block="surface-flow:alignment-risk-note"] .section-ai-slot')).toHaveText('Evidence weakness');
  await expect(page.locator('#surface-flow [data-ai-task-block="surface-flow:review-checklist"] .section-ai-slot')).toHaveText('Next evidence loop');
  await expect(page.locator('#surface-flow [data-ai-task-block="surface-flow:surface-brief"] .section-ai-profile-copy')).toContainText('Compress the current surface');
  await expect(page.locator('#surface-flow [data-ai-task="surface-flow:surface-brief"][data-ai-field="headline"]')).toContainText('Surface brief will appear here');
  await expect(page.locator('#verification-main [data-ai-task="verification-main:weakest-signal-note"][data-ai-field="probe"]')).toContainText('The weakest current signal will appear here');
  await expect(page.locator('#proof-ladder [data-ai-task="proof-ladder:next-stronger-proof"][data-ai-field="targetRung"]')).toContainText('The next stronger proof target will appear here');

  const docMetaText = await page.locator('#doc-meta').evaluate((node) => node.textContent || '');
  const docMeta = JSON.parse(docMetaText);
  const sectionsById = new Map(docMeta.sections.map((section) => [section.id, section]));
  expect(sectionsById.get('surface-flow').ai.enabledProfiles).not.toContain('surface-brief');
  expect(sectionsById.get('verification-main').ai.enabledProfiles).not.toContain('verification-brief');
  expect(sectionsById.get('proof-ladder').ai.enabledProfiles).not.toContain('proof-state-brief');

  const aiSpec = page.locator('#doc-ai-spec');
  await expect(aiSpec).toBeAttached();
  const aiSpecText = await aiSpec.evaluate((node) => node.textContent || '');
  expect(aiSpecText).toContain('surface-flow:surface-brief');
  expect(aiSpecText).toContain('verification-main:verification-brief');
  expect(aiSpecText).toContain('proof-ladder:proof-state-brief');
});

test('normalizes common local-model JSON shapes into the advisory slots', async ({ page }) => {
  const responses = [
    { title: 'Delivery surface brief', overview: 'The export surface is wired and ready for local advisory hydration.', focusPoints: ['Check the embedded spec.', 'Verify the section-level run action.'] },
    { riskSurface: 'Embedded advisory runtime', why: 'It is the point where standalone export behavior and local inference have to stay aligned.' },
    { checklist: [{ text: 'Confirm the endpoint and model config.' }, { text: 'Verify exact field binding in the export.' }] },
  ];
  await page.addInitScript((mockResponses) => {
    let callIndex = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === 'http://127.0.0.1:1234/v1/chat/completions') {
        const next = mockResponses[callIndex] || mockResponses[mockResponses.length - 1];
        callIndex += 1;
        return new Response(JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(next),
              },
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    };
  }, responses);

  await page.goto(renderedHtmlUrl);
  await page.locator('[data-ai-run="surface-flow"]').click();

  await expect(page.locator('#surface-flow [data-ai-task="surface-flow:surface-brief"][data-ai-field="headline"]')).toHaveText('Delivery surface brief');
  await expect(page.locator('#surface-flow [data-ai-task="surface-flow:surface-brief"][data-ai-field="summary"]')).toContainText('wired and ready');
  await expect(page.locator('#surface-flow [data-ai-task="surface-flow:review-checklist"][data-ai-field="items"]')).toContainText('Confirm the endpoint and model config.');
  await expect(page.locator('#surface-flow [data-ai-status="surface-flow:surface-brief"]')).toHaveText('Ready');
  await expect(page.locator('#surface-flow [data-ai-status="surface-flow:alignment-risk-note"]')).toHaveText('Ready');
  await expect(page.locator('#surface-flow [data-ai-status="surface-flow:review-checklist"]')).toHaveText('Ready');
});

test('recovers nested profile wrapper output from local models', async ({ page }) => {
  const response = {
    data: {
      surfaceBrief: {
        headline: 'Nested product brief',
        summary: 'The local model wrapped the expected profile payload but the export recovered it.',
        currentFocus: ['Keep the advisory document-native.', 'Avoid source mutation.'],
      },
    },
  };
  await page.addInitScript((mockResponse) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === 'http://127.0.0.1:1234/v1/chat/completions') {
        return new Response(JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(mockResponse),
              },
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    };
  }, response);

  await page.goto(renderedHtmlUrl);
  await page.locator('[data-ai-run-task="surface-flow:surface-brief"]').click();

  await expect(page.locator('#surface-flow [data-ai-task="surface-flow:surface-brief"][data-ai-field="headline"]')).toHaveText('Nested product brief');
  await expect(page.locator('#surface-flow [data-ai-task="surface-flow:surface-brief"][data-ai-field="summary"]')).toContainText('wrapped the expected profile payload');
  await expect(page.locator('#surface-flow [data-ai-task="surface-flow:surface-brief"][data-ai-field="currentFocus"]')).toContainText('Avoid source mutation.');
});

test('retries parse-only local-model failures before surfacing an error', async ({ page }) => {
  const responses = [
    '{ "headline": "Broken first pass", "summary": "cut off"',
    { headline: 'Recovered brief', summary: 'The retry path recovered from malformed JSON.', currentFocus: ['Retry malformed JSON once or twice.', 'Keep the advisory card usable for local models.'] },
  ];
  await page.addInitScript((mockResponses) => {
    let callIndex = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === 'http://127.0.0.1:1234/v1/chat/completions') {
        const next = mockResponses[Math.min(callIndex, mockResponses.length - 1)];
        callIndex += 1;
        return new Response(JSON.stringify({
          choices: [
            {
              message: {
                content: typeof next === 'string' ? next : JSON.stringify(next),
              },
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    };
  }, responses);

  await page.goto(renderedHtmlUrl);
  await page.locator('[data-ai-run-task="surface-flow:surface-brief"]').click();

  await expect(page.locator('#surface-flow [data-ai-task="surface-flow:surface-brief"][data-ai-field="headline"]')).toHaveText('Recovered brief');
  await expect(page.locator('#surface-flow [data-ai-task="surface-flow:surface-brief"][data-ai-field="summary"]')).toContainText('recovered from malformed JSON');
  await expect(page.locator('#surface-flow [data-ai-status="surface-flow:surface-brief"]')).toHaveText('Ready');
});

test('preserves successful advisory results across later section runs', async ({ page }) => {
  const responses = [
    { headline: 'Surface brief first pass', summary: 'Surface section succeeded first.', currentFocus: ['Keep the original surface result visible.'] },
    { surface: 'Surface contract', reason: 'Surface drift reason.' },
    { items: ['Surface checklist item.'] },
    { headline: 'Verification brief second pass', readinessSummary: 'Verification section succeeded second.' },
    { probe: 'Weakest probe', reason: 'Verification weakness.', missingEvidenceType: 'automation' },
    { focus: 'Next verification focus', evidenceToCollect: ['Automation evidence'], gapsToRetireFirst: ['Coverage gap'] },
  ];
  await page.addInitScript((mockResponses) => {
    let callIndex = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === 'http://127.0.0.1:1234/v1/chat/completions') {
        const next = mockResponses[Math.min(callIndex, mockResponses.length - 1)];
        callIndex += 1;
        return new Response(JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(next),
              },
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    };
  }, responses);

  await page.goto(renderedHtmlUrl);
  await page.locator('[data-ai-run="surface-flow"]').click();
  await expect(page.locator('#surface-flow [data-ai-task="surface-flow:surface-brief"][data-ai-field="headline"]')).toHaveText('Surface brief first pass');

  await page.locator('[data-ai-run="verification-main"]').click();

  await expect(page.locator('#surface-flow [data-ai-task="surface-flow:surface-brief"][data-ai-field="headline"]')).toHaveText('Surface brief first pass');
  await expect(page.locator('#verification-main [data-ai-task="verification-main:verification-brief"][data-ai-field="headline"]')).toHaveText('Verification brief second pass');
});

test('surfaces an intentional error state after repeated malformed local-model output', async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === 'http://127.0.0.1:1234/v1/chat/completions') {
        return new Response(JSON.stringify({
          choices: [
            {
              message: {
                content: '{ "headline": "Still broken", "summary": "missing close"',
              },
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    };
  });

  await page.goto(renderedHtmlUrl);
  await page.locator('[data-ai-run-task="surface-flow:surface-brief"]').click();

  await expect(page.locator('#surface-flow [data-ai-status="surface-flow:surface-brief"]')).toHaveText('Error');
  await expect(page.locator('#surface-flow [data-ai-message="surface-flow:surface-brief"]')).toContainText('Section advisory failed');
});
