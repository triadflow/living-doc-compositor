import path from 'node:path';

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function tomlArray(values) {
  return `[${arr(values).map((value) => tomlString(value)).join(', ')}]`;
}

function localLivingDocMcpOverrides({ cwd = process.cwd() } = {}) {
  const serverPath = path.resolve(cwd, 'scripts/living-doc-mcp-server.mjs');
  return [
    `mcp_servers.living_doc_compositor.command=${tomlString(process.execPath)}`,
    `mcp_servers.living_doc_compositor.args=${tomlArray([serverPath])}`,
  ];
}

const PROFILE_DEFINITIONS = {
  inherited: {
    schema: 'living-doc-inference-tool-profile/v1',
    name: 'inherited',
    isolation: 'inherit-user-config',
    mcpMode: 'ambient',
    mcpAllowlist: [],
    mcpDenylist: [],
    pluginDenylist: [],
    codexArgs: [],
    basis: [
      'Uses the ambient Codex configuration. This profile is only appropriate when broad user-config tools are intentionally part of the run.',
    ],
  },
  'local-harness': {
    schema: 'living-doc-inference-tool-profile/v1',
    name: 'local-harness',
    isolation: 'ignore-user-config',
    sandboxMode: 'danger-full-access',
    mcpMode: 'allowlist',
    mcpAllowlist: ['living_doc_compositor'],
    mcpDenylist: ['figma', 'projectgraph', 'gtd', 'threadc', 'oauth-connectors', 'remote-apps', 'ambient-plugins'],
    pluginDenylist: [
      'github@openai-curated',
      'computer-use@openai-bundled',
      'browser-use@openai-bundled',
      'documents@openai-primary-runtime',
      'spreadsheets@openai-primary-runtime',
      'presentations@openai-primary-runtime',
    ],
    basis: [
      'Starts Codex with --ignore-user-config so ambient OAuth-backed MCPs and plugins are not inherited.',
      'Passes --sandbox danger-full-access explicitly so standalone worker units can perform the repo writes required by the living-doc objective.',
      'Adds back only the local living_doc_compositor MCP server needed by harness-aware units.',
    ],
  },
  'local-repair': {
    schema: 'living-doc-inference-tool-profile/v1',
    name: 'local-repair',
    isolation: 'ignore-user-config',
    sandboxMode: 'danger-full-access',
    mcpMode: 'allowlist',
    mcpAllowlist: ['living_doc_compositor'],
    mcpDenylist: ['figma', 'projectgraph', 'gtd', 'threadc', 'oauth-connectors', 'remote-apps', 'ambient-plugins'],
    pluginDenylist: [
      'github@openai-curated',
      'computer-use@openai-bundled',
      'browser-use@openai-bundled',
      'documents@openai-primary-runtime',
      'spreadsheets@openai-primary-runtime',
      'presentations@openai-primary-runtime',
    ],
    basis: [
      'Repair units operate on local living-doc evidence, required inspection paths, source files, and structured result contracts.',
      'Passes --sandbox danger-full-access explicitly so repair units can edit, render, test, and commit when their contract requires it.',
      'Remote OAuth-backed MCPs are outside the repair contract and must not be inherited by default.',
    ],
  },
};

export function resolveInferenceToolProfile(profile = 'local-harness', { cwd = process.cwd() } = {}) {
  const requested = typeof profile === 'string' ? { name: profile } : (profile || {});
  const name = requested.name || 'local-harness';
  const definition = PROFILE_DEFINITIONS[name];
  if (!definition) {
    throw new Error(`unknown inference tool profile: ${name}`);
  }
  const codexArgs = definition.isolation === 'ignore-user-config'
    ? [
      '--ignore-user-config',
      '--sandbox',
      requested.sandboxMode || definition.sandboxMode || 'danger-full-access',
      ...localLivingDocMcpOverrides({ cwd }).flatMap((override) => ['-c', override]),
    ]
    : [];
  return {
    ...definition,
    ...requested,
    schema: 'living-doc-inference-tool-profile/v1',
    name,
    sandboxMode: requested.sandboxMode || definition.sandboxMode || null,
    codexArgs: arr(requested.codexArgs).length ? requested.codexArgs : codexArgs,
    mcpAllowlist: arr(requested.mcpAllowlist).length ? requested.mcpAllowlist : definition.mcpAllowlist,
    mcpDenylist: arr(requested.mcpDenylist).length ? requested.mcpDenylist : definition.mcpDenylist,
    pluginDenylist: arr(requested.pluginDenylist).length ? requested.pluginDenylist : definition.pluginDenylist,
    basis: arr(requested.basis).length ? requested.basis : definition.basis,
  };
}
