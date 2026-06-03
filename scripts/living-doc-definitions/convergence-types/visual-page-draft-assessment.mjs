import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "visual-page-draft-assessment",
  "name": {
    "en": "Visual Page Draft Assessment",
    "nl": "Visuele paginadraftbeoordeling",
    "id": "Penilaian Draf Visual Halaman"
  },
  "category": "content",
  "kind": "act",
  "description": "A visual judgment and repair surface for a drafted story page. Each card compares page intent, panel specifications, actual images, text state, sequence rhythm, violations, and the next repair action so image existence does not masquerade as visual draft completeness.",
  "structuralContract": "Two-column card grid. Each card is one page-level assessment with panel-by-panel verdicts, sequence assessment, text/source state, violations, repair priority, and next action. Use this after autonomous or manual page drafting when the question is whether the page is visually usable as a draft, not merely whether files exist.",
  "notFor": [
    "generic production readiness without visual inspection (use readiness or acceptance criteria sections)",
    "asset inventories that only list image paths",
    "text-only prose review",
    "final art approval without page/sequence context",
    "implementation behavior bugs (use behavior-fidelity)"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the card as a page-quality assessment, not a file-presence check. The page is draft-ready only when the text/source state, each panel image, and the page sequence cohere with the stated page intent and panel specs.",
    "keepDistinct": [
      "page intent and target output",
      "source/text readiness",
      "panel-level spec summary",
      "actual visual observation",
      "panel verdict (keep / iterate / reject / missing)",
      "sequence-level rhythm, mirror, through-line, and continuity assessment",
      "violations and draft risks",
      "repair priority and next action"
    ],
    "inspect": [
      "Open every existing image path before marking a panel keep or draft-ready.",
      "Compare actual pixels against imageBrief, directionNote, panelRole, cinematicDirections, page compositionArc, throughLine, mirroringPairs, and cinematicNotes.",
      "Assess the page as a sequence, not only as three isolated panels.",
      "Look for forbidden image features: captions, speech bubbles, UI text, page borders, faux paper, stock/photo-realism when an illustration is required, and generic imagery that misses the beat.",
      "If generation or inspection tooling fails, mark blocked-by-tooling or usable-with-risks rather than draft-ready."
    ],
    "update": [
      "Use one card per page assessment pass or update the current card when the assessment is still the active draft state.",
      "Set verdict from the worst meaningful page blocker, not from the best panel.",
      "Write panelAssessments as concrete observations with beatId, imagePath, specSummary, actualObservation, verdict, violations, and repairPromptDelta.",
      "Write sequenceAssessment after panel assessments so it reflects actual page rhythm.",
      "Make nextAction the first repair that improves the page sequence, not necessarily the first missing asset."
    ],
    "avoid": [
      "Do not count imagePath existence as visual completion.",
      "Do not mark a panel keep without visual inspection or an explicit draft-risk caveat.",
      "Do not hide quality failures under generic audit warnings.",
      "Do not regenerate dependent panels before repairing an upstream panel that anchors the sequence.",
      "Do not confuse draft-ready with final human approval."
    ]
  },
  "icon": "<rect x='3' y='5' width='18' height='14' rx='2' opacity='.22'/><path d='M6 9h4v6H6zm5 0h3v6h-3zm4 0h3v6h-3z'/><path d='M5.5 18.5l3-3 2 2 3.5-4 4.5 5'/><circle cx='17.5' cy='7.5' r='1.4'/>",
  "iconColor": "#0f766e",
  "projection": "card-grid",
  "domain": "content",
  "entityShape": [
    "visual-assessment",
    "has-evidence",
    "page-sequence",
    "draft-quality"
  ],
  "columns": 2,
  "sources": [
    {
      "key": "pageIds",
      "entityType": null,
      "label": "Studio pages"
    },
    {
      "key": "beatIds",
      "entityType": null,
      "label": "Beats"
    },
    {
      "key": "imagePaths",
      "entityType": "artifact-file",
      "label": "Images"
    },
    {
      "key": "specRefs",
      "entityType": "ux-spec",
      "label": "Specs",
      "resolve": true
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
      "key": "verdict",
      "statusSet": "visual-draft-verdict"
    }
  ],
  "textFields": [
    {
      "key": "targetOutput",
      "label": "Target output"
    },
    {
      "key": "pageIntent",
      "label": "Page intent"
    },
    {
      "key": "sequenceAssessment",
      "label": "Sequence assessment"
    },
    {
      "key": "nextAction",
      "label": "Next action"
    }
  ],
  "detailsFields": [
    {
      "key": "panelAssessments",
      "label": "Panel assessments"
    },
    {
      "key": "violations",
      "label": "Violations"
    },
    {
      "key": "repairPriority",
      "label": "Repair priority"
    },
    {
      "key": "draftRisks",
      "label": "Draft risks"
    },
    {
      "key": "imageReviewEvidence",
      "label": "Image review evidence"
    }
  ],
  "aiActions": [
    {
      "id": "review-page-images-against-spec",
      "name": "Review page images against spec",
      "description": "Open the referenced images, compare them to page and panel specifications, update panel verdicts, and propose the next repair action."
    },
    {
      "id": "propose-repair-order",
      "name": "Propose repair order",
      "description": "Given panel verdicts and sequence dependencies, choose the first image or source repair that best improves the page as a sequence."
    }
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
