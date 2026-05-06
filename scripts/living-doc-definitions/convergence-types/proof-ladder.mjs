import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "proof-ladder",
  "name": "Proof Ladder",
  "category": "verification",
  "kind": "act",
  "description": "An ordered ladder of verification steps where each rung increases proof strength toward operational truth.",
  "structuralContract": "Two-column card grid of probe-status items, typically named as levels or rungs. Use when the section expresses staged proof escalation rather than a flat set of checks.",
  "notFor": [
    "unordered verification checkpoints",
    "general work surfaces",
    "decision records"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat proof as staged escalation where each rung increases confidence toward operational truth.",
    "keepDistinct": [
      "proof rung",
      "current status",
      "evidence notes",
      "next stronger proof"
    ],
    "inspect": [
      "Check whether evidence actually satisfies the rung before advancing status."
    ],
    "update": [
      "Preserve ladder ordering and make weaker or missing rungs explicit."
    ],
    "avoid": [
      "Do not flatten proof levels into unordered checks or decisions."
    ]
  },
  "icon": "<path opacity='.22' d='M7 4h2v16H7zm8 0h2v16h-2z'/><path d='M9 7h6v2H9zm0 4h6v2H9zm0 4h6v2H9zm0 4h6v2H9z'/><path d='M18 7l4 4-4 4-1.4-1.4 1.6-1.6H15v-2h3.2l-1.6-1.6L18 7z'/>",
  "iconColor": "#059669",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
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
      "statusSet": "probe-status"
    }
  ],
  "aiProfiles": [
    {
      "id": "proof-state-brief",
      "name": "Proof State Brief",
      "description": "Summarize what the ladder currently proves and where the proof boundary sits.",
      "slot": "section-brief",
      "defaultVisible": true
    },
    {
      "id": "weakest-open-rung",
      "name": "Weakest Open Rung",
      "description": "Identify the first unsatisfied rung and the missing evidence for closure.",
      "slot": "section-weakness-note",
      "defaultVisible": false
    },
    {
      "id": "next-stronger-proof",
      "name": "Next Stronger Proof",
      "description": "Describe the next evidence shape that would strengthen the ladder without redesigning it.",
      "slot": "section-next-loop",
      "defaultVisible": false
    }
  ],
  "aiActions": [
    {
      "id": "check-monotonic",
      "name": "Check monotonic invariant",
      "description": "Confirm every rung below this one is ready. If not, flag the inversion — this rung cannot legitimately claim ready state."
    }
  ],
  "domain": "engineering",
  "entityShape": [
    "has-code-refs",
    "has-evidence"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
