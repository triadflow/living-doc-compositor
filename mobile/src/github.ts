import Constants from 'expo-constants';

export type DocSummary = {
  slug: string;
  title: string;
  htmlUrl: string;
  pagesUrl: string;
  lastModified?: string;
};

function cfg() {
  const extra = Constants.expoConfig?.extra as any;
  return {
    owner: extra?.repoOwner as string,
    repo: extra?.repoName as string,
    pagesBase: extra?.pagesBase as string,
  };
}

// Prettify a slug like 'living-doc-template-starter-ship-feature' → 'Ship Feature'.
// Strips the common 'living-doc-' and 'template-starter-' prefixes, then title-cases.
function prettyTitle(slug: string): string {
  let s = slug
    .replace(/^living-doc-template-starter-/, '')
    .replace(/^living-doc-template-/, '')
    .replace(/^living-doc-/, '')
    .replace(/^compositor-/, '');
  s = s.replace(/-/g, ' ');
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// List every living doc HTML in docs/ using the GitHub contents API.
// Skips the landing page, compositor tool, and registry overview — those are
// infrastructure, not docs the user would read in a companion app.
export async function listDocs(token: string): Promise<DocSummary[]> {
  const { owner, repo, pagesBase } = cfg();
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/docs`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
      },
    }
  );
  if (!res.ok) throw new Error(`GitHub contents returned ${res.status}`);
  const items: Array<{ name: string; type: string }> = await res.json();

  const skip = new Set(['index.html', 'living-doc-compositor.html', 'living-doc-registry-overview.html']);
  return items
    .filter((it) => it.type === 'file' && it.name.endsWith('.html') && !skip.has(it.name))
    .map((it) => {
      const slug = it.name.replace(/\.html$/, '');
      return {
        slug,
        title: prettyTitle(slug),
        htmlUrl: `https://github.com/${owner}/${repo}/blob/main/docs/${it.name}`,
        pagesUrl: `${pagesBase}${it.name}`,
      } as DocSummary;
    });
}

// Placeholder category chip text; later this could look at the JSON payload or
// frontmatter baked into each rendered living doc.
export function categoryFor(slug: string): string {
  if (slug.startsWith('living-doc-template-starter-')) return 'Starter';
  if (slug.startsWith('living-doc-template-')) return 'Template';
  if (slug.includes('registry')) return 'Registry';
  if (slug.includes('overview')) return 'Overview';
  return 'Doc';
}
