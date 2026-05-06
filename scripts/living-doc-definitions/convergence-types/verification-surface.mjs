import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "verification-surface",
  "name": "Verification Surface",
  "category": "verification",
  "kind": "surface",
  "description": "Multi-source verification surface that combines probes, automation, APIs, and notes into a structured readiness view.",
  "structuralContract": "Two-column card grid of probe-status items with optional current coverage, next step, and gaps. Use when verification is evidence-rich and spans multiple sources.",
  "notFor": [
    "compact checkpoint sections",
    "ordered proof ladders",
    "decision or finding records"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat verification as an evidence-rich readiness surface spanning probes, automation, APIs, interactions, and tickets.",
    "keepDistinct": [
      "coverage",
      "next step",
      "gaps",
      "automation",
      "API or interaction references"
    ],
    "inspect": [
      "Check current coverage, automation paths, API refs, and open gaps before updating readiness."
    ],
    "update": [
      "Make verification status and priority reflect the current evidence, not aspiration."
    ],
    "avoid": [
      "Do not collapse this into a small checkpoint list or proof ladder."
    ]
  },
  "icon": "<path opacity='.28' d='M12 2l7 3v6c0 4.4-2.6 8.4-7 10-4.4-1.6-7-5.6-7-10V5l7-3z'/><path d='M10.2 13.8l-2.5-2.5 1.4-1.4 1.1 1.1 4.6-4.6 1.4 1.4-6 6z'/>",
  "iconColor": "#059669",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "flowIds",
      "entityType": "flow-ref",
      "label": "Related flows",
      "resolve": true
    },
    {
      "key": "pageIds",
      "entityType": "figma-page",
      "label": "Pages"
    },
    {
      "key": "interactionSurfaceIds",
      "entityType": "interaction-surface",
      "label": "Probe-relevant interactions",
      "resolve": true
    },
    {
      "key": "automationPaths",
      "entityType": "workflow",
      "label": "Automation"
    },
    {
      "key": "apiRefs",
      "entityType": "api-endpoint",
      "label": "APIs"
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
      "key": "currentCoverage",
      "label": "Current coverage"
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
  "aiProfiles": [
    {
      "id": "verification-brief",
      "name": "Verification Brief",
      "description": "Summarize the current readiness posture from evidence already present in the section.",
      "slot": "section-brief",
      "defaultVisible": true
    },
    {
      "id": "weakest-signal-note",
      "name": "Weakest Signal Note",
      "description": "Identify the current weakest evidence signal and explain why it weakens the readiness claim.",
      "slot": "section-weakness-note",
      "defaultVisible": false
    },
    {
      "id": "next-verification-loop",
      "name": "Next Verification Loop",
      "description": "Generate the next tight verification loop from the current evidence and gaps.",
      "slot": "section-next-loop",
      "defaultVisible": false
    }
  ],
  "domain": "engineering",
  "entityShape": [
    "has-code-refs",
    "has-evidence"
  ]
});
