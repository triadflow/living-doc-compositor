import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "behavior-fidelity",
  "name": "Behavior Fidelity",
  "category": "delivery",
  "kind": "surface",
  "description": "An interaction surface judged by the gap between current behavior and intended behavior.",
  "structuralContract": "Two-column card grid of interaction-status items with explicit current, expected, and next-step fields. Use when behavioral correctness is the central contract.",
  "notFor": [
    "general implementation status",
    "formal model or protocol work",
    "workflow mediation"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat behavior as the gap between current implementation and intended interaction behavior.",
    "keepDistinct": [
      "current behavior",
      "expected behavior",
      "next step",
      "blockers",
      "design and code references"
    ],
    "inspect": [
      "Compare implementation behavior against design, spec, and observed interaction state."
    ],
    "update": [
      "Keep behavioral drift concrete and make the next repair step explicit."
    ],
    "avoid": [
      "Do not reduce behavior fidelity to generic implementation status."
    ]
  },
  "icon": "<path opacity='.28' d='M12 5c5 0 8.3 4.4 9 5.5-.7 1.1-4 5.5-9 5.5s-8.3-4.4-9-5.5C3.7 9.4 7 5 12 5zm0 2c-3.5 0-6 2.7-7 4 1 1.3 3.5 4 7 4s6-2.7 7-4c-1-1.3-3.5-4-7-4z'/><circle cx='12' cy='11' r='2.2'/><path d='M18.2 16l.9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3.9-1.8z'/>",
  "iconColor": "#db2777",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "pageIds",
      "entityType": "figma-page",
      "label": "Pages"
    },
    {
      "key": "figmaNodeIds",
      "entityType": "figma-node",
      "label": "Figma"
    },
    {
      "key": "codePaths",
      "entityType": "code-file",
      "label": "Code"
    },
    {
      "key": "specRefIds",
      "entityType": "ux-spec",
      "label": "UX spec refs",
      "resolve": true
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
      "statusSet": "interaction-status"
    }
  ],
  "textFields": [
    {
      "key": "currentBehavior",
      "label": "Current"
    },
    {
      "key": "expectedBehavior",
      "label": "Expected"
    },
    {
      "key": "nextStep",
      "label": "Next step"
    }
  ],
  "detailsFields": [
    {
      "key": "blockers",
      "label": "Blockers"
    }
  ],
  "domain": "engineering",
  "entityShape": [
    "has-evidence"
  ]
});
