import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  id: 'regression-boundary',
  name: 'Regression Boundary',
  category: 'governance',
  kind: 'surface',
  description:
    'A governance surface for mistakes that are no longer legitimate because the objective, acceptance criteria, or invariants now explicitly forbid them.',
  structuralContract:
    'One-column card grid of forbidden-regression boundaries. Each card names the mistake, states the explicit system boundary that now prevents it, names the proof or artifact that would expose a violation, and says what must happen instead.',
  notFor: [
    'general risks that are still ambiguous',
    'ordinary backlog tasks',
    'acceptance criteria that define positive completion',
    'soft preferences without objective or invariant support',
  ],
  promptGuidance: {
    operatingThesis:
      'Treat this section as the anti-regression contract: once a boundary is explicit here, repeating the mistake is a violation of the living-doc objective, not a missing clarification.',
    keepDistinct: [
      'forbidden mistake',
      'explicit boundary',
      'violation signal',
      'required replacement behavior',
      'owning objective, invariant, criterion, or issue',
    ],
    inspect: [
      'Read the objective, successCondition, acceptance criteria, and invariants before adding a boundary.',
      'Check whether the mistake is truly no longer legitimate or merely still under discussion.',
      'Inspect proof artifacts, logs, issue state, and rendered docs before marking a boundary satisfied.',
    ],
    update: [
      'Write the boundary in direct language: what must not happen and what must happen instead.',
      'Tie each card to the objective, invariant, criterion, issue, or proof artifact that makes the boundary enforceable.',
      'Use violationSignal to name the concrete artifact pattern that would reveal regression.',
    ],
    avoid: [
      'Do not use this as a blame log.',
      'Do not add vague style preferences or reminders.',
      'Do not soften a forbidden regression into advisory language.',
      'Do not mark a boundary satisfied when no enforcement or proof surface exists.',
    ],
  },
  icon:
    "<path opacity='.24' d='M12 3l8 4v5c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V7l8-4z'/><path d='M8 8.7L9.3 7.4 12 10.1l2.7-2.7L16 8.7 13.3 11.4 16 14.1l-1.3 1.3L12 12.7l-2.7 2.7L8 14.1l2.7-2.7L8 8.7z'/>",
  iconColor: '#b91c1c',
  projection: 'card-grid',
  columns: 1,
  sources: [
    {
      key: 'criterionIds',
      entityType: 'section-ref',
      label: 'Acceptance criteria',
    },
    {
      key: 'invariantIds',
      entityType: 'invariant',
      label: 'Invariants',
    },
    {
      key: 'ticketIds',
      entityType: 'ticket',
      label: 'Tickets',
    },
    {
      key: 'codeRefs',
      entityType: 'code-file',
      label: 'Code references',
    },
  ],
  statusFields: [
    {
      key: 'status',
      statusSet: 'acceptance-state',
    },
  ],
  textFields: [
    {
      key: 'forbiddenMistake',
      label: 'Forbidden mistake',
    },
    {
      key: 'boundary',
      label: 'Boundary',
    },
    {
      key: 'violationSignal',
      label: 'Violation signal',
    },
    {
      key: 'requiredInstead',
      label: 'Required instead',
    },
    {
      key: 'proofSurface',
      label: 'Proof surface',
    },
  ],
  domain: 'governance',
  entityShape: ['objective-bound', 'anti-regression'],
});
