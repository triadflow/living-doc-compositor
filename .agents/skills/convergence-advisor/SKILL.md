---
name: "convergence-advisor"
description: "Help decide whether an existing convergence type fits a domain problem or define and register a new one through dialog."
---

# /convergence-advisor

Help discover and define convergence types for living docs through dialog. A thinking partner for domain decomposition — not a form filler.

## Usage

```
/convergence-advisor                     # Start from the current session context
/convergence-advisor "my domain problem" # Start from a described problem
```

## What This Skill Does

When someone is working on a domain and senses they need a living doc — or needs to add a new section to an existing one — this skill helps them identify which convergence type fits. It works through dialog, not through forms.

## Execution

### 1. UNDERSTAND THE DOMAIN

If an argument is given, use it as context. Otherwise, read the session context — what files are being discussed, what entities keep appearing together, what questions the user is trying to answer.

Ask: **"What things do you keep checking together?"**

Listen for signals:
- "I need to know if X matches Y" → alignment convergence
- "I keep checking these three things together" → scope convergence
- "The status of this depends on whether all those are done" → verification convergence
- "I need to trace from design to deployment" → stack-depth convergence

### 2. SHOW EXISTING TYPES AS EXAMPLES

Before proposing anything new, read the registry:

```
cat scripts/living-doc-registry.json
```

Present existing convergence types as examples of how other domains solved similar problems:

- **Component Status**: "The pipeline team used this because their problem was: is each piece built or not?"
- **Design-Code-Spec Flow**: "The mobile team used this because their problem was: does the implementation match the design across Figma, code, specs, and interactions?"
- **Verification**: "The deployment team used this because their problem was: can we prove this works after deploy?"
- **Design-Implementation Alignment**: "This tracks the relationship between two entity types — like Figma nodes mapped to code files, with drift status on the edge."
- **Stack-Depth Integration**: "This shows how deep a feature reaches through the stack — from design to screens to hooks to services to contracts."
- **Behavior Fidelity**: "This compares expected behavior to actual behavior — is the interaction wired, visual-only, or unwired?"
- **Mediated Operation**: "This tracks workflows that an operator runs on behalf of someone else — the brief, the inputs, the automation."
- **Decision Record**: "This captures decisions with their ticket links, status, and rationale."

Ask: **"Does any of these match what you're seeing? Or is yours a different combination of sources?"**

### 3. IDENTIFY THE CONVERGENCE (if new)

If no existing type fits, help identify the new one through dialog:

**Sources**: "You mentioned [X], [Y], and [Z] always appearing together. Those are your source entity types. Are there others?"

**Borrowed property**: "What status do you care about when you look at this grouping? What would make you say 'this is good' vs 'this needs work'?"

**Projection**: "Are you grouping things under a name (card grid) or mapping one type to another (edge table)?"

**Derivation**: "How does the status compute? Worst-of across all sources? Count of how many are done? Any-match?"

### 4. CHECK AGAINST EXISTING TYPES

Before creating a new type, validate:

- Does this overlap with an existing convergence type?
- Could this be an instance of an existing type with different scope boundaries?
- Is this genuinely a new combination of sources?

If it overlaps, say so: "What you're describing is actually a [existing type] scoped to [your domain]. You don't need a new type — just use it."

### 5. DEFINE AND REGISTER

If a new type is genuinely needed, propose the definition:

```json
{
  "name": "<name>",
  "icon": "<svg path>",
  "projection": "card-grid|edge-table",
  "columns": 2,
  "sources": [
    { "key": "<fieldName>", "entityType": "<type>", "label": "<display>" }
  ],
  "statusFields": [
    { "key": "status", "statusSet": "<set-name>" }
  ]
}
```

If the user confirms, add it to `scripts/living-doc-registry.json`. If a new status set is needed, define that too.

No code changes needed. The compositor GUI and universal renderer pick it up immediately.

### 6. CONNECT TO A DOCUMENT

After identifying or creating the type, ask: "Do you want to add this to an existing living doc, or start a new one?"

- **Existing doc**: Read it, add a new section with the convergence type, empty data array
- **New doc**: Create a minimal JSON with the objective, success condition, and the first section

Either way, the `/living-doc` skill handles the ongoing maintenance.

## Key Principles

1. **Advisor, not form filler.** Ask "what's the shape of your problem?" not "what fields do you want?"
2. **Examples first.** Always show existing types before proposing new ones.
3. **Conservative.** Prefer mapping to an existing type over creating a new one.
4. **Session-aware.** Read the context — the user may not know the name for what they need.
5. **Teach the concept.** If someone is new, explain: entities (things with identity), edges (relationships), scopes (convergences that borrow their properties from sources).
