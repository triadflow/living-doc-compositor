import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "design-system-derivation",
  "name": "Design System Derivation",
  "category": "design-system",
  "kind": "act",
  "description": "The thinking-action of deriving a new system from prior systems plus a brief. Each card is one derivation move — kept, swapped, inverted, scaled, or dropped — with pointers to the prior system and to the new one.",
  "structuralContract": "Two-column card grid of derivation moves. Each card carries a prior-system pointer, a move from the derivation-move set, a target pointer, and a rationale. Move and rationale are paired — a move without rationale loses the data the derivation was built on.",
  "notFor": [
    "brief-driven choices that are not derivations (use brief-to-system-alignment)",
    "inventories of the resulting system (use design-system-surface)",
    "generic probes against a problem (use attempt-log)"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as the chain from prior work to the new system. Every card has a priorSystemRef; derivation that does not point at a prior system is a fresh decision, not a derivation.",
    "keepDistinct": [
      "prior system pointer (where the move started)",
      "move (kept, swapped, inverted, scaled, dropped)",
      "target (where it landed in the new system)",
      "rationale (why this move from this prior, against this brief)"
    ],
    "inspect": [
      "Check that every card has a priorSystemRef.",
      "kept cards still need rationale — kept without rationale loses the data the derivation was built on.",
      "swapped and inverted cards should reference what they were swapped or inverted against."
    ],
    "update": [
      "When the target ships in design-system-surface, link target back to that primitive's id.",
      "If a kept move later gets swapped under pressure, supersede the original card rather than overwrite — the prior move is data."
    ],
    "avoid": [
      "Do not collapse kept/swapped/inverted/scaled/dropped into a binary kept/changed.",
      "Do not derive from systems with no pointer — anonymous influence is not a derivation."
    ]
  },
  "icon": "<rect x='3' y='3' width='5' height='5' rx='1' opacity='.4'/><rect x='16' y='3' width='5' height='5' rx='1' opacity='.6'/><rect x='9' y='16' width='6' height='5' rx='1'/><path opacity='.45' d='M5.5 8l5 7.5h-1.5l-4.5-7.5zm13 0l-5 7.5h1.5l4.5-7.5z'/>",
  "iconColor": "#15803d",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "priorSystemRefs",
      "entityType": "design-system-ref",
      "label": "Prior system",
      "resolve": true
    },
    {
      "key": "briefIds",
      "entityType": "client-brief",
      "label": "Brief",
      "resolve": true
    },
    {
      "key": "tokenRefs",
      "entityType": "design-token",
      "label": "Tokens"
    },
    {
      "key": "componentRefs",
      "entityType": "design-component",
      "label": "Components"
    },
    {
      "key": "motifRefs",
      "entityType": "design-motif",
      "label": "Motifs"
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
      "statusSet": "derivation-move"
    }
  ],
  "textFields": [
    {
      "key": "targetRef",
      "label": "Target"
    }
  ],
  "detailsFields": [
    {
      "key": "rationale",
      "label": "Rationale"
    }
  ],
  "aiActions": [
    {
      "id": "propose-derivation-moves",
      "name": "Propose derivation moves from prior system",
      "description": "Given a priorSystemRef and the current brief, propose candidate kept/swapped/inverted/scaled/dropped moves with placeholder rationale the author then sharpens."
    },
    {
      "id": "link-target-to-surface",
      "name": "Link derivation target to surface card",
      "description": "When a derivation card's target lands in design-system-surface, link the target field to that primitive's id."
    }
  ],
  "domain": "design",
  "entityShape": [
    "derivation-move"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
