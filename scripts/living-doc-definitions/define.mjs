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

export function defineConvergenceType(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new TypeError('defineConvergenceType expects a definition object');
  }
  if (!definition.id) throw new TypeError('convergence type definition missing id');
  if (!definition.name) throw new TypeError(`${definition.id} missing name`);
  if (!definition.category) throw new TypeError(`${definition.id} missing category`);
  if (!definition.kind) throw new TypeError(`${definition.id} missing kind`);
  if (!['act', 'surface'].includes(definition.kind)) {
    throw new TypeError(`${definition.id} kind must be act or surface`);
  }
  if (!definition.description) throw new TypeError(`${definition.id} missing description`);
  if (!definition.structuralContract) throw new TypeError(`${definition.id} missing structuralContract`);
  if (!definition.promptGuidance || typeof definition.promptGuidance !== 'object') {
    throw new TypeError(`${definition.id} missing promptGuidance`);
  }
  if (!definition.icon) throw new TypeError(`${definition.id} missing icon`);
  if (!definition.projection) throw new TypeError(`${definition.id} missing projection`);
  if (!['card-grid', 'edge-table'].includes(definition.projection)) {
    throw new TypeError(`${definition.id} projection must be card-grid or edge-table`);
  }

  return normalizeConvergenceTypeDefinition(definition);
}

function normalizeTemplateDefinition(definition) {
  return {
    id: definition.id,
    name: definition.name || definition.id,
    title: definition.title || definition.name || definition.id,
    subtitle: definition.subtitle || '',
    scope: definition.scope || '',
    objective: definition.objective || '',
    successCondition: definition.successCondition || '',
    templatePath: definition.templatePath,
    objectiveRole: definition.objectiveRole || '',
    sections: definition.sections.map((section) => ({
      id: section.id,
      title: section.title || section.id,
      convergenceType: section.convergenceType,
      role: section.role || '',
      rationale: section.rationale || '',
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

function normalizeConvergenceTypeDefinition(definition) {
  const normalized = {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    kind: definition.kind,
    description: definition.description,
    structuralContract: definition.structuralContract,
    notFor: normalizeStringArray(definition.notFor),
    promptGuidance: normalizePromptGuidance(definition.id, definition.promptGuidance),
    icon: definition.icon,
    iconColor: definition.iconColor || '#475569',
    projection: definition.projection,
    domain: definition.domain || definition.category,
    entityShape: normalizeStringArray(definition.entityShape),
  };

  if (definition.projection === 'card-grid') {
    normalized.columns = definition.columns || 1;
    normalized.sources = normalizeEntitySources(definition.sources);
    normalized.statusFields = normalizeStatusFields(definition.statusFields);
    if (definition.textFields) normalized.textFields = normalizeLabeledFields(definition.textFields);
    if (definition.detailsFields) normalized.detailsFields = normalizeLabeledFields(definition.detailsFields);
  } else {
    normalized.sourceA = normalizeEntitySource(definition.sourceA, 'sourceA');
    if (definition.sourceB) normalized.sourceB = normalizeEntitySource(definition.sourceB, 'sourceB');
    if (definition.edgeStatus) normalized.edgeStatus = normalizeStatusField(definition.edgeStatus, 'edgeStatus');
  }

  if (definition.derived !== undefined) normalized.derived = Boolean(definition.derived);
  if (definition.derivedFrom) normalized.derivedFrom = normalizeStringArray(definition.derivedFrom);
  if (definition.aiActions) normalized.aiActions = normalizeAiActions(definition.aiActions);
  if (definition.aiProfiles) normalized.aiProfiles = normalizeAiProfiles(definition.aiProfiles);
  if (definition.relationshipRoles) normalized.relationshipRoles = clonePlain(definition.relationshipRoles);
  if (definition.validRepairBehaviors) normalized.validRepairBehaviors = clonePlain(definition.validRepairBehaviors);
  if (definition.columnHeaders) normalized.columnHeaders = clonePlain(definition.columnHeaders);
  if (definition.edgeNotes) normalized.edgeNotes = clonePlain(definition.edgeNotes);
  if (definition.nestable !== undefined) normalized.nestable = Boolean(definition.nestable);
  if (definition.metadata) normalized.metadata = clonePlain(definition.metadata);

  return Object.freeze({
    id: definition.id,
    registryEntry: deepFreeze(normalized),
    generatedFields: Object.freeze(normalizeStringArray(definition.generatedFields)),
  });
}

function normalizePromptGuidance(typeId, guidance) {
  const required = ['operatingThesis', 'keepDistinct', 'inspect', 'update', 'avoid'];
  for (const key of required) {
    if (!(key in guidance)) throw new TypeError(`${typeId}.promptGuidance missing ${key}`);
  }
  if (typeof guidance.operatingThesis !== 'string' || !guidance.operatingThesis.trim()) {
    throw new TypeError(`${typeId}.promptGuidance.operatingThesis must be a non-empty string`);
  }
  return {
    operatingThesis: guidance.operatingThesis,
    keepDistinct: normalizeStringArray(guidance.keepDistinct, `${typeId}.promptGuidance.keepDistinct`),
    inspect: normalizeStringArray(guidance.inspect, `${typeId}.promptGuidance.inspect`),
    update: normalizeStringArray(guidance.update, `${typeId}.promptGuidance.update`),
    avoid: normalizeStringArray(guidance.avoid, `${typeId}.promptGuidance.avoid`),
  };
}

function normalizeEntitySources(sources = []) {
  if (!Array.isArray(sources)) throw new TypeError('sources must be an array');
  return sources.map((source, index) => normalizeEntitySource(source, `sources[${index}]`));
}

function normalizeEntitySource(source, label) {
  if (!source || typeof source !== 'object') throw new TypeError(`${label} must be an object`);
  if (!source.key) throw new TypeError(`${label} missing key`);
  return {
    key: source.key,
    entityType: source.entityType ?? null,
    label: source.label ?? null,
    ...(source.resolve !== undefined ? { resolve: Boolean(source.resolve) } : {}),
    ...(source.displayKey ? { displayKey: source.displayKey } : {}),
    ...(source.valueKey ? { valueKey: source.valueKey } : {}),
  };
}

function normalizeStatusFields(fields = []) {
  if (!Array.isArray(fields)) throw new TypeError('statusFields must be an array');
  return fields.map((field, index) => normalizeStatusField(field, `statusFields[${index}]`));
}

function normalizeStatusField(field, label) {
  if (!field || typeof field !== 'object') throw new TypeError(`${label} must be an object`);
  if (!field.key) throw new TypeError(`${label} missing key`);
  if (!field.statusSet) throw new TypeError(`${label} missing statusSet`);
  return {
    key: field.key,
    statusSet: field.statusSet,
  };
}

function normalizeLabeledFields(fields = []) {
  if (!Array.isArray(fields)) throw new TypeError('labeled fields must be an array');
  return fields.map((field, index) => {
    if (!field || typeof field !== 'object') throw new TypeError(`field[${index}] must be an object`);
    if (!field.key) throw new TypeError(`field[${index}] missing key`);
    return {
      key: field.key,
      label: field.label || field.key,
    };
  });
}

function normalizeAiActions(actions = []) {
  if (!Array.isArray(actions)) throw new TypeError('aiActions must be an array');
  return actions.map((action, index) => {
    if (!action || typeof action !== 'object') throw new TypeError(`aiActions[${index}] must be an object`);
    if (!action.id) throw new TypeError(`aiActions[${index}] missing id`);
    if (!action.name) throw new TypeError(`aiActions[${index}] missing name`);
    if (!action.description) throw new TypeError(`aiActions[${index}] missing description`);
    return {
      id: action.id,
      name: action.name,
      description: action.description,
    };
  });
}

function normalizeAiProfiles(profiles = []) {
  if (!Array.isArray(profiles)) throw new TypeError('aiProfiles must be an array');
  return profiles.map((profile, index) => {
    if (!profile || typeof profile !== 'object') throw new TypeError(`aiProfiles[${index}] must be an object`);
    if (!profile.id) throw new TypeError(`aiProfiles[${index}] missing id`);
    if (!profile.name) throw new TypeError(`aiProfiles[${index}] missing name`);
    if (!profile.description) throw new TypeError(`aiProfiles[${index}] missing description`);
    if (!profile.slot) throw new TypeError(`aiProfiles[${index}] missing slot`);
    return {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      slot: profile.slot,
      defaultVisible: Boolean(profile.defaultVisible),
    };
  });
}

function normalizeStringArray(value = [], label = 'value') {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((item) => String(item));
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}
