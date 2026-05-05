export function defineTemplate(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new TypeError('defineTemplate expects a definition object');
  }
  if (!definition.id) throw new TypeError('template definition missing id');
  if (!definition.templatePath) throw new TypeError(`${definition.id} missing templatePath`);
  if (!Array.isArray(definition.sections) || definition.sections.length === 0) {
    throw new TypeError(`${definition.id} must define sections`);
  }

  return normalizeTemplateDefinition(definition);
}

function normalizeTemplateDefinition(definition) {
  return {
    id: definition.id,
    name: definition.name || definition.id,
    templatePath: definition.templatePath,
    objectiveRole: definition.objectiveRole || '',
    sections: definition.sections.map((section) => ({
      id: section.id,
      convergenceType: section.convergenceType,
      role: section.role || '',
      required: section.required !== false,
    })),
    relationships: (definition.relationships || []).map((relationship) => ({
      id: relationship.id,
      from: relationship.from,
      to: relationship.to,
      relation: relationship.relation,
      rationale: relationship.rationale || '',
      evidence: relationship.evidence || null,
      repairOperationIds: relationship.repairOperationIds || [],
      required: relationship.required !== false,
    })),
    stageSignals: (definition.stageSignals || []).map((signal) => ({
      id: signal.id,
      stage: signal.stage,
      when: signal.when || '',
      condition: signal.condition || null,
      severity: signal.severity || 'medium',
      question: signal.question || '',
      relatedRelationships: signal.relatedRelationships || [],
    })),
    validOperations: (definition.validOperations || []).map((operation) => ({
      id: operation.id,
      label: operation.label || operation.id,
      stages: operation.stages || [],
      description: operation.description || '',
      patchKind: operation.patchKind || '',
    })),
  };
}
