# Claim spine — How to Make Drugs and Feel Great About Everything (2025)

Director: **Journey** (first-person autobiographical investigative)
Co-producer: **Keegan Kuhn** (experienced in this advocacy genre)
Runtime: 83 min
Source: embedded SRT (1,890 entries, ms-accurate)

## Declared thesis (00:57)

> "I'm deeply concerned by the war on science in our culture today — whether we're talking about the climate crisis, global pandemics, or the mysteries of our own brains, science is integral to finding meaningful solutions."

The film's specific argument: **animal testing in pharmaceutical drug development is scientifically broken AND ethically indefensible — and viable alternatives now exist.**

The personal frame: Journey's own depression and the question of whether to take antidepressants developed by the forced swim test on rats.

## Claim spine (chronological)

| # | Timecode | Claim | Evidence pattern |
|---|----------|-------|------------------|
| A | 02:30–06:00 | The forced swim test is scientifically discredited but still used to evaluate antidepressants | NIH paper (document) + Dr. Neal Barnard (named expert, PCRM) on-camera + filmmaker first-person reasoning |
| B | 18:00–22:00 | Animal models systematically fail to translate (stroke, head injury, depression, heart disease) | Statistical claim ("100+ stroke drugs in monkeys, zero in humans") + Dr. Alka Chandna + former Army TBI Program Deputy Director + biochemical mechanism (CETP absence in rats) + map-of-Australia analogy |
| C | 35:00–38:00 | Methodological irrelevance + publication bias are pervasive | Coca-Cola dye case study (8,000 cans/day cancer dose in rats) + Dr. Hartung "completely irrelevant finding" quote |
| D | 44:00–48:00 | Industry power shapes laws to criminalize criticism (AETA) | Delci Winders (legal scholar) + Andy Stepanian (3yr federal prison, SHAC, named first-hand) + ACLU/Center for Constitutional Rights endorsements + specific case details ($15M, "prisoner of inspirational significance," CMU) |
| E | 56:00–62:00 | Cruelty inside labs is systematic, not exceptional | Hidden-camera footage (Occold UK, East Millstone NJ — provenance named) + Theo the macaque (6-inch wire left in skull, sanctuary discovery) + anonymous lab worker testimony (consent flagged) + counter-voice (Americans for Medical Progress: "never seen mistreatment in 15 years") + counter-counter (Dr. John Gluck on definitions) |
| F | 68:00–75:00 | Alternatives exist now and outperform animal models | On-site company visit Emulate (Boston) + published Nature-portfolio study (87% hepatotoxicity catch rate, 22 drugs missed by animals, 2 patient deaths, 10 post-market withdrawals) + Terasaki Institute 3D bioprinting + FDA Modernization Act (regulatory shift named) |
| G | 48:00–52:00 | Making this film carries personal/legal risk | Keegan Kuhn co-producer testimony (death threats, surveillance, lawsuits, prison) + filmmaker's somatic response (hair loss) + self-disclosed determination |

## What the editorial team had to solve (cross-cuts)

For every claim above, the editor converged:

- **on-camera testimony**: which named expert, what credentials shown, what timecode in their interview rushes
- **documentary evidence**: NIH paper, published study (Communications Medicine), AETA text, FDA Modernization Act text, Pew 2018 survey
- **footage type and provenance**: stock, b-roll, undercover (with date/place/how-obtained), sanctuary
- **counter-voice**: the deliberate inclusion of opposing testimony (Americans for Medical Progress) as a defensibility move
- **legal risk flag**: AETA exposure, libel / defamation, named-individual liability
- **anonymous-source flagging**: explicit "on condition of anonymity" disclosure
- **personal-frame thread**: how Journey's first-person voiceover bridges this claim to the spine

## Methodological signals worth noting

1. **Counter-arguments are deliberately in the film** (claim E). This is a defensibility move, not balance theater — the editor chose to include AMP's denial *and then refute it* with Dr. Gluck.
2. **Legal review is woven mid-production** (claim G). The Keegan Kuhn conversation at ~48min is itself evidence that the legal/risk audit happened alongside editorial cutting, not after.
3. **Anonymous sources are explicitly disclosed**. The film tells the audience when consent constraints required anonymity.
4. **Personal frame threads every claim**. Journey's voice never disappears — even the technical claims land via her depression arc.

## Implications for the convergence type

A `claim-defensibility-cross-cut` for an investigative doc needs to converge at minimum:

| Field/source | Type | Notes |
|---|---|---|
| `claim` | text | The proposition the film advances |
| `onCameraSupport[]` | reference → transcript-segment | Named experts with credentialing visible |
| `documentaryEvidence[]` | reference → source-doc | Papers, legal acts, surveys |
| `footageEvidence[]` | reference → footage-clip | With provenance: date, place, how-obtained, ethical basis |
| `anonymousSources[]` | reference → consent-record | Flagged when anonymity was required |
| `counterVoices[]` | reference → transcript-segment | Deliberately included opposing testimony |
| `legalFlag` | enum | clear / requires-review / under-review / cleared / cut-on-legal |
| `personalFrameLink` | text | How filmmaker voiceover bridges this claim to spine |
| `defensibility` | status | `untested → testimony-only → testimony+document → testimony+document+counter-voice → legal-cleared → locked-in-cut` |

That status progression is the spine of the doc — it's the answer to "is this claim defensible enough to put in the film?" tracked over time.

## Stills worth capturing for the registry walkthrough

- ~01:35 — Journey on-camera, declaring personal stake (frames the personal-frame field)
- ~04:10 — Dr. Neal Barnard interview frame (frames the on-camera-support pattern with credential lower-third)
- ~46:00 — Andy Stepanian interview (frames first-hand legal-stakes testimony)
- ~50:30 — Americans for Medical Progress interview (frames the counter-voice inclusion move)
- ~56:30 — Hidden-camera footage of lab cruelty (frames the footage-with-provenance pattern)
- ~59:50 — Theo the macaque sanctuary discussion (frames the cross-source corroboration pattern)
- ~70:30 — Emulate organ-on-chip lab (frames the alternatives evidence pattern)

## What the stills taught (post-capture)

1. **The personal frame is voiceover-driven, not on-screen-filmmaker-driven.** At 01:37 the visual is an aerial shot of a burning forest landscape — a metaphor for "the house is on fire" in voiceover, not the filmmaker on camera. Journey rarely appears on screen. The convergence type's `personalFrameLink` field needs to accommodate **voiceover anchored to b-roll**, not just on-camera filmmaker shots.

2. **Speaker categories have visually distinct shot grammars:**
   - **Credentialed experts** (Barnard, Ingber): warm office, awards visible in background, full lower-third with degrees + institutional title
   - **First-hand witnesses** (Stepanian): stark/austere setting (empty room, single chair), no credential lower-third in early frames — visual register signals "experiential testimony"
   - **Counter-voices** (Americans for Medical Progress): noticeably different lighting/background (white BG, side profile) — visual differentiation marks them as the "deliberately included opposing view"
   - **Observational/sanctuary footage**: caged primate, strong eye contact, melancholy register — composition carries the evidentiary weight

   The editor uses **visual grammar to signal evidentiary register**. So an `onCameraSupport` reference shouldn't just point to a transcript timestamp — it should also carry a `shotRegister` field (`credentialed-expert / first-hand-witness / counter-voice / observational`) because that register is part of the defensibility move.

3. **Lower-third credentialing is itself a defensibility artifact.** Whether credentials are *rendered on screen* is an editorial decision worth tracking — it tells the audience "this person is credible by these credentials, visible right now." Add `credentialsRendered: bool` to the on-camera-support reference.

4. **Sanctuary footage and undercover footage look similar but are provenanced differently.** The `footageEvidence` reference needs a `provenanceType` field: `undercover / sanctuary / b-roll / archive / on-set / verite`.
