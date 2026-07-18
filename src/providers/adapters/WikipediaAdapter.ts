import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';

/**
 * Wikipedia adapter — free, public, unauthenticated, essentially unlimited
 * (Wikimedia's REST API asks only for a descriptive User-Agent, which
 * browsers don't allow scripts to set — Wikimedia's docs confirm anonymous
 * browser use is fine within reasonable volume). Used as the
 * lowest-priority, LAST-RESORT 'research' provider: unlike every other
 * research/text provider in the chain, it does NOT call any LLM at all — it
 * looks up the most relevant article and returns its lead-section extract
 * directly. This guarantees the Research tab (and any Agent pipeline step
 * that uses it) can produce a genuine, sourced answer even in the
 * pathological case where a user has no local Ollama install, a browser
 * without WebGPU (so WebLLM can't run), and has not enabled any keyed text
 * provider — i.e. it is the true zero-dependency floor required by
 * requirement #1 ("fully functional by default").
 */
export class WikipediaAdapter extends BaseAdapter {
  label = 'Wikipedia (Free, no key)';
  browserSafe = true;
  supportsModelDiscovery = false;

  async testConnection(_provider: ProviderConfig): Promise<{ ok: boolean; message: string; testedAt: number }> {
    return { ok: true, message: 'Wikipedia REST API — no key required.', testedAt: Date.now() };
  }

  async call(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    // Prefer a concise `query` field when the caller supplies one
    // alongside a longer `prompt` (see ResearchNodeExecutor in
    // ../../workflows/Node.ts) — Wikipedia's search API wants an actual
    // topic, not a multi-paragraph LLM synthesis prompt.
    const query = (input?.query ?? input?.prompt ?? input) as string;
    if (!query) throw new Error('Wikipedia lookup requires a query.');

    const base = (provider.baseUrl || 'https://en.wikipedia.org').replace(/\/$/, '');

    // 1. Find the best-matching article title via the search API.
    const searchUrl = `${base}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=1`;
    const searchRes = await this.fetchWithRetry(searchUrl, { method: 'GET' }, provider, undefined, options?.signal);
    if (!searchRes.ok) throw new Error(`Wikipedia search HTTP ${searchRes.status}`);
    const searchJson = await searchRes.json();
    const title = searchJson?.query?.search?.[0]?.title;
    if (!title) throw new Error(`No Wikipedia article found for "${query}".`);

    // 2. Fetch a clean plain-text summary (lead section) for that title via
    // the REST summary endpoint — already extracted/cleaned by Wikimedia,
    // no HTML parsing needed on our end.
    const summaryUrl = `${base}/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryRes = await this.fetchWithRetry(summaryUrl, { method: 'GET' }, provider, undefined, options?.signal);
    if (!summaryRes.ok) throw new Error(`Wikipedia summary HTTP ${summaryRes.status}`);
    const summaryJson = await summaryRes.json();
    const extract: string | undefined = summaryJson?.extract;
    if (!extract) throw new Error(`Wikipedia had no summary for "${title}".`);

    const pageUrl = summaryJson?.content_urls?.desktop?.page || `${base}/wiki/${encodeURIComponent(title)}`;
    return `${extract}\n\nSource: ${title} — ${pageUrl}\n\n` +
      `(Generated directly from a Wikipedia lookup, without an AI model — enable Ollama, a WebGPU browser, ` +
      `or a keyed text provider in Keys & Providers for AI-synthesized answers across multiple sources.)`;
  }
}
