import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "design-system-surface",
  "name": "Design System Surface",
  "category": "design-system",
  "kind": "surface",
  "description": "Current state of a design system, expressed as pointers. Each card is one primitive — a token, a component, or a motif — surfaced from where it actually lives (Figma variable, tokens.json key, CSS custom property, repo path).",
  "structuralContract": "Two-column card grid where each card is one design primitive. The card never owns the value; it points at where the primitive lives. Status reflects implementation state across the design-primitive lifecycle.",
  "notFor": [
    "per-feature design-implementation alignment (use design-code-spec-flow)",
    "evidence of design decisions (use decision-record)",
    "inventories of system-consuming product surfaces"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat the section as the design system itself, surfaced as pointers. Tokens, components, and motifs each live in Figma / tokens.json / a code repo; this section reveals them and tracks their lifecycle.",
    "keepDistinct": [
      "primitive kind (token, component, motif)",
      "pointer (where the primitive actually lives)",
      "implementation status",
      "provenance (which derivation move produced it, if any)"
    ],
    "inspect": [
      "Check that every card has a pointer, not a duplicated value.",
      "Recheck status against the actual source (Figma file, tokens.json, repo) before marking shipped.",
      "Flag any primitive stuck in proposed for more than 14 days — that is itself a signal."
    ],
    "update": [
      "Refresh status from the canonical source, not from memory.",
      "When a primitive ships, link the commit or PR if there is one.",
      "Set primitiveKind on every card so the renderer chooses the right chip."
    ],
    "avoid": [
      "Do not author values here — the card is a pointer.",
      "Do not turn this into a per-feature implementation board (that is design-code-spec-flow)."
    ]
  },
  "icon": "<rect x='4' y='4' width='6' height='6' rx='1' opacity='.4'/><rect x='14' y='4' width='6' height='6' rx='1' opacity='.6'/><rect x='4' y='14' width='6' height='6' rx='1' opacity='.6'/><rect x='14' y='14' width='6' height='6' rx='1'/>",
  "iconColor": "#0ea5e9",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "tokenRefs",
      "entityType": "design-token",
      "label": "Token refs"
    },
    {
      "key": "componentRefs",
      "entityType": "design-component",
      "label": "Component refs"
    },
    {
      "key": "motifRefs",
      "entityType": "design-motif",
      "label": "Motif refs"
    },
    {
      "key": "derivedFrom",
      "entityType": "design-system-ref",
      "label": "Derived from",
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
      "key": "status",
      "statusSet": "design-primitive-status"
    }
  ],
  "textFields": [
    {
      "key": "primitiveKind",
      "label": "Kind"
    },
    {
      "key": "pointerSystem",
      "label": "Source system"
    }
  ],
  "aiActions": [
    {
      "id": "refresh-from-source",
      "name": "Refresh status from source",
      "description": "For each card with a Figma or tokens.json pointer, check the canonical source and propose status updates."
    },
    {
      "id": "flag-stale-proposals",
      "name": "Flag stale proposals",
      "description": "Surface primitives that have been in proposed for more than 14 days; propose either promotion or downgrade."
    }
  ],
  "domain": "design",
  "entityShape": [
    "pointer-card"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
