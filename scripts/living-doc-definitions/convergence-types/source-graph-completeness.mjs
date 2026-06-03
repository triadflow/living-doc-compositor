import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "source-graph-completeness",
  "name": {
    "en": "Source Graph Completeness",
    "nl": "Bron-graafvolledigheid",
    "id": "Kelengkapan Graf Sumber"
  },
  "category": "content",
  "kind": "surface",
  "description": "A production-quality surface for checking whether a page or beat has the source graph needed to support a high-quality draft: page intent, beat intent, cinematic directions, fact grounding, reference assets, prompt lineage, output paths, and audit state. This prevents generated output from being treated as complete while the source data needed to explain and reproduce it is missing.",
  "structuralContract": "Two-column card grid. Each card represents one page, beat, or page-slice source graph. The card must list required source fields, present values, missing or drifted graph edges, blocking quality gaps, and the repair action needed before a draft can be called coherent.",
  "notFor": [
    "visual review of actual image pixels (use visual-page-draft-assessment)",
    "the performed reasoning pass comparing source to output (use draft-coherence-pass)",
    "generic issue status",
    "final proof evidence after all checks are done (use verification or proof types)"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat missing source data as a quality blocker when that data controls image generation, text generation, or page coherence. The source graph is complete only when page intent, beat intent, cinematic direction, facts, references, prompts, outputs, and audit state are explicit enough for another agent or human to understand why the draft looks the way it does.",
    "keepDistinct": [
      "page-level intent and composition structure",
      "beat-level intent and panel role",
      "cinematic direction fields",
      "factRefs and the facts they ground",
      "referenceAssetRefs and generated asset provenance",
      "prompt IDs and prompt lineage",
      "current output paths",
      "audit warnings/errors and whether they are quality blockers",
      "repair action required before generation or completion claim"
    ],
    "inspect": [
      "Check the page structure before looking at image beauty.",
      "Verify that every beat has the explicit facts and references its prompt or image depends on.",
      "Verify that every generated or selected image has a prompt lineage and output path tied back to the beat.",
      "Treat work-page soft labels as potentially blocking when they affect draft quality.",
      "Mark drift when source fields, prompts, images, and audit state disagree."
    ],
    "update": [
      "Use one card per page or beat source graph, depending on document scope.",
      "Set status from the worst unresolved graph blocker.",
      "Write missingEdges as concrete fields or relationships, not vague prose.",
      "Write requiredRepair as the next source edit needed before the page can be judged coherent.",
      "Update after every generation or manual source edit."
    ],
    "avoid": [
      "Do not call source graph complete because images exist.",
      "Do not downgrade missing factRefs, referenceAssetRefs, or cinematic directions to harmless notes when they affect generation quality.",
      "Do not hide missing graph data under generic audit wording.",
      "Do not infer invisible source state from a good-looking image; write the graph edge explicitly."
    ]
  },
  "icon": "<path d='M5 6.5a2 2 0 1 0 0 .01M19 6.5a2 2 0 1 0 0 .01M12 17.5a2 2 0 1 0 0 .01'/><path d='M7 7l10-.5M6.5 8.2l4.2 7.1M17.5 8.2l-4.2 7.1'/><path d='M9 17.5h6'/>",
  "iconColor": "#2563eb",
  "projection": "card-grid",
  "domain": "content",
  "entityShape": [
    "source-graph",
    "has-grounding",
    "quality-blockers",
    "prompt-lineage"
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
      "key": "factIds",
      "entityType": null,
      "label": "Facts"
    },
    {
      "key": "referenceAssetIds",
      "entityType": null,
      "label": "Reference assets"
    },
    {
      "key": "promptIds",
      "entityType": null,
      "label": "Prompts"
    },
    {
      "key": "imagePaths",
      "entityType": "artifact-file",
      "label": "Images"
    }
  ],
  "statusFields": [
    {
      "key": "status",
      "statusSet": "source-graph-quality"
    }
  ],
  "textFields": [
    {
      "key": "scope",
      "label": "Scope"
    },
    {
      "key": "requiredGraph",
      "label": "Required graph"
    },
    {
      "key": "presentGraph",
      "label": "Present graph"
    },
    {
      "key": "requiredRepair",
      "label": "Required repair"
    }
  ],
  "detailsFields": [
    {
      "key": "missingEdges",
      "label": "Missing edges"
    },
    {
      "key": "driftSignals",
      "label": "Drift signals"
    },
    {
      "key": "qualityBlockers",
      "label": "Quality blockers"
    },
    {
      "key": "auditEvidence",
      "label": "Audit evidence"
    }
  ],
  "aiActions": [
    {
      "id": "complete-source-graph",
      "name": "Complete source graph",
      "description": "Inspect the page/beat source graph, identify missing grounding, direction, reference, prompt, and output edges, then propose the required source edits before draft completion."
    },
    {
      "id": "classify-quality-blockers",
      "name": "Classify quality blockers",
      "description": "Reclassify audit gaps according to the current objective, marking fields as blocking when they control draft quality even if another system labels them soft."
    }
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
