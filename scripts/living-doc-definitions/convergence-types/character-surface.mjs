import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "character-surface",
  "name": "Character Surface",
  "category": "content",
  "kind": "surface",
  "description": "A cross-cut view of character presence, pressure, and development across the manuscript.",
  "structuralContract": "Two-column card grid of narrative-thread-state items with role in story, current pressure, and continuity concerns. Use when characters need to be tracked as structural carriers rather than isolated profile notes.",
  "notFor": [
    "chapter-only progress tracking",
    "scene-to-scene dependency tables",
    "general reference glossaries"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat characters as structural carriers of story pressure across themes, storylines, and scenes.",
    "keepDistinct": [
      "role in story",
      "current pressure",
      "continuity concerns",
      "scene/storyline/theme references"
    ],
    "inspect": [
      "Check where the character appears and what pressure they carry before updating status."
    ],
    "update": [
      "Keep character development tied to structural function, not profile trivia."
    ],
    "avoid": [
      "Do not use this as a general character glossary."
    ]
  },
  "icon": "<circle cx='12' cy='8' r='3'/><path opacity='.28' d='M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6H6z'/><path d='M7.5 11.5l1.2 1.2C9.5 11.6 10.7 11 12 11s2.5.6 3.3 1.7l1.2-1.2C15.4 10.2 13.8 9.5 12 9.5s-3.4.7-4.5 2z'/>",
  "iconColor": "#be123c",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "themeRefs",
      "entityType": "theme-ref",
      "label": "Themes"
    },
    {
      "key": "storylineRefs",
      "entityType": "storyline-ref",
      "label": "Storylines"
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
      "key": "roleInStory",
      "label": "Role in story"
    },
    {
      "key": "currentPressure",
      "label": "Current pressure"
    }
  ],
  "detailsFields": [
    {
      "key": "continuityConcerns",
      "label": "Continuity concerns"
    }
  ],
  "domain": "editorial",
  "entityShape": [],
  "generatedFields": [
    "semanticUses"
  ]
});
