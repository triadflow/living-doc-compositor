import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "maintainer-stance",
  "name": "Maintainer Stance",
  "category": "verification",
  "kind": "surface",
  "description": "Named, evolving positions held by stakeholders. Distinct from settled decision records — a stance has an owner, a timestamp, and may be rebutted or shift over time.",
  "structuralContract": "One-column card grid. Each card is one stakeholder's position with rationale and any rebuttal. Use when the section preserves an evolving debate — not a settled team decision.",
  "notFor": [
    "settled, authoritative decisions (use decision-record)",
    "observations (use symptom-observation or investigation-findings)",
    "attempted fixes (use attempt-log)"
  ],
  "promptGuidance": {
    "operatingThesis": "A stance is a named position in a live conversation. It has an owner, a timestamp, and may still move. Do not collapse stances into decisions.",
    "keepDistinct": [
      "stakeholder identity and role",
      "stated_at timestamp and link",
      "the position itself",
      "the rationale given",
      "any rebuttal",
      "evolution over time"
    ],
    "inspect": [
      "Verify the stated_at timestamp links to the original comment or statement.",
      "Check whether the stance has shifted since — update evolution accordingly."
    ],
    "update": [
      "When a stance is rebutted or softens, add to rebuttal/evolution rather than overwriting position."
    ],
    "avoid": [
      "Do not promote a stance to a decision before the team actually decides.",
      "Do not erase a stance that was retracted — mark it retracted and preserve the history."
    ]
  },
  "icon": "<path opacity='.28' d='M4 6h12v10H4z'/><circle cx='8' cy='10' r='1.5'/><circle cx='14' cy='10' r='1.5'/><path d='M6 14h3M11 14h3' stroke='currentColor' stroke-width='1' stroke-linecap='round'/>",
  "iconColor": "#0369a1",
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
      "statusSet": "stance-status"
    }
  ],
  "textFields": [
    {
      "key": "stakeholder",
      "label": "Stakeholder"
    },
    {
      "key": "stated_at",
      "label": "Stated at"
    },
    {
      "key": "position",
      "label": "Position"
    },
    {
      "key": "rationale",
      "label": "Rationale"
    },
    {
      "key": "rebuttal",
      "label": "Rebuttal"
    },
    {
      "key": "evolution",
      "label": "Evolution"
    }
  ],
  "aiActions": [
    {
      "id": "check-evolution",
      "name": "Check evolution",
      "description": "Re-read the thread since stated_at; propose updating position, rebuttal, or evolution if the stance has shifted."
    }
  ],
  "domain": "intelligence",
  "entityShape": [
    "has-evidence"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
