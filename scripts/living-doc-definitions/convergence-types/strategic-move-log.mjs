import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "strategic-move-log",
  "name": "Strategic Move Log",
  "category": "monitoring",
  "kind": "surface",
  "description": "Discrete actions taken by tracked competitors with observable effect — product launches, pricing changes, acquisitions, key hires, partnerships, exits. Events that happened in the world, not sources you read to learn about them.",
  "structuralContract": "One-column card grid of move-outcome items. Each card is one dated move attributed to a tracked competitor (byCompany reference), with moveType, dateOf, inferred intent, observed effect, and optional linkedIndicators. Use for the record of what competitors did. Not for articles or analyst reports you consumed — those are citations.",
  "notFor": [
    "articles, papers, or interviews you read (use citation-feed)",
    "your own organization's strategic moves (that is a work-bounded doc)",
    "rumors without dated evidence"
  ],
  "promptGuidance": {
    "operatingThesis": "Each card is a dated action with a consequence. Moves are what happened in the world; citations are what you read about the world. Keep the two separate.",
    "keepDistinct": [
      "which competitor made the move (byCompany reference)",
      "move type (launch / pricing / acquisition / hire / partnership / exit / product-retired)",
      "when it happened (dateOf)",
      "inferred intent — what the competitor is trying to achieve",
      "observed effect — what changed after the move",
      "indicators the move is expected to or did affect"
    ],
    "inspect": [
      "Confirm the move has a dated primary source (press release, product-page snapshot, earnings commentary) before logging it.",
      "Check whether an indicator card needs updating as the observed effect."
    ],
    "update": [
      "Transition move-outcome as evidence lands: pending-evaluation → succeeded / failed / ambiguous.",
      "Cross-link to the competitor card via byCompany so the stance evolution can cite the moves that drove it."
    ],
    "avoid": [
      "Do not invent intent without corroborating signals from the competitor.",
      "Do not treat marketing press as a move — moves require an actual change in what the competitor does (ship, price, hire, buy, exit).",
      "Do not file a move before its dateOf has passed; forecasted moves belong in the predictions ladder, not here."
    ]
  },
  "icon": "<path opacity='.22' d='M4 18L10 12L14 16L20 10'/><path d='M4 18L10 12L14 16L20 10' fill='none' stroke='currentColor' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/><circle cx='4' cy='18' r='2'/><circle cx='10' cy='12' r='2'/><circle cx='14' cy='16' r='2'/><circle cx='20' cy='10' r='2'/>",
  "iconColor": "#9333ea",
  "projection": "card-grid",
  "columns": 1,
  "sources": [
    {
      "key": "sourceRefs",
      "entityType": "content-source",
      "label": "Primary source"
    },
    {
      "key": "notes",
      "entityType": null,
      "label": null
    }
  ],
  "statusFields": [
    {
      "key": "outcome",
      "statusSet": "move-outcome"
    }
  ],
  "textFields": [
    {
      "key": "byCompany",
      "label": "By"
    },
    {
      "key": "moveType",
      "label": "Move type"
    },
    {
      "key": "dateOf",
      "label": "Date of move"
    },
    {
      "key": "intent",
      "label": "Inferred intent"
    },
    {
      "key": "observedEffect",
      "label": "Observed effect"
    }
  ],
  "detailsFields": [
    {
      "key": "linkedIndicators",
      "label": "Linked indicators"
    }
  ],
  "domain": "intelligence",
  "entityShape": [
    "time-series"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
