# The harness is the playground — draft sketch

Working doc for issue #155. The thesis and diagrams here are what the final
`harness-playground.html` will be authored against. Goal of this sketch: agree
on the spine before committing to a polished render.

---

## The spine — one sentence

The compositor and the harness are **the same primitives lifted to a longer
time horizon.** Single-session compaction becomes a multi-session living doc.
The harness's session log becomes the AI-patch event stream. A bash command
classifier becomes a patch-op classifier. Once you state the equivalence the
roadmap and the failure modes both become obvious.

That equivalence is the only claim the HTML page needs to make. Everything
else is consequences.

---

## Diagram 1 — The central equivalence

The headline picture. Same primitives, lifted by time scope.

```mermaid
flowchart TB
  subgraph harness [Harness primitives at session scope]
    direction TB
    HL[outer while loop]
    HC[lossy compaction summary]
    HT[tool registry]
    HS[append-only session log]
    HP[bash command classifier]
    HD[CLAUDE-md ancestor walk]
    HA[sub-agent archetypes]
  end

  subgraph compositor [Compositor primitives at workstream scope]
    direction TB
    CL[skill execution rides host loop]
    CC[typed schema-bound compaction via convergence types]
    CT[MCP tool surface 26 tools]
    CS[append-only ai-patch event stream]
    CP[MCP sole-writer plus schema validator]
    CD[skill registry plus living-doc-registry json]
    CA[ai-pass engines claude-code and codex]
  end

  HL -.lifted to longer scope.-> CL
  HC -.lifted to longer scope.-> CC
  HT -.lifted to longer scope.-> CT
  HS -.lifted to longer scope.-> CS
  HP -.lifted to longer scope.-> CP
  HD -.lifted to longer scope.-> CD
  HA -.lifted to longer scope.-> CA
```

**Why this is non-trivial.** Each pair on the right is the answer to "what
would happen if you tried to run the harness primitive on the left across
sessions?" The harness's lossy compaction would lose structural commitments
across a stranger session — so the compositor uses *typed* compaction. The
session log would need to survive process death and replay months later — so
the compositor uses *append-only structured patches*. The bash classifier
gates destructive shell — so the compositor's MCP-as-sole-writer gates
destructive *doc mutation*.

The right column is not a list of things we built. It is the **shape every
multi-session harness will eventually grow into.** We just got there earlier.

---

## Diagram 2 — The MCP tool surface as the registry

The compositor MCP server exposes 26 tools (counted from
`scripts/living-doc-mcp-server.mjs`). They cluster cleanly into eight
sub-surfaces. This *is* the harness's tool registry, just typed for living-doc
work.

```mermaid
flowchart LR
  subgraph mcp [living-doc-compositor MCP server]
    subgraph reg [Registry]
      R1[living_doc_registry_summary]
      R2[living_doc_registry_explain_type]
      R3[living_doc_registry_match_objective]
      R4[living_doc_registry_propose_type_gap]
    end
    subgraph struct [Structure]
      S1[living_doc_match_structure]
      S2[living_doc_structure_select]
      S3[living_doc_structure_reflect]
      S4[living_doc_structure_refine]
    end
    subgraph scaf [Scaffold]
      F1[living_doc_objective_decompose]
      F2[living_doc_scaffold]
    end
    subgraph src [Sources]
      U1[living_doc_sources_add]
      U2[living_doc_sources_create]
      U3[living_doc_sources_link]
    end
    subgraph cov [Coverage]
      V1[living_doc_coverage_map]
      V2[living_doc_coverage_find_gaps]
      V3[living_doc_coverage_check]
      V4[living_doc_coverage_evaluate_success_condition]
    end
    subgraph gov [Governance]
      G1[living_doc_governance_list_invariants]
      G2[living_doc_governance_evaluate]
      G3[living_doc_governance_check]
      G4[living_doc_governance_classify_trap]
      G5[living_doc_governance_suggest_invariant]
      G6[living_doc_governance_refine_invariant]
      G7[living_doc_governance_check_patch]
    end
    subgraph patch [Patch sole writer]
      P1[living_doc_patch_validate]
      P2[living_doc_patch_apply]
    end
    subgraph rndr [Render]
      D1[living_doc_render]
    end
  end
```

**Read across the surfaces.** Registry and Structure are *read-tier*
surfaces — they answer questions about the doc model. Scaffold, Sources,
Coverage, Governance are *workspace-tier* — they propose changes but do not
commit them. Patch is the *full-tier* surface — only `patch_apply` actually
writes the canonical. Render is read-after-write.

This is already a permission-tier model. It just isn't named one yet.

---

## Diagram 3 — The sole-writer sequence

Every mutation funnels through the same path. This is what makes replay possible.

```mermaid
sequenceDiagram
  participant Skill
  participant MCP as MCP server
  participant Schema as ai-patch-schema
  participant Apply as apply-ai-patch
  participant JSON as living-doc json
  participant Render

  Skill->>MCP: patch_validate with proposed patch
  MCP->>Schema: shape and op-kind check
  Schema-->>MCP: ok
  MCP-->>Skill: validated id

  Skill->>MCP: patch_apply with id
  MCP->>Apply: dispatch ops in declared order
  Apply->>JSON: write canonical
  Apply-->>MCP: per-op change log
  MCP->>Render: trigger
  Render->>JSON: read
  Render-->>MCP: html artifact
```

**The discipline this enforces.** A skill that writes JSON directly skips
validate and skips the change log. A render that gets hand-edited diverges
from JSON until the next render silently overwrites it. Both bypasses are
detectable by checking that the patch log replays to the current JSON. That
check should be a CI gate.

---

## Diagram 4 — AI-pass two-phase commit

`ai-pass-server.mjs` is already two-phase: propose generates and validates,
apply mutates. Human review fits in the gap. This is the harness's
"interactive approval before destructive ops" pattern, just with a UI.

```mermaid
sequenceDiagram
  participant UI as flow-body card
  participant Server as ai-pass-server
  participant Engine as engine sub-agent
  participant Store as in-memory patchStore
  participant MCP as MCP server

  UI->>Server: POST propose with engine claude-code or codex
  Server->>Engine: spawn with skillPrefix and prompt
  Engine-->>Server: candidate patch json
  Server->>Server: validatePatch
  Server->>Store: keep with patch id
  Server-->>UI: validated patch preview

  Note over UI: human reviews and edits

  UI->>Server: POST apply with patch id
  Server->>MCP: patch_apply
  MCP-->>Server: applied
  Server-->>UI: success
```

**Why this matters for the framing.** The harness gates destructive bash
*at run time*. The compositor gates destructive doc mutations *via two-phase
commit with a human in the loop*. Same insight: untrusted authority is
allowed to *propose*, only a privileged step *applies*. The privileged step
in the harness is approval; in the compositor it is `patch_apply` after
review.

---

## Diagram 5 — Sub-agent archetype dispatch

`claude-code` and `codex` are not just engine names. They are first-class
enums in `ai-patch-schema.json`, configured per user in
`~/.living-doc-compositor/ai-pass-config.json` with command and skillPrefix.
This is harness sub-agent archetyping.

```mermaid
flowchart LR
  Pref[user preferred engine]
  Cfg[ai-pass-config json]
  Pref --> Cfg
  Cfg --> Pick{select archetype}
  Pick -->|claude-code| CC[claude-code engine]
  Pick -->|codex| CX[codex engine]
  CC --> CCcmd[command claude -p]
  CC --> CCskill[skill living-doc-ai-pass-claude]
  CX --> CXcmd[command codex exec]
  CX --> CXskill[skill living-doc-ai-pass-codex]
  CCcmd --> Spawn[spawn sub-process]
  CXcmd --> Spawn
  Spawn --> Patch[returns validated patch]
```

**The opportunity this names.** Today there are two archetypes both shaped
for "propose a patch." A third archetype slot is open for *verifier* — a
sub-agent that does not mutate but reads a proposed patch plus the current
doc and returns a verdict. That archetype is what would make the
patch-classifier model in Diagram 7 enforceable.

---

## Diagram 6 — The closed mutation vocabulary

Seven ops, seven targets. Adding an eighth without bumping schema is a
silent data loss. The closed vocabulary is what makes the patch log
replayable.

```mermaid
flowchart LR
  subgraph ops [Closed mutation vocabulary 7 ops]
    O1[card-create]
    O2[card-update]
    O3[ticket-create]
    O4[coverage-add]
    O5[coverage-remove]
    O6[invariant-suggest]
    O7[rationale-update]
  end
  subgraph state [Living doc state surfaces]
    Cards[cards array]
    Edges[coverage edges]
    Invs[invariants array]
    Tickets[ticketIds links]
    Rats[rationale fields]
  end
  O1 --> Cards
  O2 --> Cards
  O3 --> Tickets
  O4 --> Edges
  O5 --> Edges
  O6 --> Invs
  O7 --> Rats
```

**Why closed-and-typed beats freeform.** A harness compaction prompt
produces a paragraph of text — lossy on purpose, sufficient for the rest of
one session. A living doc must replay across stranger sessions, so it
cannot afford freeform. The seven ops are the discipline that prevents
schema dissolution.

---

## Diagram 7 — Permission tiers, today and proposed

The harness already has a tier model on bash. The compositor has a sole-writer
discipline but no tier model on patch ops. The asymmetry is the gap.

```mermaid
flowchart LR
  subgraph H [Harness side]
    HC[bash command]
    HC --> Hclass{classify by command}
    Hclass --> Hr[read-only ls cat grep]
    Hclass --> Hw[workspace git npm test]
    Hclass --> Hf[full rm sudo shutdown plus interactive approval]
  end
  subgraph C_today [Compositor side today]
    CC[any patch op]
    CC --> Cflat[no classification all ops equal]
  end
  subgraph C_proposed [Compositor side proposed]
    PC[patch op classified by kind and target]
    PC --> Pclass{classify}
    Pclass --> Pr[read render only]
    Pclass --> Pw[workspace card-create card-update rationale-update]
    Pclass --> Pf[full invariant-suggest coverage-add coverage-remove ticket-create plus interactive approval]
  end
```

**Concrete consequence.** Right now an AI pass that wants to suggest a new
invariant is treated identically to one that wants to fix a typo in a
card's rationale. Tiering the ops means the high-impact ops (invariants,
coverage edges, ticket links) require human approval the way `rm -rf` does,
while typo fixes flow through.

---

## Diagram 8 — Compositor placement, current and three proposed

The hardest open architecture question: where exactly does the compositor
live relative to the harness?

```mermaid
flowchart TB
  subgraph current [Today beside the harness]
    direction LR
    H1[harness session]
    H2[compositor MCP server]
    Glue1[skills bridge by hand]
    H1 --- Glue1 --- H2
  end
  subgraph option_a [Option A inside as compaction layer]
    direction LR
    HA[harness session]
    HA --> Hcompact[compaction step at context budget]
    Hcompact --> CompA[compositor patch_apply emits typed cards]
  end
  subgraph option_b [Option B post-tool hook]
    direction LR
    HB[harness tool runs]
    HB --> Hpost[post-tool hook]
    Hpost --> CompB[compositor classifies whether event becomes a card-update]
  end
  subgraph option_c [Option C session-end summarizer]
    direction LR
    HC[session end]
    HC --> Sum[ai-pass engine reads session log]
    Sum --> CompC[emits card-create or card-update patches]
  end
  current -.evolve toward.-> option_a
  current -.evolve toward.-> option_b
  current -.evolve toward.-> option_c
```

**My read.** Option C is the cheapest and most additive: nothing changes
inside a session, but every session-end can optionally run an ai-pass that
folds the session into a card. Option A is the most ambitious: the
harness's own compaction *is* a compositor patch_apply, which means a
running session is continuously projecting into a living doc. Option B is
in between and probably the wrong shape — too fine-grained, too noisy.

This is the one diagram I most want feedback on, since it is the only one
that is genuinely *open*.

---

## Diagram 9 — Four real failure modes

Replacing the generic "prefix-cache trap" with the cascades that actually
threaten this codebase.

```mermaid
flowchart TB
  subgraph fm1 [1 Patch-op drift]
    A1[someone adds 8th op]
    A1 --> A2[schema not bumped]
    A2 --> A3[older sessions cannot replay log]
    A3 --> A4[history silently lossy]
  end
  subgraph fm2 [2 Render-drift]
    B1[HTML hand-edited or AI-edited]
    B1 --> B2[disagrees with JSON canonical]
    B2 --> B3[next render overwrites the divergence]
    B3 --> B4[edit lost without warning]
  end
  subgraph fm3 [3 Skill-as-shell-script]
    C1[SKILL md shells out to gh or jq]
    C1 --> C2[writes living-doc directly]
    C2 --> C3[bypasses MCP and patch schema]
    C3 --> C4[no entry in patch log]
    C4 --> C5[mutation invisible to replay]
  end
  subgraph fm4 [4 Compaction-fidelity collapse]
    D1[card-update accepts wholesale body replace]
    D1 --> D2[patch log carries blob swaps not structural changes]
    D2 --> D3[over time card schema dissolves]
    D3 --> D4[stranger session cannot read structure]
  end
```

**The defense each one needs.**
- *Patch-op drift* — schema version pinned in every patch; CI rejects
  patches whose schema version exceeds the deployed validator.
- *Render-drift* — HTML files have a header pragma `JSON canonical render do
  not edit`; pre-commit hook refuses HTML changes without a JSON change.
- *Skill-as-shell-script* — every SKILL.md declares which MCP tools it
  uses; CI scans skills for raw `gh issue create`, `cat > docs/`, etc., and
  flags.
- *Compaction-fidelity collapse* — `card-update` is restricted to
  field-level updates by default; full-body replace requires a
  `--replace-body` flag and is logged distinctly.

---

## Diagram 10 — Skill taxonomy under the new framing

If a skill cannot be slotted into one of these three classes, it is
probably misshapen.

```mermaid
flowchart TB
  Skill[a skill in dot claude slash skills]
  Skill --> Q1{does it mutate living-doc state}
  Q1 -->|no only reads or renders| Class1[harness-tier client]
  Q1 -->|yes emits patch ops via MCP| Q2{does it run a sub-agent}
  Q1 -->|yes but bypasses MCP| Bad[misshapen rewrite as Class2]
  Q2 -->|no direct emit| Class2[compaction-tier writer]
  Q2 -->|yes dispatches to claude-code or codex| Class3[ai-pass orchestrator]

  Class1 --> EX1[living-doc bootstrap]
  Class1 --> EX2[dossier]
  Class1 --> EX3[oss-issue-deep-dive]
  Class2 --> EX4[crystallize]
  Class2 --> EX5[convergence-advisor]
  Class3 --> EX6[ai-pass-claude]
  Class3 --> EX7[ai-pass-codex]
```

**The asymmetry the diagram exposes.** Today most skills are Class 1 (read
and present) or Class 3 (run an ai-pass). Class 2 — direct typed-patch
emission — is small. That asymmetry is suspicious. If `crystallize` and
`convergence-advisor` are doing patch-op work, are they doing it through
MCP, or do they have direct write paths that should be revoked?

---

## Diagram 11 — The compaction question

The one decision the framing forces us to answer. What runs at the boundary
between a session and a living doc?

```mermaid
flowchart LR
  Sess[session ends with raw events and tool log]
  Sess --> Q1{is the work card-shaped}
  Q1 -->|no| NoCompact[no compaction host harness drops the session log]
  Q1 -->|yes attempt log decision record etc| Q2{which convergence type}
  Q2 --> CompChoice[match to type and emit card-create]
  CompChoice --> Patch[ai-patch applied via MCP]
  Patch --> Doc[living doc updated]

  Q3{who runs this step}
  Q3 --> A1[option human invokes ai-pass at end]
  Q3 --> A2[option harness post-session hook]
  Q3 --> A3[option daemon watches session log]
```

**This is the question Diagram 8 is actually about.** Picking an option in
Diagram 8 is picking a "who runs this step" answer in Diagram 11.

---

## Diagram 12 — What the framing buys us as one picture

The last diagram. The reframe is the whole product.

```mermaid
flowchart LR
  subgraph before [Before the framing]
    B1[skills are tools we wrote]
    B2[MCP server is a quirky design choice]
    B3[ai-patch ops are an internal detail]
    B4[living doc is a doc rendering tool]
  end
  subgraph after [After the framing]
    A1[skills are clients of a harness runtime]
    A2[MCP sole-writer is a recognizable permission tier]
    A3[ai-patch event stream is harness session log lifted to multi-session scope]
    A4[living doc is the compaction artifact for multi-session work]
  end
  before -.same code different vocabulary.-> after
  after --> Bench1[a test for new skills slots into 9 components]
  after --> Bench2[a roadmap each component has a defense]
  after --> Bench3[an architecture question where does compositor end and harness begin]
```

---

## What changes in the HTML page versus the diagrams

The HTML page should *embed* these diagrams (Mermaid renders client-side or
pre-rendered SVG). Surrounding prose should be tight — each diagram carries
its own argument; prose is the connective tissue, not the body. Estimated
final shape: ~12 diagrams, ~600 words of prose, single page.

---

## Open questions for review

1. **Diagram 8 specifically** — am I right that Option C is the right
   first move? Or is Option A the actual ambition and Option C is
   procrastination?
2. **Diagram 7's proposed tiering** — is invariant-suggest really *full*
   tier, or is it workspace-tier with a separate "must be reviewed"
   flag? The two are not the same.
3. **Diagram 10's misshapen-skill check** — should this be a CI gate, or
   just authoring guidance?
4. **Diagrams to cut** — 12 is a lot. If you had to drop three, which?
   My instinct: 5 (sub-agent dispatch — covered enough by 4),
   maybe 12 (the meta-summary is what the lede paragraph already says).
