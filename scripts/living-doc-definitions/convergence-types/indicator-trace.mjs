import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "indicator-trace",
  "name": "Indicator Trace",
  "category": "monitoring",
  "kind": "surface",
  "description": "Tracked metric with dated latest observation, forecast, and delta versus the prior monitoring period. Used when the doc is watching a set of empirical indicators over time.",
  "structuralContract": "Two-column card grid. Each card is one tracked indicator with a latest value (as text), an as-of date, a forecast, a delta versus the last period, and a categorical trend (rising / stable / falling / resolved). Use for dashboards of empirical signals; not for categorical deliverables.",
  "notFor": [
    "deliverable tracking (use capability-surface)",
    "single-claim defense (use proof-ladder)",
    "qualitative status narratives"
  ],
  "promptGuidance": {
    "operatingThesis": "Each card is a numeric indicator whose value is dated and whose direction since the last period is what matters most.",
    "keepDistinct": [
      "indicator name and definition",
      "latest value with an as-of date",
      "forecast or expected direction",
      "delta versus last period",
      "trend label"
    ],
    "inspect": [
      "Confirm the latest value has a source with a publication date.",
      "Compare the value against the last-period value before setting deltaVsLastPeriod."
    ],
    "update": [
      "Update latestValue and asOf together; never update one without the other.",
      "Set trend only when the delta supports it."
    ],
    "avoid": [
      "Do not flip trend on a single data point if the series is noisy.",
      "Do not substitute categorical status for numeric value."
    ]
  },
  "icon": "<path opacity='.28' d='M4 5h16v14H4z'/><path d='M6 17l4-5 3 3 5-7' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/>",
  "iconColor": "#2563eb",
  "projection": "card-grid",
  "columns": 2,
  "sources": [
    {
      "key": "sourceRefs",
      "entityType": "content-source",
      "label": "Sources"
    },
    {
      "key": "notes",
      "entityType": null,
      "label": null
    }
  ],
  "statusFields": [
    {
      "key": "trend",
      "statusSet": "trend"
    }
  ],
  "textFields": [
    {
      "key": "latestValue",
      "label": "Latest value"
    },
    {
      "key": "asOf",
      "label": "As of"
    },
    {
      "key": "forecast",
      "label": "Forecast"
    },
    {
      "key": "deltaVsLastPeriod",
      "label": "Δ vs last period"
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
