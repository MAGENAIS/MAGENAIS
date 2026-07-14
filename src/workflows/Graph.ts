import { Graph, Node, Edge } from './types';

/**
 * Graph utility functions for validation, topological sorting, and dependency resolution.
 */
export class GraphUtils {
  /**
   * Validate the graph: check for cycles, duplicate node ids, and edge references.
   * Throws an error if invalid.
   */
  static validate(graph: Graph): void {
    const nodeIds = new Set(graph.nodes.map(n => n.id));
    // Check duplicate ids
    if (nodeIds.size !== graph.nodes.length) {
      throw new Error('Duplicate node ids found in graph.');
    }

    // Build adjacency for cycle detection
    const adj: Map<string, string[]> = new Map();
    graph.nodes.forEach(n => adj.set(n.id, []));
    for (const edge of graph.edges) {
      if (!nodeIds.has(edge.from)) {
        throw new Error(`Edge from unknown node: ${edge.from}`);
      }
      if (!nodeIds.has(edge.to)) {
        throw new Error(`Edge to unknown node: ${edge.to}`);
      }
      adj.get(edge.from)!.push(edge.to);
    }

    // Detect cycles using DFS (Kahn's algorithm)
    const inDegree: Map<string, number> = new Map();
    graph.nodes.forEach(n => inDegree.set(n.id, 0));
    for (const edge of graph.edges) {
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    let visited = 0;
    while (queue.length > 0) {
      const node = queue.shift()!;
      visited++;
      for (const neighbor of adj.get(node) || []) {
        const deg = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) queue.push(neighbor);
      }
    }
    if (visited !== graph.nodes.length) {
      throw new Error('Graph contains a cycle.');
    }
  }

  /**
   * Get the topological order of nodes (dependencies first).
   * Returns an array of node ids in execution order.
   */
  static getTopologicalOrder(graph: Graph): string[] {
    this.validate(graph);
    const inDegree: Map<string, number> = new Map();
    const adj: Map<string, string[]> = new Map();
    graph.nodes.forEach(n => {
      inDegree.set(n.id, 0);
      adj.set(n.id, []);
    });
    for (const edge of graph.edges) {
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
      adj.get(edge.from)!.push(edge.to);
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    const order: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      order.push(node);
      for (const neighbor of adj.get(node) || []) {
        const deg = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) queue.push(neighbor);
      }
    }
    return order;
  }

  /**
   * Get the immediate predecessors (dependencies) of a node.
   */
  static getPredecessors(graph: Graph, nodeId: string): string[] {
    return graph.edges.filter(e => e.to === nodeId).map(e => e.from);
  }

  /**
   * Get the immediate successors of a node.
   */
  static getSuccessors(graph: Graph, nodeId: string): string[] {
    return graph.edges.filter(e => e.from === nodeId).map(e => e.to);
  }

  /**
   * Find nodes that have no incoming edges (root nodes).
   */
  static getRootNodes(graph: Graph): Node[] {
    const hasIncoming = new Set(graph.edges.map(e => e.to));
    return graph.nodes.filter(n => !hasIncoming.has(n.id));
  }

  /**
   * Find nodes that have no outgoing edges (leaf nodes).
   */
  static getLeafNodes(graph: Graph): Node[] {
    const hasOutgoing = new Set(graph.edges.map(e => e.from));
    return graph.nodes.filter(n => !hasOutgoing.has(n.id));
  }

  // Node types whose designated input genuinely IS a media reference
  // (an image to look at, an audio clip to transcribe) rather than
  // natural-language text — everything else expects text.
  private static readonly MEDIA_CONSUMING_TYPES = new Set(['vision', 'audio', 'video']);

  /**
   * True for values that reference generated media (a blob: URL from
   * URL.createObjectURL, a data: URI, or an {url: ...} result object) as
   * opposed to plain text output.
   */
  private static isMediaReference(value: any): boolean {
    if (typeof value === 'string') {
      return value.startsWith('blob:') || value.startsWith('data:');
    }
    if (value && typeof value === 'object' && typeof value.url === 'string') {
      return value.url.startsWith('blob:') || value.url.startsWith('data:') || /^https?:\/\//.test(value.url);
    }
    return false;
  }

  /**
   * Resolve input references: given a node's input mapping and a map of outputs from executed nodes,
   * produce the actual input values.
   *
   * ROOT CAUSE (reported: workflow chaining an Image step into a Text step
   * made the text model respond with "that's a blob URL..."): this method
   * resolves `${nodeId}` references to whatever the upstream node actually
   * output, with no regard for whether the downstream node's input field
   * expects text or media. An image-generation step's output is a
   * browser-local `blob:` URL (meaningless outside this tab, and NOT an
   * image the text model can see) — piping that raw string into a text
   * node's `prompt` field made the LLM receive a blob URL as its literal
   * prompt and — quite reasonably — explain what a blob URL is. This
   * applies generally to any media-producing step (image/video/audio/
   * music/speech) feeding into any text-consuming step (text/research/
   * coding/gamegen/data/doc), not just this one combination, so the fix
   * lives here centrally rather than as a special case for one pair of
   * step types.
   */
  /** Safely render any node output as a string for embedding in another prompt. */
  private static stringifyOutput(value: any): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.url === 'string') return value.url;
    if (value === undefined || value === null) return '';
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  /** Extract a usable media URL from a resolved reference value (string or {url} object). */
  private static mediaUrlOf(value: any): string {
    return typeof value === 'string' ? value : value.url;
  }

  // Node types whose primary input is a literal generation prompt fed straight
  // to a diffusion-style media provider (not an instruction-following chat
  // turn) — a full, multi-paragraph previous-step output overwhelms/gets
  // truncated unpredictably by these and tends to steer the result away from
  // the topic rather than toward it.
  private static readonly DIFFUSION_PROMPT_TYPES = new Set(['image', 'video', 'music']);
  private static readonly MAX_DIFFUSION_PROMPT_CHARS = 500;

  // Node types whose primary input is read by an instruction-following text
  // model. A bare previous-step output with no instruction attached reads to
  // these as an unprompted statement, so the model tends to respond by
  // describing/commenting on that text ("processing" it) instead of producing
  // new, on-topic content — which is the entire point of chaining steps.
  // 'speech' (spoken verbatim) and 'research' (used as a literal search
  // query) are deliberately excluded: wrapping those would corrupt the exact
  // text/query they're meant to carry through unchanged.
  private static readonly INSTRUCTION_TEXT_TYPES = new Set(['text', 'coding', 'gamegen']);

  /**
   * ROOT CAUSE (reported: workflow chaining, e.g. text -> image or
   * image -> text, "gets confused" and ends up just re-processing/describing
   * the previous step's raw content instead of producing new, on-topic
   * content in its own modality): a chained step's entire input was set to
   * the exact, unmodified value the previous node returned, with nothing
   * telling the receiving model/provider what to actually do with it. Two
   * distinct problems hid behind that one symptom:
   *   1) Some node outputs aren't plain text (e.g. ResearchNodeExecutor
   *      returns {papers, sourceStatus, summary}) — passed straight through,
   *      that object stringifies to "[object Object]" wherever a downstream
   *      provider embeds it in a request, which reads as complete nonsense.
   *   2) Even for plain text, a diffusion-style image/video/music prompt
   *      needs a short, on-topic prompt (not a multi-paragraph excerpt), and
   *      an instruction-following text/coding/gamegen step needs to be told
   *      to *build on* the prior text, not just react to seeing it appear
   *      with no framing.
   * Adapts a resolved reference value for the node type about to consume it.
   */
  static adaptChainedValue(nodeType: string, value: any): any {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      value = typeof value.summary === 'string' ? value.summary : GraphUtils.stringifyOutput(value);
    }
    if (typeof value !== 'string') return value;

    if (GraphUtils.DIFFUSION_PROMPT_TYPES.has(nodeType)) {
      const trimmed = value.trim();
      if (trimmed.length > GraphUtils.MAX_DIFFUSION_PROMPT_CHARS) {
        return trimmed.slice(0, GraphUtils.MAX_DIFFUSION_PROMPT_CHARS).replace(/\s+\S*$/, '') + '\u2026';
      }
      return trimmed;
    }

    if (GraphUtils.INSTRUCTION_TEXT_TYPES.has(nodeType)) {
      return 'Using the following as context/reference material, produce new, well-developed, on-topic content ' +
        "(expanding on it, summarizing it, or continuing it, as appropriate) \u2014 don't just restate or describe it " +
        'verbatim:\n\n' + value;
    }

    return value;
  }

  /**
   * A pending upgrade: `values[key]` currently holds either the sentinel
   * (whole-value case) or a string containing `marker` (embedded case) and
   * needs the real caption for `url` substituted in once available.
   */
  static resolveInputsAsync(
    node: Node,
    outputs: Map<string, any>,
    staticInputs: Record<string, any> = {}
  ): { values: Record<string, any>; pending: Array<{ key: string; url: string; marker?: string }> } {
    const resolved: Record<string, any> = {};
    const pending: Array<{ key: string; url: string; marker?: string }> = [];
    const mappings = node.inputs || {};
    const expectsMedia = GraphUtils.MEDIA_CONSUMING_TYPES.has(node.type);
    const resolveRef = (ref: string): any => {
      const [nodeId, ...path] = ref.split('.');
      const output = outputs.get(nodeId);
      if (output === undefined) {
        throw new Error(`Output from node ${nodeId} not found for input reference \${${ref}}`);
      }
      let result = output;
      for (const p of path) {
        if (result && typeof result === 'object' && p in result) {
          result = result[p];
        } else {
          throw new Error(`Cannot access path ${path.join('.')} on output of node ${nodeId}`);
        }
      }
      return result;
    };
    const REF_RE = /\$\{([^}]+)\}/g;
    let markerSeq = 0;
    for (const [key, value] of Object.entries(mappings)) {
      if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}') && value.indexOf('${', 2) === -1) {
        // The ENTIRE value is exactly one reference — preserve whatever
        // type the upstream node actually output (string, {url}, etc.)
        // rather than coercing to a string, so downstream media-aware
        // nodes still get a usable reference, not `"[object Object]"`.
        const result = resolveRef(value.slice(2, -1).trim());
        if (!expectsMedia && GraphUtils.isMediaReference(result)) {
          // Placeholder for now — BaseNodeExecutor.resolveInputs (async)
          // will try to replace this with a real vision-generated caption
          // of the media before the node actually runs; this text is only
          // what's left in place if that upgrade isn't possible (no vision
          // provider available, or the call fails).
          resolved[key] = '[A previous step generated a media file here that could not be described — ' +
            'continuing based on the original request/context only.]';
          pending.push({ key, url: GraphUtils.mediaUrlOf(result) });
        } else if (expectsMedia) {
          // Vision/audio/video nodes need the raw media reference (or raw
          // upstream value) untouched — leave it exactly as resolved.
          resolved[key] = result;
        } else {
          resolved[key] = GraphUtils.adaptChainedValue(node.type, result);
        }
      } else if (typeof value === 'string' && REF_RE.test(value)) {
        // One or more references EMBEDDED in a larger string (e.g. a
        // user-authored template like "Summarize this: ${step1}") — every
        // match is resolved and safely stringified, then substituted in
        // place. This is what lets a UI offer a friendly inline
        // placeholder (see AgentsMode's `{{previous}}`, translated to
        // `${prevNodeId}` before reaching here) instead of requiring the
        // whole field to be nothing but a reference.
        REF_RE.lastIndex = 0;
        resolved[key] = value.replace(REF_RE, (_match, ref) => {
          const result = resolveRef(ref.trim());
          if (!expectsMedia && GraphUtils.isMediaReference(result)) {
            const marker = `\u0000MEDIA_REF_${markerSeq++}\u0000`;
            pending.push({ key, url: GraphUtils.mediaUrlOf(result), marker });
            return marker;
          }
          return GraphUtils.stringifyOutput(result);
        });
      } else {
        resolved[key] = value;
      }
    }
    return { values: { ...staticInputs, ...resolved }, pending };
  }

  /**
   * Synchronous convenience wrapper (used by tests and any caller that
   * doesn't need the vision-caption upgrade) — pending media references
   * fall straight back to the static placeholder text.
   */
  static resolveInputs(
    node: Node,
    outputs: Map<string, any>,
    staticInputs: Record<string, any> = {}
  ): Record<string, any> {
    return GraphUtils.resolveInputsAsync(node, outputs, staticInputs).values;
  }
}
