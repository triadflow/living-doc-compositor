import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "content-outline",
  "name": "Content Outline",
  "category": "content",
  "kind": "act",
  "description": "A single-lane map of planned or drafted content where sequence and narrative progression matter.",
  "structuralContract": "One-column card grid of content-lifecycle items. Use when the section is outlining a chapter path, book path, or dependency path rather than comparing parallel content streams.",
  "notFor": [
    "parallel content workstreams",
    "support catalogs",
    "decision records"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as a single ordered content path where sequence and narrative progression matter.",
    "keepDistinct": [
      "outline unit",
      "sequence",
      "lifecycle status",
      "source refs",
      "notes"
    ],
    "inspect": [
      "Read neighboring outline units before changing status or ordering."
    ],
    "update": [
      "Preserve sequence and progression instead of parallelizing the section."
    ],
    "avoid": [
      "Do not use this for side-by-side production streams or support catalogs."
    ]
  },
  "icon": "<path opacity='.24' d='M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z'/><path d='M7 8h2v2H7zm4 0h7v2h-7zm-4 4h2v2H7zm4 0h7v2h-7zm-4 4h2v2H7zm4 0h5v2h-5z'/>",
  "iconColor": "#a16207",
  "projection": "card-grid",
  "columns": 1,
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
  "domain": "editorial",
  "entityShape": [],
  "generatedFields": [
    "semanticUses"
  ]
});
