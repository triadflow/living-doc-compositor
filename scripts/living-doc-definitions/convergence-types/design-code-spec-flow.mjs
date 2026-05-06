import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "design-code-spec-flow",
  "name": "Design–Code–Spec Flow",
  "category": "delivery",
  "kind": "surface",
  "description": "A product surface where design artifacts, code, specs, and tracked interactions converge into one implementation flow.",
  "structuralContract": "Two-column card grid combining design, code, spec, and interaction references. Use when the section is about one named surface viewed through those converging artifacts.",
  "notFor": [
    "status-only implementation inventories",
    "formal verification or protocol sections",
    "single-lane operational narratives"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat a product surface as the convergence of design intent, code, specs, interactions, and tickets.",
    "keepDistinct": [
      "design artifacts",
      "code references",
      "spec references",
      "tracked interactions",
      "delivery tickets"
    ],
    "inspect": [
      "Check design, code, spec, interaction, and ticket references together before changing status."
    ],
    "update": [
      "Refresh surface status and code status from the current state of all referenced sources."
    ],
    "avoid": [
      "Do not reduce the section to implementation status only."
    ]
  },
  "icon": "<circle cx='6' cy='6' r='2.5' opacity='.35'/><circle cx='18' cy='6' r='2.5' opacity='.55'/><circle cx='12' cy='18' r='2.5'/><path d='M7.35 7.1l2.95 5.9-1.35.68-2.95-5.9zm9.3 0l1.35.68-2.95 5.9-1.35-.68zM9 5.25h6v1.5H9z'/>",
  "iconColor": "#0f766e",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "pageIds",
      "entityType": "figma-page",
      "label": "Pages"
    },
    {
      "key": "defaultNodeIds",
      "entityType": "figma-node",
      "label": "Defaults"
    },
    {
      "key": "codeRefs",
      "entityType": "code-file",
      "label": "Code refs"
    },
    {
      "key": "specRefIds",
      "entityType": "ux-spec",
      "label": "UX spec refs",
      "resolve": true
    },
    {
      "key": "interactionSurfaceIds",
      "entityType": "interaction-surface",
      "label": "Tracked interactions",
      "resolve": true
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
      "statusSet": "page-status"
    },
    {
      "key": "codeStatus",
      "statusSet": "code-status"
    }
  ],
  "aiProfiles": [
    {
      "id": "surface-brief",
      "name": "Surface Brief",
      "description": "Compress the current surface into a short summary plus current focus points.",
      "slot": "section-brief",
      "defaultVisible": true
    },
    {
      "id": "alignment-risk-note",
      "name": "Alignment Risk Note",
      "description": "Call out the strongest current design-code-spec drift risk in the section.",
      "slot": "section-weakness-note",
      "defaultVisible": false
    },
    {
      "id": "review-checklist",
      "name": "Review Checklist",
      "description": "Generate a short local review checklist for this delivery surface.",
      "slot": "section-next-loop",
      "defaultVisible": false
    }
  ],
  "domain": "engineering",
  "entityShape": [
    "has-code-refs",
    "has-tickets"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
