import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "experiment-evidence-surface",
  "name": "Experiment Evidence Surface",
  "category": "verification",
  "kind": "act",
  "description": "A research or experimentation surface where code, workflows, artifacts, and tracked work converge into one evidence-bearing iteration view.",
  "structuralContract": "Two-column card grid of experiment-status items with explicit current baseline, next step, and gaps. Use when the section is about an iterative experimental system that advances through frozen evidence, tooling, and retained decisions.",
  "notFor": [
    "single authoritative decisions with no active iteration",
    "design-to-code mappings",
    "protocol conformance surfaces"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as an iterative evidence surface where experiments advance through baselines, tooling, next steps, and retained gaps.",
    "keepDistinct": [
      "current baseline",
      "next step",
      "gaps",
      "artifacts",
      "workflows",
      "code"
    ],
    "inspect": [
      "Check frozen artifacts, workflows, code, and tickets before updating evidence status."
    ],
    "update": [
      "Keep baseline, next step, and gaps explicit for each experiment."
    ],
    "avoid": [
      "Do not collapse active experimentation into decisions or generic verification."
    ]
  },
  "icon": "<path opacity='.24' d='M7 4h10v2H7zm2 3h6v4.2l4.4 6.8A2 2 0 0117.7 21H6.3a2 2 0 01-1.7-3l4.4-6.8V7z'/><path d='M9.2 14h5.6l2.4 3.8a.6.6 0 01-.5.9H7.3a.6.6 0 01-.5-.9L9.2 14zm1.3-5h3v2h-3z'/>",
  "iconColor": "#7c3aed",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "artifactPaths",
      "entityType": "artifact-file",
      "label": "Artifacts"
    },
    {
      "key": "workflowPaths",
      "entityType": "workflow",
      "label": "Workflows"
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
      "statusSet": "probe-status"
    },
    {
      "key": "priority",
      "statusSet": "probe-priority"
    }
  ],
  "textFields": [
    {
      "key": "currentBaseline",
      "label": "Current baseline"
    },
    {
      "key": "nextStep",
      "label": "Next step"
    }
  ],
  "detailsFields": [
    {
      "key": "gaps",
      "label": "Current gaps"
    }
  ],
  "domain": "research",
  "entityShape": [
    "has-code-refs",
    "has-evidence"
  ]
});
