import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  "id": "tiny-experiment",
  "name": "Tiny Experiment",
  "category": "verification",
  "kind": "act",
  "description": "A small, time-bounded experiment with an explicit hypothesis and a closure decision of persist, pause, or pivot. The unit of pact-shaped learning.",
  "structuralContract": "Two-column card grid. Each card is one experiment with a hypothesis, a window, the signals it watches, and on closure an outcome with rationale. Status is pact-status; outcome is pact-outcome and is only set when status is closed.",
  "notFor": [
    "ongoing tasks without a hypothesis or window (use attempt-log)",
    "cohort views across multiple experiments (use experiment-evidence-surface)",
    "settled decisions with no live signal (use decision-record)"
  ],
  "promptGuidance": {
    "operatingThesis": "Each card is a pact: a declarative hypothesis, a window with start and end, the signals being tracked, and a closure that picks one of three legitimate moves — persist, pause, or pivot. The closure carries the data; the running state is just the wait.",
    "keepDistinct": [
      "hypothesis",
      "window (start and end)",
      "signals being tracked",
      "status (running vs closed)",
      "outcome (persist / pause / pivot) on closure",
      "rationale on closure"
    ],
    "inspect": [
      "Check that every running card has a window end date — undated experiments quietly turn into permanent commitments.",
      "Check that closed cards have an outcome and a one or two sentence rationale.",
      "If a card has been running past its window without a closure, that is itself a signal — either close it or extend the window deliberately."
    ],
    "update": [
      "When the window closes, set status=closed, set outcome, and write the rationale before moving on. Skipping the rationale loses the data the experiment was trying to gather.",
      "If pivoting, link nextPact to the follow-up experiment so the chain stays traceable.",
      "Persisting does not mean unchanged — write down what is being kept and what (if anything) is being adjusted."
    ],
    "avoid": [
      "Do not use this for tasks that have no hypothesis. Tasks without a question being asked belong in attempt-log or operating-surface.",
      "Do not collapse persist/pause/pivot into pass/fail — the three-way choice is the point.",
      "Do not let cards drift past their window without a closure. The closure is what makes it an experiment."
    ]
  },
  "icon": "<path opacity='.28' d='M9 2h6v4l-3 3-3-3z'/><path d='M9 9l3 3 3-3v9a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V9z'/><circle cx='12' cy='16' r='1.4'/>",
  "iconColor": "#7c3aed",
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
      "statusSet": "pact-status"
    },
    {
      "key": "outcome",
      "statusSet": "pact-outcome"
    }
  ],
  "textFields": [
    {
      "key": "windowStart",
      "label": "Window start"
    },
    {
      "key": "windowEnd",
      "label": "Window end"
    },
    {
      "key": "nextPact",
      "label": "Next pact"
    }
  ],
  "detailsFields": [
    {
      "key": "hypothesis",
      "label": "Hypothesis"
    },
    {
      "key": "signals",
      "label": "Signals tracked"
    },
    {
      "key": "rationale",
      "label": "Rationale on closure"
    }
  ],
  "aiActions": [
    {
      "id": "check-window-elapsed",
      "name": "Check window elapsed",
      "description": "If the window end has passed and status is still running, propose closure — surface the signals collected so far and ask the user for an outcome and rationale."
    },
    {
      "id": "draft-rationale",
      "name": "Draft closure rationale",
      "description": "Read the signals and any linked attempts, then propose a one or two sentence rationale for the chosen outcome. Author still confirms."
    }
  ],
  "domain": "research",
  "entityShape": [
    "time-series",
    "has-evidence"
  ],
  "generatedFields": [
    "semanticUses"
  ]
});
