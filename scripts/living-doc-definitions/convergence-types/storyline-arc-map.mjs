import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "storyline-arc-map",
  "name": "Storyline Arc Map",
  "category": "content",
  "kind": "act",
  "description": "A map of narrative lines or arcs showing what each storyline is carrying, where it turns, and which scenes or characters keep it moving.",
  "structuralContract": "Two-column card grid of narrative-thread-state items with arc role, current trajectory, and key beats. Use when named storylines need to stay explicit across the manuscript.",
  "notFor": [
    "chapter drafting progress",
    "single-scene dependency tables",
    "isolated character notes"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat storylines as named arcs with roles, trajectories, beats, and open loops.",
    "keepDistinct": [
      "arc role",
      "current trajectory",
      "key beats",
      "themes",
      "characters",
      "scenes"
    ],
    "inspect": [
      "Check the scenes and characters carrying the arc before updating its status."
    ],
    "update": [
      "Keep turns, open loops, and weak beats explicit."
    ],
    "avoid": [
      "Do not collapse storylines into isolated character notes or chapter status."
    ]
  },
  "icon": "<path opacity='.24' d='M5 18c0-5.2 3.2-9 7-9 1.9 0 3.4.9 4.6 2.2L19 9l.8.9c-1.6 1.8-3.8 4.5-3.8 7.1v1H5z'/><path d='M6 17c1.2-3.8 3.4-6 6-6 2.1 0 3.5 1.1 4.7 2.8l-1.3.9c-.9-1.3-1.9-2.1-3.4-2.1-1.8 0-3.5 1.4-4.6 4.4z'/><circle cx='18' cy='8' r='2'/>",
  "iconColor": "#0369a1",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "themeRefs",
      "entityType": "theme-ref",
      "label": "Themes"
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
      "key": "arcRole",
      "label": "Arc role"
    },
    {
      "key": "currentTrajectory",
      "label": "Current trajectory"
    }
  ],
  "detailsFields": [
    {
      "key": "beats",
      "label": "Key beats and open loops"
    }
  ],
  "domain": "editorial",
  "entityShape": [],
  "generatedFields": [
    "semanticUses"
  ]
});
