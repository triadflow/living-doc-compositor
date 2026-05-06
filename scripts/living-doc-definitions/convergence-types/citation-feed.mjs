import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "citation-feed",
  "name": "Citation Feed",
  "category": "monitoring",
  "kind": "surface",
  "description": "Dated source entries (papers, interviews, op-eds) grouped by monitoring period. Used when the doc accumulates reference material over time with period attribution.",
  "structuralContract": "One-column card grid. Each card is one citation with title, author, venue, publication date, and url. Carries a citation-state status and a lastUpdatedInPeriod marker so period-grouping renders. Use for monitoring docs; not for flat reference lists.",
  "notFor": [
    "reference lists without period semantics",
    "single-doc source inventories",
    "ticket or PR link tables"
  ],
  "promptGuidance": {
    "operatingThesis": "Each card is one dated source added in a specific monitoring period; grouping by period is what makes the feed useful.",
    "keepDistinct": [
      "title and author",
      "venue",
      "publication date",
      "url",
      "the period the citation was added in"
    ],
    "inspect": [
      "Check the publication date belongs to the current period before adding to this period's group.",
      "Verify the url resolves."
    ],
    "update": [
      "Retroactive additions to a prior period are allowed but flag with a note.",
      "Mark retracted sources explicitly; do not delete history."
    ],
    "avoid": [
      "Do not add sources without a publication date.",
      "Do not duplicate a source that already exists in a prior period."
    ]
  },
  "icon": "<path opacity='.26' d='M5 4h11l3 3v13H5z'/><path d='M8 9h8v1.5H8zm0 3h8v1.5H8zm0 3h6v1.5H8z'/>",
  "iconColor": "#6d28d9",
  "projection": "card-grid",
  "columns": 1,
  "sources": [
    {
      "key": "sourceRefs",
      "entityType": "content-source",
      "label": "Source"
    },
    {
      "key": "notes",
      "entityType": null,
      "label": null
    }
  ],
  "statusFields": [
    {
      "key": "state",
      "statusSet": "citation-state"
    }
  ],
  "textFields": [
    {
      "key": "author",
      "label": "Author"
    },
    {
      "key": "venue",
      "label": "Venue"
    },
    {
      "key": "publishedAt",
      "label": "Published"
    },
    {
      "key": "url",
      "label": "URL"
    }
  ],
  "detailsFields": [
    {
      "key": "cardsReferenced",
      "label": "Referenced cards"
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
