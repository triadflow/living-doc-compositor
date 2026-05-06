import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "status-snapshot",
  "name": "Status Snapshot",
  "category": "overview",
  "kind": "surface",
  "description": "A summary section that compresses the current document into top-level counts and distribution signals.",
  "structuralContract": "Stats-first section with snapshot cards and no item grid requirement. Use for high-level totals and state distribution, not for individual entities.",
  "notFor": [
    "component or capability inventories",
    "decision or finding sections",
    "verification surfaces"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as document-wide compression, not as an item inventory.",
    "keepDistinct": [
      "top-level counts",
      "distribution signals",
      "document-wide callouts"
    ],
    "inspect": [
      "Read the rest of the document before changing snapshot stats."
    ],
    "update": [
      "Recompute stats and callout language from the current section set and payload."
    ],
    "avoid": [
      "Do not add individual work items here."
    ]
  },
  "icon": "<rect x='4' y='14' width='3' height='6' rx='1' opacity='.4'/><rect x='10.5' y='9' width='3' height='11' rx='1' opacity='.65'/><rect x='17' y='5' width='3' height='15' rx='1'/>",
  "iconColor": "#475569",
  "projection": "card-grid",
  "columns": 2,
  "sources": [],
  "statusFields": [],
  "domain": "ops",
  "entityShape": [],
  "generatedFields": [
    "semanticUses"
  ]
});
