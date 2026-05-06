import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "explainability-layer",
  "name": "Explainability Layer",
  "category": "governance",
  "kind": "act",
  "description": "A minimal plain-language explanation of the whole living doc: what the objective really means and what the current state is.",
  "structuralContract": "One-column card grid, usually with exactly one card. The card contains only an objective explanation and a current-state explanation, with a hard limit of five sentences total across both fields.",
  "notFor": [
    "multi-card interpretive taxonomies",
    "generic summaries that omit constraints",
    "decision records or proof surfaces"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as the shortest possible correct explanation of the document: first what the objective really locks in, then what the current state is.",
    "keepDistinct": [
      "objective explanation",
      "current state"
    ],
    "inspect": [
      "Read objective, successCondition, invariants, and the most relevant grounded sections or sources before writing."
    ],
    "update": [
      "Use one card by default.",
      "Keep the whole section at five sentences or fewer.",
      "Spend most of the sentence budget on the objective explanation and current state."
    ],
    "avoid": [
      "Do not invent new requirements unsupported by the doc or its sources.",
      "Do not turn explainability into another board or taxonomy.",
      "Do not spend sentence budget on references, caveats, or meta-commentary."
    ]
  },
  "icon": "<path opacity='.24' d='M12 4c5.2 0 9.5 3.7 10 8-.5 4.3-4.8 8-10 8S2.5 16.3 2 12c.5-4.3 4.8-8 10-8z'/><circle cx='12' cy='12' r='4.2'/><circle cx='12' cy='12' r='1.8' opacity='.75'/>",
  "iconColor": "#0f766e",
  "projection": "card-grid",
  "columns": 1,
  "sources": [],
  "statusFields": [],
  "textFields": [
    {
      "key": "objectiveExplanation",
      "label": "Objective"
    },
    {
      "key": "currentState",
      "label": "Current state"
    }
  ],
  "domain": "governance",
  "entityShape": []
});
