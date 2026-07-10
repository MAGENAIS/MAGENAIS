import { Workflow, Graph } from './types';

/**
 * Factory to create workflow objects.
 */
export class WorkflowFactory {
  static create(name: string, graph: Graph, description?: string): Workflow {
    const now = Date.now();
    return {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      description,
      graph,
      createdAt: now,
      updatedAt: now,
      metadata: {},
    };
  }

  static update(workflow: Workflow, updates: Partial<Workflow>): Workflow {
    return {
      ...workflow,
      ...updates,
      updatedAt: Date.now(),
    };
  }
}

// Simple in-memory store for workflows (later replaced by persistence)
export class WorkflowStore {
  private workflows: Map<string, Workflow> = new Map();

  save(workflow: Workflow): void {
    this.workflows.set(workflow.id, workflow);
  }

  get(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  getAll(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  delete(id: string): boolean {
    return this.workflows.delete(id);
  }

  // Future: persist to IndexedDB or localStorage
}
