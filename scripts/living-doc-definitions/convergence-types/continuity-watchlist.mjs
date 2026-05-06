import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "continuity-watchlist",
  "name": "Continuity Watchlist",
  "category": "content",
  "kind": "act",
  "description": "A compact watchlist of continuity, timeline, or causality risks that could break reader trust if left unresolved.",
  "structuralContract": "One-column card grid of continuity-risk items with explicit risk summary, next check, and evidence. Use when inconsistencies need to stay visible until they are settled or resolved.",
  "notFor": [
    "general drafting progress",
    "theme mapping",
    "formal model assertions"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat continuity risks as unresolved contradictions that must remain visible until checked or resolved.",
    "keepDistinct": [
      "risk summary",
      "next check",
      "evidence",
      "affected scenes/characters/storylines/themes"
    ],
    "inspect": [
      "Check current evidence and contradictions before changing risk status."
    ],
    "update": [
      "Keep risks concrete and action-oriented with a next check."
    ],
    "avoid": [
      "Do not hide continuity issues inside general notes."
    ]
  },
  "icon": "<path opacity='.24' d='M12 3l8 3v5c0 5.1-3.1 9.7-8 11-4.9-1.3-8-5.9-8-11V6l8-3z'/><path d='M12 8a2 2 0 110 4 2 2 0 010-4zm-1 5h2v4h-2z'/>",
  "iconColor": "#dc2626",
  "projection": "card-grid",
  "columns": 1,
  "sources": [
    {
      "key": "sceneRefs",
      "entityType": "scene-ref",
      "label": "Scenes"
    },
    {
      "key": "characterRefs",
      "entityType": "character-ref",
      "label": "Characters"
    },
    {
      "key": "storylineRefs",
      "entityType": "storyline-ref",
      "label": "Storylines"
    },
    {
      "key": "themeRefs",
      "entityType": "theme-ref",
      "label": "Themes"
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
      "statusSet": "continuity-risk"
    }
  ],
  "textFields": [
    {
      "key": "riskSummary",
      "label": "Risk summary"
    },
    {
      "key": "nextCheck",
      "label": "Next check"
    }
  ],
  "detailsFields": [
    {
      "key": "evidence",
      "label": "Evidence and contradictions"
    }
  ],
  "domain": "editorial",
  "entityShape": [],
  "generatedFields": [
    "semanticUses"
  ]
});
