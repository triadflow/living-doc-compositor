import { defineTemplate } from '../define.mjs';

export default defineTemplate({
  id: 'starter-write-book',
  name: 'Write a Book',
  title: 'Write a Book',
  subtitle: 'A small starting shape for drafting a book without losing chapter focus, momentum, and the tool layer.',
  scope: 'One manuscript or book project moving from outline into drafted chapters.',
  objective: 'Make the manuscript legible enough that someone can see what the book is, which chapters are moving, and how the work is being supported.',
  successCondition: 'A reader can identify the current chapter set, the state of each major drafting unit, and the tools used to keep the manuscript moving.',
  templatePath: 'docs/living-doc-template-starter-write-book.json',
  objectiveRole: 'Seed a book drafting doc with chapter production state and tooling.',
  sections: [
    {
      id: 'status-snapshot',
      title: 'Status Snapshot',
      convergenceType: 'status-snapshot',
      role: 'Summarize manuscript drafting momentum without carrying chapter details.',
      rationale: 'This section keeps drafting status visible while chapters and tooling remain inspectable.',
    },
    {
      id: 'chapter-flow',
      title: 'Chapter Flow',
      convergenceType: 'content-production',
      role: 'Track major chapter or drafting units as production cards.',
      rationale: 'A book draft needs chapter-level production cards so momentum and dependencies are visible.',
    },
    {
      id: 'tooling',
      title: 'Tooling Surface',
      convergenceType: 'tooling-surface',
      role: 'Expose tools used to keep drafting work moving.',
      rationale: 'Drafting claims need an operational tool layer so chapter state can be updated and inspected.',
    },
  ],
  relationships: [
    {
      id: 'status-summarizes-chapters',
      from: 'status-snapshot',
      to: 'content-production',
      relation: 'summarizes',
      rationale: 'Book status should summarize the current chapter production state.',
    },
    {
      id: 'tooling-supports-chapter-flow',
      from: 'tooling-surface',
      to: 'content-production',
      relation: 'supports',
      rationale: 'Chapter production needs tools for drafting, tracking, or rendering the manuscript.',
    },
  ],
  stageSignals: [
    {
      id: 'seeding-missing-chapters',
      stage: 'Seeding',
      severity: 'high',
      when: 'content-production has no chapter cards',
      condition: { kind: 'section-empty', type: 'content-production' },
      question: 'What first chapter or drafting unit makes this book project tangible?',
    },
    {
      id: 'operation-chapters-without-tooling',
      stage: 'Operation',
      severity: 'medium',
      when: 'chapter flow exists but tooling-surface has no tool cards',
      condition: {
        kind: 'source-populated-target-empty',
        sourceType: 'content-production',
        targetType: 'tooling-surface',
      },
      question: 'Which tool keeps the chapter work moving or inspectable?',
      relatedRelationships: ['tooling-supports-chapter-flow'],
    },
    {
      id: 'judgment-book-starter-ready',
      stage: 'Judgment',
      severity: 'high',
      when: 'chapter flow and tooling are populated',
      condition: {
        kind: 'all-populated-no-high-gaps',
        types: ['content-production', 'tooling-surface'],
      },
      question: 'Can a reader identify the chapter set, their state, and the tools supporting the draft?',
      relatedRelationships: ['tooling-supports-chapter-flow'],
    },
  ],
  validOperations: [
    {
      id: 'add-chapter-card',
      label: 'Add chapter card',
      stages: ['Seeding', 'Composition'],
      description: 'Add a chapter or drafting unit with synopsis, target, and dependencies.',
      patchKind: 'card-create',
    },
    {
      id: 'add-drafting-tooling',
      label: 'Add drafting tooling',
      stages: ['Operation', 'Refresh'],
      description: 'Add a tool used to draft, render, or inspect manuscript progress.',
      patchKind: 'card-create',
    },
  ],
});
