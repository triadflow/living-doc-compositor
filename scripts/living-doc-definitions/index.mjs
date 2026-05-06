import architectManuscript from './templates/architect-manuscript.mjs';
import competitorWatcher from './templates/competitor-watcher.mjs';
import designSystem from './templates/design-system.mjs';
import mapThemesStorylines from './templates/map-themes-storylines.mjs';
import monitoringTracker from './templates/monitoring-tracker.mjs';
import operationsSupport from './templates/operations-support.mjs';
import ossIssueDeepDive from './templates/oss-issue-deep-dive.mjs';
import proofCanonicality from './templates/proof-canonicality.mjs';
import starterProveClaim from './templates/starter-prove-claim.mjs';
import starterRunSupportOps from './templates/starter-run-support-ops.mjs';
import starterShipFeature from './templates/starter-ship-feature.mjs';
import starterTinyExperiment from './templates/starter-tiny-experiment.mjs';
import starterWriteBook from './templates/starter-write-book.mjs';
import surfaceDelivery from './templates/surface-delivery.mjs';
import coherenceMap from './convergence-types/coherence-map.mjs';
import explainabilityLayer from './convergence-types/explainability-layer.mjs';
import acceptanceCriteria from './convergence-types/acceptance-criteria.mjs';
import designCodeSpecFlow from './convergence-types/design-code-spec-flow.mjs';
import statusSnapshot from './convergence-types/status-snapshot.mjs';
import capabilitySurface from './convergence-types/capability-surface.mjs';
import operatingSurface from './convergence-types/operating-surface.mjs';
import enablerCatalog from './convergence-types/enabler-catalog.mjs';
import toolingSurface from './convergence-types/tooling-surface.mjs';
import designImplementationAlignment from './convergence-types/design-implementation-alignment.mjs';
import verificationSurface from './convergence-types/verification-surface.mjs';
import verificationCheckpoints from './convergence-types/verification-checkpoints.mjs';
import proofLadder from './convergence-types/proof-ladder.mjs';
import operation from './convergence-types/operation.mjs';
import stackDepth from './convergence-types/stack-depth.mjs';
import behaviorFidelity from './convergence-types/behavior-fidelity.mjs';
import protocolConformance from './convergence-types/protocol-conformance.mjs';
import formalModel from './convergence-types/formal-model.mjs';
import modelAssertion from './convergence-types/model-assertion.mjs';
import contentProduction from './convergence-types/content-production.mjs';
import contentOutline from './convergence-types/content-outline.mjs';
import themeThreadMap from './convergence-types/theme-thread-map.mjs';
import transcriptArgumentFrame from './convergence-types/transcript-argument-frame.mjs';
import storylineArcMap from './convergence-types/storyline-arc-map.mjs';
import characterSurface from './convergence-types/character-surface.mjs';
import sceneDependencyMap from './convergence-types/scene-dependency-map.mjs';
import continuityWatchlist from './convergence-types/continuity-watchlist.mjs';
import experimentEvidenceSurface from './convergence-types/experiment-evidence-surface.mjs';
import decisionRecord from './convergence-types/decision-record.mjs';
import investigationFindings from './convergence-types/investigation-findings.mjs';
import attemptLog from './convergence-types/attempt-log.mjs';
import issueOrbit from './convergence-types/issue-orbit.mjs';
import codeAnchor from './convergence-types/code-anchor.mjs';
import symptomObservation from './convergence-types/symptom-observation.mjs';
import maintainerStance from './convergence-types/maintainer-stance.mjs';
import expertStanceTrack from './convergence-types/expert-stance-track.mjs';
import indicatorTrace from './convergence-types/indicator-trace.mjs';
import citationFeed from './convergence-types/citation-feed.mjs';
import positionClusterMap from './convergence-types/position-cluster-map.mjs';
import buildLifecycleSurface from './convergence-types/build-lifecycle-surface.mjs';
import competitorStanceTrack from './convergence-types/competitor-stance-track.mjs';
import strategicMoveLog from './convergence-types/strategic-move-log.mjs';
import changeLog from './convergence-types/change-log.mjs';
import tinyExperiment from './convergence-types/tiny-experiment.mjs';
import designSystemSurface from './convergence-types/design-system-surface.mjs';
import tasteSignature from './convergence-types/taste-signature.mjs';
import briefToSystemAlignment from './convergence-types/brief-to-system-alignment.mjs';
import designSystemDerivation from './convergence-types/design-system-derivation.mjs';

export { defineTemplate, defineConvergenceType } from './define.mjs';

export const templateDefinitions = [
  architectManuscript,
  competitorWatcher,
  designSystem,
  mapThemesStorylines,
  monitoringTracker,
  operationsSupport,
  ossIssueDeepDive,
  proofCanonicality,
  starterProveClaim,
  starterRunSupportOps,
  starterShipFeature,
  starterTinyExperiment,
  starterWriteBook,
  surfaceDelivery,
];

export const convergenceTypeDefinitions = [
  coherenceMap,
  explainabilityLayer,
  acceptanceCriteria,
  designCodeSpecFlow,
  statusSnapshot,
  capabilitySurface,
  operatingSurface,
  enablerCatalog,
  toolingSurface,
  designImplementationAlignment,
  verificationSurface,
  verificationCheckpoints,
  proofLadder,
  operation,
  stackDepth,
  behaviorFidelity,
  protocolConformance,
  formalModel,
  modelAssertion,
  contentProduction,
  contentOutline,
  themeThreadMap,
  transcriptArgumentFrame,
  storylineArcMap,
  characterSurface,
  sceneDependencyMap,
  continuityWatchlist,
  experimentEvidenceSurface,
  decisionRecord,
  investigationFindings,
  attemptLog,
  issueOrbit,
  codeAnchor,
  symptomObservation,
  maintainerStance,
  expertStanceTrack,
  indicatorTrace,
  citationFeed,
  positionClusterMap,
  buildLifecycleSurface,
  competitorStanceTrack,
  strategicMoveLog,
  changeLog,
  tinyExperiment,
  designSystemSurface,
  tasteSignature,
  briefToSystemAlignment,
  designSystemDerivation,
];
