import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "brief-to-system-alignment",
  "name": "Brief to System Alignment",
  "category": "design-system",
  "kind": "act",
  "description": "The thinking-action of mapping a client brief to design responses. Each card is one paired move — a brief constraint or aspiration on one side, a design move on the other, with rationale.",
  "structuralContract": "Two-column card grid of paired moves. Each card carries a constraint, a response, a state from the alignment-state set, and a brief reference. Cards are not authored once and forgotten — alignment shifts as the system gets built.",
  "notFor": [
    "settled architecture decisions with no live tension (use decision-record)",
    "inventories of what was built (use design-system-surface)",
    "brief documents themselves (those are referenced, not authored here)"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat each card as one explicit translation from brief to design. The pairing is the unit — a constraint without a response is a question, not an alignment.",
    "keepDistinct": [
      "constraint (what the brief asks for)",
      "response (the design move that answers it)",
      "alignment state (aligned, partial, deferred, conflicting)",
      "rationale (why this response, not another)"
    ],
    "inspect": [
      "Check that every card has both a constraint and a response — neither side alone is alignment.",
      "Look for partial and conflicting cards that have not moved in a long time — that is unresolved tension, not stable state."
    ],
    "update": [
      "Promote partial to aligned only when the response actually closes the constraint.",
      "Use conflicting honestly — do not paper over a tension that the brief and the design have not resolved."
    ],
    "avoid": [
      "Do not collapse partial and conflicting into aligned.",
      "Do not use this for decisions that have no brief constraint (use decision-record instead)."
    ]
  },
  "icon": "<rect x='3' y='8' width='7' height='8' rx='1' opacity='.45'/><rect x='14' y='8' width='7' height='8' rx='1'/><rect x='10' y='11.25' width='4' height='1.5' opacity='.7'/>",
  "iconColor": "#d97706",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "briefIds",
      "entityType": "client-brief",
      "label": "Brief",
      "resolve": true
    },
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
      "statusSet": "alignment-state"
    }
  ],
  "textFields": [
    {
      "key": "constraint",
      "label": "Constraint"
    },
    {
      "key": "response",
      "label": "Response"
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
      "id": "extract-constraints-from-brief",
      "name": "Extract constraints from brief",
      "description": "Read the linked client-brief and propose alignment cards for each constraint, with placeholder response fields the author then fills."
    },
    {
      "id": "flag-unresolved-tension",
      "name": "Flag unresolved tension",
      "description": "Surface partial and conflicting cards older than 14 days; propose escalation to a decision-record if the tension is structural."
    }
  ],
  "domain": "design",
  "entityShape": [
    "paired-move"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
