import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "position-cluster-map",
  "name": "Position Cluster Map",
  "category": "monitoring",
  "kind": "surface",
  "description": "Two-axis layout where named thinkers or stakeholders are placed to visualise consensus and divergence. Movement between monitoring periods is the primary signal.",
  "structuralContract": "Two-column card grid. Each card is one thinker with an x-axis value, a y-axis value, and an optional prior-period position for comparison. Uses stance-status to reflect movement direction. Use for consensus/divergence maps; not for generic ranking or scorecards.",
  "notFor": [
    "generic stakeholder ranking",
    "quantitative scorecards",
    "issue-specific stance snapshots"
  ],
  "promptGuidance": {
    "operatingThesis": "The map's value is showing movement between periods, not a static snapshot of current positions.",
    "keepDistinct": [
      "thinker identity",
      "current axis position",
      "prior-period axis position",
      "named axes"
    ],
    "inspect": [
      "Re-derive coordinates from the expert-stance-track cards in the same doc before updating; do not fabricate movement."
    ],
    "update": [
      "When a thinker moves on an axis, preserve the prior position so the delta is inspectable.",
      "Update the movement status to reflect the direction of the shift."
    ],
    "avoid": [
      "Do not invent coordinates without evidence in the companion stance cards.",
      "Do not remove prior positions; they are the historical record."
    ]
  },
  "icon": "<path opacity='.22' d='M4 4h16v16H4z'/><path d='M4 12h16M12 4v16' fill='none' stroke='currentColor' stroke-width='1.2'/><circle cx='8' cy='9' r='1.5'/><circle cx='15' cy='14' r='1.5'/><circle cx='10' cy='17' r='1.5'/>",
  "iconColor": "#be123c",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "sourceRefs",
      "entityType": "content-source",
      "label": "Sources"
    },
    {
      "key": "notes",
      "entityType": null,
      "label": null
    }
  ],
  "statusFields": [
    {
      "key": "movement",
      "statusSet": "stance-status"
    }
  ],
  "textFields": [
    {
      "key": "axisX",
      "label": "Magnitude (weak → strong)"
    },
    {
      "key": "axisY",
      "label": "Institutional role (market → institution)"
    },
    {
      "key": "priorPosition",
      "label": "Prior period"
    }
  ],
  "domain": "intelligence",
  "entityShape": [],
  "generatedFields": [
    "semanticUses"
  ]
});
