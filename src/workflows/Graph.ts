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

  static resolveInputs(
    node: Node,
    outputs: Map<string, any>,
    staticInputs: Record<string, any> = {}
  ): Record<string, any> {
    const resolved: Record<string, any> = {};
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
    for (const [key, value] of Object.entries(mappings)) {
      if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}') && value.indexOf('${', 2) === -1) {
        // The ENTIRE value is exactly one reference — preserve whatever
        // type the upstream node actually output (string, {url}, etc.)
        // rather than coercing to a string, so downstream media-aware
        // nodes still get a usable reference, not `"[object Object]"`.
        let result = resolveRef(value.slice(2, -1).trim());
        if (!expectsMedia && GraphUtils.isMediaReference(result)) {
          result = '[The previous workflow step generated a media file (image, audio, or video) here, ' +
            'not text — its content cannot be read directly. Continue based on the original request/context only, ' +
            'or add a Vision step to the workflow if the content of that file needs to be analyzed.]';
        }
        resolved[key] = result;
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
          let result = resolveRef(ref.trim());
          if (!expectsMedia && GraphUtils.isMediaReference(result)) {
            return '[a generated media file from a previous step, not readable as text]';
          }
          return GraphUtils.stringifyOutput(result);
        });
      } else {
        // Static value (or directly provided)
        resolved[key] = value;
      }
    }
    // Merge with static inputs (allow override)
    return { ...staticInputs, ...resolved };
  }
}
