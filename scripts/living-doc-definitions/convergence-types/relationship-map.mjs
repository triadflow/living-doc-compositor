import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  id: 'relationship-map',
  name: 'Relationship Map',
  category: 'governance',
  kind: 'surface',
  description:
    'A semantic map surface for relationships that need to be inspected as structure, with Mermaid as a portable notation for one or more diagram projections.',
  structuralContract:
    'One-column card grid of relationship maps. Each card states the relationship claim, the semantic role of the map, the question it helps answer, the anchors it depends on, and one or more Mermaid diagram sources that project the relationship structure.',
  notFor: [
    'decorative diagrams',
    'screenshots or illustrations without a relationship claim',
    'diagrams that duplicate prose without improving inspection',
    'private renderer-only graph artifacts that are not part of the living-doc reasoning surface',
  ],
  promptGuidance: {
    operatingThesis:
      'Treat each map as a semantic projection: the diagram is valid only when it makes relationships inspectable that would otherwise remain implicit, diluted, or easy to misroute.',
    keepDistinct: [
      'relationship claim',
      'semantic role',
      'validation question',
      'Mermaid source',
      'living-doc anchors',
      'staleness or drift trigger',
    ],
    inspect: [
      'Check that every diagram is anchored to actual living-doc sections, criteria, invariants, issues, code, or evidence paths.',
      'Verify that the map exposes a relationship needed for reasoning, execution, repair, or proof.',
      'Look for diagrams that have become stale because the underlying process, primitive, or boundary changed.',
    ],
    update: [
      'State what relationship the map asserts before adding Mermaid source.',
      'Use semanticRole to say whether the map is descriptive, normative, diagnostic, or execution-guiding.',
      'Use validationQuestion to name the decision or inspection the map supports.',
      'Keep Mermaid source readable and directly tied to named anchors.',
    ],
    avoid: [
      'Do not use this type as a visual appendix.',
      'Do not let a diagram replace acceptance criteria, proof, or direct log inspection.',
      'Do not add maps that cannot name what would make them stale or wrong.',
      'Do not treat Mermaid syntax as the semantic source of truth; the relationship claim and anchors are the source of meaning.',
    ],
  },
  icon:
    "<path opacity='.24' d='M4 5h6v6H4zM14 13h6v6h-6zM15 4h4v4h-4z'/><path d='M10 8h3.2a3.8 3.8 0 013.8 3.8V13h-2v-1.2A1.8 1.8 0 0013.2 10H10V8zM7 11v2.2A3.8 3.8 0 0010.8 17H14v-2h-3.2A1.8 1.8 0 019 13.2V11H7z'/>",
  iconColor: '#0f766e',
  projection: 'card-grid',
  columns: 1,
  sources: [
    {
      key: 'sectionIds',
      entityType: 'section-ref',
      label: 'Sections',
    },
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
      statusSet: 'model-integrity',
    },
  ],
  textFields: [
    {
      key: 'claim',
      label: 'Relationship claim',
    },
    {
      key: 'semanticRole',
      label: 'Semantic role',
    },
    {
      key: 'validationQuestion',
      label: 'Validation question',
    },
    {
      key: 'driftRisk',
      label: 'Drift risk',
    },
  ],
  detailsFields: [
    {
      key: 'diagrams',
      label: 'Mermaid diagrams',
    },
  ],
  domain: 'governance',
  entityShape: ['relationship-projection', 'diagram-backed-map'],
});
