function arr(value) {
  return Array.isArray(value) ? value : [];
}

export function commitEvidenceBlocked(commit = {}) {
  return commit.blocked === true || ['blocked', 'failed'].includes(commit.status);
}

export function commitEvidenceSatisfied(commit = {}, hardFacts = {}) {
  if (commitEvidenceBlocked(commit)) return false;
  if (commit.exemption?.approved === true || commit.notRequired === true) return true;

  if (commit.source === 'commit-intent-output-contract') {
    return Boolean(commit.sha)
      && commit.approved === true
      && commit.status === 'approved'
      && commit.validationOk !== false;
  }

  return Boolean(commit.sha || hardFacts.commitEvidencePresent === true);
}

export function commitEvidenceRequired(commit = {}, hardFacts = {}, sourceChanged = false) {
  return sourceChanged === true || hardFacts.sourceFilesChanged === true || commit.required === true;
}

export function commitGateFromCommitEvidence({ commit = {}, hardFacts = {}, sourceChanged = false } = {}) {
  const required = commitEvidenceRequired(commit, hardFacts, sourceChanged);
  if (commitEvidenceBlocked(commit)) {
    return {
      required: true,
      status: 'blocked',
      evidencePresent: false,
      resultPath: commit.resultPath || null,
      resultRef: commit.resultRef || null,
      validationPath: commit.validationPath || null,
      validationRef: commit.validationRef || null,
      reasonCode: commit.reasonCode || 'commit-intent-gate-blocked',
      basis: arr(commit.basis),
    };
  }
  if (commitEvidenceSatisfied(commit, hardFacts)) {
    return {
      required,
      status: 'satisfied',
      evidencePresent: true,
      resultPath: commit.resultPath || null,
      resultRef: commit.resultRef || null,
      validationPath: commit.validationPath || null,
      validationRef: commit.validationRef || null,
      reasonCode: commit.reasonCode || null,
      basis: arr(commit.basis),
    };
  }
  if (required) {
    return {
      required: true,
      status: 'missing',
      evidencePresent: false,
    };
  }
  return {
    required: false,
    status: 'not-required',
    evidencePresent: false,
  };
}
