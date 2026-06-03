import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "draft-coherence-pass",
  "name": {
    "en": "Draft Coherence Pass",
    "nl": "Drafcoherentiepass",
    "id": "Pemeriksaan Koherensi Draf"
  },
  "category": "content",
  "kind": "act",
  "description": "A recorded reasoning pass that compares source graph, prompts, generated images, text, and page sequence before a draft completion claim. Each card is a performed coherence judgment with findings, rejections, repairs, and the evidence used.",
  "structuralContract": "Two-column card grid. Each card is one coherence pass over a page or page slice. It must name the source graph snapshot, output artifacts, checks performed, mismatches found, repairs made or required, and the resulting coherence verdict.",
  "notFor": [
    "static listing of source fields without performed judgment (use source-graph-completeness)",
    "pixel-only visual judgment without source graph comparison (use visual-page-draft-assessment)",
    "general QA test evidence",
    "project governance commentary"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat coherence as an action that must be performed and recorded. A draft is coherent only when source graph, prompts, text, images, and sequence support the same page intent. If any source edge, prompt, image, or sequence element contradicts the objective, the pass must require repair or regeneration.",
    "keepDistinct": [
      "source graph snapshot checked",
      "prompts and output artifacts checked",
      "text-to-image coherence",
      "fact-to-image coherence",
      "reference-to-image coherence",
      "beat-to-page sequence coherence",
      "rejections and why they were rejected",
      "repairs performed",
      "remaining blockers and next repair"
    ],
    "inspect": [
      "Read source graph completeness before judging outputs.",
      "Open actual image files and compare them to beat/page source data.",
      "Compare prompts to explicit factRefs, referenceAssetRefs, and cinematic directions.",
      "Compare each panel to neighboring panels and page-level sequence role.",
      "Do not accept a good-looking asset if it is unsupported by the source graph or contradicts the sequence."
    ],
    "update": [
      "Create a new card for each substantial coherence pass or iteration.",
      "Set verdict from the worst unresolved coherence failure.",
      "List rejected artifacts with concrete rejection reasons.",
      "List repairs performed and repairs still required separately.",
      "Only set coherent after the pass can point to source graph, output, and visual evidence."
    ],
    "avoid": [
      "Do not invent a distinction between high-quality draft and full coherence.",
      "Do not treat final image generation success as coherence proof.",
      "Do not skip source data because the rendered result looks plausible.",
      "Do not bury contradictions as soft gaps when they block the objective.",
      "Do not claim completion without a recorded pass."
    ]
  },
  "icon": "<path d='M4 6h7M4 12h7M4 18h7'/><path d='M15 6l2 2 4-4M15 12l2 2 4-4M15 18l2 2 4-4'/>",
  "iconColor": "#7c3aed",
  "projection": "card-grid",
  "domain": "content",
  "entityShape": [
    "coherence-pass",
    "performed-judgment",
    "source-output-comparison",
    "repair-loop"
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
      "key": "sourceGraphCards",
      "entityType": null,
      "label": "Source graph cards"
    },
    {
      "key": "imageJobIds",
      "entityType": null,
      "label": "Image jobs"
    },
    {
      "key": "imagePaths",
      "entityType": "artifact-file",
      "label": "Images"
    },
    {
      "key": "promptIds",
      "entityType": null,
      "label": "Prompts"
    }
  ],
  "statusFields": [
    {
      "key": "verdict",
      "statusSet": "draft-coherence-verdict"
    }
  ],
  "textFields": [
    {
      "key": "scope",
      "label": "Scope"
    },
    {
      "key": "sourceSnapshot",
      "label": "Source snapshot"
    },
    {
      "key": "coherenceFinding",
      "label": "Coherence finding"
    },
    {
      "key": "nextRepair",
      "label": "Next repair"
    }
  ],
  "detailsFields": [
    {
      "key": "checksPerformed",
      "label": "Checks performed"
    },
    {
      "key": "artifactAssessments",
      "label": "Artifact assessments"
    },
    {
      "key": "rejections",
      "label": "Rejections"
    },
    {
      "key": "repairsPerformed",
      "label": "Repairs performed"
    },
    {
      "key": "remainingBlockers",
      "label": "Remaining blockers"
    }
  ],
  "aiActions": [
    {
      "id": "run-draft-coherence-pass",
      "name": "Run draft coherence pass",
      "description": "Compare source graph, prompts, text, images, and sequence; record mismatches, rejected artifacts, repairs, remaining blockers, and the coherence verdict."
    },
    {
      "id": "derive-next-repair",
      "name": "Derive next repair",
      "description": "From the coherence failures, choose the next source edit, prompt repair, or image regeneration that moves the whole page toward coherent draft quality."
    }
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
