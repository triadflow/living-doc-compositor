# CLI/MCP Boundary

Use this reference when extending the first Codex living-doc harness.

## Boundary

The skill should make sequencing decisions. Deterministic scripts or MCP/CLI tools should own repeatable state transitions.

Keep in the skill:

- deciding when to select/refine structure
- deciding whether source material should be created
- interpreting coverage and governance results
- explaining final outcome and residual risk

Move into CLI/MCP/scripts:

- registry/type inspection
- template matching and scaffolding
- patch validation and application
- coverage gap checks
- governance/invariant checks
- rendering and commit checkpointing
- source artifact creation/linking when the system is writable

## Preferred Evolution

Start with local scripts in this skill and repo scripts in `scripts/`. The first MCP server is `scripts/living-doc-mcp-server.mjs`, runnable with `npm run ldoc:mcp`. Promote additional operations into that server once the operation is used repeatedly and has a clear input/output contract.

Current MCP operations:

- `living_doc_registry_summary`
- `living_doc_registry_explain_type`
- `living_doc_registry_match_objective`
- `living_doc_registry_propose_type_gap`
- `living_doc_objective_decompose`
- `living_doc_structure_select`
- `living_doc_structure_reflect`
- `living_doc_structure_refine`
- `living_doc_scaffold`
- `living_doc_sources_add`
- `living_doc_sources_create`
- `living_doc_sources_link`
- `living_doc_coverage_map`
- `living_doc_coverage_find_gaps`
- `living_doc_coverage_evaluate_success_condition`
- `living_doc_governance_list_invariants`
- `living_doc_governance_evaluate`
- `living_doc_governance_classify_trap`
- `living_doc_governance_suggest_invariant`
- `living_doc_governance_refine_invariant`
- `living_doc_governance_check_patch`
- `living_doc_patch_validate`
- `living_doc_patch_apply`
- `living_doc_render`

Candidate next operations:

- source-system-specific creation adapters beyond local markdown and GitHub issues
- typed structural patch schemas for section-level changes
- richer governance evaluation that runs invariant-specific checks
- meta fingerprint recomputation after MCP mutations
- `run.finalize`

## Policy Defaults

- Read operations are allowed when source credentials already exist.
- Writes to living-doc JSON are allowed when the user asked to run the harness.
- Writes to external systems should be explicit or clearly in scope.
- Commits should be explicit unless the user chose checkpoint/final/audit mode.
