# Draft: `claim-defensibility-cross-cut` convergence type

Working draft, not yet committed to `scripts/living-doc-registry.json`. Grounded in the dissection of *How to Make Drugs and Feel Great About Everything* (2025) — see `claim-spine.md`.

## Why this type

In investigative documentary, a single recurring objective drives the editorial process: **"is this claim defensible enough to put in the film?"** The answer is multi-modal — a claim is defensible when on-camera testimony, documentary evidence, footage with provenance, deliberately included counter-voices, and a legal-risk read all converge around it. No single existing tool answers that — fact-check sheets see one slice, edit projects see another, legal trackers see a third. The compositor's job is to converge them.

Each instance of this type holds **one claim** and shows the full evidentiary picture for that claim, with a status that progresses from `untested` to `locked-in-cut` (or terminates as `cut-on-defensibility` if the claim couldn't be defended).

## New status set: `claim-defensibility`

```json
"claim-defensibility": {
  "values": [
    "untested",
    "testimony-only",
    "corroborated",
    "counter-voiced",
    "legal-cleared",
    "locked-in-cut",
    "cut-on-defensibility"
  ],
  "tones": {
    "untested": "warning",
    "testimony-only": "warning",
    "corroborated": "neutral",
    "counter-voiced": "positive",
    "legal-cleared": "positive",
    "locked-in-cut": "positive",
    "cut-on-defensibility": "negative"
  }
}
```

**Progression rationale:**
- `untested` — claim asserted, no evidence yet attached
- `testimony-only` — on-camera support exists but no documentary corroboration; fragile
- `corroborated` — testimony AND documentary evidence converge
- `counter-voiced` — corroborated AND a counter-voice has been deliberately included; this is the defensibility move that distinguishes investigative work from advocacy
- `legal-cleared` — passed legal/AETA/libel review
- `locked-in-cut` — final, in the picture lock
- `cut-on-defensibility` — claim was excluded because it couldn't be defended (preserved as failed-claim history, not deleted)

## New entity types

### `transcript-segment` — pointer to a timestamped speaker quote in the outer transcript tool

Carries the visual register info because the editor uses visual grammar as part of the defensibility move.

```json
"transcript-segment": {
  "name": "Transcript segment",
  "description": "A timestamped speaker quote in an outer transcript tool (Trint, ScriptSync, etc).",
  "fields": [
    { "key": "transcriptSource", "label": "Transcript source" },
    { "key": "speaker", "label": "Speaker" },
    { "key": "startTimecode", "label": "Start timecode" },
    { "key": "endTimecode", "label": "End timecode" },
    { "key": "quote", "label": "Quote text" },
    { "key": "shotRegister", "label": "Shot register",
      "values": ["credentialed-expert", "first-hand-witness", "counter-voice", "observational", "filmmaker-voiceover"] },
    { "key": "credentialsRendered", "label": "Credentials shown on screen" }
  ]
}
```

### `footage-clip` — pointer to footage in the edit project / library, with provenance

```json
"footage-clip": {
  "name": "Footage clip",
  "description": "A clip in the outer edit system (Avid bin, Frame.io, drive). Provenance is what makes the clip defensible.",
  "fields": [
    { "key": "binLocation", "label": "Bin / library" },
    { "key": "clipId", "label": "Clip ID or filename" },
    { "key": "provenanceType", "label": "Provenance",
      "values": ["undercover", "sanctuary", "b-roll", "archive", "on-set", "verite", "stock"] },
    { "key": "dateOfRecording", "label": "Recorded" },
    { "key": "location", "label": "Where filmed" },
    { "key": "howObtained", "label": "How obtained" }
  ]
}
```

### `consent-record` — pointer to a release form / anonymity agreement

```json
"consent-record": {
  "name": "Consent record",
  "description": "A release or anonymity agreement governing on-screen use of a subject's testimony.",
  "fields": [
    { "key": "subjectId", "label": "Subject" },
    { "key": "consentType", "label": "Consent type",
      "values": ["named", "anonymous", "voice-only", "back-of-head", "redacted", "withdrawn"] },
    { "key": "consentDate", "label": "Signed" },
    { "key": "conditions", "label": "Conditions / off-limits" }
  ]
}
```

`content-source` (already in the registry) carries the documentary-evidence role — papers, legal acts, surveys, published studies.

## Convergence type entry

```json
"claim-defensibility-cross-cut": {
  "name": "Claim Defensibility Cross-cut",
  "category": "investigation",
  "description": "Per-claim view of a single proposition the documentary advances, converging on-camera testimony, documentary evidence, footage with provenance, anonymous-source consent, deliberately included counter-voices, and legal-risk state. The recurring objective in investigative documentary: is this claim defensible enough to put in the film?",
  "structuralContract": "One-column card grid, one claim per card. Each card converges named-expert testimony, documentary evidence, footage-with-provenance, counter-voice references, and a legal-risk flag, scoped to a single proposition. Use when the recurring question is 'can this claim survive in the cut?' — not for narrative arc tracking, scene ordering, or research backlog.",
  "notFor": [
    "narrative arc or storyline mapping",
    "scene-to-scene dependency tracking",
    "research backlog / source ingestion log",
    "legal clearance tracking outside the context of a specific claim"
  ],
  "promptGuidance": {
    "operatingThesis": "Treat each card as one claim and converge every modality of support and risk visible against it. The claim's defensibility lifecycle is the spine.",
    "keepDistinct": [
      "the claim itself (one proposition)",
      "on-camera testimony (with shot register and credentialing)",
      "documentary evidence (papers, laws, surveys, studies)",
      "footage with provenance (undercover / sanctuary / archive)",
      "anonymous-source consent flags",
      "counter-voices (deliberately included opposing testimony)",
      "legal-risk state",
      "personal-frame thread (how filmmaker voiceover bridges this claim to the spine)"
    ],
    "inspect": [
      "Verify each transcript-segment reference still resolves to its outer tool.",
      "Check that counter-voice testimony is genuinely opposing, not adjacent.",
      "Confirm footage provenance is still defensible (not retracted, source still citable)."
    ],
    "update": [
      "When defensibility advances, log what evidence carried it forward (testimony alone? added doc? added counter-voice? legal sign-off?).",
      "Mark cut claims as `cut-on-defensibility` rather than deleting — failed-claim history is part of the doc's audit trail."
    ],
    "avoid": [
      "Do not duplicate the underlying outer-source state — references only.",
      "Do not collapse counter-voices into general 'opposing perspectives' — name the speaker, the segment, the frame.",
      "Do not advance to `locked-in-cut` without an explicit legal-cleared step."
    ]
  },
  "icon": "<path opacity='.26' d='M5 4h11l3 3v13H5z'/><circle cx='12' cy='13' r='3'/><path d='M10.5 13l1 1 2-2.5'/>",
  "iconColor": "#0f766e",
  "projection": "card-grid",
  "columns": 1,
  "sources": [
    { "key": "onCameraSupport",     "entityType": "transcript-segment", "label": "On-camera testimony" },
    { "key": "documentaryEvidence", "entityType": "content-source",     "label": "Documents / studies / laws" },
    { "key": "footageEvidence",     "entityType": "footage-clip",       "label": "Footage with provenance" },
    { "key": "anonymousSources",    "entityType": "consent-record",     "label": "Anonymous-source consents" },
    { "key": "counterVoices",       "entityType": "transcript-segment", "label": "Counter-voices included" },
    { "key": "notes", "entityType": null, "label": null }
  ],
  "statusFields": [
    { "key": "defensibility", "statusSet": "claim-defensibility" }
  ],
  "textFields": [
    { "key": "claim", "label": "Claim" },
    { "key": "personalFrameLink", "label": "How the filmmaker's voice bridges this claim" }
  ],
  "detailsFields": [
    { "key": "legalRiskNotes", "label": "Legal / AETA / libel risk read" },
    { "key": "openGaps",       "label": "What's still missing" }
  ],
  "domain": "investigation",
  "entityShape": ["has-evidence", "has-counter-evidence", "lifecycle"]
}
```

## What this lets the LLM do for the documentary maker

The doc isn't a system of record — it's a cross-cut the LLM (Claude Code, Codex) can pull up against one objective at a time:

- *"Show me every claim that's still in `testimony-only` going into next week's screening"* — the doc filters its own cards by status
- *"For claim D, what would close the gap from corroborated → counter-voiced?"* — the LLM reads the claim's existing counter-voices, sees there are none, and suggests opposing-voice candidates from the broader research stack
- *"Is the AETA-affected claim cluster legal-cleared?"* — the LLM scans the legal-flag fields across the cards, surfaces the ones still under review
- *"Walk me through the personal-frame thread across all locked claims"* — the LLM reads the `personalFrameLink` field across every `locked-in-cut` card and gives the filmmaker a continuity check

That last move is the pay-off no existing tool gives — the **personal-frame continuity check across the claim spine** — and it's what the convergence projection exists to enable.

## Out of scope for this draft

- The `/integrate-transcript`, `/integrate-rushes`, `/integrate-legal-tracker` importers — design first, plumbing later
- A separate `subject-access-ledger` or `cut-spine` type — narrowed earlier; investigative docs put subjects inside the claim cross-cut as testimony sources, and let editorial tools handle structural ordering
- UI rendering details — the existing card-grid projection should fit; visual tuning happens after the registry entry lands