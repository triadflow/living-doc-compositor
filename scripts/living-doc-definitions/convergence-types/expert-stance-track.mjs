import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "expert-stance-track",
  "name": "Expert Stance Track",
  "category": "monitoring",
  "kind": "surface",
  "description": "Sustained public-intellectual stance across many works, tracked across monitoring periods as evidence accumulates and positions evolve.",
  "structuralContract": "One-column card grid. Each card names an expert by name + affiliation and carries current stance, core view, evolution since the last monitoring period, and latest source references. Use this when tracking a set of named voices whose positions shift over time.",
  "notFor": [
    "one-off forum or PR comments (use maintainer-stance)",
    "anonymous or aggregated sentiment capture",
    "stance on a single issue thread"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat each card as a sustained public-intellectual stance that evolves over monitoring periods, not a one-off comment.",
    "keepDistinct": [
      "expert name and affiliation",
      "current stance label",
      "core view prose",
      "evolution since last period",
      "latest source references"
    ],
    "inspect": [
      "Check what the expert has published in the current monitoring period before changing their stance."
    ],
    "update": [
      "When a stance softens, retracts, or reinforces, record it as a status transition plus an evolution note that cites the triggering source.",
      "Preserve prior-period evolution notes as history; append rather than overwrite."
    ],
    "avoid": [
      "Do not invent stance shifts without a dated source from the current period.",
      "Do not use this for anonymous or aggregated sentiment."
    ]
  },
  "icon": "<path opacity='.26' d='M4 5h16v14H4z'/><circle cx='9' cy='10' r='2.5'/><path d='M4 19v-1.5c0-1.4 2.2-2.5 5-2.5s5 1.1 5 2.5V19H4zM15 7h5v2h-5zm0 4h5v2h-5zm0 4h5v2h-5z'/>",
  "iconColor": "#7a4b2a",
  "projection": "card-grid",
  "columns": 1,
  "sources": [
    {
      "key": "latestSourceRefs",
      "entityType": "content-source",
      "label": "Latest sources"
    },
    {
      "key": "notes",
      "entityType": null,
      "label": null
    }
  ],
  "statusFields": [
    {
      "key": "stance",
      "statusSet": "stance-status"
    }
  ],
  "textFields": [
    {
      "key": "affiliation",
      "label": "Affiliation"
    },
    {
      "key": "stanceLabel",
      "label": "Stance"
    },
    {
      "key": "coreView",
      "label": "Core view"
    },
    {
      "key": "evolutionSinceLastPeriod",
      "label": "Evolution since last period"
    }
  ],
  "detailsFields": [
    {
      "key": "whatTheyEmphasise",
      "label": "What they emphasise"
    }
  ],
  "domain": "intelligence",
  "entityShape": [
    "has-evidence",
    "time-series"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
