import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "symptom-observation",
  "name": "Symptom Observation",
  "category": "verification",
  "kind": "act",
  "description": "Observed behaviors with reproduction paths and witness attribution. Distinct from generic findings — the presence of repro steps and a named witness is the semantic contract.",
  "structuralContract": "Two-column card grid. Each card is one observed behavior with environment, reproduction steps, and a witness. Use when the section captures reproducible behaviors of a bug or feature — not generalized findings.",
  "notFor": [
    "conclusions or synthesized findings (use investigation-findings)",
    "tried fixes (use attempt-log)",
    "decisions or positions (use maintainer-stance or decision-record)"
  ],
  "promptGuidance": {
    "operatingThesis": "A symptom is a reproducible behavior. Without repro steps and a witness, it is not a symptom — it is a generic finding and belongs elsewhere.",
    "keepDistinct": [
      "environment",
      "reproduction steps",
      "witness attribution",
      "contradicting observers (when present)"
    ],
    "inspect": [
      "Verify the repro steps actually reproduce — if the environment shifted, mark unconfirmed.",
      "Check whether any other observer contradicted the symptom."
    ],
    "update": [
      "When a symptom is independently reproduced, keep the original witness and add the corroboration to notes."
    ],
    "avoid": [
      "Do not promote a generic finding to a symptom without a real repro path."
    ]
  },
  "icon": "<circle cx='10' cy='10' r='6' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M10 6v4M10 12v.5' stroke='currentColor' stroke-width='1.5' stroke-linecap='round'/>",
  "iconColor": "#d97706",
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
      "statusSet": "symptom-status"
    }
  ],
  "textFields": [
    {
      "key": "environment",
      "label": "Environment"
    },
    {
      "key": "witness",
      "label": "Witness"
    },
    {
      "key": "contradicted_by",
      "label": "Contradicted by"
    }
  ],
  "detailsFields": [
    {
      "key": "repro_steps",
      "label": "Reproduction"
    }
  ],
  "aiActions": [
    {
      "id": "suggest-environment-variants",
      "name": "Suggest environment variants",
      "description": "Propose reproduction attempts on adjacent environments (other OS, terminal, framework version) to narrow or widen the symptom."
    },
    {
      "id": "check-contradictions",
      "name": "Check for contradictions",
      "description": "Scan the thread + orbit cards for observers who reported different behaviour; flag contradicted_by."
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
