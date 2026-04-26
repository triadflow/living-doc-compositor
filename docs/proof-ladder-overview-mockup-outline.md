# Proof Ladder Overview — Mockup Outline

## Purpose

Define the mockup structure before refining visuals.

This outline is for the current living doc content served at:

- `http://localhost:4321/api/resources/living-doc/12`

The source document is:

- `Proof Ladder Overview`

## Core UX Assumptions

- The living doc remains the primary surface.
- The document structure stays first-class.
- Team collaboration is decentralized at inference time.
- Shared agreement converges through Git and GitHub.
- The GUI should surface GitHub state that matters to the document.
- The GUI should not invent structure that the doc itself does not carry.

## Structural Rule

The left ribbon must reflect actual document structure, not ad hoc mock labels.

For this doc, the section-driven ribbon is:

- `Objective Coherence`
- `Explain this doc`
- `Status Snapshot`
- `Operating Model`
- `Proof Ladder`
- `Supporting Surface`

Modes like `Flow`, `Review`, `Board`, `GitHub`, or `Resume` belong in the top view switch, not in the structural ribbon.

## Shared Screen Rules

- The mockups use current compositor visual language.
- The top bar shows view mode and repo state.
- The left rail shows section structure only.
- The main canvas shows the active section or doc-level state.
- The right rail shows GitHub-backed collaboration state when relevant.
- Local AI activity is represented as local draft/proposal work, not shared live agent state.

## Screen Set

### 1. Doc Landing / Orientation

Goal:

- Let a teammate understand the current truth quickly.

Content:

- Title and subtitle from the live doc
- Objective
- Success condition
- Current status summary
- Canonical branch/file state
- Section overview
- Key GitHub threads attached to current proof state

Primary emphasis:

- Levels `1–5` closed
- Level `6` partial
- Level `7` planned and blocked behind real Level `6` closure

### 2. Section Work Surface

Goal:

- Show one section as the primary working surface.

Recommended focus:

- `Proof Ladder`, or specifically the `Level 6` content inside it

Content:

- Canonical accepted section state
- Attached GitHub evidence
- Local draft/proposal actions
- Clear distinction between accepted text and local unpushed changes

Primary emphasis:

- Manual runtime delivery is support evidence only
- The rung contract must not be narrowed around available evidence

### 3. Objective Coherence / Flow View

Goal:

- Show how the doc’s structure carries the objective.

Content:

- Objective facets
- Carrying sections
- Governing invariants
- Coverage relationships between them

Primary emphasis:

- `Operating Model`, `Proof Ladder`, and `Supporting Surface` carry the proof objective together
- The coherence view is derived from actual doc structure, not invented board categories

### 4. Proposal Review View

Goal:

- Show how local inference produces structured changes that later converge through GitHub review.

Content:

- Canonical text on `main`
- Local structured proposal
- PR-backed review state
- Accept / defer / revise actions

Primary emphasis:

- Local inference is private and decentralized
- Shared agreement happens through Git branches, PRs, and review

### 5. Shared Workbench View

Goal:

- Show GitHub as first-class around the doc without replacing the doc.

Content:

- Section-driven doc rail
- Center doc state
- Right rail with GitHub-linked queues, PRs, and next operator actions

Primary emphasis:

- The doc remains central
- GitHub is the shared convergence mechanism
- The GUI surfaces repo-backed collaboration rather than simulating a separate collaboration system

### 6. Handoff / Resume View

Goal:

- Let a new teammate or local agent resume quickly from canonical state plus linked work.

Content:

- Current accepted objective
- Current accepted proof state
- Open GitHub threads
- Local draft or pending proposal state
- First next actions

Primary emphasis:

- What is true now
- What is still open
- What is local only
- What should happen next

## GitHub Surface To Show

Only show GitHub state that materially informs the document.

Likely threads for this doc:

- `#148`
- `#197` through `#204`
- `trackandback-lead#476`
- `#157`
- `#164`
- `#175`
- `#187`
- `#131`
- `trackandback-lead#353`
- `trackandback-lead#354`

## Current Content Truth To Preserve

The mockups should preserve the current document truth:

- Levels `1–5` are closed as proof evidence
- Level `6` is partial / open
- Level `7` is planned
- `#148` is not the current closed frontier; it is the repeatability umbrella blocked behind Level `6`
- Manual outer-layer delivery plus same-case replay is support evidence, not Level `6` closure

## Next Step After This Outline

Refine the HTML mockups so that:

- the left ribbon is fully section-driven
- mode switching stays in the top bar
- each screen uses current live doc content
- GitHub state is surfaced as repo-backed collaboration, not fake shared AI state
