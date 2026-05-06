import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "protocol-conformance",
  "name": "Protocol Conformance",
  "category": "verification",
  "kind": "surface",
  "description": "A specification-to-implementation contract surface focused on interoperability and compliance.",
  "structuralContract": "Two-column card grid of conformance-state items with explicit requirement, target, and deviations. Use when the governing reference is an external or formal protocol specification.",
  "notFor": [
    "general implementation inventories",
    "behavior comparison sections",
    "formal model integrity work"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as a protocol contract between specification and implementation.",
    "keepDistinct": [
      "spec requirement",
      "interop target",
      "implementation code",
      "deviations"
    ],
    "inspect": [
      "Check the governing spec and target implementation before changing conformance state."
    ],
    "update": [
      "Record deviations explicitly and keep conformance tied to named protocol requirements."
    ],
    "avoid": [
      "Do not treat this as generic behavior comparison or formal model inventory."
    ]
  },
  "icon": "<path opacity='.28' d='M6 3h9l5 5v13H6a2 2 0 01-2-2V5a2 2 0 012-2z'/><path d='M14 3v6h6v2h-8V3h2zm-5 9h5v2H9zm0 4h5v2H9zm8.3-3.7l1.4 1.4-3.7 3.7-1.9-1.9 1.4-1.4.5.5 2.3-2.3z'/>",
  "iconColor": "#65a30d",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "specRefs",
      "entityType": "protocol-spec",
      "label": "Specifications"
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
      "statusSet": "conformance-state"
    }
  ],
  "textFields": [
    {
      "key": "specRequirement",
      "label": "Spec requirement"
    },
    {
      "key": "interopTarget",
      "label": "Interop target"
    }
  ],
  "detailsFields": [
    {
      "key": "deviations",
      "label": "Deviations"
    }
  ],
  "domain": "engineering",
  "entityShape": [
    "has-code-refs"
  ]
});
