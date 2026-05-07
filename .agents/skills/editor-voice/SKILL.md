---
name: "editor-voice"
description: "Review, revise, or draft Living Docs Journal and living-doc-compositor blog articles in the project's house voice. Use when Codex is asked for writing style advice, article editing, editorial review, blog post drafting, title/dek review, voice consistency, or conversion of project work into a field-note essay for docs/blog*.html or related writing."
---

# /editor-voice

Edit Living Docs Journal writing as a field-note essay for serious operators, not as product marketing or generic thought leadership.

## Core Position

The blog is a project journal about making complex human-agent work legible enough to continue, inspect, and repair.

Preferred voice:

- precise, calm, and slightly opinionated
- concrete before abstract
- allergic to hype
- technical without becoming implementation notes
- personal enough to show where the insight came from, but not memoir-like
- honest about boundaries and unresolved parts

Default audience:

- future Rene
- future agents working on the project
- builders, researchers, operators, and senior technical readers who care about complex AI-mediated work

Do not optimize for a broad marketing reader.

## Article Shape

Most posts should follow this arc:

1. **Pressure**: name the repeated pain that made the post necessary.
2. **Concrete case**: show the artifact, issue, repo, tracker, meeting, command, section, or workflow that exposed it.
3. **Distinction**: introduce the useful naming split or model.
4. **Mechanism**: explain how living docs make the distinction operational.
5. **Boundary**: state what this does not solve.
6. **Rule**: close with a sober operating rule or implication.

Strong recurring openings:

- "Every time you engage with..."
- "The hard part is no longer..."
- "I only saw it because..."
- "The useful behavior was not magic. It was pressure."

Avoid opening with a definition unless the definition is itself the tension.

## House Moves

Keep and sharpen these moves:

- Name real pressures: archaeology tax, session state loss, stale context, coordination bottlenecks, weak proof, hidden structure.
- Let concrete examples carry abstraction: Textual issues, GitHub tickets, registry fields, tracker cards, MCP tools, rendered docs, skill runs.
- Use named concepts when they earn their keep: convergence type, registry as language, act/surface, source-system spine, governed inference, representation first.
- Treat living docs as working surfaces, not documents to admire.
- Say "what this does not solve" before the reader has to ask.

Every 3-5 abstract paragraphs need one artifact-level paragraph. Name a file, card, section, issue, command, screenshot, source, field, status, or before/after state.

## Voice Checks

Run these checks before calling a draft ready:

- Cut `actually` unless it changes meaning.
- Avoid `load-bearing`; if one use survives, it must label a structural claim precisely.
- Use italics only for introduced terms, titles, quoted modes, or real contrast. Do not italicize abstract nouns for emphasis.
- Keep `Not X. Y.` constructions rare and earned. Prefer one clean sentence when possible.
- Remove stage directions to the reader, such as "stopping here for a second" or "the point is this" when the paragraph can simply make the point.
- Break padded three-beat lists when the third item is only rhythm.
- Vary openers and closers across a series. Do not end every piece on "the deeper claim."
- Avoid throat-clearing honesty. Say the limit directly.
- Use em dashes with restraint.
- Preserve a concrete-to-abstract ratio that lets a new reader see the work, not only the theory.
- Avoid mid-paragraph definitions that interrupt momentum; define the term once, then use it.

Useful quick scan:

```bash
rg -n "\bactually\b|load-bearing|Stopping here|stopping here|The deeper claim|the deeper claim" docs/blog*.html
```

## Review Workflow

When asked to review or advise:

1. Read the target article and `docs/blog.html` context if relevant.
2. Check the title, dek, H1, H2s, opening, concrete anchors, boundary section, and closer.
3. Lead with the highest-leverage editorial diagnosis.
4. Give specific rewrite advice, not generic style principles.
5. If useful, include 2-4 suggested lines or section rewrites.

Output shape for reviews:

```text
Editorial diagnosis: <one sentence>
Keep:
- <specific strength>
Tighten:
- <specific issue and why>
Suggested edits:
- <concrete rewrite or action>
```

## Proposal Page First

For any substantive article refinement, create a static HTML proposal page before editing the article.

Use this when the user asks to refine, improve, rewrite, or make a serious editorial pass on a post. Skip it only for tiny copyedits or when the user explicitly asks to edit directly.

Page requirements:

- Write the page to `docs/editorial-review-<article-slug>.html`.
- Make it standalone: inline CSS, no external dependencies.
- Show the target article, current title/dek, and review date.
- Lead with the editorial diagnosis.
- Show proposed edits as review cards grouped by section or paragraph.
- For each proposed edit, include:
  - `Current`: the current line, paragraph, heading, or summary of the current passage
  - `Proposed`: the replacement or action
  - `Argument`: why this improves the piece against the house voice
  - `Risk`: what could be lost or needs user judgment
- Include a final recommendation: `edit now`, `discuss first`, or `leave unchanged`.
- Link back to the source article and `docs/blog.html`.

Suggested page structure:

```html
<main class="review">
  <header>
    <p class="eyebrow">Editorial review</p>
    <h1>Review: Article title</h1>
    <p class="dek">One-sentence editorial diagnosis.</p>
  </header>
  <section>
    <h2>Highest-leverage changes</h2>
    <article class="edit-card">
      <h3>Section or paragraph label</h3>
      <dl>
        <dt>Current</dt><dd>...</dd>
        <dt>Proposed</dt><dd>...</dd>
        <dt>Argument</dt><dd>...</dd>
        <dt>Risk</dt><dd>...</dd>
      </dl>
    </article>
  </section>
</main>
```

After writing the proposal page:

1. Tell the user the page path.
2. Summarize the recommendation in 3-6 bullets.
3. Do not apply article edits until the user approves the proposal, unless the original request explicitly authorized direct application after the proposal.

## Editing Workflow

When asked to edit directly:

1. Preserve the article's factual claims, links, code references, dates, and source context.
2. Edit for voice, structure, and clarity without flattening the author's point.
3. Prefer surgical paragraph rewrites over whole-post rewrites unless the user asks for a major rewrite.
4. Keep HTML structure intact. Update related index/dek text only when the changed title or premise requires it.
5. If editing `docs/blog.html`, keep the series ordering and metadata coherent.

Do not simplify project language into generic AI vocabulary. If a term is project-native and useful, keep it and anchor it in a concrete example.

## Drafting Workflow

When drafting a new post from project work:

1. Start from the source artifact, not the general idea.
2. Identify the pressure the artifact exposed.
3. Write the first paragraph around that pressure.
4. Introduce project terms only after the reader has seen why they are needed.
5. Include one boundary section.
6. End with an operating rule, not a marketing CTA.

Good positioning sentence:

> The Living Docs Journal is not a product blog. It is a field journal about making complex human-agent work legible enough to continue, inspect, and repair.

## Local Editorial Context

If the task needs historical voice context, inspect:

- `docs/blog.html` for current series structure and live index copy.
- `docs/blog-editorial.json` for editorial invariants and prior voice-pass notes.
- Existing posts in `docs/blog-*.html`, especially:
  - `docs/blog-oss-issue-deep-dive.html`
  - `docs/blog-registry-is-a-language.html`
  - `docs/blog-act-and-surface.html`
  - `docs/blog-code-as-canonical-semantic-source.html`
