# How Living Docs Work

This document explains the living-doc model from the conceptual level first, then connects that model to the actual artifacts in this repository.

## The Problem A Living Doc Solves

Most real work is split across systems.

- Design lives in Figma.
- Code lives in repositories.
- Status lives in tickets and pull requests.
- Verification lives in probes, tests, workflows, and logs.
- Decisions live in chat, meetings, comments, and scattered notes.

To understand the actual state of a feature, product surface, integration, or operation, a human usually has to gather those pieces manually and rebuild the structure in their head.

That is expensive.

It is expensive for humans because they spend time hunting for structure instead of reasoning about the work.

It is expensive for LLMs because tokens get spent reconstructing context instead of using context.

A living doc exists to reduce that cost.

## What A Living Doc Is

A living doc is not just a page of notes.

A living doc is a structured, navigable view over work that already exists somewhere else.

It brings multiple source surfaces into one page without pretending to replace those sources.

The key idea is:

> a living doc is a projection, not a duplicate system of record

That matters because it changes the job of the document.

The document is not trying to become the new canonical source for design, code, or issue state.

Instead, it acts as a convergence surface:

- one place to see related things together
- one place to reason across system boundaries
- one place to share context with someone who does not have equal access to every source

In the language used in this repo, a living doc is a subgraph view: a deliberate projection of entities and relationships into a readable page.

## The Core Mental Model

Three primitives matter most.

| Primitive | Meaning |
|---|---|
| Entity | Something with its own identity and properties, such as a Figma page, code file, ticket, API, workflow, or probe |
| Edge | A typed relationship between entities, such as implements, verifies, references, or aligns |
| Scope | A named convergence of entities viewed together for a reason |

The scope is what the living doc gives you.

It says: for this topic, these things belong in the same reasoning frame.

That framing is the real value.

Without scope, you have a pile of links.

With scope, you have an intelligible surface.

## Why The System Uses Convergence Types

A living doc is made from sections.

Each section is not arbitrary. It is an instance of a convergence type.

A convergence type defines:

- which kinds of source entities can appear together
- which statuses matter
- which notes or detail fields belong
- how the section should be projected visually

This is one of the most important ideas in the whole system.

The type is not just display decoration.

The type is a semantic claim about what kind of convergence is happening.

For example:

- design + code + spec + tracked interaction is one kind of convergence
- capability + implementation status + tickets is another
- design node to code file alignment is another
- verification evidence across automation, probes, APIs, and pages is another

The repo calls these formal combinations convergence types because the interesting thing is not any one source by itself. The interesting thing is the fact that they converge.

Once the convergence type is known, the rest can be standardized.

That gives both humans and LLMs a major advantage:

- the type tells you what is inside
- the type tells you what kinds of relationships matter
- the type narrows where to look when something is wrong

In other words, the type compresses the search space.

## Why The Projection Is Derived From The Type

This system deliberately avoids making layout a separate semantic decision.

A section is not first defined as data and then later styled however someone feels like styling it.

Instead, the convergence type determines the projection.

Today the main projections are:

- `card-grid`
- `edge-table`

That means a section is not saying:

> here is some data, choose a layout

It is saying:

> this is this kind of thing, therefore it should be seen this way

That keeps the structure legible across documents.

It also prevents silent drift where two sections mean the same thing but are presented differently for accidental reasons.

## A Living Doc Is Meant To Evolve

The system is not built around the idea that you should design the perfect document upfront.

Instead, you start with the minimum number of convergence types that make the current work intelligible.

Then you add structure as the work reveals new recurring needs.

Typical evolution looks like this:

1. You begin with a capability or implementation surface.
2. You realize status alone is not enough.
3. You add design-to-code alignment.
4. Later you add verification evidence.
5. Later still you add decision or canonical-claim sections.

The important property is additive growth.

Existing sections keep their meaning.

New sections increase coverage rather than forcing a rewrite of the whole doc.

That is why the system can grow with the work instead of becoming a taxonomy exercise that stalls before anyone gets useful output.

## What Makes A Living Doc "Living"

The phrase "living doc" does not mean "a mutable essay."

It means the document stays tied to operational reality.

It can be updated as the sources change.

It can accumulate new sections as the reasoning needs change.

It can be rerendered into a new snapshot when the underlying document changes.

The "living" part is the continuity of relationship to the underlying systems and to the evolving model of the work.

It does not mean every shared HTML file updates itself forever.

In fact, in this repo, the shared HTML output is explicitly a snapshot.

That distinction is important:

- the JSON document is the editable canonical artifact in this repo
- the rendered HTML is a portable snapshot of that state at a point in time

## Canonical JSON Versus Portable HTML Snapshot

The working source for a living doc is JSON.

The shareable artifact is standalone HTML.

That split solves two different problems.

### The JSON solves authoring

The JSON is the structured source that can be edited, versioned, reviewed, regenerated, and rerendered.

It is where section composition and document content actually live.

### The HTML solves distribution

The HTML is meant to travel.

It can be sent to someone else, opened without a server, and inspected without a build step.

It is self-contained by design.

The HTML also embeds the full compositor, not a reduced viewer.

That means the deliverable is not just the document. It is the document plus the tool needed to inspect or extend the structure.

This is a deliberate product choice:

- recipients can read the doc
- recipients can explore how it is structured
- recipients can use the same tool to derive a new doc

## Why The Snapshot Carries Identity And Lineage

A portable HTML snapshot can drift from its source.

The repo treats that as normal, not as a failure.

Because drift is expected, the snapshot includes identity and lineage fields such as:

- doc ID
- title
- scope
- owner
- generated timestamp
- version or revision
- canonical origin
- derived from
- source coverage

These fields answer the practical questions that appear the moment an HTML file gets shared:

- What exactly is this?
- When was it generated?
- What source did it come from?
- What systems does it cover?
- How likely is it to be outdated?

The snapshot therefore does not hide its own limitations. It declares them.

## Why Relative Time Is Anchored To The Snapshot

If a snapshot shows phrases like "6 minutes ago" and then sits in a folder or chat thread for a week, that phrasing becomes misleading.

So the correct anchor for relative time in a portable snapshot is not the viewer's current clock.

It is the snapshot generation time.

That is why the generated HTML now treats the header `Generated` timestamp as the anchor and derives block-level relative labels from it.

Conceptually, this preserves the meaning of the snapshot:

- it tells you how old evidence was relative to the moment the snapshot was taken
- it does not pretend the snapshot is a live dashboard

## How The Registry Fits In

The registry is the formal vocabulary of the system.

In this repo, that vocabulary lives in [../scripts/living-doc-registry.json](../scripts/living-doc-registry.json).

The registry defines:

- entity types
- status sets
- convergence types

This matters because the renderer and compositor are not supposed to hard-code meaning.

The registry is the single source of truth for what a type is.

If you need a new convergence type, you add a registry entry.

You do not fork logic across renderer and UI just to teach the system a new concept.

That separation gives the system a clean shape:

- the registry defines semantics
- the compositor provides authoring behavior
- the renderer produces shareable artifacts

## How The Compositor Fits In

The compositor is the authoring surface.

In this repo, it lives at [living-doc-compositor.html](./living-doc-compositor.html).

Conceptually, the compositor does four jobs:

1. It lets you compose a document out of convergence types.
2. It lets you inspect and edit the structured JSON representation.
3. It lets you preview the projected document.
4. It lets you export either JSON or standalone HTML.

The compositor is intentionally a single self-contained HTML file.

That keeps the tool easy to open, easy to share, and easy to embed into rendered docs.

The renderer synchronizes embedded registry and locale data into the compositor so it can still run as a standalone artifact without external fetches.

## How Rendering Fits In

Rendering is the act of turning a canonical JSON document into a portable HTML snapshot.

In this repo, the universal renderer is [../scripts/render-living-doc.mjs](../scripts/render-living-doc.mjs).

Conceptually, the renderer does this:

1. Load the document JSON.
2. Load the current registry and locale data.
3. Load the current compositor HTML.
4. Build snapshot identity and lineage metadata.
5. Project each section according to its convergence type.
6. Embed the complete compositor into the output.
7. Write one standalone HTML file.

That gives the system an important property:

> every rendered living doc is both a deliverable and a portable authoring environment

## The Universal Document Shape

Every living doc follows one general shape even when the domain changes.

At the top level, a document contains metadata such as:

- title
- subtitle
- scope
- owner
- version
- canonical origin
- source coverage

Then it contains sections.

Each section contains:

- an `id`
- a `title`
- a `convergenceType`
- optional callouts, stats, pills, or timestamps
- a `data` array with the actual items for that section

The point of the universal format is not to make all docs identical.

The point is to make all docs legible to the same toolchain.

The document can vary in content while remaining structurally recognizable.

## What A Section Is Really Doing

A section is not just a chapter.

A section is a statement that a particular kind of convergence deserves its own reasoning surface.

For example, one section may answer:

- what capabilities exist and what state are they in?

Another may answer:

- where does the implementation diverge from the design?

Another may answer:

- what evidence says this thing is verified?

This is why the system scales better than a long narrative document.

Instead of forcing all reasoning into paragraphs, it gives each recurring pattern a known shape.

## How Living Docs Differ From Other Artifacts

Living docs overlap with several familiar tools, but they are not the same thing.

### They are not wikis

A wiki is usually organized around free-form prose first.

A living doc is organized around typed convergence surfaces first.

### They are not dashboards

A dashboard usually optimizes for current metrics and status at a glance.

A living doc optimizes for structural reasoning across systems.

### They are not issue trackers

An issue tracker is a system of record for work items.

A living doc can include ticket state, but only as one part of a larger view.

### They are not architecture diagrams

An architecture diagram shows components and relationships abstractly.

A living doc can include that reasoning, but it is tied to concrete working artifacts and current status.

## Why This Helps Humans

For humans, living docs reduce context switching.

They also reduce the amount of hidden structure that must be inferred every time someone new joins the work.

A good living doc tells a reader:

- what kinds of things matter here
- how they are grouped
- what status language to trust
- what source surfaces exist
- where gaps or drift still remain

That makes onboarding faster and review sharper.

## Why This Helps LLMs

The repo explicitly treats living docs as useful for local AI workflows.

The reason is simple:

LLMs perform better when the surrounding structure is explicit.

When a document is self-describing and typed:

- retrieval gets easier
- prompts need less reconstruction work
- updates can target specific sections
- tokens go toward reasoning instead of parsing

The convergence type effectively acts as a compact semantic interface.

It tells the model what it is looking at before the model has to infer it from raw text.

## What The System Refuses To Do

The constraints in this repo are not incidental. They protect the model.

The system deliberately refuses a few tempting shortcuts.

### It does not hard-code type meaning in the renderer

If a type exists, it belongs in the registry.

### It does not rely on external runtime dependencies in rendered docs

A rendered artifact must stand alone.

### It does not quietly rewrite meaning when moving content

If content moves between artifacts, it should be carried exactly.

### It does not pretend snapshots are live truth

A snapshot can drift, so it must expose lineage.

## The Smallest Operational Picture

If you want the shortest accurate model of the whole system, it is this:

1. The registry defines the language of convergence.
2. The compositor lets you build a document with that language.
3. The JSON stores the document in a universal form.
4. The renderer turns that JSON into a standalone HTML snapshot.
5. The snapshot embeds the full compositor so the document remains inspectable and extensible after sharing.

## How To Read This Repo Through That Model

If you are new to the repo, these files matter most:

| File | Role |
|---|---|
| [README.md](../README.md) | Short overview of the system and commands |
| [../scripts/living-doc-registry.json](../scripts/living-doc-registry.json) | Canonical type system |
| [../scripts/living-doc-i18n.json](../scripts/living-doc-i18n.json) | Canonical locale strings |
| [living-doc-compositor.html](./living-doc-compositor.html) | Standalone compositor tool |
| [living-doc-empty.json](./living-doc-empty.json) | Skeleton source document |
| [../scripts/render-living-doc.mjs](../scripts/render-living-doc.mjs) | Universal JSON-to-HTML renderer |
| [../scripts/render-registry-overview.mjs](../scripts/render-registry-overview.mjs) | Registry overview generator |

## Final Conceptual Summary

A living doc is a typed reasoning surface over distributed work.

It exists because the real state of modern work is scattered across systems and expensive to reconstruct.

Its core move is to define recurring kinds of convergence as first-class types.

Those types let the system standardize projection, reduce ambiguity, and make both human and LLM reasoning more efficient.

The JSON document is the canonical structured source.

The HTML is the portable snapshot.

The registry is the semantic source of truth.

The compositor is the authoring surface.

The renderer is the packaging step that turns the model into something shareable without losing lineage or tool access.
