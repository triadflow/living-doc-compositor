Fixture prompt for commit-intent.

Harness tool profile:
{
  "schema": "living-doc-inference-tool-profile/v1",
  "name": "local-harness",
  "isolation": "ignore-user-config",
  "sandboxMode": "danger-full-access",
  "mcpMode": "allowlist",
  "mcpAllowlist": [
    "living_doc_compositor"
  ],
  "mcpDenylist": [
    "figma",
    "projectgraph",
    "gtd",
    "threadc",
    "oauth-connectors",
    "remote-apps",
    "ambient-plugins"
  ],
  "pluginDenylist": [
    "github@openai-curated",
    "computer-use@openai-bundled",
    "browser-use@openai-bundled",
    "documents@openai-primary-runtime",
    "spreadsheets@openai-primary-runtime",
    "presentations@openai-primary-runtime"
  ],
  "basis": [
    "Starts Codex with --ignore-user-config so ambient OAuth-backed MCPs and plugins are not inherited.",
    "Passes --sandbox danger-full-access explicitly so standalone worker units can perform the repo writes required by the living-doc objective.",
    "Adds back only the local living_doc_compositor MCP server needed by harness-aware units."
  ],
  "codexArgs": [
    "--ignore-user-config",
    "--sandbox",
    "danger-full-access",
    "-c",
    "mcp_servers.living_doc_compositor.command=\"/Users/rene/.nvm/versions/node/v24.13.0/bin/node\"",
    "-c",
    "mcp_servers.living_doc_compositor.args=[\"/Users/rene/projects/living-doc-compositor/scripts/living-doc-mcp-server.mjs\"]"
  ]
}
