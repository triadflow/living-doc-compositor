import { createHash } from 'node:crypto';

/**
 * Compute a stable fingerprint of the section structure that meta-layer
 * data was derived from. Stable under prose copy-editing, unstable under
 * structural change (adding a section, renaming an id, adding a card,
 * changing a convergence type).
 *
 * Inputs used:
 *  - section.id
 *  - section.convergenceType
 *  - ordered list of card ids from section.data
 *
 * Output shape: "sha256:<hex>"
 */
export function computeSectionFingerprint(sections) {
  const payload = (Array.isArray(sections) ? sections : []).map((section) => ({
    id: String(section?.id ?? ''),
    type: String(section?.convergenceType ?? ''),
    cards: (Array.isArray(section?.data) ? section.data : [])
      .map((item) => String(item?.id ?? ''))
      .filter((id) => id.length > 0),
  }));
  const canonical = JSON.stringify(payload);
  const hex = createHash('sha256').update(canonical).digest('hex');
  return `sha256:${hex}`;
}

/**
 * Compare a stored fingerprint against the current sections.
 * Returns { fresh: boolean, stored: string, current: string, reason?: string }.
 */
export function checkFingerprint(storedFingerprint, sections) {
  const current = computeSectionFingerprint(sections);
  const stored = String(storedFingerprint ?? '').trim();
  if (!stored) {
    return { fresh: false, stored: '', current, reason: 'missing' };
  }
  if (stored !== current) {
    return { fresh: false, stored, current, reason: 'mismatch' };
  }
  return { fresh: true, stored, current };
}
