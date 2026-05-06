import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "attempt-log",
  "name": "Attempt Log",
  "category": "verification",
  "kind": "act",
  "description": "A record of actions taken against a problem and what each one proved. Distinct from findings (observations) and decisions (chosen directions).",
  "structuralContract": "Two-column card grid. Each card is one attempt with an outcome. Status is attempt-log-status. Use when capturing tried fixes, probes, and shipped workarounds — not to record decisions or generic findings.",
  "notFor": [
    "observed behaviors (use symptom-observation)",
    "settled team decisions (use decision-record)",
    "positions in an ongoing debate (use maintainer-stance)"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat each card as an action with a result. Every attempt must name what was tried and what it proved; shipped attempts must link their shipping site.",
    "keepDistinct": [
      "what was tried",
      "what it proved",
      "shipped-in location",
      "cost to apply",
      "attempt status"
    ],
    "inspect": [
      "Verify each attempt has a concrete outcome — probes that revealed nothing are noise.",
      "Check the shipped_in URL resolves and the referenced code or patch still exists."
    ],
    "update": [
      "When an attempt is superseded by a newer one, mark it superseded rather than deleting.",
      "Preserve rejected attempts — they tell the next reader what not to try."
    ],
    "avoid": [
      "Do not collapse attempts into observations or decisions.",
      "Do not mix generic notes into attempt cards — supporting context goes in notes[]."
    ]
  },
  "icon": "<path opacity='.28' d='M4 4h12v12H4z'/><path d='M6 7h8v1.5H6zm0 3h6v1.5H6zm0 3h4v1.5H6z'/><path d='M15 13l3 3-1 1-3-3z'/>",
  "iconColor": "#ea580c",
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
      "statusSet": "attempt-log-status"
    }
  ],
  "textFields": [
    {
      "key": "shipped_in",
      "label": "Shipped in"
    },
    {
      "key": "cost_to_apply",
      "label": "Cost to apply"
    }
  ],
  "detailsFields": [
    {
      "key": "what_tried",
      "label": "What was tried"
    },
    {
      "key": "what_proved",
      "label": "What it proved"
    }
  ],
  "aiActions": [
    {
      "id": "propose-supersession",
      "name": "Propose supersession",
      "description": "If a newer attempt productionised the same insight, suggest marking this card superseded and linking the newer shipping site."
    },
    {
      "id": "find-shipping-commit",
      "name": "Find shipping commit",
      "description": "Search the referenced repos for the commit that productionised this attempt; fill shipped_in if missing."
    }
  ],
  "domain": "research",
  "entityShape": [
    "has-evidence",
    "time-series"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
