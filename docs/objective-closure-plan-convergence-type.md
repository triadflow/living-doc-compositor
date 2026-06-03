# Objective Closure Plan Convergence Type

`objective-closure-plan` is a governance surface for planning the path from a living-doc objective to closure.

It should be used when a living doc needs one checkable planning card that connects:

- the root `objective`
- the root `successCondition`
- watched issue, acceptance, proof, and closure sections
- closure gates
- next goal candidates
- a Mermaid planning diagram
- a stored freshness fingerprint

The freshness checker is document-local. It does not query GitHub, AWS, logs, dashboards, or other source systems. Source-system evidence should update the living doc first; the checker then verifies whether the plan still matches the watched living-doc content.

## Sample Card

```json
{
  "id": "plan-production-close",
  "name": "Close production path",
  "state": "current",
  "managementSummary": "The production path is mostly proven, but not formally closed. Management should read the remaining work as final audit and closure alignment: resolve the residual owner-history question, refresh governed deploy proof, and audit all-account rollout against the objective.",
  "planningQuestion": "What remaining path closes the living-doc objective?",
  "objectiveRef": "root.objective",
  "successConditionRef": "root.successCondition",
  "freshnessBasis": "Objective, success condition, issue lanes, acceptance criteria, proof ladder, and closure path.",
  "staleWhen": "Any watched section, watched card, objective, or success condition changes without refreshing the checker fingerprint.",
  "watchedSections": [
    "issue-lanes",
    "acceptance-criteria",
    "proof-ladder",
    "closure-path"
  ],
  "watchedCards": [
    "criterion-live-mobile-visible"
  ],
  "closureGates": [
    {
      "id": "gate-live-mobile-visible",
      "label": "Accepted result becomes mobile-visible",
      "sourceCardIds": ["criterion-live-mobile-visible"],
      "exitCriterion": "The criterion reaches satisfied state with source evidence."
    }
  ],
  "nextGoalCandidates": [
    {
      "id": "goal-live-mobile-visible",
      "ticketId": "296",
      "whyNext": "It is the first unsatisfied closure criterion.",
      "doneWhen": "The production lane proves accepted output reaches mobile-visible state."
    }
  ],
  "check": [
    {
      "basisFingerprint": "sha256:...",
      "lastCheckedAt": "2026-06-03T00:00:00.000Z",
      "status": "current"
    }
  ],
  "diagrams": [
    {
      "title": "Closure path",
      "text": "flowchart LR\n  Objective[\"Objective\"] --> Criteria[\"Acceptance criteria\"]\n  Criteria --> Goal[\"Next goal\"]\n  Goal --> Proof[\"Proof update\"]\n  Proof --> Close[\"Closure decision\"]"
    }
  ]
}
```

## Checker

Run:

```bash
node scripts/check-objective-closure-plan.mjs docs/example-living-doc.json
```

The checker returns `current` only when every objective-closure-plan card has a stored `basisFingerprint` matching the current watched living-doc content.

The checker fingerprints:

- `objective`
- `successCondition`
- watched sections
- watched cards

It intentionally excludes the `objective-closure-plan` section itself so updating the stored fingerprint does not make the plan stale again.
