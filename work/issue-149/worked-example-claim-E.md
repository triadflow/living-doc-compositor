# Worked example: Claim E — "Cruelty inside laboratories is systematic, not exceptional"

A single instance of the `claim-defensibility-cross-cut` convergence type, instantiated against one claim from *How to Make Drugs and Feel Great About Everything*.

Picked Claim E because it exercises every field — on-camera testimony, documentary evidence, footage with provenance, anonymous-source consent, deliberately included counter-voices, AND high legal risk. If the convergence type holds for this claim, it holds for the simpler ones.

---

## The claim card (instance)

```json
{
  "id": "claim-lab-cruelty-systematic",
  "claim": "Cruelty inside research laboratories is systematic, not the result of a few bad actors.",
  "personalFrameLink": "Voiceover at 63:01 — 'I really did not want to look at what happens to the animals inside of these places, but with everything I was learning, how could I not look?' — bridges from the prior section's intellectual argument into the moral weight of the footage that follows.",
  "defensibility": "counter-voiced",

  "onCameraSupport": [
    {
      "transcriptSource": "trint://project-howtomakedrugs/interviews/chandna-2024-03",
      "speaker": "Dr. Alka Chandna",
      "startTimecode": "00:18:44",
      "endTimecode": "00:19:35",
      "quote": "There have been more than 100 drugs that have reversed the debilitating impacts of stroke in monkeys. And not one of those drugs helped human patients...",
      "shotRegister": "credentialed-expert",
      "credentialsRendered": true
    },
    {
      "transcriptSource": "trint://project-howtomakedrugs/interviews/gluck-2024-04",
      "speaker": "Dr. John Gluck",
      "startTimecode": "00:58:52",
      "endTimecode": "00:59:13",
      "quote": "You'd have to have a pretty narrow definition of what 'mistreatment' means to say 'I haven't seen it.' A lot of just the basic things that we do to animals in laboratories are mistreatment.",
      "shotRegister": "credentialed-expert",
      "credentialsRendered": true
    },
    {
      "transcriptSource": "trint://project-howtomakedrugs/interviews/press-2024-05",
      "speaker": "Deborah Press",
      "startTimecode": "01:00:38",
      "endTimecode": "01:01:46",
      "quote": "The Animal Welfare Act is more remarkable for what it doesn't do than for what it does... We just see time and time again, the enforcement isn't there.",
      "shotRegister": "credentialed-expert",
      "credentialsRendered": true
    }
  ],

  "documentaryEvidence": [
    {
      "id": "src-animal-welfare-act",
      "title": "Animal Welfare Act (7 U.S.C. §§ 2131–2159)",
      "type": "statute",
      "url": "https://www.usda.gov/topics/animals/awa",
      "addedAt": "2024-05-12T00:00:00Z"
    },
    {
      "id": "src-usda-beagle-investigation-2022",
      "title": "USDA inspection report — Envigo / Cumberland beagle facility (2022)",
      "type": "regulatory-investigation",
      "url": "https://www.aphis.usda.gov/animal_welfare/downloads/inspection-reports/envigo-2022.pdf",
      "addedAt": "2024-05-12T00:00:00Z"
    }
  ],

  "footageEvidence": [
    {
      "binLocation": "avid://howtomakedrugs/bins/undercover",
      "clipId": "OCCOLD_HLS_2003_undercover_07.mxf",
      "provenanceType": "undercover",
      "dateOfRecording": "2003",
      "location": "Huntingdon Life Sciences laboratory, Occold, England",
      "howObtained": "Independent journalist undercover infiltration; footage previously aired and remains in public-record SHAC court materials"
    },
    {
      "binLocation": "avid://howtomakedrugs/bins/undercover",
      "clipId": "EAST_MILLSTONE_HLS_2003_undercover_03.mxf",
      "provenanceType": "undercover",
      "dateOfRecording": "2003",
      "location": "Huntingdon Life Sciences laboratory, East Millstone, New Jersey",
      "howObtained": "Independent journalist undercover infiltration; same campaign as Occold footage"
    },
    {
      "binLocation": "avid://howtomakedrugs/bins/sanctuary",
      "clipId": "SANCTUARY_THEO_macaque_xrays.mxf",
      "provenanceType": "sanctuary",
      "dateOfRecording": "2024",
      "location": "Macaque sanctuary (UK)",
      "howObtained": "Sanctuary granted access; veterinary records of 6-inch wire in skull included with consent"
    },
    {
      "binLocation": "avid://howtomakedrugs/bins/observational",
      "clipId": "GIZMO_macaque_caged.mxf",
      "provenanceType": "sanctuary",
      "dateOfRecording": "2024",
      "location": "Macaque sanctuary (UK)",
      "howObtained": "Filmed on-site with sanctuary permission"
    }
  ],

  "anonymousSources": [
    {
      "subjectId": "anon-lab-worker-2024",
      "consentType": "voice-only",
      "consentDate": "2024-06-10",
      "conditions": "On condition of anonymity. No identifying voice characteristics may be preserved if employer is identifiable. Disclosed in-film as 'someone who was working for a laboratory at the time of our interview, an interview they agreed to only on the condition of anonymity.'"
    }
  ],

  "counterVoices": [
    {
      "transcriptSource": "trint://project-howtomakedrugs/interviews/amp-2024-04",
      "speaker": "Americans for Medical Progress representative",
      "startTimecode": "00:57:29",
      "endTimecode": "00:58:09",
      "quote": "I have never seen somebody mistreat an animal in my, you know, 15 or so years working in a primate facility... that is not the norm and nor should it be.",
      "shotRegister": "counter-voice",
      "credentialsRendered": false
    }
  ],

  "legalRiskNotes": "AETA exposure: footage and testimony pertain to a covered animal-enterprise. Cleared with counsel: undercover footage is from public-record SHAC materials and time-barred for direct AETA exposure; sanctuary footage was filmed with consent. The anonymous lab-worker testimony is the highest-risk element — counsel reviewed and approved on grounds that consent is documented and identifying detail was scrubbed. Defamation read: claims are supported by named experts and statutory references; no individual is named as a perpetrator without first-person witness corroboration.",

  "openGaps": "None blocking lock. (Earlier draft had a gap on the AMP counter-voice — was 'corroborated' but not 'counter-voiced'. Closed by including the AMP segment at 57:29 and following with Gluck's refutation.)"
}
```

## How the defensibility status got to `counter-voiced` (the lifecycle log)

The status didn't jump — it climbed. This is what the LLM tracking the cross-cut would have logged:

| When | Status transition | What evidence carried it |
|------|-------------------|--------------------------|
| Early research | `untested` | Filmmaker noted suspicion based on prior reading; no testimony attached yet |
| After Chandna interview | → `testimony-only` | One credentialed expert on camera; fragile single-mode support |
| After Press + AWA citation | → `corroborated` | Documentary evidence (statute + regulatory record) attached; cross-mode support |
| After AMP segment + Gluck refutation | → `counter-voiced` | Counter-voice deliberately included AND addressed in cut |
| Pending | → `legal-cleared` | Awaiting written counsel sign-off on undercover-footage time-bar argument |
| Pending | → `locked-in-cut` | After picture lock |

The transition from `corroborated` to `counter-voiced` was the editorially most important move — it's what distinguishes this from advocacy. The film deliberately gives AMP a clean read of their position before refuting it through Gluck's structural critique ("you'd have to have a pretty narrow definition of mistreatment"). That move is the convergence type's reason to exist.

## What an LLM working alongside the filmmaker can do with this card

Concrete examples, against this single card:

1. **Continuity check.** *"For locked-in-cut claims, summarize the personal-frame thread."* The LLM reads `personalFrameLink` across all locked claims, including this one's "I really did not want to look... how could I not look?" — flags whether the emotional through-line is continuous or has gaps.

2. **Counter-voice audit.** *"Which claims are still at `corroborated` and could promote to `counter-voiced` if we found the right opposing voice?"* For this card, that audit is now closed. For other claims (B, C), it might still be open.

3. **Legal-risk surface.** *"Show me the legal-risk read across all undercover-provenance footage."* The LLM walks `footageEvidence` across the whole doc, filters by `provenanceType: undercover`, joins to `legalRiskNotes` — surfaces the AETA exposure profile in one view.

4. **Anonymous-source roster.** *"List every anonymous source and the conditions of their participation."* The LLM joins `consentRecord`s across all claim cards — gives the filmmaker a single audit trail before delivery.

5. **Pre-screening readiness check.** *"For tomorrow's rough-cut screening, which claims are still below `counter-voiced`?"* The LLM filters by `defensibility` status — surfaces what the showrunner needs to brief the audience on as still-in-progress.

Each of these is a query no single existing tool can answer because each tool sees a slice. The convergence type is what lets the LLM answer them.

## What this validates and what it changes

**Validates:**
- The lifecycle is the spine — without `defensibility` status progression the type is just a list of evidence
- Counter-voices are a structural field, not a "perspectives" afterthought
- Footage `provenanceType` is the discipline that prevents the cutting room becoming the only source of truth for what's defensible
- Visual register (`shotRegister` + `credentialsRendered`) on transcript references is genuinely useful — the editor's visual-grammar choices are part of defensibility, not just aesthetics

**Changes from earlier sketch:**
- Originally had `legalFlag` as an enum; the worked example shows legal risk needs prose context (`legalRiskNotes`), not a status enum — too much nuance per claim. Keep the `defensibility` lifecycle's `legal-cleared` step as the binary gate, but track the substance in prose.
- The lifecycle log (status transitions over time with what carried each one) wasn't in the original draft. Worth adding — it's the audit trail the LLM uses to answer "how did this claim get here?" Could be auto-generated from status field history, or a dedicated `lifecycleLog[]` field.

## Honest read on whether this is the right design

Yes for investigative documentary specifically. The type does work the existing registry can't — `proof-ladder` is closest but is logic-of-proof, not multi-modal evidence convergence; `citation-feed` is dated source ingestion, not claim-bound; `investigation-findings` is broader-scope, not single-claim.

The risk: this type is *heavy* — many fields, multiple new entity types, status set with seven values. For a documentary maker to actually use it, the importer skills matter more than the registry entry. Without `/integrate-transcript` pulling segments from Trint and `/integrate-rushes` pulling clips with provenance, the type is too much manual data entry. That's the next ticket, not this one.