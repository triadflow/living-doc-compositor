import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  id: 'objective-closure-plan',
  name: 'Objective Closure Plan',
  category: 'governance',
  kind: 'surface',
  description:
    'A living-doc-native planning surface that connects an objective and success condition to closure gates, next goal candidates, blockers, source anchors, Mermaid planning diagrams, and a deterministic freshness check.',
  structuralContract:
    'One-column card grid of objective closure plans. Each card must name the planning question, objective and success-condition references, watched living-doc sections or cards, closure gates, next goal candidates, freshness basis, stale conditions, checker state, and one or more Mermaid diagrams. This is a planning graph tied to living-doc state, not a generic diagram appendix or a duplicate issue tracker.',
  notFor: [
    'generic Mermaid relationship maps',
    'free-form progress summaries',
    'date or effort forecasts',
    'duplicating acceptance criteria or issue lanes as a second source of truth',
    'checking live GitHub, AWS, or other source systems directly',
  ],
  promptGuidance: {
    operatingThesis:
      'Treat objective closure planning as a typed, checkable projection of the current living doc: the plan is useful only if it preserves objective language, references source cards, states remaining gates, and can prove whether it is fresh against the watched document content.',
    keepDistinct: [
      'objective and success-condition references',
      'watched living-doc sections and cards',
      'closure gates',
      'next goal candidates',
      'blocking issue or proof references',
      'Mermaid diagram source',
      'freshness fingerprint and check result',
      'live source-system sync, which happens before this checker runs',
    ],
    inspect: [
      'Read objective, successCondition, issue lanes, acceptance criteria, proof ladder, and closure path before updating the plan.',
      'Verify that every closure gate references existing living-doc cards or explicit source anchors.',
      'Check whether the plan card freshness fingerprint still matches the current watched living-doc content.',
      'Treat stale freshness as a planning update requirement, not as proof that production state changed.',
    ],
    update: [
      'Use one card for one objective closure plan unless the document has genuinely separate objective scopes.',
      'Keep Mermaid diagrams execution-guiding and anchored to named gates, issues, criteria, proof rungs, or source sections.',
      'Record watchedSections and watchedCards so the checker has a deterministic basis.',
      'Update the checker fingerprint after changing watched objective, criteria, issue, proof, or closure-gate content.',
    ],
    avoid: [
      'Do not make the Mermaid diagram the source of truth.',
      'Do not query GitHub, AWS, or logs from the freshness checker; update the living doc from source evidence first.',
      'Do not hide unresolved gates behind a broad current or ready state.',
      'Do not convert this type into a backlog; next goal candidates must explain how they move objective closure.',
    ],
  },
  icon:
    "<path opacity='.22' d='M4 4h16v16H4z'/><path d='M7 7h5v2H7zm0 4h5v2H7zm0 4h4v2H7z'/><path d='M14 7h3a3 3 0 013 3v1h-2v-1a1 1 0 00-1-1h-3V7zm0 8h3a1 1 0 001-1v-1h2v1a3 3 0 01-3 3h-3v-2z'/><path d='M13 11h5v2h-5z'/>",
  iconColor: '#7c3aed',
  projection: 'card-grid',
  columns: 1,
  sources: [
    {
      key: 'ticketIds',
      entityType: 'ticket',
      label: 'Tickets',
    },
    {
      key: 'sectionIds',
      entityType: 'section-ref',
      label: 'Watched sections',
    },
    {
      key: 'criterionIds',
      entityType: 'section-ref',
      label: 'Acceptance criteria',
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
      key: 'state',
      statusSet: 'closure-plan-state',
    },
  ],
  textFields: [
    {
      key: 'managementSummary',
      label: 'Management summary',
    },
    {
      key: 'planningQuestion',
      label: 'Planning question',
    },
    {
      key: 'objectiveRef',
      label: 'Objective reference',
    },
    {
      key: 'successConditionRef',
      label: 'Success condition reference',
    },
    {
      key: 'freshnessBasis',
      label: 'Freshness basis',
    },
    {
      key: 'staleWhen',
      label: 'Stale when',
    },
  ],
  detailsFields: [
    {
      key: 'watchedSections',
      label: 'Watched sections',
    },
    {
      key: 'watchedCards',
      label: 'Watched cards',
    },
    {
      key: 'closureGates',
      label: 'Closure gates',
    },
    {
      key: 'nextGoalCandidates',
      label: 'Next goal candidates',
    },
    {
      key: 'check',
      label: 'Freshness check',
    },
    {
      key: 'diagrams',
      label: 'Mermaid diagrams',
    },
  ],
  domain: 'governance',
  entityShape: ['objective-bound', 'closure-plan', 'diagram-backed-map', 'freshness-check'],
  metadata: {
    authoringSkill: {
      name: 'objective-closure-plan',
      path: '.agents/skills/objective-closure-plan/SKILL.md',
    },
  },
});
