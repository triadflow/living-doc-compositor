# Proof Ladder Registry Extension Shape

## Goal

Define an exact additive registry shape for `proof-ladder` so the convergence type itself can declare:

- how ordered ladder state is interpreted
- which derived signals are canonical
- which signals are eligible for prominent summary treatment

This is a proposal only. It does **not** patch the live registry yet.

## Why The Current Shape Is Insufficient

The current `proof-ladder` type in `scripts/living-doc-registry.json` already says:

- the section is ordered
- each rung has `probe-status`
- proof strengthens rung by rung
- monotonicity matters

That is enough to render the section as a ladder.

It is not enough to make stronger doc-level decisions such as:

- what the current frontier is
- how many rungs are actually closed as a contiguous prefix
- what the next rung is
- whether a higher rung is invalid because lower rungs are not closed
- which derived ladder signals are important enough for a hero or snapshot surface

## Proposed Additive Extension

Add two new optional fields on convergence types:

- `stateSemantics`
- `summarySemantics`

For `proof-ladder`, the exact shape would be:

```json
{
  "proof-ladder": {
    "name": "Proof Ladder",
    "category": "verification",
    "description": "An ordered ladder of verification steps where each rung increases proof strength toward operational truth.",
    "structuralContract": "Two-column card grid of probe-status items, typically named as levels or rungs. Use when the section expresses staged proof escalation rather than a flat set of checks.",
    "notFor": [
      "unordered verification checkpoints",
      "general work surfaces",
      "decision records"
    ],
    "promptGuidance": {
      "operatingThesis": "Treat proof as staged escalation where each rung increases confidence toward operational truth.",
      "keepDistinct": [
        "proof rung",
        "current status",
        "evidence notes",
        "next stronger proof"
      ],
      "inspect": [
        "Check whether evidence actually satisfies the rung before advancing status."
      ],
      "update": [
        "Preserve ladder ordering and make weaker or missing rungs explicit."
      ],
      "avoid": [
        "Do not flatten proof levels into unordered checks or decisions."
      ]
    },
    "icon": "<path opacity='.22' d='M7 4h2v16H7zm8 0h2v16h-2z'/><path d='M9 7h6v2H9zm0 4h6v2H9zm0 4h6v2H9zm0 4h6v2H9z'/><path d='M18 7l4 4-4 4-1.4-1.4 1.6-1.6H15v-2h3.2l-1.6-1.6L18 7z'/>",
    "iconColor": "#059669",
    "projection": "card-grid",
    "columns": 2,
    "sources": [
      {
        "key": "ticketIds",
        "entityType": "ticket",
        "label": "Tickets"
      },
      {
        "key": "notes",
        "entityType": null,
        "label": null
      }
    ],
    "statusFields": [
      {
        "key": "status",
        "statusSet": "probe-status"
      }
    ],
    "aiActions": [
      {
        "id": "check-monotonic",
        "name": "Check monotonic invariant",
        "description": "Confirm every rung below this one is ready. If not, flag the inversion — this rung cannot legitimately claim ready state."
      }
    ],
    "domain": "engineering",
    "entityShape": [
      "has-code-refs",
      "has-evidence"
    ],
    "stateSemantics": {
      "kind": "ordered-ladder",
      "orderedBy": "data-order",
      "itemUnit": "rung",
      "statusKey": "status",
      "closedStatuses": [
        "ready"
      ],
      "activeStatuses": [
        "partial",
        "blocked"
      ],
      "futureStatuses": [
        "planned"
      ],
      "frontierRule": {
        "kind": "first-status-not-in",
        "statuses": [
          "ready"
        ]
      },
      "closedPrefixRule": {
        "kind": "contiguous-prefix-in-statuses",
        "statuses": [
          "ready"
        ]
      },
      "inversionRule": {
        "kind": "status-after-open-prefix",
        "openStatuses": [
          "partial",
          "planned",
          "blocked"
        ],
        "invalidLaterStatuses": [
          "ready"
        ]
      },
      "derivedSignals": [
        {
          "id": "closedPrefixCount",
          "kind": "contiguous-prefix-count",
          "statuses": [
            "ready"
          ]
        },
        {
          "id": "currentFrontierItem",
          "kind": "first-item-with-status-not-in",
          "statuses": [
            "ready"
          ]
        },
        {
          "id": "currentFrontierStatus",
          "kind": "status-of-signal",
          "signal": "currentFrontierItem"
        },
        {
          "id": "nextRungItem",
          "kind": "next-item-after-signal",
          "signal": "currentFrontierItem"
        },
        {
          "id": "isFullyClosed",
          "kind": "all-items-in-statuses",
          "statuses": [
            "ready"
          ]
        },
        {
          "id": "hasInversion",
          "kind": "violates-rule",
          "rule": "inversionRule"
        }
      ]
    },
    "summarySemantics": {
      "headlineSignal": "currentFrontierItem",
      "prominentSignals": [
        "currentFrontierItem",
        "currentFrontierStatus",
        "closedPrefixCount",
        "nextRungItem"
      ],
      "summaryFields": [
        {
          "id": "currentFrontier",
          "label": "Current frontier",
          "signal": "currentFrontierItem",
          "format": "item-name"
        },
        {
          "id": "currentFrontierStatus",
          "label": "Frontier status",
          "signal": "currentFrontierStatus",
          "format": "raw"
        },
        {
          "id": "closedRungs",
          "label": "Closed rungs",
          "signal": "closedPrefixCount",
          "format": "count"
        },
        {
          "id": "nextRung",
          "label": "Next rung",
          "signal": "nextRungItem",
          "format": "item-name"
        },
        {
          "id": "ladderComplete",
          "label": "Fully closed",
          "signal": "isFullyClosed",
          "format": "boolean"
        }
      ],
      "consumerHints": {
        "status-snapshot": {
          "prefer": [
            "closedRungs",
            "currentFrontier",
            "currentFrontierStatus",
            "nextRung"
          ]
        },
        "hero": {
          "prefer": [
            "currentFrontier",
            "closedRungs",
            "nextRung"
          ]
        },
        "flow": {
          "prefer": [
            "hasInversion"
          ]
        }
      }
    }
  }
}
```

## What This Means

This keeps `proof-ladder` as the source of truth for ladder meaning.

The registry itself now declares:

- what counts as closed
- what counts as current
- how to find the frontier
- how to detect invalid ladder inversions
- which derived ladder signals are important enough to summarize prominently

That lets the compositor or any inference layer behave consistently without hard-coded proof-ladder logic.

## Why Split `stateSemantics` From `summarySemantics`

`stateSemantics` answers:

- how should this convergence type be interpreted structurally?
- what derived state can be computed from its items?

`summarySemantics` answers:

- which of those derived states are meaningful enough to elevate?
- how should other surfaces consume them?

That separation matters because many convergence types may want derived state, but not all derived state deserves hero prominence.

## Why This Is Better Than Encoding It In `status-snapshot`

If `status-snapshot` invents ladder semantics, then the meaning of a proof ladder leaks out of the proof-ladder type.

That creates two problems:

- the ladder type is no longer the true source of meaning
- every consumer has to learn proof-ladder rules independently

With this extension:

- `proof-ladder` defines its own state logic
- `status-snapshot` can consume the derived summary fields without reinventing them

## Immediate Effect On The Current Proof Ladder Doc

For the current `Proof Ladder Overview` doc, this extension would let the system derive:

- `closedPrefixCount = 5`
- `currentFrontierItem = level-6`
- `currentFrontierStatus = partial`
- `nextRungItem = level-7`
- `isFullyClosed = false`
- `hasInversion = false`

That is exactly the state the current mockups are trying to express prominently.

## What This Suggests For The Convergence Type System

If this direction is right, the convergence type system is not only a rendering registry.

It also becomes a registry of:

- structural meaning
- derivation rules
- summary eligibility

That is a useful expansion because it keeps domain behavior attached to the convergence type instead of scattering it across:

- renderer heuristics
- prompt-only conventions
- one-off mock or UI logic

## Likely Generalization

This shape is likely reusable for other ordered or stateful convergence types later, for example:

- `verification-lattice`
- `capability-surface`
- `operation`

But `proof-ladder` is the clean first candidate because its ordering semantics are explicit and already central.

## Next Step

If this shape looks right, the next concrete step is:

1. decide whether `stateSemantics` and `summarySemantics` should be generic top-level convergence-type fields
2. decide whether the compositor should consume them directly or only expose them to AI/sync layers first
3. then patch `scripts/living-doc-registry.json`
