/**
 * Remote Compute – offload heavy tasks to a backend server.
 * This is a stub for future implementation.
 */

import { ComputeTask } from './types';
import { Logger } from '../core/Logger';
import { EventBus } from '../core/EventBus';

export class RemoteCompute {
  private eventBus: EventBus;
  private tasks: Map<string, ComputeTask> = new Map();
  private endpoint: string = ''; // configurable

  constructor(eventBus: EventBus, endpoint?: string) {
    this.eventBus = eventBus;
    this.endpoint = endpoint || '';
  }

  /**
   * Submit a task for remote execution.
   */
  async submitTask(type: string, input: any, options?: any): Promise<string> {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const task: ComputeTask = {
      id,
      type,
      input,
      options,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.tasks.set(id, task);
    this.eventBus.emit('compute:taskSubmitted', task);

    if (this.endpoint) {
      // Simulate sending to remote
      Logger.info(`Submitting task ${id} to remote endpoint ${this.endpoint}`);
      // In real implementation, we would POST to the endpoint.
      // For now, we just simulate completion.
      setTimeout(() => {
        const t = this.tasks.get(id);
        if (t) {
          t.status = 'completed';
          t.result = `[Remote result for ${type}]`;
          t.updatedAt = Date.now();
          this.eventBus.emit('compute:taskCompleted', t);
        }
      }, 2000);
    } else {
      Logger.warn('Remote compute endpoint not configured; task will remain pending.');
    }
    return id;
  }

  /**
   * Get task status.
   */
  getTask(id: string): ComputeTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Get all tasks.
   */
  getTasks(): ComputeTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Set remote endpoint.
   */
  setEndpoint(url: string): void {
    this.endpoint = url;
    Logger.info(`Remote compute endpoint set to ${url}`);
  }
}
