import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "stack-depth",
  "name": "Stack-Depth Integration",
  "category": "delivery",
  "kind": "surface",
  "description": "A feature surface evaluated by how deeply it is wired through the stack from UI down to contracts and services.",
  "structuralContract": "Two-column card grid emphasizing integration depth and source layers. Use when the key question is how far implementation wiring really goes.",
  "notFor": [
    "design-to-code row mappings",
    "general capability status sections",
    "protocol or model contracts"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as a depth test of how far a feature is wired through UI, hooks, services, contracts, and specs.",
    "keepDistinct": [
      "UI surface",
      "hooks",
      "services",
      "contracts",
      "source mode",
      "integration depth"
    ],
    "inspect": [
      "Trace each feature down the stack before changing integration depth."
    ],
    "update": [
      "Make shallow, mocked, and real-backend wiring explicit."
    ],
    "avoid": [
      "Do not use this for simple design-code alignment or broad capability status."
    ]
  },
  "icon": "<rect x='5' y='4' width='14' height='3' rx='1.5' opacity='.28'/><rect x='5' y='10.5' width='14' height='3' rx='1.5' opacity='.55'/><rect x='5' y='17' width='14' height='3' rx='1.5'/><path d='M11 7h2v10h-2z'/>",
  "iconColor": "#0284c7",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "figmaNodeIds",
      "entityType": "figma-node",
      "label": "Figma"
    },
    {
      "key": "screenPaths",
      "entityType": "code-file",
      "label": "Screens"
    },
    {
      "key": "hookPaths",
      "entityType": "code-file",
      "label": "Hooks"
    },
    {
      "key": "servicePaths",
      "entityType": "code-file",
      "label": "Services"
    },
    {
      "key": "contractPaths",
      "entityType": "code-file",
      "label": "Contracts"
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
      "key": "depth",
      "statusSet": "integration-depth"
    },
    {
      "key": "sourceMode",
      "statusSet": "integration-source"
    }
  ],
  "domain": "engineering",
  "entityShape": [
    "has-code-refs"
  ]
});
