import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "taste-signature",
  "name": "Taste Signature",
  "category": "design-system",
  "kind": "surface",
  "description": "The designer's recurring identity, surfaced across prior systems. Each card is one trait — a colour relationship, a spacing rhythm, a motion preference, a typographic axis, a compositional habit — with pointers to the prior systems where it appears.",
  "structuralContract": "Two-column card grid of traits. Each trait points at one or more prior design-system-ref entries as evidence. Recurrence status reflects how many systems the trait has been observed in.",
  "notFor": [
    "external actors' positions (use expert-stance-track or competitor-stance-track)",
    "per-system inventory (use design-system-surface)",
    "individual decisions inside one engagement (use decision-record)"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as the designer's idiom made visible. Taste lives in the prior systems; this section reveals it. Each trait is evidenced, not asserted.",
    "keepDistinct": [
      "trait (the recurring choice)",
      "evidence (prior systems where it appears)",
      "recurrence status (recurring vs emerging vs abandoned)"
    ],
    "inspect": [
      "Check that every recurring card has at least two prior-system pointers — one is anecdotal.",
      "Look for emerging traits that have stalled at one pointer for a long time — they are candidates for abandoned."
    ],
    "update": [
      "Promote emerging to recurring only when a second prior-system pointer exists.",
      "Mark a trait abandoned when older systems carry it but the most recent ones have moved on — that is data, not failure."
    ],
    "avoid": [
      "Do not assert taste without prior-system pointers.",
      "Do not collapse multiple distinct traits into one card."
    ]
  },
  "icon": "<circle cx='12' cy='12' r='9' opacity='.25'/><circle cx='12' cy='12' r='6.5' opacity='.5'/><circle cx='12' cy='12' r='4'/><circle cx='12' cy='12' r='1.5' opacity='.7'/>",
  "iconColor": "#be185d",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "priorSystemRefs",
      "entityType": "design-system-ref",
      "label": "Prior systems",
      "resolve": true
    },
    {
      "key": "tokenRefs",
      "entityType": "design-token",
      "label": "Token examples"
    },
    {
      "key": "componentRefs",
      "entityType": "design-component",
      "label": "Component examples"
    },
    {
      "key": "motifRefs",
      "entityType": "design-motif",
      "label": "Motif examples"
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
      "statusSet": "taste-recurrence"
    }
  ],
  "textFields": [
    {
      "key": "trait",
      "label": "Trait"
    }
  ],
  "detailsFields": [
    {
      "key": "evidence",
      "label": "Evidence"
    }
  ],
  "aiActions": [
    {
      "id": "find-recurring-traits",
      "name": "Find recurring traits across prior systems",
      "description": "Read the priorSystems collection and propose candidate taste traits with the prior-system pointers as evidence."
    },
    {
      "id": "promote-recurrence",
      "name": "Propose recurrence promotion",
      "description": "For emerging traits with a newly-added prior-system pointer (now two or more), propose promotion to recurring."
    }
  ],
  "domain": "design",
  "entityShape": [
    "evidenced-pattern"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
