import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  id: 'acceptance-criteria',
  name: 'Acceptance Criteria',
  category: 'governance',
  kind: 'surface',
  description:
    'Objective-bound criteria that define what must be true before the living doc objective can be accepted as complete.',
  structuralContract:
    'One-column card grid of objective-acceptance criteria. Each card must conserve one accountable term from the objective or successCondition, state the proof required for acceptance, and say how the result will be judged. This is a closure contract, not a task checklist.',
  notFor: [
    'implementation task lists',
    'nice-to-have requirements not present in the objective',
    'proof evidence itself',
    'generic QA checklists detached from the objective',
  ],
  promptGuidance: {
    operatingThesis:
      "Treat acceptance criteria as the objective's closure boundary: every criterion must answer what would make one accountable objective term accepted as complete.",
    keepDistinct: [
      'objective or success-condition term',
      'criterion statement',
      'required proof',
      'acceptance test',
      'current acceptance state',
    ],
    inspect: [
      'Read the objective and successCondition verbatim before adding or changing criteria.',
      'Check whether every criterion maps to an accountable objective term rather than to convenient implementation work.',
      'Compare proof cards, rendered artifacts, tests, commits, and issue state against the acceptance test before marking a criterion satisfied.',
    ],
    update: [
      'Write each criterion as a condition that must be true for objective closure.',
      'Preserve the exact objective language in `objectiveTerm` when possible.',
      'Use `proofRequired` to name the evidence shape, not the implementation step.',
      'Mark a criterion `out-of-scope` only when the objective or successCondition explicitly excludes it.',
    ],
    avoid: [
      'Do not use acceptance criteria as a backlog.',
      'Do not create criteria from what has already been implemented unless the objective actually requires it.',
      'Do not mark criteria satisfied from closed issues, rendered pages, or green tests alone when the proof requirement is broader.',
      'Do not loosen the criterion to fit available evidence.',
    ],
  },
  icon:
    "<rect x='4' y='4' width='16' height='16' rx='3' opacity='.24'/><path d='M8 12.2l2.3 2.3L16.2 8.6l1.4 1.4-7.3 7.3-3.7-3.7z'/><path d='M7 7h8v1.8H7z' opacity='.75'/>",
  iconColor: '#0f766e',
  projection: 'card-grid',
  columns: 1,
  sources: [
    {
      key: 'facetIds',
      entityType: 'objective-facet',
      label: 'Objective facets',
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
    {
      key: 'notes',
      entityType: null,
      label: null,
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
      key: 'objectiveTerm',
      label: 'Objective term',
    },
    {
      key: 'criterion',
      label: 'Criterion',
    },
    {
      key: 'proofRequired',
      label: 'Proof required',
    },
    {
      key: 'acceptanceTest',
      label: 'Acceptance test',
    },
  ],
  domain: 'governance',
  entityShape: ['objective-bound', 'closure-gate'],
});
