import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "tooling-surface",
  "name": "Tooling Surface",
  "category": "operations",
  "kind": "surface",
  "description": "An operational tooling surface that collects the skills, scripts, workflows, and local instruments used to inspect, verify, or modify the domain without treating them as source material.",
  "structuralContract": "Two-column card grid of tooling-status items. Each item should represent one operational instrument with clear purpose, invocation, and caveats. Use when the section is about how the domain is worked on rather than what the domain says.",
  "notFor": [
    "primary source material",
    "general capability inventories",
    "verification evidence sections"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as the operational instrument layer used to inspect, verify, modify, or refresh the domain.",
    "keepDistinct": [
      "skills",
      "scripts",
      "workflows",
      "tooling artifacts",
      "caveats"
    ],
    "inspect": [
      "Check whether each tool is currently trusted, caveated, prototype, broken, or missing."
    ],
    "update": [
      "Keep purpose, when-to-use, invocation, and caveats explicit for each tool."
    ],
    "avoid": [
      "Do not treat tooling entries as primary source material or domain claims."
    ]
  },
  "icon": "<path opacity='.24' d='M13.8 2l.6 2.46c.59.14 1.15.36 1.68.64L18.3 4l1.7 1.7-1.1 2.2c.28.53.5 1.09.64 1.68l2.46.62v2.6l-2.46.62c-.14.59-.36 1.15-.64 1.68l1.1 2.2-1.7 1.7-2.2-1.1c-.53.28-1.09.5-1.68.64L13.8 22h-2.6l-.62-2.46a7 7 0 01-1.68-.64L6.7 20l-1.7-1.7 1.1-2.2a7 7 0 01-.64-1.68L3 12.8v-2.6l2.46-.62c.14-.59.36-1.15.64-1.68L5 5.7 6.7 4l2.2 1.1c.53-.28 1.09-.5 1.68-.64L11.2 2z'/><circle cx='12' cy='12' r='3'/><path d='M16.8 16.8l3.2 3.2-1.2 1.2-3.2-3.2z'/>",
  "iconColor": "#7c3aed",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "skillPaths",
      "entityType": "artifact-file",
      "label": "Skills"
    },
    {
      "key": "scriptPaths",
      "entityType": "code-file",
      "label": "Scripts"
    },
    {
      "key": "workflowPaths",
      "entityType": "workflow",
      "label": "Workflows"
    },
    {
      "key": "artifactPaths",
      "entityType": "artifact-file",
      "label": "Tooling artifacts"
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
      "statusSet": "tooling-status"
    }
  ],
  "textFields": [
    {
      "key": "purpose",
      "label": "Purpose"
    },
    {
      "key": "whenToUse",
      "label": "When to use"
    },
    {
      "key": "invocation",
      "label": "Invocation"
    }
  ],
  "detailsFields": [
    {
      "key": "caveats",
      "label": "Caveats and gaps"
    }
  ],
  "domain": "ops",
  "entityShape": [
    "has-code-refs"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
