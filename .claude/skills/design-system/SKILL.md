# /design-system

Run a design-system living doc — your taste-signature evidenced across prior systems alongside one active client engagement (brief alignment, derivation moves, and the system-being-built as pointer cards).

## Usage

```
/design-system                       # Discover the design-system doc, show state across all four sections
/design-system bootstrap             # Create a design-system living doc from the template
/design-system token <name>          # Add a design-token card (interactive)
/design-system component <name>      # Add a design-component card (interactive)
/design-system motif <name>          # Add a design-motif card (interactive)
/design-system taste                 # Articulate a recurring trait pointing at prior systems
/design-system align                 # Record one brief-to-system alignment pair (constraint ↔ response)
/design-system derive <prior-id>     # Record one derivation move from a prior system
/design-system pull-figma <fileKey>  # Use the Figma MCP at inference time to populate pointer cards
```

## What this skill does

A design system has four kinds of work running in parallel — your recurring identity (taste), translating a brief, carrying primitives over from prior systems, and shipping the actual primitives. The `/design-system` skill runs the doc that holds all four, with the discipline that pointers reference where things live, never duplicate them.

Six flows:

1. **Bootstrap** a new design-system living doc from `docs/living-doc-template-design-system.json`.
2. **Add a primitive** — a token, component, or motif card in the design-system-surface section.
3. **Articulate a taste trait** — a recurring choice across prior systems, with prior-system pointers as evidence.
4. **Record an alignment** — one paired move mapping a brief constraint to a design response.
5. **Record a derivation** — one move from a prior system into the new one (kept / swapped / inverted / scaled / dropped).
6. **Pull from Figma** — at inference time via the Figma MCP, propose pointer cards from the canonical Figma file.

A primitive is a pointer, not a value. A trait needs at least two prior-system pointers to be recurring. An alignment is paired or it is not an alignment. A derivation needs a `priorSystemRef` or it is a fresh decision. The discipline is what this skill is for.

## Execution

### 1. DISCOVER OR BOOTSTRAP

Look for an existing design-system living doc — any JSON in `docs/` whose first section uses one of the four design-system convergence types.

```bash
grep -lE '"convergenceType": "(design-system-surface|taste-signature|brief-to-system-alignment|design-system-derivation)"' docs/*.json
```

If none exists and the user wants to start one:

```bash
cp docs/living-doc-template-design-system.json docs/<short-name>-design-system.json
```

Then edit the new file's `docId`, `title`, `subtitle`, `scope`, `owner`, `canonicalOrigin`, `updated`. Replace the `priorSystems` array with the user's actual prior work and the `clientBriefs` array with the active client brief. Clear the seeded example cards from each section unless the user wants to keep them as references.

### 2. SHOW STATE

For an existing doc, show:

- **design-system-surface** — counts by `design-primitive-status` (proposed / in-figma / coded / shipped / deprecated). Surface anything stuck in `proposed` for more than 14 days — that is itself a signal.
- **taste-signature** — counts by `taste-recurrence` (recurring / emerging / abandoned). Flag `emerging` traits with only one prior-system pointer; they are still anecdotal.
- **brief-to-system-alignment** — show `partial` and `conflicting` first; those are the live tension. `aligned` and `deferred` after.
- **design-system-derivation** — recent moves grouped by `derivation-move` (kept / swapped / inverted / scaled / dropped).

If multiple sections have stale `updated` timestamps (more than 14 days), surface that *first* before asking what the user wants to do next.

### 3. ASK THE QUESTIONS — primitive (token / component / motif)

Always in this order:

1. **Name.** Short, scoped to the system's own vocabulary (e.g. `color/brand/primary`, `button/primary`, `12px-radius-soft-shadow`).
2. **Pointer.** Where it actually lives. One of:
   - Figma variable id — e.g. `figma:Variable:Color/Brand/Primary`
   - tokens.json key — e.g. `tokens.color.brand.primary`
   - CSS custom property — e.g. `--color-brand-primary`
   - Code component path — e.g. `src/components/Button.tsx`
3. **Status.** Default `proposed` for new entries. Promote when the primitive lands in Figma / code / production.
4. **Notes.** Optional rationale or constraint.

Card shape (token):

```json
{
  "id": "<slug>",
  "name": "<token name>",
  "primitiveKind": "token",
  "pointerSystem": "Figma variable | tokens.json | CSS custom property",
  "status": "proposed",
  "updated": "<full ISO timestamp>",
  "tokenRefs": ["<the pointer string>"],
  "derivedFrom": [],
  "notes": []
}
```

Component cards mirror this shape with `primitiveKind: "component"` and `componentRefs`. Motif cards use `primitiveKind: "motif"` and `motifRefs`.

### 4. ASK THE QUESTIONS — taste

1. **Trait.** A recurring choice the designer wants to articulate. Examples: "warm grays over neutral", "8px radius soft shadow", "label-above-input form pattern", "subtle hover lift".
2. **Prior systems.** At least one pointer. Push for two or more — a single appearance is `emerging`, not `recurring`.
3. **Recurrence status.** Default `emerging` if one prior system pointer; `recurring` only with two or more. Never auto-promote without evidence.
4. **Evidence.** One or two sentences naming where the trait shows up across the prior systems.

Card shape:

```json
{
  "id": "<slug>",
  "name": "<short label>",
  "status": "emerging | recurring | abandoned",
  "updated": "<full ISO timestamp>",
  "trait": "<one-sentence description of the recurring choice>",
  "priorSystemRefs": ["<prior-system-id>", "<prior-system-id>"],
  "evidence": [
    { "type": "info", "text": "<where the trait appears across the prior systems>" }
  ],
  "notes": []
}
```

### 5. ASK THE QUESTIONS — alignment

1. **Constraint.** What the brief asks for. Use the brief's own language where possible.
2. **Response.** The design move that answers it. Make it operational ("chroma capped at 60", not "no neon vibe").
3. **State.** `aligned` / `partial` / `deferred` / `conflicting`. Push for honesty — `partial` and `conflicting` are useful early states, not failures.
4. **Brief reference.** Pointer to the `client-brief` entity in the doc's `clientBriefs` collection.
5. **Rationale.** One or two sentences — why this response, not another.

Card shape:

```json
{
  "id": "<slug>",
  "name": "<constraint ↔ response one-liner>",
  "status": "aligned | partial | deferred | conflicting",
  "updated": "<full ISO timestamp>",
  "constraint": "<what the brief asks for>",
  "response": "<the design move that answers it>",
  "briefIds": ["<brief-id>"],
  "tokenRefs": [],
  "componentRefs": [],
  "rationale": [
    { "type": "info", "text": "<why this response>" }
  ]
}
```

### 6. ASK THE QUESTIONS — derivation

1. **Prior system.** Required — pointer to an entry in the `priorSystems` collection. Anonymous influence is not a derivation.
2. **Move.** One of `kept` / `swapped` / `inverted` / `scaled` / `dropped`. The five moves are deliberately distinct — do not collapse to a binary kept/changed.
3. **Target.** Pointer to the new primitive in the current system, when one exists.
4. **Rationale.** One or two sentences — *why this move from this prior, against this brief*. `kept` still needs rationale; without it, the data the move was built on is lost.

Card shape:

```json
{
  "id": "<slug>",
  "name": "<short label of the move>",
  "status": "kept | swapped | inverted | scaled | dropped",
  "updated": "<full ISO timestamp>",
  "priorSystemRefs": ["<prior-system-id>"],
  "briefIds": ["<brief-id>"],
  "targetRef": "<id of the new primitive>",
  "tokenRefs": [],
  "componentRefs": [],
  "motifRefs": [],
  "rationale": [
    { "type": "info", "text": "<why this move>" }
  ]
}
```

### 7. PULL FIGMA — inference-time MCP usage

The `/design-system pull-figma <fileKey>` flow uses the Figma MCP server at inference time. No importer is built; the agent reads Figma variables, components, and styles directly and proposes pointer cards into `design-system-surface`.

Outline:

1. Detect the Figma MCP server. If absent, fall back to manual entry and tell the user.
2. Call whatever the server exposes for variables / components / styles on the given fileKey.
3. For each variable / component / style, propose one card with:
   - `tokenRef` / `componentRef` / `motifRef` set to the canonical Figma id
   - `pointerSystem` set to `"Figma variable"`, `"Figma component"`, or `"Figma effect style"`
   - `status` default `in-figma`
4. Show the user the proposed cards in a single review pass. Confirm, then write.
5. The user can refine names, group entries, or drop ones that should not surface — the skill is a thin layer; the user is the editor.

Do not auto-write without confirmation. Pulling from Figma can be noisy; one review pass keeps the surface curated.

### 8. WRITE AND RENDER

- Update the JSON in place.
- Set `updated` at doc, section, and card levels (full ISO precision, not just date).
- Re-render: `node scripts/render-living-doc.mjs <path>`.
- Report what changed; do not auto-open the rendered file.

### 9. REPORT

For a new card:

```
<Doc title> — <section> updated
Added: <card name> (<status>)
Pointer: <where it lives>
```

For a closure or status change:

```
<Doc title> — <section> updated
<n> cards changed
Status: <one-line summary>
```

For a Figma pull:

```
Figma pull from <fileKey>
Proposed: <n> tokens / <n> components / <n> motifs
Confirmed and written: <n>
```

## Key principles

1. **Pointers, not copies.** Every primitive references where it lives. The card never owns the value. If you find yourself typing a hex code into the card, stop — point at the variable instead.
2. **Taste needs evidence.** One prior-system pointer is `emerging`. Two or more is `recurring`. Do not promote without evidence — the rule is what makes the section data, not assertion.
3. **Alignment is honest.** `partial` and `conflicting` are useful states. They mean a tension between brief and design has been named, not papered over. Promoting prematurely loses that data.
4. **Derivation moves are specific.** `kept` alone is not enough — the rationale names *why this, from that, against this brief*. Anonymous influence is not derivation.
5. **Figma is read at inference time.** No importer is built; the MCP server is used directly when present. The skill works without it, more powerfully with it.
6. **The user edits, the skill drafts.** Especially on `pull-figma`, never auto-write a noisy import. Propose, confirm, write.
7. **Ship the artifact.** Re-render after every change. The HTML is the thing the user actually scrolls through.
