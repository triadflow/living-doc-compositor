import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "model-assertion",
  "name": "Model Assertion",
  "category": "verification",
  "kind": "act",
  "description": "A singular formal claim about the model, usually canonicality, authority, or one downstream truth path.",
  "structuralContract": "One-column card grid of model-integrity items. Use when the section is asserting one compact model truth rather than surveying many model elements in parallel.",
  "notFor": [
    "broad formal model inventories",
    "general operational work",
    "verification sections"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as one compact formal claim whose authority, primitives, invariants, and status must stay clear.",
    "keepDistinct": [
      "claim",
      "primitive refs",
      "invariant refs",
      "authority refs",
      "integrity status"
    ],
    "inspect": [
      "Check the governing authority and linked primitives before updating claim status."
    ],
    "update": [
      "Keep the assertion singular and avoid broad model inventory drift."
    ],
    "avoid": [
      "Do not use this for broad formal model inventories or verification checklists."
    ]
  },
  "icon": "<path opacity='.24' d='M12 3l7 4v10l-7 4-7-4V7l7-4z'/><path d='M12 6.2L8.8 8v4.4l3.2 1.8 3.2-1.8V8L12 6.2zm-1 9.2h2V19h-2z'/>",
  "iconColor": "#4338ca",
  "projection": "card-grid",
  "columns": 1,
  "sources": [
    {
      "key": "primitiveRefs",
      "entityType": "formal-primitive",
      "label": "Primitives"
    },
    {
      "key": "invariantRefs",
      "entityType": "invariant",
      "label": "Invariants"
    },
    {
      "key": "authorityRefs",
      "entityType": "authority",
      "label": "Authorities"
    },
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
      "statusSet": "model-integrity"
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
