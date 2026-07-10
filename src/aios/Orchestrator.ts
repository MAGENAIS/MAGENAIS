/**
 * Multi-Agent Orchestrator – coordinates execution of multiple agents.
 * Agents can be workflows, LLM calls, research agents, or custom.
 */

import { AgentDefinition, OrchestrationPlan, OrchestrationResult } from './types';
import { Kernel } from '../core/Kernel';
import { Logger } from '../core/Logger';
import { EventBus } from '../core/EventBus';

export class AgentOrchestrator {
  private kernel: Kernel;
  private eventBus: EventBus;

  constructor(kernel: Kernel) {
    this.kernel = kernel;
    this.eventBus = kernel.getEventBus();
  }

  /**
   * Execute an orchestration plan.
   */
  async execute(plan: OrchestrationPlan): Promise<OrchestrationResult[]> {
    Logger.info(`Executing orchestration with ${plan.agents.length} agents, mode: ${plan.mode}`);

    const results: OrchestrationResult[] = [];

    if (plan.mode === 'sequential') {
      for (const agent of plan.agents) {
        const result = await this.executeAgent(agent);
        results.push(result);
        if (result.error) {
          // Optionally stop on error
          break;
        }
      }
    } else if (plan.mode === 'parallel') {
      const promises = plan.agents.map(agent => this.executeAgent(agent));
      const res = await Promise.allSettled(promises);
      res.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          results.push(r.value);
        } else {
          results.push({
            agentId: plan.agents[i].id,
            output: null,
            error: r.reason?.message || 'Unknown error',
            duration: 0,
          });
        }
      });
    } else if (plan.mode === 'conditional') {
      // Simplified: run first agent, then decide based on output.
      // For now, we just run all agents in order.
      for (const agent of plan.agents) {
        const result = await this.executeAgent(agent);
        results.push(result);
      }
    }

    this.eventBus.emit('orchestration:completed', { plan, results });
    return results;
  }

  /**
   * Execute a single agent.
   */
  private async executeAgent(agent: AgentDefinition): Promise<OrchestrationResult> {
    const start = Date.now();
    try {
      let output: any;
      switch (agent.type) {
        case 'workflow': {
          const workflowId = agent.config.workflowId;
          if (!workflowId) throw new Error('Workflow ID is required for workflow agent.');
          const workflow = this.kernel.getWorkflowStore().get(workflowId);
          if (!workflow) throw new Error(`Workflow ${workflowId} not found.`);
          const inputs = agent.config.inputs || {};
          const result = await this.kernel.getWorkflowEngine().execute(workflow, inputs);
          output = result.finalOutput;
          break;
        }
        case 'llm': {
          const prompt = agent.config.prompt || '';
          const model = agent.config.model;
          const temperature = agent.config.temperature ?? 0.8;
          // Use the text provider fallback chain
          const text = await this.kernel
            .getProviderManager()
            .callWithFallback('text', this.kernel.getRouter(), { prompt }, { model, temperature });
          output = text;
          break;
        }
        case 'research': {
          const query = agent.config.query || '';
          // Use existing research nodes (we can invoke a workflow)
          // For simplicity, we'll use a direct call to the research workflow.
          const workflow = this.kernel.getWorkflowStore().get('research-workflow');
          if (!workflow) throw new Error('Research workflow not found.');
          const result = await this.kernel.getWorkflowEngine().execute(workflow, { query });
          output = result.finalOutput;
          break;
        }
        default:
          throw new Error(`Unsupported agent type: ${agent.type}`);
      }
      const duration = Date.now() - start;
      this.eventBus.emit('agent:executed', { agentId: agent.id, output, duration });
      return { agentId: agent.id, output, duration };
    } catch (err: any) {
      const duration = Date.now() - start;
      Logger.error(`Agent ${agent.id} failed:`, err);
      return { agentId: agent.id, output: null, error: err.message, duration };
    }
  }
}
