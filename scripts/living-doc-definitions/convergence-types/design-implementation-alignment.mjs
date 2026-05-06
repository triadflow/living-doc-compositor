import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "design-implementation-alignment",
  "name": "Design–Implementation Alignment",
  "category": "delivery",
  "kind": "surface",
  "description": "A direct mapping between a design artifact and its implementation target in code.",
  "structuralContract": "Edge-table with one design-side entity and one code-side entity per row. Use when the relationship between the two is the thing being judged.",
  "notFor": [
    "general capability inventories",
    "behavior comparison sections",
    "multi-source product flows"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat each row as a judged relationship between one design artifact and one implementation target.",
    "keepDistinct": [
      "design-side entity",
      "code-side entity",
      "edge status",
      "edge notes"
    ],
    "inspect": [
      "Check both sides of each mapping before changing the alignment status."
    ],
    "update": [
      "Keep rows focused on alignment or drift between the paired sources."
    ],
    "avoid": [
      "Do not expand this into a general capability inventory or multi-source flow card."
    ]
  },
  "icon": "<rect x='3' y='5' width='6' height='10' rx='1.5' opacity='.28'/><path d='M5 8h2v2H5zm0 4h2v2H5zm7-1h4v2h-4zm5.5-6L22 9.5 17.5 14l-1.4-1.4 3.1-3.1-3.1-3.1L17.5 5z'/>",
  "iconColor": "#7c3aed",
  "projection": "edge-table",
  "columns": [
    "figmaSurface",
    "localFile",
    "status",
    "notes"
  ],
  "columnHeaders": [
    "Figma Surface",
    "Local File",
    "Status",
    "Notes"
  ],
  "sourceA": {
    "key": "figmaNodeId",
    "entityType": "figma-node",
    "displayKey": "figmaName"
  },
  "sourceB": {
    "key": "localPath",
    "entityType": "code-file"
  },
  "edgeStatus": {
    "key": "status",
    "statusSet": "code-status"
  },
  "edgeNotes": {
    "key": "notes"
  },
  "domain": "engineering",
  "entityShape": [
    "has-code-refs"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
