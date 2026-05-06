import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "build-lifecycle-surface",
  "name": "Build Lifecycle Surface",
  "category": "monitoring",
  "kind": "surface",
  "description": "Parallel lifecycle status across a coherent set of physical or contractual build items. Each card is one item (a datacenter campus, a power-purchase agreement, a plant) progressing through announced → permitting → construction → energizing → operational.",
  "structuralContract": "Two-column card grid of build-lifecycle items. Each card has a current lifecycle status, planned and operational capacity (text), operator attribution, location, first-announced and expected-operational dates, and an optional delay-versus-plan description. Use when tracking the gap between what was announced and what actually gets delivered — not for strategic postures and not for events.",
  "notFor": [
    "strategic posture tracking (use competitor-stance-track)",
    "discrete dated events (use strategic-move-log)",
    "numeric indicators (use indicator-trace)"
  ],
  "promptGuidance": {
    "operatingThesis": "Each card is one build item moving through a physical or contractual lifecycle. The announced-versus-operational gap at card level is the primary signal this section carries.",
    "keepDistinct": [
      "lifecycle status (announced / permitting / construction / energizing / operational / cancelled)",
      "planned capacity and operational capacity as separate fields",
      "operator attribution and location",
      "first-announced date and expected-operational date",
      "delay versus plan — described, not collapsed into status"
    ],
    "inspect": [
      "Confirm the current lifecycle state against a dated public source before transitioning status.",
      "Check whether operationalCapacity has moved — that is the indicator that matters more than status by itself."
    ],
    "update": [
      "Preserve the history by updating expectedOperational with a new date rather than rewriting the original.",
      "Capture delays in delayVsPlan narratively; do not collapse a delay into status=cancelled unless there is a formal cancellation."
    ],
    "avoid": [
      "Do not use announced capacity as if it were delivered capacity.",
      "Do not drop a card when a project is cancelled — mark it cancelled and keep the record."
    ]
  },
  "icon": "<rect x='3' y='10' width='4' height='10' rx='.8' opacity='.28'/><rect x='9' y='6' width='4' height='14' rx='.8' opacity='.5'/><rect x='15' y='3' width='4' height='17' rx='.8' opacity='.8'/><path d='M3 20h18' fill='none' stroke='currentColor' stroke-width='1.4'/><path d='M6 6l3 0M12 3l3 0' fill='none' stroke='currentColor' stroke-width='1.4' opacity='.55'/>",
  "iconColor": "#0f766e",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "sourceRefs",
      "entityType": "content-source",
      "label": "Primary source"
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
      "statusSet": "build-lifecycle"
    }
  ],
  "textFields": [
    {
      "key": "operator",
      "label": "Operator"
    },
    {
      "key": "location",
      "label": "Location"
    },
    {
      "key": "plannedCapacity",
      "label": "Planned capacity"
    },
    {
      "key": "operationalCapacity",
      "label": "Operational capacity"
    },
    {
      "key": "firstAnnounced",
      "label": "First announced"
    },
    {
      "key": "expectedOperational",
      "label": "Expected operational"
    }
  ],
  "detailsFields": [
    {
      "key": "delayVsPlan",
      "label": "Delay vs plan"
    },
    {
      "key": "milestones",
      "label": "Recent milestones"
    }
  ],
  "aiActions": [
    {
      "id": "check-lifecycle-transition",
      "name": "Check for lifecycle transition",
      "description": "Read recent public sources touching the card (press, filings, earnings). If a transition to the next lifecycle state is evidenced, propose updating status and add the supporting source to the citation feed."
    }
  ],
  "domain": "intelligence",
  "entityShape": [
    "has-evidence",
    "time-series"
  ]
});
