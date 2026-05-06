import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "competitor-stance-track",
  "name": "Competitor Stance Track",
  "category": "monitoring",
  "kind": "surface",
  "description": "An organization's strategic posture tracked across monitoring periods, where the 'stance' is revealed through behavior (launches, pricing, hires, earnings commentary) rather than stated in writing.",
  "structuralContract": "One-column card grid. Each card names a competitor with sector/stage/geography, a strategic-posture label, a one-paragraph current-bet prose, an evolutionSinceLastPeriod field describing behavioral shifts, and references to signals (press, earnings, product pages). Use for tracking organizations. Not for individual public-intellectual stances — those belong in expert-stance-track.",
  "notFor": [
    "individual public-intellectual stances (use expert-stance-track)",
    "one-off PR or forum positions (use maintainer-stance)",
    "internal strategy docs about your own organization"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat each card as an organization's strategic posture inferred from its behavior. The source of truth is what they do (launches, pricing changes, hires, earnings), not what they say in op-eds.",
    "keepDistinct": [
      "company name and identifying facts (sector, stage, geography)",
      "current strategic posture as a label",
      "current bet prose — what they are actually investing in right now",
      "evolution since last period — behavioral moves that shifted the picture",
      "signal references — the events and publications that ground the read"
    ],
    "inspect": [
      "Check public signals in the current monitoring period before shifting a posture — launches, pricing updates, exec hires, earnings transcripts, job posts, product-page edits.",
      "Re-derive the current bet from the last 3–6 months of behavior, not from a dated About page."
    ],
    "update": [
      "When a competitor softens, retracts, or pivots a bet, record the status transition and cite the triggering signals in evolutionSinceLastPeriod.",
      "Preserve prior-period evolution notes as history; append rather than overwrite."
    ],
    "avoid": [
      "Do not infer a pivot from a single data point. Strategic shifts require corroborating signals.",
      "Do not source from confidential or paid-subscription intel in a shareable tracker.",
      "Do not conflate a marketing narrative with a strategic bet — marketing speaks; behavior reveals."
    ]
  },
  "icon": "<path opacity='.24' d='M4 20V8l8-4 8 4v12z'/><path d='M9 20v-6h6v6zm-3-8h2v2H6zm10 0h2v2h-2z'/>",
  "iconColor": "#0f766e",
  "projection": "card-grid",
  "columns": 1,
  "sources": [
    {
      "key": "signalRefs",
      "entityType": "content-source",
      "label": "Signals"
    },
    {
      "key": "notes",
      "entityType": null,
      "label": null
    }
  ],
  "statusFields": [
    {
      "key": "posture",
      "statusSet": "stance-status"
    }
  ],
  "textFields": [
    {
      "key": "sector",
      "label": "Sector"
    },
    {
      "key": "stage",
      "label": "Stage"
    },
    {
      "key": "geography",
      "label": "Geography"
    },
    {
      "key": "strategicPosture",
      "label": "Strategic posture"
    },
    {
      "key": "currentBet",
      "label": "Current bet"
    },
    {
      "key": "evolutionSinceLastPeriod",
      "label": "Evolution since last period"
    }
  ],
  "detailsFields": [
    {
      "key": "activeInitiatives",
      "label": "Active initiatives"
    }
  ],
  "domain": "intelligence",
  "entityShape": [
    "has-evidence",
    "time-series"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
