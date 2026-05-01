---
name: "tiny-experiment"
description: "Bootstrap a tiny-experiments living doc, add new pacts with hypothesis/window/signals, or close running pacts with persist/pause/pivot."
---

# /tiny-experiment

Run small, time-bounded experiments with an explicit hypothesis, a window, and a closure that picks one of three legitimate moves — persist, pause, or pivot. Inspired by Anne-Laure Le Cunff's *Tiny Experiments* (2025).

## Usage

```
/tiny-experiment                  # Show pacts, surface anything due to close
/tiny-experiment new              # Add a new pact to an existing doc
/tiny-experiment bootstrap        # Create a pacts living doc from the template
/tiny-experiment close <card-id>  # Close a pact with outcome + rationale
```

## What this skill does

Three flows:

1. **Bootstrap** a new pacts living doc from the template, walking the user through their first pact.
2. **Add** a new experiment card to an existing doc.
3. **Close** a running pact — record outcome (persist / pause / pivot) and a one-or-two-sentence rationale.

A pact is a bet, not a goal. Always insist on the hypothesis form (`If I do X for N, then Y`) and a real end date.

## Execution

### 1. DISCOVER OR BOOTSTRAP

Look for an existing pacts living doc — any JSON in `docs/` whose first section has `convergenceType: "tiny-experiment"`.

```bash
grep -l '"convergenceType": "tiny-experiment"' docs/*.json
```

If none exists and the user wants to start one:

```bash
cp docs/living-doc-template-starter-tiny-experiment.json docs/<short-name>-pacts.json
```

Then edit the new file's `docId`, `title`, `subtitle`, `scope`, `owner`, `canonicalOrigin`, and `updated`. Clear the example `data` arrays unless the user explicitly wants to keep the seeded examples as references. Walk the user through their first pact (see ASK THE QUESTIONS).

### 2. SHOW STATE

For an existing doc, show:

- **Running pacts**, grouped by `windowEnd` (soonest first).
- **Pacts whose window has elapsed** and need closure — surface these *first*. Closure waiting is itself a signal.
- **Recently-closed pacts** with their outcomes.

If anything is overdue for closure, ask about it before asking what the user wants to do next.

### 3. ASK THE QUESTIONS — new pact

Always in this order:

1. **What's the bet?** Hypothesis. Insist on declarative form: *"If I do X for N, then Y."* If the user says "I want to try X" reframe to a hypothesis. Reject pure goals ("I want to ship the feature") — accept questions ("If I pair on the renderer for two weeks, the test suite will catch the next regression").
2. **What window?** Default 14 days from today. Accept any duration. Flag anything > 30 days as suspicious — long windows usually mean the pact is too big and should be split.
3. **What signals?** At least one. Push for *trackable*. Reject vague ones ("I'll see how it feels") — accept "drift catches per week", "morning energy 1-5", "session count", "edit passes per dossier".
4. **Title.** Short, fits on a card. Reject titles that sound like goals; accept titles that name the bet.

Then write the card. Card shape:

```json
{
  "id": "<slug>",
  "name": "<title>",
  "status": "running",
  "updated": "<full ISO timestamp>",
  "windowStart": "<YYYY-MM-DD>",
  "windowEnd": "<YYYY-MM-DD>",
  "hypothesis": [
    { "type": "info", "text": "<declarative hypothesis>" }
  ],
  "signals": [
    { "type": "info", "text": "<signal 1>" },
    { "type": "info", "text": "<signal 2>" }
  ],
  "ticketIds": [],
  "notes": []
}
```

### 4. ASK THE QUESTIONS — closure

When closing a pact:

1. **Outcome.** Persist, pause, or pivot. Three legitimate moves; none is failure. If the user reaches for "fail", reframe — *what did the signals actually show?* That's a pause or a pivot, not a fail.
2. **Rationale.** One or two sentences. Push past "it worked" to *what specifically the signals showed*.
3. **Next pact?** Only if pivoting or persisting-with-changes. Optional link to a follow-up card id.

Then update the card:

```json
{
  "status": "closed",
  "outcome": "persist | pause | pivot",
  "rationale": [
    { "type": "info", "text": "<one or two sentences>" }
  ],
  "nextPact": "<id or omit>",
  "updated": "<full ISO timestamp>"
}
```

### 5. WRITE AND RENDER

- Update the JSON in place.
- Set `updated` at doc, section, and card levels (full ISO precision, not just date).
- Re-render: `node scripts/render-living-doc.mjs <path>`.

### 6. REPORT

For a new pact:

```
Pact <title> opened — running until <windowEnd>
Tracking: <signals>
```

For a closure:

```
Pact <title> closed — <outcome>
Rationale: <one line>
Next pact: <id or "none">
```

## Key principles

1. **A pact is a bet, not a goal.** Always require hypothesis form. Goals are outcomes; bets are questions.
2. **The window is real.** Default 14 days. > 30 days is suspicious — usually the pact is too big.
3. **Persist / pause / pivot — never silent drop.** If a pact runs past its window without closure, surface it. Drifting is the failure mode this skill is built to prevent.
4. **The rationale is the data.** A closed card without rationale taught the user nothing.
5. **Borrow Le Cunff's frame; do not copy her vocabulary.** If "pact" reads as forced in a particular doc, "experiment" works fine. The discipline is what matters, not the brand.
6. **Ship the artifact.** After every change, re-render. The HTML is the thing the user actually reads.
