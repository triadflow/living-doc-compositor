import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "operation",
  "name": "Mediated Operation",
  "category": "operations",
  "kind": "surface",
  "description": "An operator-mediated workflow surface where human or agent routing turns a request into coordinated execution.",
  "structuralContract": "Two-column card grid of probe-status items focused on workflow support, mediation, and next-step readiness.",
  "notFor": [
    "verification evidence sections",
    "capability inventories",
    "formal model work"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as a mediated workflow where a request is routed into coordinated execution.",
    "keepDistinct": [
      "request inputs",
      "workflow paths",
      "current support",
      "next step",
      "gaps"
    ],
    "inspect": [
      "Check the current request path and operator or agent support before updating readiness."
    ],
    "update": [
      "Keep mediation, support state, and gaps visible as separate fields."
    ],
    "avoid": [
      "Do not convert this into general capability status or verification evidence."
    ]
  },
  "icon": "<path opacity='.28' d='M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z'/><path d='M7 9h7.2l-1.6-1.6L14 6l4 4-4 4-1.4-1.4 1.6-1.6H7V9zm10 6H9.8l1.6 1.6L10 18l-4-4 4-4 1.4 1.4L9.8 15H17v2z'/>",
  "iconColor": "#ea580c",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "workflowPaths",
      "entityType": "workflow",
      "label": "Workflows"
    },
    {
      "key": "requestInputs",
      "entityType": "api-endpoint",
      "label": "Request inputs"
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
    }
  ],
  "textFields": [
    {
      "key": "currentSupport",
      "label": "Current support"
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
  "domain": "ops",
  "entityShape": [
    "has-tickets"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
