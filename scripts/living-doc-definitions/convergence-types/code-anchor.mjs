import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "code-anchor",
  "name": "Code Anchor",
  "category": "verification",
  "kind": "surface",
  "description": "Revision-pinned pointers into source code. Each card is one file-and-range with a short description of what the code does and why it matters for the focal issue. Diagnostic, not product-framing.",
  "structuralContract": "Two-column card grid. Each card pins a file path, line range, and revision (commit SHA or tag). Use when a doc needs to point a reader into exact code locations, not describe product capabilities.",
  "notFor": [
    "user-facing product capabilities (use capability-surface)",
    "general architectural overviews",
    "tried fixes (use attempt-log)"
  ],
  "promptGuidance": {
    "operatingThesis": "Each anchor pins source code at a revision. Without a revision, a code anchor is not trustworthy — if the file moves, the pointer stales silently.",
    "keepDistinct": [
      "file path",
      "line range",
      "pinned revision",
      "what the code does",
      "why it matters for the focal issue"
    ],
    "inspect": [
      "Verify the revision is resolvable (tag or SHA).",
      "When the doc is re-crystallized, check whether the pinned file/range still matches current main."
    ],
    "update": [
      "If the code has moved since the pin, update the revision or mark the anchor changed-since-issue."
    ],
    "avoid": [
      "Do not use code-anchor for product capabilities or feature-level descriptions."
    ]
  },
  "icon": "<path opacity='.28' d='M4 4h12v12H4z'/><path d='M7 8l-2 2 2 2M13 8l2 2-2 2' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/><path d='M11 7l-2 6'/>",
  "iconColor": "#7c3aed",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
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
      "statusSet": "code-anchor-status"
    }
  ],
  "textFields": [
    {
      "key": "path",
      "label": "Path"
    },
    {
      "key": "range",
      "label": "Line"
    },
    {
      "key": "revision",
      "label": "Revision"
    },
    {
      "key": "what_it_does",
      "label": "What it does"
    }
  ],
  "detailsFields": [
    {
      "key": "why_it_matters",
      "label": "Why it matters"
    }
  ],
  "aiActions": [
    {
      "id": "check-revision-drift",
      "name": "Check revision drift",
      "description": "Diff the pinned revision against current main. Propose updating the revision, flagging as changed-since-issue, or replacing the anchor."
    },
    {
      "id": "propose-replacement-anchor",
      "name": "Propose replacement anchor",
      "description": "If the code moved, suggest a replacement path + range with the same purpose."
    }
  ],
  "domain": "engineering",
  "entityShape": [
    "has-code-refs"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
