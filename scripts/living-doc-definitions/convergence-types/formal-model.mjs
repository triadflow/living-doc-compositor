import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "formal-model",
  "name": "Formal Model",
  "category": "verification",
  "kind": "surface",
  "description": "A formal model surface spanning multiple primitives, invariants, or authorities in parallel.",
  "structuralContract": "Two-column card grid of model-integrity items with optional definition, authority scope, and violations. Use when several model elements need to be compared or held together at once.",
  "notFor": [
    "single canonical claims",
    "implementation work surfaces",
    "content planning"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as a parallel surface of model primitives, invariants, authorities, and integrity status.",
    "keepDistinct": [
      "primitive",
      "invariant",
      "authority",
      "definition",
      "authority scope",
      "violations"
    ],
    "inspect": [
      "Check the authoritative source and current violations before updating integrity status."
    ],
    "update": [
      "Keep model definitions and authority boundaries explicit."
    ],
    "avoid": [
      "Do not collapse broad model inventory into one claim."
    ]
  },
  "icon": "<path opacity='.28' d='M12 2l7 4v12l-7 4-7-4V6l7-4zm0 2.3L7 7v10l5 2.9 5-2.9V7l-5-2.7z'/><circle cx='12' cy='7.5' r='1.3'/><circle cx='9' cy='15' r='1.3'/><circle cx='15' cy='15' r='1.3'/><circle cx='12' cy='12' r='1.1' opacity='.65'/>",
  "iconColor": "#4f46e5",
  "projection": "card-grid",
  "columns": 2,
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
  "textFields": [
    {
      "key": "definition",
      "label": "Definition"
    },
    {
      "key": "authorityScope",
      "label": "Authority scope"
    }
  ],
  "detailsFields": [
    {
      "key": "violations",
      "label": "Violations"
    }
  ],
  "domain": "research",
  "entityShape": [],
  "generatedFields": [
    "semanticUses"
  ]
});
