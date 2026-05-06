import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "scene-dependency-map",
  "name": "Scene Dependency Map",
  "category": "content",
  "kind": "act",
  "description": "A dependency table showing which scenes set up, justify, or pay off other scenes.",
  "structuralContract": "Edge-table with one setup scene and one dependent or payoff scene per row plus dependency strength and notes. Use when causality and payoff ordering matter more than scene status in isolation.",
  "notFor": [
    "broad chapter progress tracking",
    "theme or character mapping",
    "general continuity risk notes"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat each row as a causal or payoff dependency between a setup scene and a dependent scene.",
    "keepDistinct": [
      "setup scene",
      "dependent scene",
      "dependency strength",
      "dependency notes"
    ],
    "inspect": [
      "Check both scenes and the actual causal/payoff relationship before changing status."
    ],
    "update": [
      "Preserve edge-table clarity and make missing setup or payoff explicit."
    ],
    "avoid": [
      "Do not turn this into broad chapter progress or theme mapping."
    ]
  },
  "icon": "<circle cx='7' cy='7' r='2.2' opacity='.35'/><circle cx='17' cy='7' r='2.2' opacity='.55'/><circle cx='12' cy='17' r='2.4'/><path d='M8.7 8.4l2.5 6.1-1.4.6-2.5-6.1zm6.6 0l1.4.6-2.5 6.1-1.4-.6zM9.6 6.2h4.8v1.6H9.6z'/>",
  "iconColor": "#0f766e",
  "projection": "edge-table",
  "columnHeaders": [
    "Setup scene",
    "Dependent scene",
    "Dependency",
    "Notes"
  ],
  "sourceA": {
    "key": "setupSceneId",
    "entityType": "scene-ref"
  },
  "sourceB": {
    "key": "dependentSceneId",
    "entityType": "scene-ref"
  },
  "edgeStatus": {
    "key": "status",
    "statusSet": "dependency-state"
  },
  "edgeNotes": {
    "key": "notes"
  },
  "domain": "editorial",
  "entityShape": [],
  "generatedFields": [
    "semanticUses"
  ]
});
