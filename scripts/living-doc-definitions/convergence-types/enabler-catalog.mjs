import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "enabler-catalog",
  "name": "Enabler Catalog",
  "category": "operations",
  "kind": "surface",
  "description": "A dense catalog of enabling, support, remediation, or auxiliary work items that sit around the core flow.",
  "structuralContract": "Three-column card grid of block-status items. Use for compact inventories of enabling assets or interventions where breadth matters more than narrative flow.",
  "notFor": [
    "core component surfaces",
    "single-lane operational narratives",
    "content planning sections"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as a breadth-first catalog of enabling or auxiliary work around the core flow.",
    "keepDistinct": [
      "enablers",
      "support assets",
      "remediations",
      "auxiliary work items"
    ],
    "inspect": [
      "Check whether each item enables the core flow rather than being the core flow."
    ],
    "update": [
      "Keep entries compact and catalog-like so breadth remains visible."
    ],
    "avoid": [
      "Do not use this for single-lane operational narratives or primary component surfaces."
    ]
  },
  "icon": "<rect x='4' y='4' width='5' height='5' rx='1.2' opacity='.3'/><rect x='10.5' y='4' width='5' height='5' rx='1.2' opacity='.5'/><rect x='17' y='4' width='3' height='5' rx='1.2' opacity='.75'/><rect x='4' y='11' width='5' height='5' rx='1.2' opacity='.5'/><rect x='10.5' y='11' width='5' height='5' rx='1.2' opacity='.75'/><path d='M17 12h3v3h-3zm0 4.5h3V20h-3z'/>",
  "iconColor": "#0f766e",
  "projection": "card-grid",
  "columns": 3,
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
  "domain": "engineering",
  "entityShape": [
    "has-tickets"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
