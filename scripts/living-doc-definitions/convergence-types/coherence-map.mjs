import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "coherence-map",
  "name": "Coherence Map",
  "category": "governance",
  "kind": "surface",
  "description": "Projection of doc-root objective facets, coverage edges, and invariants. Each card is one facet with its carrying sections, governing invariants, and current coverage state.",
  "structuralContract": "Two-column card grid of coherence-state items, derived from doc-root objectiveFacets, coverage, and invariants. Cards are not authored per item — the renderer computes them from doc-root fields.",
  "notFor": [
    "per-section implementation work",
    "ticket inventories",
    "verification evidence"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as a derived view of doc-root coherence: each facet of the objective mapped to its carrying sections and invariants.",
    "keepDistinct": [
      "objective facet",
      "carrying sections",
      "invariants",
      "coverage state"
    ],
    "inspect": [
      "Recompute coverage from doc-root objectiveFacets and coverage edges before editing."
    ],
    "update": [
      "Edit doc-root objectiveFacets, coverage, or invariants — do not author coherence-map items by hand."
    ],
    "avoid": [
      "Do not put implementation state or ticket status into coherence cards."
    ]
  },
  "icon": "<path opacity='.28' d='M12 3l9 5v8l-9 5-9-5V8z'/><path d='M12 7l5 3v4l-5 3-5-3v-4z'/><circle cx='12' cy='12' r='1.5'/>",
  "iconColor": "#0891b2",
  "projection": "card-grid",
  "columns": 2,
  "derived": true,
  "derivedFrom": [
    "objectiveFacets",
    "coverage",
    "invariants"
  ],
  "sources": [
    {
      "key": "sectionIds",
      "entityType": "section-ref",
      "label": "Carrying sections"
    },
    {
      "key": "invariantIds",
      "entityType": "invariant-ref",
      "label": "Governing invariants",
      "resolve": true
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
      "statusSet": "coherence-state"
    }
  ],
  "textFields": [
    {
      "key": "facetDescription",
      "label": "Facet"
    }
  ],
  "domain": "governance",
  "entityShape": []
});
