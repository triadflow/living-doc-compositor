import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "investigation-findings",
  "name": "Investigation Findings",
  "category": "verification",
  "kind": "act",
  "description": "A set of factual findings recovered from an investigation, review, or forensic pass.",
  "structuralContract": "Two-column card grid of page-status items, usually ground-truth findings. Use when the section is a collection of observed findings rather than decisions or implementation tasks.",
  "notFor": [
    "decision records",
    "general status inventories",
    "formal model claims"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat findings as observed facts recovered from an investigation, distinct from decisions or planned work.",
    "keepDistinct": [
      "finding",
      "status",
      "evidence notes",
      "linked tickets"
    ],
    "inspect": [
      "Check the underlying investigation evidence before adding or changing a finding."
    ],
    "update": [
      "Keep findings factual and separate from recommendations or decisions."
    ],
    "avoid": [
      "Do not turn findings into decisions, formal claims, or generic status items."
    ]
  },
  "icon": "<circle cx='10' cy='10' r='5.5' opacity='.24'/><path d='M10 7h4v2h-4zm0 4h3v2h-3z'/><path d='M14.5 14.5l4 4-1.4 1.4-4-4z'/>",
  "iconColor": "#dc2626",
  "projection": "card-grid",
  "columns": 2,
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
      "id": "check-still-holding",
      "name": "Check still holding",
      "description": "Re-verify the finding against current evidence. Propose status transitions (ground-truth / reference / deprecated) or flag as stale."
    }
  ],
  "domain": "research",
  "entityShape": [
    "has-evidence"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
