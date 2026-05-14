import path from 'node:path';
import { access } from 'node:fs/promises';

export const ARTIFACT_REF_SCHEMA = 'living-doc-artifact-ref/v1';

export function isArtifactRef(value) {
  return Boolean(value && typeof value === 'object' && value.schema === ARTIFACT_REF_SCHEMA);
}

function normalizeRunDir({ cwd = process.cwd(), runDir }) {
  if (!runDir) return null;
  const absolute = path.isAbsolute(runDir) ? runDir : path.resolve(cwd, runDir);
  return path.relative(cwd, absolute) || '.';
}

function isInsidePath(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isParentRelativePath(value) {
  return value === '..' || value.startsWith('../') || value.startsWith('..\\');
}

function owningLivingDocRunDir({ cwd = process.cwd(), fallbackRunDir, absoluteFilePath }) {
  const runsRoot = path.resolve(cwd, '.living-doc-runs');
  if (!isInsidePath(runsRoot, absoluteFilePath)) return fallbackRunDir;

  const [ownerRunId] = path.relative(runsRoot, absoluteFilePath).split(path.sep);
  if (!ownerRunId) return fallbackRunDir;
  return path.join(runsRoot, ownerRunId);
}

function isLivingDocRunDir({ cwd = process.cwd(), runDir }) {
  if (!runDir) return false;
  const runsRoot = path.resolve(cwd, '.living-doc-runs');
  const absoluteRunDir = path.isAbsolute(runDir) ? runDir : path.resolve(cwd, runDir);
  return isInsidePath(runsRoot, absoluteRunDir);
}

export function artifactRef({ cwd = process.cwd(), runId = null, runDir, relativePath, kind = 'artifact' }) {
  if (!runDir || !relativePath) return null;
  return {
    schema: ARTIFACT_REF_SCHEMA,
    runId: runId || path.basename(path.isAbsolute(runDir) ? runDir : path.resolve(cwd, runDir)),
    runDir: normalizeRunDir({ cwd, runDir }),
    relativePath: String(relativePath),
    kind,
  };
}

export function artifactRefFromPath({ cwd = process.cwd(), runId = null, runDir, filePath, kind = 'artifact' }) {
  if (!runDir || !filePath) return null;
  const absoluteRunDir = path.isAbsolute(runDir) ? runDir : path.resolve(cwd, runDir);
  const filePathString = String(filePath);
  const absoluteFilePath = path.isAbsolute(filePathString)
    ? filePathString
    : filePathString.startsWith('.') && !isParentRelativePath(filePathString)
      ? path.resolve(cwd, filePath)
      : path.resolve(absoluteRunDir, filePath);
  const ownerRunDir = owningLivingDocRunDir({
    cwd,
    fallbackRunDir: absoluteRunDir,
    absoluteFilePath,
  });
  const ownerRunId = ownerRunDir === absoluteRunDir ? runId : path.basename(ownerRunDir);
  return artifactRef({
    cwd,
    runId: ownerRunId,
    runDir: ownerRunDir,
    relativePath: path.relative(ownerRunDir, absoluteFilePath),
    kind,
  });
}

export function resolveArtifactRef({ cwd = process.cwd(), currentRunDir = cwd, ref }) {
  if (!ref) return null;
  if (isArtifactRef(ref)) {
    if (!ref.runDir || !ref.relativePath) return null;
    const ownerRunDir = path.isAbsolute(ref.runDir)
      ? ref.runDir
      : path.resolve(cwd, ref.runDir);
    return path.resolve(ownerRunDir, ref.relativePath);
  }
  if (typeof ref === 'object') return null;
  if (path.isAbsolute(String(ref))) return String(ref);
  if (String(ref).startsWith('.')) return path.resolve(cwd, ref);
  return path.resolve(currentRunDir || cwd, ref);
}

export function artifactRefDisplayPath({ cwd = process.cwd(), currentRunDir = cwd, ref }) {
  const absolute = resolveArtifactRef({ cwd, currentRunDir, ref });
  return absolute ? path.relative(cwd, absolute) : null;
}

export async function validateArtifactRef({ cwd = process.cwd(), currentRunDir = cwd, ref, mustExist = false }) {
  const absolutePath = resolveArtifactRef({ cwd, currentRunDir, ref });
  const violations = [];
  if (!absolutePath) violations.push('artifact-ref-missing');
  if (ref && typeof ref === 'object' && !isArtifactRef(ref)) violations.push('artifact-ref-schema-invalid');
  if (isArtifactRef(ref)) {
    if (!ref.runDir) violations.push('artifact-ref-runDir-missing');
    if (!ref.relativePath) violations.push('artifact-ref-relativePath-missing');
    if (ref.relativePath && isLivingDocRunDir({ cwd, runDir: ref.runDir }) && isParentRelativePath(String(ref.relativePath))) {
      violations.push('artifact-ref-relativePath-escapes-runDir');
    }
  }
  if (mustExist && absolutePath) {
    try {
      await access(absolutePath);
    } catch {
      violations.push('artifact-ref-target-missing');
    }
  }
  return {
    ok: violations.length === 0,
    violations,
    absolutePath,
    displayPath: absolutePath ? path.relative(cwd, absolutePath) : null,
  };
}
