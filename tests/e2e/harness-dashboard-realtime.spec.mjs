import { test, expect } from '@playwright/test';

import { dashboardHtml } from '../../scripts/living-doc-harness-dashboard-server.mjs';

function graphFixture({ active = 'iteration-1-worker', withReviewer = false } = {}) {
  const nodes = [
    {
      id: 'lifecycle-controller',
      type: 'lifecycle',
      role: 'controller',
      label: 'ldhl-realtime-fixture',
      status: 'running',
      iteration: null,
      artifactPaths: { lifecycleResultPath: '.living-doc-runs/ldhl-realtime-fixture/lifecycle-result.json' },
      meta: {},
      privacy: { localOperatorOnly: true, rawPromptIncluded: false, rawNativeTraceIncluded: false },
    },
    {
      id: 'iteration-1-worker',
      type: 'inference-unit',
      role: 'worker',
      label: 'Iteration 1 worker',
      status: active === 'iteration-1-worker' ? 'running' : 'finished',
      iteration: 1,
      artifactPaths: {
        inputContractPath: '.living-doc-runs/ldh-worker/contract.json',
        codexEventsPath: '.living-doc-runs/ldh-worker/codex-turns/codex-events.jsonl',
        resultPath: '.living-doc-runs/ldh-worker/result.json',
      },
      meta: { runId: 'ldh-worker', hasCodexEvents: true, validationOk: null },
      privacy: { localOperatorOnly: true, rawPromptIncluded: false, rawNativeTraceIncluded: false },
    },
  ];
  const edges = [
    {
      id: 'lifecycle-to-worker-1',
      from: 'lifecycle-controller',
      to: 'iteration-1-worker',
      type: 'contract-handoff',
      label: 'start worker iteration',
      status: 'recorded',
      gate: 'worker-contract-required',
      lifecycleEffect: 'start-worker',
      contract: {
        inputContractPath: '.living-doc-runs/ldh-worker/contract.json',
        promptPath: '.living-doc-runs/ldh-worker/prompt.md',
      },
    },
  ];
  if (withReviewer) {
    nodes.push({
      id: 'iteration-1-reviewer',
      type: 'inference-unit',
      role: 'reviewer',
      label: 'Iteration 1 reviewer',
      status: 'running',
      iteration: 1,
      artifactPaths: {
        inputContractPath: '.living-doc-runs/ldh-worker/reviewer-inference/iteration-1-input.json',
        codexEventsPath: '.living-doc-runs/ldh-worker/reviewer-inference/iteration-1-codex-events.jsonl',
        resultPath: '.living-doc-runs/ldh-worker/reviewer-inference/iteration-1-verdict.json',
      },
      meta: { runId: 'ldh-worker', hasCodexEvents: true, validationOk: null },
      privacy: { localOperatorOnly: true, rawPromptIncluded: false, rawNativeTraceIncluded: false },
    });
    edges.push({
      id: 'worker-to-reviewer-1',
      from: 'iteration-1-worker',
      to: 'iteration-1-reviewer',
      type: 'contract-handoff',
      label: 'raw worker evidence review',
      status: 'recorded',
      gate: 'reviewer-verdict-required',
      lifecycleEffect: 'reviewer-started',
      contract: {
        inputContractPath: '.living-doc-runs/ldh-worker/reviewer-inference/iteration-1-input.json',
        codexEventsPath: '.living-doc-runs/ldh-worker/reviewer-inference/iteration-1-codex-events.jsonl',
      },
    });
  }
  return {
    schema: 'living-doc-harness-inference-graph/v1',
    resultId: 'ldhl-realtime-fixture',
    lifecycleDir: '.living-doc-runs/ldhl-realtime-fixture',
    generatedAt: null,
    finalState: { kind: 'running' },
    activeInferenceUnitId: active,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
    privacy: {
      localOperatorOnly: true,
      rawPromptIncluded: false,
      rawNativeTraceIncluded: false,
    },
  };
}

test('dashboard applies streamed graph and log events without reload', async ({ page }) => {
  const initialGraph = graphFixture();
  const reviewerGraph = graphFixture({ active: 'iteration-1-reviewer', withReviewer: true });

  await page.addInitScript(({ initialGraph }) => {
    window.__reloadCount = 0;
    const originalReload = Location.prototype.reload;
    Location.prototype.reload = function reload() {
      window.__reloadCount += 1;
      return originalReload.apply(this, arguments);
    };
    window.fetch = async (url) => {
      const text = String(url);
      if (text.includes('/api/lifecycles/') && text.includes('/nodes/iteration-1-reviewer/tail')) {
        return new Response(JSON.stringify({
          schema: 'living-doc-harness-graph-node-tail/v1',
          nodeId: 'iteration-1-reviewer',
          privacy: { localOperatorOnly: true, rawPromptIncluded: false, rawNativeTraceIncluded: false },
          codexEvents: ['REVIEWER-ONLY-MARKER selected reviewer log'],
          stderr: [],
          lastMessage: [],
          result: [],
          validation: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (text.includes('/api/lifecycles/') && text.includes('/nodes/iteration-1-worker/tail')) {
        return new Response(JSON.stringify({
          schema: 'living-doc-harness-graph-node-tail/v1',
          nodeId: 'iteration-1-worker',
          privacy: { localOperatorOnly: true, rawPromptIncluded: false, rawNativeTraceIncluded: false },
          codexEvents: ['WORKER-ONLY-MARKER selected worker log'],
          stderr: [],
          lastMessage: [],
          result: [],
          validation: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (text.endsWith('/api/lifecycles/ldhl-realtime-fixture/graph')) {
        return new Response(JSON.stringify(initialGraph), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (text.endsWith('/api/lifecycles/ldhl-realtime-fixture/events')) {
        return new Response(JSON.stringify({
          schema: 'living-doc-harness-dashboard-event-history/v1',
          resultId: 'ldhl-realtime-fixture',
          eventCount: 3,
          privacy: {
            localOperatorOnly: true,
            rawPromptIncluded: false,
            rawNativeTraceIncluded: false,
            supervisingChatStateIncluded: false,
          },
          events: [
            {
              schema: 'living-doc-harness-dashboard-event/v1',
              eventId: 'history-lifecycle-snapshot',
              type: 'lifecycle_snapshot',
              at: '2026-05-10T06:30:00.000Z',
              source: 'persisted-lifecycle',
              payload: { resultId: 'ldhl-realtime-fixture', graph: initialGraph },
              privacy: { localOperatorOnly: true, rawPromptIncluded: false, rawNativeTraceIncluded: false, supervisingChatStateIncluded: false },
            },
            {
              schema: 'living-doc-harness-dashboard-event/v1',
              eventId: 'history-contract-handoff',
              type: 'contract_handoff',
              at: '2026-05-10T06:30:00.100Z',
              source: 'graph-contract-edge',
              payload: {
                resultId: 'ldhl-realtime-fixture',
                edgeId: 'lifecycle-to-worker-1',
                from: 'lifecycle-controller',
                to: 'iteration-1-worker',
                contract: { inputContractPath: '.living-doc-runs/ldh-worker/contract.json' },
              },
              privacy: { localOperatorOnly: true, rawPromptIncluded: false, rawNativeTraceIncluded: false, supervisingChatStateIncluded: false },
            },
            {
              schema: 'living-doc-harness-dashboard-event/v1',
              eventId: 'history-worker-log',
              type: 'log_append',
              at: '2026-05-10T06:30:00.200Z',
              source: 'local-log-tail',
              payload: {
                resultId: 'ldhl-realtime-fixture',
                nodeId: 'iteration-1-worker',
                role: 'worker',
                kind: 'codexEvents',
                path: '.living-doc-runs/ldh-worker/codex-turns/codex-events.jsonl',
                lines: ['WORKER-ONLY-MARKER restored from event history'],
              },
              privacy: { localOperatorOnly: true, rawPromptIncluded: false, rawNativeTraceIncluded: false, supervisingChatStateIncluded: false },
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (text.endsWith('/api/lifecycles')) {
        return new Response(JSON.stringify({
          schema: 'living-doc-harness-dashboard-lifecycles/v1',
          generatedAt: '2026-05-10T06:30:00.000Z',
          lifecycles: [{
            resultId: 'ldhl-realtime-fixture',
            createdAt: '2026-05-10T06:30:00.000Z',
            docPath: 'docs/living-doc-harness-realtime-dashboard.json',
            finalState: { kind: 'running' },
            iterationCount: 1,
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: `unexpected ${text}` }), { status: 404 });
    };
    class MockWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.listeners = {};
        window.__dashboardSocket = this;
        setTimeout(() => {
          this.readyState = 1;
          this.emit('open', {});
        }, 0);
      }
      addEventListener(type, handler) {
        this.listeners[type] = this.listeners[type] || [];
        this.listeners[type].push(handler);
      }
      emit(type, event) {
        for (const handler of this.listeners[type] || []) handler(event);
      }
      sendEvent(event) {
        this.emit('message', { data: JSON.stringify(event) });
      }
      close() {
        this.readyState = 3;
        this.emit('close', {});
      }
    }
    window.WebSocket = MockWebSocket;
  }, { initialGraph });

  await page.route('http://localhost/dashboard', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: dashboardHtml({ runsDir: '.living-doc-runs', evidenceDir: 'evidence/living-doc-harness' }),
    });
  });
  await page.goto('http://localhost/dashboard');

  await expect(page.locator('[data-graph-node-id="iteration-1-worker"]')).toHaveClass(/current-unit/);
  await expect(page.locator('#graphInspector')).toContainText('.living-doc-runs/ldh-worker/contract.json');
  await expect(page.locator('#graphTailBox')).toContainText('WORKER-ONLY-MARKER');
  await expect(page.locator('#graphInspector')).toContainText('lifecycle_snapshot');
  await expect(page.locator('#graphInspector')).toContainText('contract_handoff');

  await page.evaluate((reviewerGraph) => {
    window.__dashboardSocket.sendEvent({
      schema: 'living-doc-harness-dashboard-event/v1',
      eventId: 'graph-update-reviewer',
      type: 'graph_update',
      at: '2026-05-10T06:30:01.000Z',
      source: 'artifact-derived-graph',
      payload: {
        resultId: 'ldhl-realtime-fixture',
        activeInferenceUnitId: 'iteration-1-reviewer',
        nodeCount: reviewerGraph.nodeCount,
        edgeCount: reviewerGraph.edgeCount,
        graph: reviewerGraph,
      },
      privacy: { localOperatorOnly: true, rawPromptIncluded: false, rawNativeTraceIncluded: false, supervisingChatStateIncluded: false },
    });
    window.__dashboardSocket.sendEvent({
      schema: 'living-doc-harness-dashboard-event/v1',
      eventId: 'reviewer-log-append',
      type: 'log_append',
      at: '2026-05-10T06:30:02.000Z',
      source: 'local-log-tail',
      payload: {
        resultId: 'ldhl-realtime-fixture',
        nodeId: 'iteration-1-reviewer',
        role: 'reviewer',
        kind: 'codexEvents',
        path: '.living-doc-runs/ldh-worker/reviewer-inference/iteration-1-codex-events.jsonl',
        lines: ['REVIEWER-ONLY-MARKER streamed reviewer log'],
      },
      privacy: { localOperatorOnly: true, rawPromptIncluded: false, rawNativeTraceIncluded: false, supervisingChatStateIncluded: false },
    });
  }, reviewerGraph);

  await expect(page.locator('[data-graph-node-id="iteration-1-reviewer"]')).toHaveClass(/current-unit/);
  await expect(page.locator('[data-graph-edge-id="worker-to-reviewer-1"]').first()).toBeAttached();
  await expect(page.locator('#graphInspector')).toContainText('iteration-1-input.json');
  await expect(page.locator('#graphTailBox')).toContainText('REVIEWER-ONLY-MARKER');
  await expect(page.locator('#graphTailBox')).not.toContainText('WORKER-ONLY-MARKER');
  await expect(page.locator('#graphInspector')).toContainText('graph_update');
  await expect.poll(() => page.evaluate(() => window.__reloadCount)).toBe(0);
});
