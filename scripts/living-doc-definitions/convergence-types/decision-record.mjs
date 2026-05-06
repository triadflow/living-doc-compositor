import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "decision-record",
  "name": "Decision Record",
  "category": "verification",
  "kind": "act",
  "description": "A compact set of decisions or operating choices that should be treated as authoritative ground truth.",
  "structuralContract": "One-column card grid of page-status items, usually ground-truth or reference. Use when the section captures decisions, operating models, or declared truths rather than implementation work.",
  "notFor": [
    "investigation finding sets",
    "component status surfaces",
    "verification ladders"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat decisions as authoritative ground truth or reference statements, not implementation work.",
    "keepDistinct": [
      "decision",
      "status",
      "notes",
      "linked tickets"
    ],
    "inspect": [
      "Check whether the decision is still current before marking it ground-truth."
    ],
    "update": [
      "Keep decision entries compact and authoritative."
    ],
    "avoid": [
      "Do not mix factual findings, verification rungs, or component status into decisions."
    ]
  },
  "icon": "<path opacity='.28' d='M11 3h2v18h-2z'/><path d='M13 5h6l-2 3 2 3h-6V5zm-2 8H5l2 3-2 3h6v-6z'/>",
  "iconColor": "#be123c",
  "projection": "card-grid",
  "columns": 1,
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
      "statusSet": "page-status"
    }
  ],
  "aiActions": [
    {
      "id": "check-if-still-current",
      "name": "Check if still current",
      "description": "Read recent commits, tickets, and sessions for signals that a ground-truth decision has been implicitly overridden. Propose softening to reference or opening a challenge card."
    }
  ],
  "domain": "governance",
  "entityShape": [
    "time-series"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
