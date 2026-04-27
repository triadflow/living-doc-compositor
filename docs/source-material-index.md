# Source-Material Index

The source-material index is a derived local cache for living-doc source discovery. It is not portable living-doc content and it is not canonical truth. Living-doc JSON, GitHub, local files, and connector systems remain the source of truth.

## Record Contract

Index files use schema `living-doc-source-index/v1` and are written under `.living-doc-source-index/source-index.json` by default. Each source record includes:

- `sourceId`: stable hash of source type plus canonical URL, path, or connector id.
- `sourceType`: `github-issue`, `github-pr`, `local-file`, `living-doc-json`, `rendered-html`, `connector-artifact`, or `unsupported`.
- `canonical`: exact URL, repo identity, issue or PR number, local repo path, or connector id.
- `status`: `indexed`, `queued`, `skipped`, `changed`, `stale`, `inaccessible`, `deleted`, `unsupported`, `embedding-model-stale`, or `failed`.
- `freshness`: marker type, marker value, content hash when available, and check timestamp.
- `permissions`: access/visibility state plus failure reason when a source is inaccessible.
- `provenance`: index derivation metadata.
- `backlinks`: living-doc path, section id, card id, field, and edge type that referenced the source.
- `chunks`: deterministic chunk ids, text ranges, content hashes, and embedding metadata.
- `embedding`: provider, model/version, and vector dimensions.

Embeddings are stored as deterministic local vectors in the first implementation (`local-hash-v1`). The provider boundary is explicit so a later embedding provider can replace local vectors without changing portable living-doc JSON.

## CLI

Scan one living doc and write or report index actions:

```bash
node scripts/source-material-index.mjs scan docs/example.json --write
```

Query the derived index for inference-run hydration candidates:

```bash
node scripts/source-material-index.mjs query "default advisory profiles" --limit 5
```

Fetch and normalize a GitHub issue or PR when live `gh` access is available:

```bash
node scripts/source-material-index.mjs fetch-github https://github.com/OWNER/REPO/issues/123 --write
```

Retrieval output is only a shortlist. Agents must re-check the canonical source URL or path before status changes, source-system writes, or implementation decisions.
