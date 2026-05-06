import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "content-production",
  "name": "Content Production",
  "category": "content",
  "kind": "surface",
  "description": "Parallel content-production surface where several chapters, deliverables, or streams are being developed together.",
  "structuralContract": "Two-column card grid of content-lifecycle items with optional synopsis, word target, and dependencies. Use when the reader should compare several content units side by side.",
  "notFor": [
    "single-lane chapter maps",
    "support asset catalogs",
    "general component implementation"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as parallel content units moving through production together.",
    "keepDistinct": [
      "content unit",
      "lifecycle status",
      "synopsis",
      "word target",
      "dependencies"
    ],
    "inspect": [
      "Check each content unit's source material and dependencies before updating status."
    ],
    "update": [
      "Keep entries comparable so production state can be scanned across units."
    ],
    "avoid": [
      "Do not turn this into a single chapter outline or generic implementation tracker."
    ]
  },
  "icon": "<path opacity='.28' d='M4 5.5C4 4.7 4.7 4 5.5 4H11v14H6a2 2 0 00-2 2V5.5zm9 0c0-.8.7-1.5 1.5-1.5H20v16a2 2 0 00-2-2h-5v-14z'/><path d='M7 8h2v2H7zm7 0h3v2h-3zM7 12h2v2H7zm7 0h3v2h-3z'/>",
  "iconColor": "#ca8a04",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "sourceRefs",
      "entityType": "content-source",
      "label": "Source material"
    },
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
      "statusSet": "content-lifecycle"
    }
  ],
  "textFields": [
    {
      "key": "synopsis",
      "label": "Synopsis"
    },
    {
      "key": "wordTarget",
      "label": "Word target"
    }
  ],
  "detailsFields": [
    {
      "key": "dependencies",
      "label": "Dependencies"
    }
  ],
  "domain": "editorial",
  "entityShape": [],
  "generatedFields": [
    "semanticUses"
  ]
});
