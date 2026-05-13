export const LIFECYCLE_ROUTING_POLICY_RULES = [
  {
    id: 'approved-closure-review-closes-lifecycle',
    unitId: 'closure-review',
    role: 'closure-review',
    terminalActionKind: 'closed',
    selectedBy: 'closure-review',
    reasonCode: ({ closureReview }) => closureReview?.review?.reasonCode || 'closure-review-approved',
    when: ({ classification, closureReviewApproved, commitRequired, prReviewRequired, prReviewSatisfied }) => (
      classification === 'closed'
      && closureReviewApproved === true
      && commitRequired !== true
      && (prReviewRequired !== true || prReviewSatisfied === true)
    ),
  },
  {
    id: 'user-stop-terminal',
    terminalActionKind: 'user-stopped',
    selectedBy: 'user-stop',
    reasonCode: ({ reasonCode }) => reasonCode || 'user-stopped',
    when: ({ classification }) => classification === 'user-stopped',
  },
  {
    id: 'blocked-commit-intent-gate-needs-continuation',
    unitId: 'continuation-inference',
    role: 'continuation',
    reasonCode: ({ commitGate, reasonCode }) => commitGate?.reasonCode || reasonCode || 'commit-intent-gate-blocked',
    when: ({ classification, commitBlocked }) => (
      ['closure-candidate', 'resumable', 'repairable', 'closed'].includes(classification)
      && commitBlocked === true
    ),
  },
  {
    id: 'source-side-effect-before-review',
    unitId: 'commit-intent',
    role: 'commit-intent',
    reasonCode: ({ classification }) => `${classification || 'reviewer'}-source-changes-require-commit-evidence`,
    when: ({ classification, commitRequired }) => (
      ['closure-candidate', 'resumable', 'repairable', 'closed'].includes(classification)
      && commitRequired === true
    ),
  },
  {
    id: 'blocked-pr-review-gate-needs-continuation',
    unitId: 'continuation-inference',
    role: 'continuation',
    reasonCode: ({ prReviewGate, reasonCode }) => prReviewGate?.reasonCode || reasonCode || 'pr-review-gate-blocked',
    when: ({ prReviewRequired, prReviewSatisfied, prReviewBlocked, prReviewGateMentioned }) => (
      prReviewRequired === true
      && prReviewSatisfied !== true
      && prReviewBlocked === true
      && prReviewGateMentioned === true
    ),
  },
  {
    id: 'required-pr-review-after-commit',
    unitId: 'pr-review',
    role: 'pr-review',
    reasonCode: ({ prReviewGateMentioned, reasonCode }) => (
      prReviewGateMentioned ? reasonCode || 'pr-review-policy-gate-missing' : 'pr-review-required-by-run-policy'
    ),
    when: ({ classification, commitRequired, prReviewRequired, prReviewSatisfied, prReviewBlocked }) => (
      ['closure-candidate', 'resumable', 'repairable', 'closed'].includes(classification)
      && commitRequired !== true
      && prReviewRequired === true
      && prReviewSatisfied !== true
      && prReviewBlocked !== true
    ),
  },
  {
    id: 'closure-review-denied-needs-continuation',
    unitId: 'continuation-inference',
    role: 'continuation',
    reasonCode: ({ closureReview }) => closureReview?.review?.reasonCode || 'closure-review-denied',
    when: ({ closureReviewDenied }) => closureReviewDenied === true,
  },
  {
    id: 'closure-review-after-preconditions',
    unitId: 'closure-review',
    role: 'closure-review',
    reasonCode: ({ classification, reasonCode }) => (
      classification === 'closed' ? 'reviewer-closed-requires-final-closure-review' : reasonCode || 'closure-candidate-requests-closure-review'
    ),
    when: ({ classification, commitRequired, prReviewRequired, prReviewSatisfied, closureReviewMentioned, commitPreconditionMentioned }) => (
      ['closed', 'closure-candidate', 'resumable'].includes(classification)
      && (classification === 'closed' || closureReviewMentioned === true)
      && commitRequired !== true
      && commitPreconditionMentioned !== true
      && (prReviewRequired !== true || prReviewSatisfied === true)
    ),
  },
  {
    id: 'explicit-controller-closure-review',
    unitId: 'closure-review',
    role: 'closure-review',
    reasonCode: ({ reasonCode }) => reasonCode || 'controller-owned-closure-review-required',
    when: ({ explicitControllerClosure, preconditionPending }) => (
      explicitControllerClosure === true
      && preconditionPending !== true
    ),
  },
  {
    id: 'blocked-terminal-classification-needs-continuation',
    unitId: 'continuation-inference',
    role: 'continuation',
    reasonCode: ({ reasonCode, classification }) => reasonCode || classification || 'terminal-classification-requires-continuation',
    when: ({ classification }) => ['true-block', 'pivot', 'deferred', 'budget-exhausted'].includes(classification),
  },
  {
    id: 'repair-skill-chain-blocked-needs-continuation',
    unitId: 'continuation-inference',
    role: 'continuation',
    reasonCode: () => 'repair-skill-chain-blocked',
    when: ({ repairRunBlocked }) => repairRunBlocked === true,
  },
  {
    id: 'controller-owned-closure-criteria-need-continuation',
    unitId: 'continuation-inference',
    role: 'continuation',
    reasonCode: () => 'controller-owned-closure-criteria-pending',
    when: ({ classification, controllerOwnedClosureCriteriaPending, commitRequired, prReviewRequired, prReviewSatisfied }) => (
      ['repairable', 'resumable', 'closure-candidate'].includes(classification)
      && controllerOwnedClosureCriteriaPending === true
      && commitRequired !== true
      && (prReviewRequired !== true || prReviewSatisfied === true)
    ),
  },
  {
    id: 'reviewer-repair-routes-balance-scan',
    unitId: 'living-doc-balance-scan',
    role: 'balance-scan',
    reasonCode: () => 'reviewer-selected-repair',
    when: ({ classification, nextIterationMode, executeRepairSkills }) => (
      ['repairable', 'resumable', 'closure-candidate'].includes(classification)
      && nextIterationMode === 'repair'
      && executeRepairSkills === true
    ),
  },
  {
    id: 'reviewer-repair-routes-worker-without-repair-units',
    unitId: 'worker',
    role: 'worker',
    reasonCode: () => 'repair-resumed-without-executed-repair-units',
    when: ({ classification, nextIterationMode, executeRepairSkills }) => (
      ['repairable', 'resumable', 'closure-candidate'].includes(classification)
      && nextIterationMode === 'repair'
      && executeRepairSkills !== true
    ),
  },
  {
    id: 'reviewer-authorized-worker-continuation',
    unitId: 'worker',
    role: 'worker',
    reasonCode: () => 'reviewer-authorized-continuation',
    when: ({ nextIterationAllowed }) => nextIterationAllowed === true,
  },
  {
    id: 'no-valid-route-blocker',
    terminalActionKind: 'continuation-required',
    selectedBy: 'routing-policy',
    reasonCode: ({ reasonCode }) => reasonCode || 'no-valid-policy-route',
    when: ({ nextIterationAllowed }) => nextIterationAllowed !== true,
  },
];

export function selectLifecycleRoute(facts) {
  for (const rule of LIFECYCLE_ROUTING_POLICY_RULES) {
    if (!rule.when(facts)) continue;
    return {
      schema: 'living-doc-harness-routing-policy-selection/v1',
      policyRuleId: rule.id,
      ...(rule.unitId ? { unitId: rule.unitId } : {}),
      ...(rule.role ? { role: rule.role } : {}),
      ...(rule.terminalActionKind ? { terminalActionKind: rule.terminalActionKind } : {}),
      ...(rule.selectedBy ? { selectedBy: rule.selectedBy } : {}),
      reasonCode: typeof rule.reasonCode === 'function' ? rule.reasonCode(facts) : rule.reasonCode,
      status: 'selected',
    };
  }
  return null;
}
