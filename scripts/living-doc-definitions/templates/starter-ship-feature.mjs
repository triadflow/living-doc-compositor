import { defineTemplate } from '../define.mjs';

export default defineTemplate({
  id: 'starter-ship-feature',
  name: 'Ship a Feature',
  title: 'Ship a Feature',
  subtitle: 'A small starting shape for one feature that needs intent, delivery focus, and a tool layer.',
  scope: 'One feature or product surface that needs to move from idea into working behavior.',
  objective: 'Make the main feature legible enough that a teammate can see what it is, what matters most, and how to work on it.',
  successCondition: 'A reader can name the primary surface, the current delivery target, and the tools used to update or render the doc.',
  templatePath: 'docs/living-doc-template-starter-ship-feature.json',
  objectiveRole: 'Seed a feature delivery doc with a primary surface and the tooling needed to work on it.',
  sections: [
    {
      id: 'status-snapshot',
      title: 'Status Snapshot',
      convergenceType: 'status-snapshot',
      role: 'Summarize feature delivery readiness without replacing the surface or tooling cards.',
      rationale: 'This section gives a small feature doc a quick readiness signal while the actual feature and tool evidence stays separate.',
    },
    {
      id: 'surface-flow',
      title: 'Design–Code–Spec Flow',
      convergenceType: 'design-code-spec-flow',
      role: 'Name the primary feature surface as a joined design, code, spec, interaction, and ticket entity.',
      rationale: 'A feature needs one concrete surface card before delivery work can be understood or handed off.',
    },
    {
      id: 'tooling',
      title: 'Tooling Surface',
      convergenceType: 'tooling-surface',
      role: 'Expose the scripts, workflows, and artifacts used to update or render the feature doc.',
      rationale: 'A teammate needs an operational tool path to keep the feature doc current instead of only reading the feature card.',
    },
  ],
  relationships: [
    {
      id: 'status-summarizes-feature',
      from: 'status-snapshot',
      to: 'design-code-spec-flow',
      relation: 'summarizes',
      rationale: 'Feature status should summarize the real surface being shipped.',
    },
    {
      id: 'tooling-supports-feature-flow',
      from: 'tooling-surface',
      to: 'design-code-spec-flow',
      relation: 'supports',
      rationale: 'The feature surface is operational only when the update/render tools are visible.',
    },
  ],
  stageSignals: [
    {
      id: 'seeding-missing-feature-surface',
      stage: 'Seeding',
      severity: 'high',
      when: 'design-code-spec-flow has no feature card',
      condition: { kind: 'section-empty', type: 'design-code-spec-flow' },
      question: 'What primary feature surface should this starter doc make tangible first?',
    },
    {
      id: 'operation-feature-without-tooling',
      stage: 'Operation',
      severity: 'medium',
      when: 'feature surface exists but tooling-surface has no tool path',
      condition: {
        kind: 'source-populated-target-empty',
        sourceType: 'design-code-spec-flow',
        targetType: 'tooling-surface',
      },
      question: 'Which script, workflow, or artifact lets a teammate update or render this feature doc?',
      relatedRelationships: ['tooling-supports-feature-flow'],
    },
    {
      id: 'judgment-feature-starter-ready',
      stage: 'Judgment',
      severity: 'high',
      when: 'feature surface and tooling are populated',
      condition: {
        kind: 'all-populated-no-high-gaps',
        types: ['design-code-spec-flow', 'tooling-surface'],
      },
      question: 'Can a teammate name the feature, current delivery target, and tools from this doc?',
      relatedRelationships: ['tooling-supports-feature-flow'],
    },
  ],
  validOperations: [
    {
      id: 'add-feature-surface',
      label: 'Add feature surface',
      stages: ['Seeding', 'Composition'],
      description: 'Add the primary design-code-spec feature card.',
      patchKind: 'card-create',
    },
    {
      id: 'add-feature-tooling',
      label: 'Add feature tooling',
      stages: ['Composition', 'Operation'],
      description: 'Add a tool card that explains how to update, render, or inspect the feature doc.',
      patchKind: 'card-create',
    },
  ],
});
