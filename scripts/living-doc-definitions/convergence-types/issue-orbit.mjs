import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "issue-orbit",
  "name": "Issue Orbit",
  "category": "verification",
  "kind": "surface",
  "description": "A graph of sibling issues and PRs that share root cause, symmetry, or adjacency with the focal issue. Not a list of findings — each card is metadata about another issue.",
  "structuralContract": "Two-column card grid. Each card names another issue/PR, its state, its relationship to the focal issue, and why it matters. Use when a doc needs to preserve the shape of nearby bugs in the same problem space.",
  "notFor": [
    "observations about the focal issue (use symptom-observation)",
    "attempts at a fix (use attempt-log)",
    "general references or citations"
  ],
  "promptGuidance": {
    "operatingThesis": "Each card describes a different issue and its relationship to the focal one. The relationship is required — a card without a clear relationship does not belong here.",
    "keepDistinct": [
      "sibling issue identity",
      "github state",
      "relationship to focal (same-root-cause, adjacent, symmetric, superseded, prior-art)",
      "relevance to focal"
    ],
    "inspect": [
      "Verify the github_state is current — closed issues may have reopened, open issues may have gone stale.",
      "Challenge the relationship classification — a weak relationship is usually no relationship."
    ],
    "update": [
      "When a sibling issue is closed by a PR, link it via ticketIds or notes and update status."
    ],
    "avoid": [
      "Do not include issues with only topical overlap — the relationship must be structural."
    ]
  },
  "icon": "<circle cx='10' cy='10' r='2'/><circle cx='10' cy='10' r='6' fill='none' stroke='currentColor' stroke-width='1' opacity='.4'/><circle cx='16' cy='10' r='1.5'/><circle cx='6' cy='14' r='1.5'/><circle cx='6' cy='6' r='1.5'/>",
  "iconColor": "#0891b2",
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
      "statusSet": "issue-orbit-status"
    }
  ],
  "textFields": [
    {
      "key": "url",
      "label": "URL"
    },
    {
      "key": "github_state",
      "label": "GitHub state"
    },
    {
      "key": "relationship",
      "label": "Relationship"
    },
    {
      "key": "relevance",
      "label": "Relevance"
    }
  ],
  "aiActions": [
    {
      "id": "refresh-github-state",
      "name": "Refresh GitHub state",
      "description": "Re-fetch the linked issue/PR and update status + closed_by_pr if changed since the doc was last touched."
    },
    {
      "id": "reclassify-relationship",
      "name": "Reclassify relationship",
      "description": "Re-read the sibling issue and challenge the current relationship classification (same-root-cause / symmetric / adjacent / superseded / prior-art)."
    }
  ],
  "domain": "research",
  "entityShape": [
    "has-tickets"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
