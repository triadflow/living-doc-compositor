---
name: "private-onboarding"
description: "Build a private onboarding living doc from granted sources so a new employee, contractor, or freelancer can understand the work fast and find the first credible value loops, with any broader reading kept in a sidecar note."
---

# /private-onboarding

Build a private onboarding living doc after contracts are signed, NDA is in place, access is granted, and the new person needs a fast path to understanding and value delivery.

## Usage

```bash
/private-onboarding <team-or-project>
/private-onboarding <team-or-project> --goals "<initial goals>"
/private-onboarding <team-or-project> --dry-run
```

## What this skill does

It turns granted access into:

- one private living doc about the work system the person needs to contribute to
- one optional onboarding note that can carry broader orientation help outside the doc

The output is a private living doc that helps the new person answer:

- what the current objective is
- which work surfaces are central
- what counts as proof here
- how work gets coordinated and accepted
- where the first real value loops are

This is private by default. The tool can be open source while the content remains inside the granted confidentiality boundary.

## Execution

### 1. Confirm the onboarding boundary

Use only sources the person is already allowed to read.

Typical sources:

- repos
- tickets and PRs
- docs
- dashboards
- onboarding goals
- meeting notes or recordings
- design files
- operating rituals
- recent decision trails

Do not make this an org-wide anthropology pass. Stay close to the work system the new person needs in order to contribute.

### 2. Model the onboarding surface

The doc should make five things explicit:

- `Current objective`
- `Canonical work surfaces`
- `Proof model`
- `Coordination rhythm`
- `First value loops`

If broader interpretation is useful, derive it in the separate onboarding note, not in the living doc. That can include an `organizational DNA` reading such as:

- what the place respects
- what kind of evidence moves work
- whether it is system-first, output-first, reliability-first, governance-first, or mixed

### 3. Read for fit, not volume

Read enough to answer:

- which repo or artifact is the heartbeat
- which dashboards or docs matter in live decisions
- where work is reviewed or accepted
- what a credible contribution looks like
- which small loops would create value quickly

Do not optimize for complete organizational memory. Optimize for fast usefulness.

### 4. Draft the private onboarding doc

Start from `docs/living-doc-empty.json`.

Draft sections such as:

- objective / current mission
- work surfaces
- decision and review path
- proof and quality bar
- current frictions or opportunities
- first value loops

Keep the doc itself about the work the person needs in order to contribute. Do not turn it into a broader interpretation surface about the organization.

### 5. Identify candidate value loops

Always end with 2–5 candidate first value loops.

A value loop should be:

- small enough to act on soon
- legible to the organization
- connected to an existing proof surface
- likely to build trust

Prefer loops that improve a real surface the organization already cares about.

### 6. Keep private by default

Do not assume the doc should be shared.

The default workflow is:

- build privately
- use it to orient and choose work
- later extract or share specific sections only if useful

### 7. Keep broader readings outside the doc

If it helps the person orient, add a short sidecar onboarding note covering:

- strongest organizational DNA reading
- strongest implicit proof pattern
- major fit risks or surprises
- questions that still need confirmation from humans

Do not persist those broader readings as first-class living-doc structure.

### 8. Finish

- stamp full ISO `updated` timestamps
- render the doc
- recommend `/crystallize` after the shape stabilizes
- recommend `/explainability-sync` if a short current-state reading would help

## Output

Produce:

- one private onboarding living doc
- one short onboarding note covering:
  - strongest objective reading
  - strongest current-state reading
  - canonical work surfaces
  - proof model
  - top candidate value loops

## Key principles

1. Access is not understanding.
2. Read for fit and contribution, not total coverage.
3. Objective and current state come first.
4. Keep the doc private by default.
5. Keep broader organizational readings outside the living doc.
6. Ground any broader reading in visible work, not slogans.
7. End with concrete value loops.
