import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "verification-checkpoints",
  "name": "Verification Checkpoints",
  "category": "verification",
  "kind": "act",
  "description": "Compact verification section for a small set of checks, probes, or repair validations.",
  "structuralContract": "One-column card grid of probe-status items. Use when the verification surface is checkpoint-like rather than evidence-rich.",
  "notFor": [
    "full verification surfaces with coverage and gaps",
    "ordered proof ladders",
    "general component work"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as a compact list of checks or repair validations.",
    "keepDistinct": [
      "check name",
      "probe status",
      "ticket references",
      "notes"
    ],
    "inspect": [
      "Check the latest result or ticket state for each checkpoint before updating status."
    ],
    "update": [
      "Keep each checkpoint short and action-oriented."
    ],
    "avoid": [
      "Do not turn checkpoints into evidence-rich verification surfaces or proof ladders."
    ]
  },
  "icon": "<rect x='5' y='3.5' width='14' height='17' rx='2' opacity='.24'/><path d='M8 8h8v1.8H8zm0 4h5v1.8H8zm1.9 4.4l-2-2 1.3-1.3 1 1 3.8-3.8 1.3 1.3-5.1 5.1z'/>",
  "iconColor": "#16a34a",
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
      "statusSet": "probe-status"
    }
  ],
  "domain": "engineering",
  "entityShape": [
    "has-evidence"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
