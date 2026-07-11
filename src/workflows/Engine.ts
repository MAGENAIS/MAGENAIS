import {
  Graph,
  Workflow,
  ExecutionContext,
  NodeResult,
  WorkflowResult,
  Node,
} from './types';
import { GraphUtils } from './Graph';
import { NodeRegistry } from './Registry';
import { Logger } from '../core/Logger';
import { ProviderManager } from '../providers/registry/Manager';
import { SmartRouter } from '../providers/Router';

export interface EngineOptions {
  registry: NodeRegistry;
  // default timeout per node if not specified
  defaultTimeout?: number;
  defaultRetries?: number;
  // cache to share across executions
  cache?: Map<string, any>;
  // Provider platform services made available to every node executor via context.services
  providerManager?: ProviderManager;
  router?: SmartRouter;
}

export class WorkflowEngine {
  private registry: NodeRegistry;
  private defaultTimeout: number;
  private defaultRetries: number;
  private cache: Map<string, any>;
  private providerManager?: ProviderManager;
  private router?: SmartRouter;

  constructor(options: EngineOptions) {
    this.registry = options.registry;
    this.defaultTimeout = options.defaultTimeout || 60000; // 1 minute
    this.defaultRetries = options.defaultRetries || 0;
    this.cache = options.cache || new Map();
    this.providerManager = options.providerManager;
    this.router = options.router;
  }

  /**
   * Execute a workflow graph with the given inputs.
   */
  async execute(workflow: Workflow, inputs: Record<string, any>): Promise<WorkflowResult> {
    const startTime = Date.now();
    const context: ExecutionContext = {
      inputs,
      variables: new Map(), // we'll store outputs by node id
      cache: this.cache,
      log: (msg, level = 'info') => Logger[level](`[Workflow ${workflow.id}] ${msg}`),
      services: this.providerManager && this.router
        ? { providerManager: this.providerManager, router: this.router }
        : undefined,
    };

    const graph = workflow.graph;
    // Validate graph
    GraphUtils.validate(graph);

    // Get execution order (topological)
    const order = GraphUtils.getTopologicalOrder(graph);
    // Map node id to Node object for quick lookup
    const nodeMap = new Map<string, Node>();
    graph.nodes.forEach(n => nodeMap.set(n.id, n));

    const nodeResults: NodeResult[] = [];
    const outputs = new Map<string, any>(); // store outputs for reference

    // Execute nodes in order, but also handle concurrency: we can run independent nodes in parallel.
    // For simplicity, we'll run in topological order but we can run parallel batches.
    // We'll implement a simple parallel execution: at each step, run all nodes whose dependencies are satisfied.
    // We'll keep a set of completed nodes and a set of running nodes.
    const completed = new Set<string>();
    const running = new Set<string>();
    const failed = new Set<string>();

    // Helper to execute a single node
    const executeNode = async (nodeId: string): Promise<void> => {
      const node = nodeMap.get(nodeId)!;
      if (!node.enabled) {
        // skip
        completed.add(nodeId);
        return;
      }
      const nodeStart = Date.now();
      let status: 'completed' | 'failed' = 'completed';
      let output: any = null;
      let error: string | undefined;
      let cacheHit = false;

      // Check cache
      //
      // ROOT CAUSE (Priority 1 — "Generate only works once"): every mode
      // builds its workflow with a fixed node id per modality (e.g. 'text1',
      // 'img1', 'research1', ...) and a `node.config` that only carries UI
      // option state (model, temperature, sliders, ...) — the user's actual
      // prompt/text/file lives in `node.inputs` / `context.inputs`, which are
      // resolved separately by each executor. The cache key below previously
      // omitted those inputs entirely, so two calls with the *same node id
      // and same options but a different prompt* hashed to the *same cache
      // key* and the engine's shared, kernel-lifetime `this.cache` returned
      // the first run's stale output forever after — visible to the user as
      // "clicking Generate again does nothing" even though the promise chain
      // itself completed fine. Including the resolved inputs (and the raw
      // workflow-level inputs, for nodes with no incoming edges) in the key
      // ensures a new prompt/file always produces a fresh cache key.
      const resolvedInputs = GraphUtils.resolveInputs(node, outputs, context.inputs);
      const cacheKey = node.cacheKey || `${nodeId}:${JSON.stringify(node.config)}:${JSON.stringify(resolvedInputs)}`;
      if (this.cache.has(cacheKey)) {
        output = this.cache.get(cacheKey);
        cacheHit = true;
        Logger.debug(`Cache hit for node ${nodeId}`);
      } else {
        // Get executor
        const executor = this.registry.getExecutor(node.type);
        if (!executor) {
          throw new Error(`No executor registered for node type: ${node.type}`);
        }
        // Retry logic
        let attempts = 0;
        const maxRetries = node.retries !== undefined ? node.retries : this.defaultRetries;
        let lastError: any;
        while (attempts <= maxRetries) {
          try {
            // Resolve inputs dynamically by passing the outputs map to the executor's context
            // We'll set the context.variables to the outputs map
            // But the executor needs to know which outputs are available.
            // We'll pass the outputs map to the executor via context.
            // We'll also ensure that the executor uses the resolveInputs method.
            // For simplicity, we'll call the executor with the node and context.
            // However, the context.variables should be the outputs map.
            // We'll create a new context for this node execution, but we want to share outputs.
            // We'll mutate the context.variables to be the outputs map.
            // We'll also pass the context.log.
            const execContext = {
              ...context,
              variables: outputs, // reference to the outputs map
            };
            output = await executor.execute(node, execContext);
            break; // success
          } catch (err) {
            lastError = err;
            attempts++;
            if (attempts <= maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, attempts), 10000);
              Logger.warn(`Retry ${attempts}/${maxRetries} for node ${nodeId} in ${delay}ms`);
              await new Promise(r => setTimeout(r, delay));
            }
          }
        }
        if (attempts > maxRetries) {
          status = 'failed';
          error = lastError?.message || 'Unknown error';
          failed.add(nodeId);
        } else {
          // Store in cache
          this.cache.set(cacheKey, output);
        }
      }

      const nodeEnd = Date.now();
      const result: NodeResult = {
        nodeId,
        status,
        output: status === 'completed' ? output : undefined,
        error,
        startTime: nodeStart,
        endTime: nodeEnd,
        duration: nodeEnd - nodeStart,
        cacheHit,
      };
      nodeResults.push(result);

      if (status === 'completed') {
        completed.add(nodeId);
        outputs.set(nodeId, output);
        context.log?.(`Node ${nodeId} completed in ${result.duration}ms`);
      } else {
        context.log?.(`Node ${nodeId} failed: ${error}`, 'error');
        // If a node fails, we may continue or stop. We'll stop for now.
        throw new Error(`Node ${nodeId} failed: ${error}`);
      }
    };

    // Execute nodes in topological order with concurrency
    // We'll use a queue of ready nodes (nodes whose dependencies are completed)
    // We'll run them in parallel using Promise.all with limited concurrency? We'll just run all ready at once.
    // But we need to respect order: we can run nodes whose dependencies are all completed.
    const ready = () => {
      const candidates: string[] = [];
      for (const nodeId of order) {
        if (completed.has(nodeId) || running.has(nodeId) || failed.has(nodeId)) continue;
        const deps = GraphUtils.getPredecessors(graph, nodeId);
        const allCompleted = deps.every(d => completed.has(d));
        if (allCompleted) {
          candidates.push(nodeId);
        }
      }
      return candidates;
    };

    while (completed.size < graph.nodes.length) {
      const readyNodes = ready();
      if (readyNodes.length === 0) {
        // Deadlock or cycle? Should not happen due to validation.
        throw new Error('No nodes ready to execute; possible deadlock.');
      }
      // Execute all ready nodes concurrently
      const promises = readyNodes.map(nodeId => executeNode(nodeId));
      await Promise.all(promises);
    }

    const endTime = Date.now();
    // Determine overall status
    const overallStatus = failed.size > 0 ? (failed.size === graph.nodes.length ? 'failed' : 'partial') : 'completed';
    // Find final output: output of leaf nodes or the last node in order
    const leafIds = GraphUtils.getLeafNodes(graph).map(n => n.id);
    const finalOutput = leafIds.length > 0 ? outputs.get(leafIds[0]) : undefined;

    return {
      workflowId: workflow.id,
      status: overallStatus,
      nodeResults,
      finalOutput,
      error: failed.size > 0 ? 'Some nodes failed' : undefined,
      startTime,
      endTime,
      duration: endTime - startTime,
    };
  }
}
