import assert from 'node:assert/strict';
import vm from 'node:vm';

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

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  contains(name) {
    return String(this.owner.attributes.class || '').split(/\s+/).includes(name);
  }
}

class FakeElement {
  constructor(document, tagName = 'div', attrs = {}) {
    this.document = document;
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attrs };
    this.dataset = {};
    this.listeners = {};
    this.style = {};
    this.children = [];
    this.parentElement = null;
    this._innerHTML = '';
    this._textContent = '';
    this.classList = new FakeClassList(this);
    this.offsetWidth = 2400;
    this.offsetHeight = 1400;
    for (const [key, value] of Object.entries(attrs)) this.setAttribute(key, value);
  }

  get id() {
    return this.attributes.id || '';
  }

  set id(value) {
    this.setAttribute('id', value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '');
    this.children = this.document.parseElements(this._innerHTML, this);
  }

  get textContent() {
    return this._textContent || this._innerHTML.replace(/<[^>]*>/g, '');
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this._innerHTML = this._textContent;
    this.children = [];
  }

  get outerHTML() {
    const attrs = Object.entries(this.attributes)
      .map(([key, value]) => ` ${key}="${String(value).replaceAll('"', '&quot;')}"`)
      .join('');
    return `<${this.tagName.toLowerCase()}${attrs}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }

  setAttribute(name, value) {
    const text = String(value ?? '');
    this.attributes[name] = text;
    if (name === 'id') this.document.elements.set(text, this);
    if (name.startsWith('data-')) {
      const datasetKey = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      this.dataset[datasetKey] = text;
    }
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  addEventListener(type, handler) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }

  querySelector(selector) {
    if (selector === 'defs' && this._innerHTML.includes('<defs')) {
      return new FakeElement(this.document, 'defs', {});
    }
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    return this.document.querySelectorAll(selector, this);
  }

  getBoundingClientRect() {
    return { width: this.offsetWidth, height: this.offsetHeight, left: 0, top: 0 };
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    for (const id of [
      'status',
      'lifecycles',
      'graphStatus',
      'graphBoard',
      'graphEdgeLayer',
      'graphUnits',
      'graphSummary',
      'graphStageState',
      'graphInspector',
      'refresh',
      'resetGraphLayout',
    ]) {
      const tag = id === 'graphEdgeLayer' ? 'svg' : (id === 'refresh' || id === 'resetGraphLayout' ? 'button' : 'div');
      const element = new FakeElement(this, tag, { id });
      if (id === 'graphEdgeLayer') element.innerHTML = '<defs></defs>';
      this.elements.set(id, element);
    }
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  addEventListener() {}

  parseElements(markup, parent = null) {
    const elements = [];
    const openTagPattern = /<([a-zA-Z][\w:-]*)([^>]*)>/g;
    let match;
    while ((match = openTagPattern.exec(markup))) {
      const attrs = {};
      for (const attrMatch of match[2].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/g)) {
        attrs[attrMatch[1]] = attrMatch[2];
      }
      if (!attrs.id && !Object.keys(attrs).some((key) => key.startsWith('data-'))) continue;
      const element = new FakeElement(this, match[1], attrs);
      element.parentElement = parent;
      elements.push(element);
      if (attrs.id) this.elements.set(attrs.id, element);
    }
    return elements;
  }

  querySelectorAll(selector, root = null) {
    const candidates = root
      ? [root, ...root.children]
      : [...this.elements.values()].flatMap((element) => [element, ...element.children]);
    const unique = new Map();
    for (const element of candidates) {
      if (this.matchesSelector(element, selector)) unique.set(element.outerHTML, element);
      for (const child of element.children || []) {
        if (this.matchesSelector(child, selector)) unique.set(child.outerHTML, child);
      }
    }
    return [...unique.values()];
  }

  matchesSelector(element, selector) {
    const dataAttr = selector.match(/^\[data-([a-z0-9-]+)\]$/i);
    if (dataAttr) return element.attributes[`data-${dataAttr[1]}`] !== undefined;
    return false;
  }
}

class FakeResponse {
  constructor(body, { status = 200 } = {}) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.body = body;
  }

  async json() {
    return this.body;
  }
}

async function flushMicrotasks(rounds = 6) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const initialGraph = graphFixture();
const reviewerGraph = graphFixture({ active: 'iteration-1-reviewer', withReviewer: true });
const document = new FakeDocument();
const localStorageValues = new Map();
const socketMessages = [];
const fetchCalls = [];
let reloadCount = 0;

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = {};
    globalThis.__dashboardSocket = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open', {});
    });
  }

  addEventListener(type, handler) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }

  emit(type, event) {
    for (const handler of this.listeners[type] || []) handler(event);
  }

  sendEvent(event) {
    socketMessages.push(event);
    this.emit('message', { data: JSON.stringify(event) });
  }

  close() {
    this.readyState = 3;
    this.emit('close', {});
  }
}

const context = {
  console,
  document,
  window: {},
  location: {
    protocol: 'http:',
    host: 'localhost',
    reload() {
      reloadCount += 1;
    },
  },
  localStorage: {
    getItem(key) {
      return localStorageValues.get(key) || null;
    },
    setItem(key, value) {
      localStorageValues.set(key, String(value));
    },
    removeItem(key) {
      localStorageValues.delete(key);
    },
  },
  WebSocket: MockWebSocket,
  fetch: async (url) => {
    const text = String(url);
    fetchCalls.push(text);
    if (text.includes('/api/lifecycles/') && text.includes('/nodes/iteration-1-reviewer/tail')) {
      return new FakeResponse({
        schema: 'living-doc-harness-graph-node-tail/v1',
        nodeId: 'iteration-1-reviewer',
        privacy: { localOperatorOnly: true, rawPromptIncluded: false, rawNativeTraceIncluded: false },
        codexEvents: ['REVIEWER-ONLY-MARKER selected reviewer log'],
        stderr: [],
        lastMessage: [],
        result: [],
        validation: [],
      });
    }
    if (text.includes('/api/lifecycles/') && text.includes('/nodes/iteration-1-worker/tail')) {
      return new FakeResponse({
        schema: 'living-doc-harness-graph-node-tail/v1',
        nodeId: 'iteration-1-worker',
        privacy: { localOperatorOnly: true, rawPromptIncluded: false, rawNativeTraceIncluded: false },
        codexEvents: ['WORKER-ONLY-MARKER selected worker log'],
        stderr: [],
        lastMessage: [],
        result: [],
        validation: [],
      });
    }
    if (text.endsWith('/api/lifecycles/ldhl-realtime-fixture/graph')) {
      return new FakeResponse(initialGraph);
    }
    if (text.endsWith('/api/lifecycles/ldhl-realtime-fixture/events')) {
      return new FakeResponse({
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
      });
    }
    if (text.endsWith('/api/lifecycles')) {
      return new FakeResponse({
        schema: 'living-doc-harness-dashboard-lifecycles/v1',
        generatedAt: '2026-05-10T06:30:00.000Z',
        lifecycles: [{
          resultId: 'ldhl-realtime-fixture',
          createdAt: '2026-05-10T06:30:00.000Z',
          docPath: 'docs/living-doc-harness-realtime-dashboard.json',
          finalState: { kind: 'running' },
          iterationCount: 1,
        }],
      });
    }
    return new FakeResponse({ error: `unexpected ${text}` }, { status: 404 });
  },
  setInterval: () => 0,
  clearInterval: () => {},
  queueMicrotask,
  setImmediate,
};
context.window = context;
context.Location = function Location() {};
context.Location.prototype.reload = () => {
  reloadCount += 1;
};

const html = dashboardHtml({ runsDir: '.living-doc-runs', evidenceDir: 'evidence/living-doc-harness' });
const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
assert.ok(script, 'dashboard HTML must contain executable script');

vm.createContext(context);
new vm.Script(script, { filename: 'dashboard-inline.js' }).runInContext(context);
await flushMicrotasks();

assert.match(document.getElementById('graphUnits').innerHTML, /data-graph-node-id="iteration-1-worker"/);
assert.match(document.getElementById('graphUnits').innerHTML, /current-unit/);
assert.match(document.getElementById('graphInspector').innerHTML, /ldh-worker\/contract\.json/);
assert.match(document.getElementById('graphTailBox').textContent, /WORKER-ONLY-MARKER/);
assert.equal(fetchCalls.some((call) => call.endsWith('/api/lifecycles/ldhl-realtime-fixture/events')), true);
assert.match(document.getElementById('graphInspector').innerHTML, /lifecycle_snapshot/);
assert.match(document.getElementById('graphInspector').innerHTML, /contract_handoff/);

globalThis.__dashboardSocket.sendEvent({
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
globalThis.__dashboardSocket.sendEvent({
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
await flushMicrotasks();

assert.match(document.getElementById('graphUnits').innerHTML, /current-unit"[^>]*data-graph-node-id="iteration-1-reviewer"/);
assert.match(document.getElementById('graphEdgeLayer').innerHTML, /data-graph-edge-id="worker-to-reviewer-1"/);
assert.match(document.getElementById('graphInspector').innerHTML, /iteration-1-input\.json/);
assert.match(document.getElementById('graphInspector').innerHTML, /graph_update/);
assert.match(document.getElementById('graphInspector').innerHTML, /REVIEWER-ONLY-MARKER/);
assert.doesNotMatch(document.getElementById('graphInspector').innerHTML, /WORKER-ONLY-MARKER/);
assert.equal(reloadCount, 0);
assert.equal(socketMessages.length, 2);

console.log('living-doc harness dashboard realtime UI contract spec: all assertions passed');
