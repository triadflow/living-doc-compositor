import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "transcript-argument-frame",
  "name": "Transcript Argument Frame",
  "category": "research",
  "kind": "act",
  "description": "Analytical map of a transcript's claims, assumptions, reasoning chains, vulnerabilities, and counterarguments.",
  "structuralContract": "One-column card grid, one claim or reasoning unit per card. Each card must trace back to transcript spans and keep claim, assumptions, reasoning, flaws, and counterarguments distinct.",
  "notFor": [
    "general transcript summaries",
    "theme tracking",
    "documentary legal defensibility",
    "single-claim proof ladders"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat each card as one claim or reasoning unit from a transcript, grounded in source spans and tested against assumptions, weak links, and counterarguments.",
    "keepDistinct": [
      "the claim",
      "transcript span references",
      "reasoning path",
      "assumptions",
      "potential flaws",
      "counterarguments",
      "context-grounding links"
    ],
    "inspect": [
      "Check the transcript span before changing the claim or status.",
      "Check whether the card repeats, updates, or contradicts context from linked living docs.",
      "Distinguish what the speaker explicitly said from what the analyst inferred."
    ],
    "update": [
      "Preserve source-span references when rewriting the claim.",
      "Move factual assertions that need external verification into findings or proof surfaces.",
      "Keep serious counterarguments on the same card as the claim they challenge."
    ],
    "avoid": [
      "Do not collapse this into a generic summary.",
      "Do not mark a claim explicit-supported unless the transcript and context actually support it.",
      "Do not silently import private cross-doc context without provenance."
    ]
  },
  "icon": "<path opacity='.24' d='M4 4h16v16H4z'/><path d='M7 8h10v1.6H7zm0 4h7v1.6H7zm0 4h10v1.6H7z'/><path d='M17 11l3 3-3 3-1.2-1.2 1-1H14v-1.6h2.8l-1-1z'/>",
  "iconColor": "#2557d6",
  "projection": "card-grid",
  "columns": 1,
  "sources": [
    {
      "key": "transcriptRefs",
      "entityType": "content-source",
      "label": "Transcript spans"
    },
    {
      "key": "evidenceRefs",
      "entityType": "content-source",
      "label": "Evidence cited or implied"
    },
    {
      "key": "contextRefs",
      "entityType": "content-source",
      "label": "Context grounding"
    },
    {
      "key": "counterRefs",
      "entityType": "content-source",
      "label": "Counterarguments"
    },
    {
      "key": "notes",
      "entityType": null,
      "label": null
    }
  ],
  "statusFields": [
    {
      "key": "argumentStatus",
      "statusSet": "argument-defensibility"
    }
  ],
  "textFields": [
    {
      "key": "claim",
      "label": "Claim"
    },
    {
      "key": "reasoning",
      "label": "Reasoning"
    },
    {
      "key": "assumptions",
      "label": "Assumptions"
    }
  ],
  "detailsFields": [
    {
      "key": "potentialFlaws",
      "label": "Potential flaws"
    },
    {
      "key": "counterArguments",
      "label": "Counterarguments"
    },
    {
      "key": "contextGrounding",
      "label": "Context grounding"
    },
    {
      "key": "openQuestions",
      "label": "Open questions"
    }
  ],
  "domain": "research",
  "entityShape": [
    "has-evidence"
  ]
});
