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

  /**
   * Resolve input references: given a node's input mapping and a map of outputs from executed nodes,
   * produce the actual input values.
   */
  static resolveInputs(
    node: Node,
    outputs: Map<string, any>,
    staticInputs: Record<string, any> = {}
  ): Record<string, any> {
    const resolved: Record<string, any> = {};
    const mappings = node.inputs || {};
    for (const [key, value] of Object.entries(mappings)) {
      if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
        // Reference: ${nodeId.output}
        const ref = value.slice(2, -1).trim();
        const [nodeId, ...path] = ref.split('.');
        const output = outputs.get(nodeId);
        if (output === undefined) {
          throw new Error(`Output from node ${nodeId} not found for input ${key}`);
        }
        let result = output;
        for (const p of path) {
          if (result && typeof result === 'object' && p in result) {
            result = result[p];
          } else {
            throw new Error(`Cannot access path ${path.join('.')} on output of node ${nodeId}`);
          }
        }
        resolved[key] = result;
      } else {
        // Static value (or directly provided)
        resolved[key] = value;
      }
    }
    // Merge with static inputs (allow override)
    return { ...staticInputs, ...resolved };
  }
}
