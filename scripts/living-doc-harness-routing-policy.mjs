export const LIFECYCLE_ROUTING_POLICY_RULES = [
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
    id: 'mentioned-closure-review',
    unitId: 'closure-review',
    role: 'closure-review',
    reasonCode: ({ reasonCode }) => reasonCode || 'closure-candidate-requests-closure-review',
    when: ({ classification, commitRequired, prReviewRequired, closureReviewMentioned, commitPreconditionMentioned }) => (
      ['closure-candidate', 'resumable'].includes(classification)
      && closureReviewMentioned === true
      && commitRequired !== true
      && commitPreconditionMentioned !== true
      && prReviewRequired !== true
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
];

export function selectLifecycleRoute(facts) {
  for (const rule of LIFECYCLE_ROUTING_POLICY_RULES) {
    if (!rule.when(facts)) continue;
    return {
      schema: 'living-doc-harness-routing-policy-selection/v1',
      policyRuleId: rule.id,
      unitId: rule.unitId,
      role: rule.role,
      reasonCode: typeof rule.reasonCode === 'function' ? rule.reasonCode(facts) : rule.reasonCode,
      status: 'selected',
    };
  }
  return null;
}
