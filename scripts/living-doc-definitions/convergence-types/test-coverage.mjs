import { defineConvergenceType } from '../define.mjs';

export default defineConvergenceType({
  id: 'test-coverage',
  name: 'Test Coverage',
  category: 'verification',
  kind: 'surface',
  description:
    'A contract-facing coverage map that ties acceptance criteria to concrete tests, fixtures, input contracts, and output assertions.',
  structuralContract:
    'Two-column card grid of test-coverage obligations. Each card names the acceptance criterion or criteria being proven, the system boundary under test, the expected input contract shape, the output assertion, and the test artifacts that make the proof executable. This is not a generic checklist; it is a TDD contract surface for objective closure.',
  notFor: [
    'acceptance criteria themselves',
    'unordered proof rungs',
    'generic test inventories detached from objective closure',
    'manual QA notes without an executable boundary',
    'implementation tasks that do not name the input/output contract under proof',
  ],
  promptGuidance: {
    operatingThesis:
      'Treat test coverage as the executable proof map between acceptance criteria and the system boundary that proves them.',
    keepDistinct: [
      'acceptance criterion ids',
      'test artifact path',
      'system boundary',
      'input contract fixture',
      'output assertion',
      'proof claim',
      'known gap',
    ],
    inspect: [
      'Start from the acceptance criteria and success condition before adding a coverage card.',
      'Check whether the named test really exercises the same input/output contract the acceptance criterion depends on.',
      'Look for green tests that are misleading because fixtures do not match the live contract shape.',
      'Compare contract fixtures, generated artifacts, dashboard output, and live lifecycle evidence before marking coverage covered.',
    ],
    update: [
      'Create one card per meaningful proof boundary, not one card per test file.',
      'Use `criterionIds` to preserve the acceptance criteria being proven.',
      'Use `boundary` to name the system boundary under test.',
      'Use `inputContract` and `outputAssertion` to state the executable TDD contract.',
      'Mark coverage `covered` only when the test can fail for the actual boundary violation the criterion is trying to prevent.',
    ],
    avoid: [
      'Do not count a test as coverage only because it touches the same file.',
      'Do not let broad integration tests hide missing contract-boundary tests.',
      'Do not duplicate the proof ladder; this type maps acceptance criteria to executable tests.',
      'Do not mark coverage covered when the test uses a fake contract shape that the real system never emits.',
    ],
  },
  icon:
    "<path opacity='.22' d='M4 5h16v14H4z'/><path d='M7 9l2 2 4-4 1.4 1.4L9 13.8 5.6 10.4z'/><path d='M6 16h12v2H6zm8-7h4v2h-4zm0 4h4v2h-4z'/>",
  iconColor: '#2563eb',
  projection: 'card-grid',
  columns: 2,
  sources: [
    {
      key: 'criterionIds',
      entityType: null,
      label: 'Acceptance criteria',
    },
    {
      key: 'testRefs',
      entityType: 'code-file',
      label: 'Tests',
    },
    {
      key: 'fixtureRefs',
      entityType: 'artifact-file',
      label: 'Fixtures',
    },
    {
      key: 'ticketIds',
      entityType: 'ticket',
      label: 'Tickets',
    },
  ],
  statusFields: [
    {
      key: 'status',
      statusSet: 'coverage-state',
    },
  ],
  textFields: [
    {
      key: 'boundary',
      label: 'Boundary',
    },
    {
      key: 'inputContract',
      label: 'Input contract',
    },
    {
      key: 'outputAssertion',
      label: 'Output assertion',
    },
    {
      key: 'proofClaim',
      label: 'Proof claim',
    },
    {
      key: 'gap',
      label: 'Gap',
    },
  ],
  aiActions: [
    {
      id: 'check-contract-fit',
      name: 'Check contract fit',
      description:
        'Compare the named test and fixture with the live system contract shape and flag fake, stale, or misleading coverage.',
    },
    {
      id: 'find-missing-criterion-coverage',
      name: 'Find missing criterion coverage',
      description:
        'Read the acceptance criteria and identify any criteria that lack executable input/output proof coverage.',
    },
  ],
  domain: 'engineering',
  entityShape: ['objective-bound', 'has-code-refs', 'has-evidence'],
});
