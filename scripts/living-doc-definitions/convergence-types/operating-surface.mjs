import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "operating-surface",
  "name": "Operating Surface",
  "category": "operations",
  "kind": "surface",
  "description": "A bounded operational or implementation surface described as a single narrative lane of work items.",
  "structuralContract": "One-column card grid of block-status items. Use when the section is best read as one coherent surface, boundary, side channel, or support area rather than parallel component columns.",
  "notFor": [
    "parallel component inventories",
    "formal model claims",
    "decision or finding sections"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as one coherent operational or implementation lane.",
    "keepDistinct": [
      "bounded operating surface",
      "current block status",
      "code and ticket references",
      "narrative notes"
    ],
    "inspect": [
      "Read the lane as a whole before changing individual item status."
    ],
    "update": [
      "Preserve one-column narrative flow and avoid splitting the surface into parallel inventory cards."
    ],
    "avoid": [
      "Do not use this for broad component inventories or formal model claims."
    ]
  },
  "icon": "<rect x='4' y='5' width='16' height='14' rx='2' opacity='.22'/><path d='M7 9h10v2H7zm0 4h6v2H7z'/><circle cx='17' cy='14' r='2.5'/>",
  "iconColor": "#0891b2",
  "projection": "card-grid",
  "columns": 1,
  "sources": [
    {
      "key": "codePaths",
      "entityType": "code-file",
      "label": "Code"
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
      "statusSet": "block-status"
    }
  ],
  "nestable": true,
  "domain": "ops",
  "entityShape": [],
  "generatedFields": [
    "semanticUses"
  ]
});
