import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "capability-surface",
  "name": "Capability Surface",
  "category": "delivery",
  "kind": "surface",
  "description": "Parallel status across a coherent system surface made up of capabilities, subsystems, or implementation tracks.",
  "structuralContract": "Two-column card grid of block-status items. Each item should represent a capability, module, subsystem, or comparable implementation track with concise state plus supporting notes and refs.",
  "notFor": [
    "single-column narrative surfaces",
    "dense catalogs of enabling work",
    "formal claims or investigation findings"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as parallel capability, subsystem, or implementation-track status across one coherent system surface.",
    "keepDistinct": [
      "capabilities or subsystems",
      "implementation status",
      "supporting notes",
      "code and ticket references"
    ],
    "inspect": [
      "Check code paths and tickets for each capability before changing its status."
    ],
    "update": [
      "Keep each card concise and comparable so readers can scan capability state side by side."
    ],
    "avoid": [
      "Do not turn this into a single narrative lane or formal proof surface."
    ]
  },
  "icon": "<rect x='4' y='4' width='7' height='7' rx='1.5' opacity='.3'/><rect x='13' y='4' width='7' height='7' rx='1.5' opacity='.55'/><rect x='4' y='13' width='7' height='7' rx='1.5' opacity='.55'/><path d='M14 15.5l2 2 4-4-1.4-1.4-2.6 2.6-.6-.6L14 15.5z'/>",
  "iconColor": "#2563eb",
  "projection": "card-grid",
  "columns": 2,
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
  "aiActions": [
    {
      "id": "propose-status-from-commits",
      "name": "Propose status from commits",
      "description": "Look at recent commits touching the card’s codePaths and propose a status change (built / partial / not-built / gap / blocked) based on what landed."
    }
  ],
  "domain": "engineering",
  "entityShape": [
    "has-tickets"
  ]
});
