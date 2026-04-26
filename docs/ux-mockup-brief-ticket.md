# Ticket: UX Mockup Brief for Static Shareable Living Doc + Tool Integration

## Summary

Create a first series of UX mockups that improve how people work with the living doc, the integrated tool, AI assistance, and other collaborators together, while preserving the current product paradigm:

- the rendered living doc remains a static, shareable artifact
- the full compositor remains integrated into that artifact
- the document remains the primary expression of the work
- AI and human collaboration become more legible without becoming the subject of the page
- the shared accepted document state converges through Git in the GitHub repo
- AI inference remains decentralized and local to each teammate's Codex session

This ticket is for the mockup brief only, not for implementation.

## Why

The current paradigm is structurally correct, but the UX can express the document's objective, current state, section roles, governance state, AI affordances, and collaboration affordances more clearly.

Today, the system is already strong at:

- treating the document as the artifact of record
- embedding the full tool inside the rendered output
- representing structure via convergence types
- making governance visible through objective facets, coverage, invariants, and fingerprint freshness

The UX gap is that these strengths are not yet presented with enough smoothness or clarity for mixed human + AI + multi-person work.

## Product Constraints

The mockups must preserve these constraints:

- Keep the static sharable document + integrated full tool paradigm.
- Do not split the experience into a separate app where the doc becomes secondary.
- Do not reduce the embedded compositor to a lightweight viewer.
- Keep the living doc centered on work objective, current state, evidence, structure, and next value-bearing moves.
- Keep AI and collaborator activity attached to the doc's real structure.
- Make governance legible, but do not make governance the whole experience.
- Assume the underlying source of accepted shared state is a Git repository hosted on GitHub.
- Assume teammates can infer locally, but accepted doc changes centralize through normal Git commits, branches, pull requests, and merges.

## UX Direction

Use this direction as the base:

- Primary paradigm: `Read-First, Act-In-Place`
- Secondary influence: selective `Shared Workbench Around The Doc` elements

Interpretation:

- the document should feel primary on first open
- actions should appear close to the relevant section or card
- AI should behave like a precise operator on doc structure, not generic floating chat
- collaboration should show up as anchored proposals, notes, review state, and handoff state
- surrounding workbench elements may exist, but should not visually demote the document

## Collaboration Model

Design around a two-layer structure:

- `Layer 1: Canonical doc structure`
- `Layer 2: Proposal and review structure`

Interpretation:

- the canonical living doc is the accepted shared state
- teammates run AI inference locally on their own machine against the doc and repo context
- local inference is not itself the shared collaboration substrate
- what becomes shared is structured output: proposals, rationale, evidence updates, comments, and accepted edits
- accepted changes converge in Git and are centralized through the shared GitHub repo
- collaboration should feel compatible with branches, pull requests, review comments, and merge-based agreement

## Architecture Note

The collaboration substrate should be treated as:

- `Living doc`: semantic structure and accepted work state
- `GitHub`: shared convergence, review, and agreement system
- `Local Codex inference`: decentralized private reasoning and repair operator

Interpretation:

- the product should not try to replace GitHub's branch, PR, review, and merge model
- the doc should surface the GitHub states that matter to document coherence and team progress
- canonical document truth is what has landed in the shared repo
- proposal state is what exists on branches, in pull requests, and in review
- local inference is the fallback and power tool when the GUI is insufficient or the user gets stuck
- local inference can manage document state directly on the local checkout, but it only becomes team collaboration once it is committed, pushed, and reviewed through GitHub

Design consequence:

- make GitHub-native collaboration first-class inside the doc
- do not build a fake replacement for GitHub inside the doc
- show only the repo and review state that matters for document understanding and coordination

## Core Design Problem

Design a smoother UX for expressing:

- what this doc is for
- what state the work is in now
- how the sections relate to the objective
- what is fresh, stale, drifting, blocked, or unresolved
- what AI can do here, at this exact point in the doc
- what other people have proposed, changed, reviewed, or handed off
- what is only local inference versus what has been pushed into shared review
- what branch, pull request, or merged change currently carries a proposed structure update

## Deliverable

Produce a first-pass mockup set with `6` screens.

The set should cover both the reading surface and the working surface, but still feel like one integrated product.

## Mockups To Produce

### 1. Doc Landing / Orientation

Show the first-open experience for a rendered living doc.

Must make these things immediately legible:

- objective
- current state
- success condition
- freshness or drift state
- section map
- why this doc matters now

The key feeling should be: "I opened a document that already knows what work it is holding."

### 2. Section Work Surface

Show one section expanded as the main working surface.

Must show:

- section purpose
- section state
- evidence or source grounding
- card-level structure
- local AI actions
- local collaborator notes or proposals
- how a local proposal can become a Git-backed shared proposal

The key feeling should be: "I can understand and act exactly where the work lives."

### 3. Governance / Coherence View

Show a stronger version of the current coherence/flow view.

Must make visible:

- objective facets
- coverage across sections
- invariants
- stale vs fresh fingerprint state
- orphaned or overloaded sections
- AI actions for coherence repair or explanation

The key feeling should be: "The doc can show whether its shape still matches its purpose."

### 4. Review And Proposal Mode

Show how human and AI suggestions attach to the doc without replacing doc truth.

Must distinguish:

- current accepted doc state
- pending proposals
- author comments
- AI-suggested changes
- review status
- local-only proposals versus proposals pushed into the shared repo
- Git/GitHub-backed proposal state such as branch, commit, or pull request context

The key feeling should be: "Collaboration is attached to the structure, not floating beside it."

### 5. Shared Workbench Overlay

Show a more operational mode wrapped around the document.

Must include:

- center doc surface
- structure/state rail
- activity or review rail
- explicit AI operator actions
- ownership or attention signals
- repo-backed coordination signals such as branch status, open PRs, and merged vs unmerged structure changes

This should borrow from the `Shared Workbench Around The Doc` paradigm without losing document primacy.

The key feeling should be: "This is coordinated work around a canonical artifact."

### 6. Handoff / Resume State

Show the experience for a new person or a new AI session joining cold.

Must answer:

- what this doc is trying to achieve
- what the current state is
- what changed recently
- what is unresolved
- what is trusted
- what the next likely actions are
- which repo state is canonical to resume from
- which proposed changes are still only in review

The key feeling should be: "I can resume real work without re-deriving the whole document."

## Content Requirements

Every mockup should visibly express some combination of:

- objective
- current state
- section role
- evidence or sources
- doc freshness or drift
- AI affordances
- collaborator affordances
- proposal vs accepted state
- next useful action
- local inference vs shared proposal state
- Git/GitHub-backed canonical status

At least `3` of the `6` mockups should show how AI operates on specific doc structure.

At least `3` of the `6` mockups should show other people as first-class participants in the workflow.

## Interaction Principles

The mockups should follow these principles:

- Read before act.
- Express state before controls.
- Keep actions local to the structure they affect.
- Prefer precise AI verbs over generic chat.
- Show doc truth separately from suggestion layers.
- Make drift, freshness, and coherence visually obvious.
- Preserve continuity between reading mode and working mode.
- Separate local inference from shared accepted state.
- Make Git-backed agreement feel like the convergence point for collaboration.

## Visual Principles

The mockups should avoid generic SaaS UI and should feel deliberate.

Aim for:

- strong orientation at the top of the doc
- clearer hierarchy between objective, state, sections, and action surfaces
- bold but restrained visual language
- visible status semantics
- distinct treatment for accepted state, pending proposals, and AI suggestions
- a reading experience that still feels polished and shareable

## Out Of Scope

This ticket does not include:

- implementing the new UX in `docs/living-doc-compositor.html`
- changing the JSON schema
- changing the convergence registry
- changing render mechanics
- deciding the final visual system

This ticket is about mockup direction and scope only.

## Acceptance Criteria

- A mockup brief exists and is specific enough for design execution.
- The brief preserves the current static sharable integrated-tool paradigm.
- The brief clearly selects one primary UX direction and one secondary influence.
- The brief clearly describes the two-layer collaboration model.
- The brief assumes decentralized local inference with Git/GitHub as the shared convergence layer.
- The brief defines `6` mockups with distinct purposes.
- The brief makes AI and collaborator roles explicit.
- The brief keeps the living doc centered on objective, current state, evidence, and structure.
- The brief avoids turning the experience into a separate workspace product where the doc is secondary.

## Notes For Design

- The current system already has strong raw ingredients: objective, success condition, sections, convergence types, governance, board mode, and embedded compositor.
- The design opportunity is not to replace that model, but to stage it better.
- If tradeoffs appear, preserve document primacy over operational chrome.
- If one mockup must feel most definitive, prioritize `Doc Landing / Orientation`.
