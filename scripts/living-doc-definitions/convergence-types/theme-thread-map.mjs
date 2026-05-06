import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "theme-thread-map",
  "name": "Theme Thread Map",
  "category": "content",
  "kind": "act",
  "description": "A thematic surface where recurring ideas are traced through storylines, characters, scenes, and source material.",
  "structuralContract": "Two-column card grid of narrative-thread-state items with explicit articulation, why it matters, and where the theme is currently carried. Use when themes should be tracked as deliberate structural threads rather than left implicit.",
  "notFor": [
    "chapter drafting progress",
    "causal scene dependencies",
    "general note dumps"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat themes as deliberate threads carried by storylines, characters, scenes, and source material.",
    "keepDistinct": [
      "theme articulation",
      "why it matters",
      "carriers",
      "pressure points"
    ],
    "inspect": [
      "Check which storylines, characters, and scenes currently carry the theme."
    ],
    "update": [
      "Make thin, overloaded, or unresolved thematic pressure visible."
    ],
    "avoid": [
      "Do not reduce themes to generic notes or chapter progress."
    ]
  },
  "icon": "<circle cx='8' cy='7' r='2.2' opacity='.3'/><circle cx='16' cy='7' r='2.2' opacity='.55'/><circle cx='12' cy='16' r='2.4'/><path d='M8.8 8.4l2.4 5.1-1.4.6-2.4-5.1zm6.4 0l1.4.6-2.4 5.1-1.4-.6zM9.5 6.2h5v1.6h-5z'/>",
  "iconColor": "#b45309",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "storylineRefs",
      "entityType": "storyline-ref",
      "label": "Storylines"
    },
    {
      "key": "characterRefs",
      "entityType": "character-ref",
      "label": "Characters"
    },
    {
      "key": "sceneRefs",
      "entityType": "scene-ref",
      "label": "Scenes"
    },
    {
      "key": "sourceRefs",
      "entityType": "content-source",
      "label": "Source material"
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
      "statusSet": "narrative-thread-state"
    }
  ],
  "textFields": [
    {
      "key": "articulation",
      "label": "Articulation"
    },
    {
      "key": "whyItMatters",
      "label": "Why it matters"
    }
  ],
  "detailsFields": [
    {
      "key": "pressurePoints",
      "label": "Pressure points and gaps"
    }
  ],
  "domain": "editorial",
  "entityShape": [],
  "generatedFields": [
    "semanticUses"
  ]
});
