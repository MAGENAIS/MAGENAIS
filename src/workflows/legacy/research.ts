/**
 * Ported from the legacy monolith's searchSemanticScholar/searchOpenAlex/searchArxiv/
 * gatherResearchSources. These all call free, keyless, browser-callable public APIs.
 */

export type LogFn = (message: string, level?: 'info' | 'warn' | 'error') => void;

export interface Paper {
  title: string;
  authors: string;
  year: number | string | null;
  abstract: string | null;
  citations: number | null;
  venue: string | null;
  url: string | null;
  source: string;
}

export interface SourceStatus {
  name: string;
  status: 'ok' | 'fail';
}

export interface ResearchResult {
  papers: Paper[];
  sourceStatus: SourceStatus[];
}

async function searchSemanticScholar(query: string, limit: number): Promise<Paper[]> {
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: 'title,authors,year,abstract,citationCount,externalIds,openAccessPdf,venue',
  });
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  const papers: Paper[] = (json.data || []).map((p: any) => ({
    title: p.title,
    authors: (p.authors || []).slice(0, 4).map((a: any) => a.name).join(', '),
    year: p.year,
    abstract: p.abstract,
    citations: p.citationCount,
    venue: p.venue,
    url: (p.openAccessPdf && p.openAccessPdf.url) || (p.externalIds && p.externalIds.DOI ? 'https://doi.org/' + p.externalIds.DOI : null),
    source: 'Semantic Scholar',
  }));
  if (papers.length === 0) throw new Error('no results');
  return papers;
}

async function searchOpenAlex(query: string, limit: number): Promise<Paper[]> {
  const params = new URLSearchParams({ search: query, per_page: String(limit) });
  const url = `https://api.openalex.org/works?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  const papers: Paper[] = (json.results || []).map((w: any) => {
    let abstract: string | null = null;
    if (w.abstract_inverted_index) {
      const positions: string[] = [];
      for (const [word, idxs] of Object.entries<number[]>(w.abstract_inverted_index)) {
        idxs.forEach(i => { positions[i] = word; });
      }
      abstract = positions.join(' ').trim();
    }
    return {
      title: w.title,
      authors: (w.authorships || []).slice(0, 4).map((a: any) => a.author && a.author.display_name).filter(Boolean).join(', '),
      year: w.publication_year,
      abstract,
      citations: w.cited_by_count,
      venue: w.primary_location && w.primary_location.source && w.primary_location.source.display_name,
      url: w.open_access && w.open_access.oa_url ? w.open_access.oa_url : w.id,
      source: 'OpenAlex',
    };
  });
  if (papers.length === 0) throw new Error('no results');
  return papers;
}

async function searchArxiv(query: string, limit: number): Promise<Paper[]> {
  const params = new URLSearchParams({ search_query: 'all:' + query, start: '0', max_results: String(limit), sortBy: 'relevance' });
  const url = `https://export.arxiv.org/api/query?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const xmlText = await res.text();
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error("couldn't parse arXiv response");
  const entries = Array.from(xml.getElementsByTagName('entry'));
  const papers: Paper[] = entries.map(entry => {
    const get = (tag: string) => {
      const el = entry.getElementsByTagName(tag)[0];
      return el ? (el.textContent || '').trim() : null;
    };
    const authors = Array.from(entry.getElementsByTagName('author'))
      .map(a => {
        const n = a.getElementsByTagName('name')[0];
        return n ? (n.textContent || '').trim() : null;
      })
      .filter(Boolean)
      .slice(0, 4)
      .join(', ');
    const idUrl = get('id');
    const published = get('published');
    return {
      title: (get('title') || '').replace(/\s+/g, ' '),
      authors,
      year: published ? published.slice(0, 4) : null,
      abstract: (get('summary') || '').replace(/\s+/g, ' '),
      citations: null,
      venue: 'arXiv preprint',
      url: idUrl,
      source: 'arXiv',
    };
  });
  if (papers.length === 0) throw new Error('no results');
  return papers;
}

export async function gatherResearchSources(
  query: string,
  limitPerSource: number,
  logFn: LogFn | undefined,
  enabledSources: string[]
): Promise<ResearchResult> {
  const allAttempts = [
    { key: 'semanticscholar', name: 'Semantic Scholar', fn: () => searchSemanticScholar(query, limitPerSource) },
    { key: 'openalex', name: 'OpenAlex', fn: () => searchOpenAlex(query, limitPerSource) },
    { key: 'arxiv', name: 'arXiv', fn: () => searchArxiv(query, limitPerSource) },
  ];
  const enabled = enabledSources && enabledSources.length ? enabledSources : ['semanticscholar', 'openalex', 'arxiv'];
  const attempts = allAttempts.filter(a => enabled.includes(a.key));
  const results = await Promise.allSettled(attempts.map(a => a.fn()));
  let allPapers: Paper[] = [];
  const sourceStatus: SourceStatus[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      allPapers = allPapers.concat(r.value);
      sourceStatus.push({ name: attempts[i].name, status: 'ok' });
      logFn?.(`${attempts[i].name} returned ${r.value.length} paper(s).`, 'info');
    } else {
      sourceStatus.push({ name: attempts[i].name, status: 'fail' });
      logFn?.(`${attempts[i].name} failed — ${r.reason?.message || r.reason}`, 'error');
    }
  });
  if (allPapers.length === 0) throw new Error('All academic sources failed or returned nothing — try rephrasing the question.');
  const seen = new Set<string>();
  allPapers = allPapers.filter(p => {
    const key = (p.title || '').toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { papers: allPapers, sourceStatus };
}
