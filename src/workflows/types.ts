/**
 * Core types for the Workflow Engine.
 * Defines nodes, edges, graphs, execution context and statuses.
 */

// --- Node Types ---
export type NodeType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'speech'
  | 'music'
  | 'research'
  | 'gamegen'
  | 'data'
  | 'doc'
  | 'coding'
  | 'vision';

// --- Node Input Mapping ---
// A mapping from a node's input field name to a value or a reference to another node's output.
// Static values (any JS value, including File/Blob/parsed objects) or a
// { ref: nodeId } pointing at another node's output.
export type InputMapping = Record<string, any>;

// --- Node Definition ---
export interface Node {
  id: string;
  type: NodeType;
  label: string;
  // Configuration specific to the node type (e.g., model, prompt template, parameters)
  config: Record<string, any>;
  // Input mappings: how to resolve inputs for this node from previous outputs or static values.
  inputs?: InputMapping;
  // Timeout in milliseconds (overrides provider default)
  timeout?: number;
  // Number of retries on failure (overrides provider default)
  retries?: number;
  // Optional cache key to reuse results; if not provided, defaults to node id + input hash.
  cacheKey?: string;
  // Whether this node is enabled; if false, it is skipped.
  enabled?: boolean;
}

// --- Edge Definition ---
export interface Edge {
  from: string;   // source node id
  to: string;     // target node id
  // optional condition: if expression evaluates to false, the edge is not traversed
  condition?: string;
}

// --- Graph Definition ---
export interface Graph {
  nodes: Node[];
  edges: Edge[];
}

// --- Workflow Definition ---
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  graph: Graph;
  createdAt: number;
  updatedAt: number;
  // metadata like author, version, etc.
  metadata?: Record<string, any>;
}

// --- Execution Context ---
// Carries data through the workflow execution.
export interface ExecutionContext {
  // Inputs provided when starting the workflow (e.g., user prompt, file data)
  inputs: Record<string, any>;
  // Variables that can be set during execution (e.g., from node outputs, keyed by node id)
  variables: Map<string, any>;
  // Cache for node results (shared across the execution)
  cache: Map<string, any>;
  // Optional logger callback
  log?: (message: string, level?: 'info' | 'warn' | 'error') => void;
  // Provider platform services, injected by the Kernel so node executors can
  // reach real providers without reaching back into a global singleton.
  services?: {
    providerManager: import('../providers/registry/Manager').ProviderManager;
    router: import('../providers/Router').SmartRouter;
  };
}

// --- Node Status ---
export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

// --- Node Execution Result ---
export interface NodeResult {
  nodeId: string;
  status: NodeStatus;
  output?: any;           // the actual output data (text, image URL, etc.)
  error?: string;         // error message if failed
  startTime: number;
  endTime: number;
  duration: number;       // ms
  cacheHit?: boolean;
}

// --- Workflow Execution Result ---
export interface WorkflowResult {
  workflowId: string;
  status: 'completed' | 'failed' | 'partial';
  nodeResults: NodeResult[];
  finalOutput?: any;      // output of the last node (or a designated output node)
  error?: string;
  startTime: number;
  endTime: number;
  duration: number;
}

// --- Node Executor Interface ---
// Each node type implements this to perform its work.
export interface NodeExecutor {
  type: NodeType;
  execute(node: Node, context: ExecutionContext): Promise<any>;
}

// --- Node Registry contract ---
// Implemented by the concrete NodeRegistry class in Registry.ts (the runtime value
// export). Kept here only as a type alias so callers can depend on the shape
// without creating a duplicate 'NodeRegistry' export collision at the barrel file.
export interface NodeRegistryContract {
  register(executor: NodeExecutor): void;
  getExecutor(type: NodeType): NodeExecutor | undefined;
}
