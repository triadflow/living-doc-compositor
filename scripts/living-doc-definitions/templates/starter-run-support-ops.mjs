import { defineTemplate } from '../define.mjs';

export default defineTemplate({
  id: 'starter-run-support-ops',
  name: 'Run Support Ops',
  title: 'Run Support Ops',
  subtitle: 'A small starting shape for support work where request flow and operator tooling matter first.',
  scope: 'One support or operations domain where requests enter through a mediated path and operators need a clear tool layer.',
  objective: 'Make the request path and operator tool layer legible enough that someone can quickly understand how the support domain currently runs.',
  successCondition: 'A reader can see how a request enters the system, who or what fulfills it, and which tools the operators trust.',
  templatePath: 'docs/living-doc-template-starter-run-support-ops.json',
  objectiveRole: 'Seed an operations doc with request flow and the operator tooling that supports it.',
  sections: [
    {
      id: 'status-snapshot',
      title: 'Status Snapshot',
      convergenceType: 'status-snapshot',
      role: 'Summarize support readiness without carrying request-flow details.',
      rationale: 'This section keeps operational status visible while request flow and tool support remain inspectable.',
    },
    {
      id: 'operations',
      title: 'Mediated Operation',
      convergenceType: 'operation',
      role: 'Describe how requests enter and move through the support domain.',
      rationale: 'The mediated operation is the core of the support domain because it names how work enters, is fulfilled, and moves next.',
    },
    {
      id: 'tooling',
      title: 'Tooling Surface',
      convergenceType: 'tooling-surface',
      role: 'Expose trusted tools used by operators to run or inspect the request flow.',
      rationale: 'Operators need visible tooling so the support flow can be run without rediscovering scripts or workflows.',
    },
  ],
  relationships: [
    {
      id: 'status-summarizes-operation',
      from: 'status-snapshot',
      to: 'operation',
      relation: 'summarizes',
      rationale: 'Support status should summarize the actual mediated operation.',
    },
    {
      id: 'tooling-supports-operation',
      from: 'tooling-surface',
      to: 'operation',
      relation: 'supports',
      rationale: 'A request flow is operational only when operators can see the trusted tools that support it.',
    },
  ],
  stageSignals: [
    {
      id: 'seeding-missing-operation',
      stage: 'Seeding',
      severity: 'high',
      when: 'operation has no request-flow cards',
      condition: { kind: 'section-empty', type: 'operation' },
      question: 'What first request path or mediated operation makes this support domain tangible?',
    },
    {
      id: 'operation-without-tooling',
      stage: 'Operation',
      severity: 'medium',
      when: 'operation exists but tooling-surface has no trusted tool card',
      condition: {
        kind: 'source-populated-target-empty',
        sourceType: 'operation',
        targetType: 'tooling-surface',
      },
      question: 'Which tool does the operator trust to run, inspect, or update this support flow?',
      relatedRelationships: ['tooling-supports-operation'],
    },
    {
      id: 'judgment-support-starter-ready',
      stage: 'Judgment',
      severity: 'high',
      when: 'operation and tooling are populated',
      condition: {
        kind: 'all-populated-no-high-gaps',
        types: ['operation', 'tooling-surface'],
      },
      question: 'Can a reader understand how requests enter and which tools operators trust?',
      relatedRelationships: ['tooling-supports-operation'],
    },
  ],
  validOperations: [
    {
      id: 'add-operation-card',
      label: 'Add operation card',
      stages: ['Seeding', 'Composition'],
      description: 'Add a request-flow card naming the intake path, current support, and next step.',
      patchKind: 'card-create',
    },
    {
      id: 'add-operator-tooling',
      label: 'Add operator tooling',
      stages: ['Composition', 'Operation'],
      description: 'Add the trusted script, workflow, or tool used by operators.',
      patchKind: 'card-create',
    },
  ],
});
