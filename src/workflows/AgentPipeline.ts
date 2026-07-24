/**
 * AgentPipeline — the "smart agent" layer behind the Agents tab.
 *
 * Scope note: this file is additive. It does NOT change WorkflowEngine,
 * Graph.ts, Registry.ts, Node.ts, or the Provider Manager — every one of
 * those is reused exactly as-is. Each plan step runs as its own one-node
 * workflow via `kernel.getWorkflowEngine().execute()`, so the retry/skip/
 * continue-on-failure logic below lives entirely in this orchestration
 * layer instead of touching the shared multi-node Engine loop that every
 * other tab (WorkflowModal, etc.) also depends on — Engine.execute() aborts
 * the whole run on a node's first unrecovered failure by design, which is
 * correct for a hand-wired workflow graph but wrong for an autonomous
 * agent that should keep going and report what it could/couldn't do.
 *
 * Memory reuse: short-term step outputs are recorded through the existing
 * AIMemory store (src/aios/Memory.ts) — already built, already wired into
 * Kernel, previously unused by any tab. No new storage mechanism.
 */

import type { Kernel } from '../core/Kernel';
import type { AIMemory } from '../aios/Memory';
import { NodeType, Workflow } from './types';
import { NODE_PRIMARY_INPUT_KEY } from './nodeInputKeys';

export type AgentLogFn = (message: string, level?: 'info' | 'warn' | 'error') => void;

/** The subset of NodeTypes this pipeline can autonomously plan into — must match
 *  the manual step-editor's own type list (AgentsMode.ts) exactly, since both a
 *  real NodeType executor AND a plain-text-prompt primary input are required
 *  (see NODE_PRIMARY_INPUT_KEY's doc comment for why 'vision'/'doc'/'data'/'audio'
 *  don't qualify — they need a real file/image, which a goal string can't supply). */
export const AGENT_PLANNABLE_TYPES: NodeType[] = ['agents', 'research', 'text', 'coding', 'image', 'speech', 'gamegen'];

export interface AgentPlanStep {
  id: string;
  title: string;
  modeType: NodeType;
  promptTemplate: string;
  personaId?: string;
}

export interface AgentPlan {
  goal: string;
  steps: AgentPlanStep[];
}

export interface AgentStepRunResult {
  nodeId: string;
  title: string;
  modeType: NodeType;
  status: 'completed' | 'failed' | 'skipped';
  output?: any;
  error?: string;
  startTime: number;
  endTime: number;
  duration: number;
  attempts: number;
  providerUsed?: string;
  reflection?: { acceptable: boolean; reason: string };
  optimizedPrompt?: string;
}

export interface AgentRunSummary {
  goal: string;
  planSteps: number;
  completedSteps: number;
  skippedSteps: number;
  failedSteps: number;
  durationMs: number;
  providersUsed: string[];
  finalResult: any;
}

export interface AgentRunOutcome {
  nodeResults: AgentStepRunResult[];
  summary: AgentRunSummary;
}

export interface AgentRunOptions {
  goal: string;
  steps: AgentPlanStep[];
  personas: any[];
  optimizePrompts?: boolean; // default true
  reflect?: boolean;         // default true
  maxRetriesPerStep?: number; // default 1
  log?: AgentLogFn;
}

/**
 * Thin, deliberately lightweight wrapper around the existing AIMemory store
 * (src/aios/Memory.ts). Adds nothing new to persistence — just namespaces
 * entries under a 'agent-pipeline' tag + per-run tag so short-term step
 * outputs and a trimmed "conversation context" digest can be reconstructed,
 * and lets old entries expire on their own via AIMemory's existing TTL
 * handling rather than needing any cleanup job.
 */
export class AgentMemory {
  constructor(private memory: AIMemory) {}

  private key(runId: string, stepId: string): string {
    return `agent-pipeline:${runId}:${stepId}`;
  }

  /** Workflow memory / previous outputs — one entry per completed step, 24h TTL (short-term by design). */
  recordStep(runId: string, stepId: string, output: any): void {
    const text = typeof output === 'string' ? output : (() => { try { return JSON.stringify(output ?? ''); } catch { return String(output); } })();
    this.memory.set(this.key(runId, stepId), text.slice(0, 4000), 24 * 60 * 60 * 1000, ['agent-pipeline', `run:${runId}`]);
  }

  /** Conversation context — a short digest of the most recent step outputs for this run, for continuity in later steps/reflection without re-sending the entire history every time. */
  getContextDigest(runId: string, maxEntries = 3, maxChars = 1200): string {
    const entries = this.memory.getByTag(`run:${runId}`).sort((a, b) => a.timestamp - b.timestamp).slice(-maxEntries);
    if (!entries.length) return '';
    return entries.map(e => String(e.value)).join('\n---\n').slice(-maxChars);
  }

  /** Optional manual cleanup — entries also expire on their own via AIMemory's TTL. */
  clearRun(runId: string): void {
    this.memory.getByTag(`run:${runId}`).forEach(e => this.memory.delete(e.key));
  }
}

export class AgentPipeline {
  private agentMemory: AgentMemory;

  constructor(private kernel: Kernel) {
    this.agentMemory = new AgentMemory(kernel.getMemory());
  }

  getMemory(): AgentMemory {
    return this.agentMemory;
  }

  /** Loosely parses a JSON object out of a model response that may be wrapped in
   *  markdown fences or preceded/followed by commentary the prompt asked it not
   *  to include (models don't always comply) — returns null rather than throwing
   *  so every caller here can fall back gracefully instead of failing the run. */
  private static parseJsonLoose(text: string): any {
    if (!text) return null;
    let s = text.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  private static textify(value: any): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && typeof (value as any).url === 'string') return (value as any).url;
    try { return JSON.stringify(value); } catch { return String(value); }
  }

  /** Scans the log lines a single step's provider call produced for
   *  ProviderManager's own "<name> succeeded first — rendering result now."
   *  line (see Manager.ts raceForFirstSuccess) to attribute which provider
   *  actually served a step, for the execution summary — without requiring
   *  any change to ProviderManager's public API/return value. Best-effort:
   *  if the wording ever changes, the summary just omits that field. */
  private static extractProvider(logs: string[]): string | undefined {
    for (const line of logs) {
      const m = line.match(/^(.+?) succeeded first — rendering result now\.$/);
      if (m) return m[1];
    }
    return undefined;
  }

  private services() {
    return { providerManager: this.kernel.getProviderManager(), router: this.kernel.getRouter() };
  }

  /**
   * Requirement 2 (Automatic Planning) + Requirement 5 (Tool Selection):
   * asks an 'agents' provider to break the goal into an ordered list of
   * steps, each already tagged with the best-fit MAGENAIS mode — one call
   * covers both, rather than a separate classification round-trip per step.
   * Falls back to a single-step plan (using the goal as-is) if planning
   * fails or returns something unusable, so a flaky/unavailable planner
   * never blocks the agent from attempting the task at all.
   */
  async planFromGoal(goal: string, log?: AgentLogFn): Promise<AgentPlan> {
    const trimmedGoal = (goal || '').trim();
    if (!trimmedGoal) return { goal: trimmedGoal, steps: [] };

    const allowedTypes = AGENT_PLANNABLE_TYPES.join(', ');
    const planningPrompt =
      `You are a planning assistant for an AI agent. Break the user's goal into a short ordered list of concrete steps ` +
      `(1 step if the goal is already simple/atomic, up to 6 for a multi-part goal).\n` +
      `For each step choose the single best "type" from exactly this list: ${allowedTypes}.\n` +
      `- "text": general writing/reasoning/analysis\n` +
      `- "agents": a task with real-world/action framing (bookings, purchases, device control) that needs an honest "can't literally do this, but here's how" answer\n` +
      `- "research": literature/academic paper questions only — never for general tasks\n` +
      `- "coding": writing code\n` +
      `- "image": generating an image\n` +
      `- "speech": converting text to spoken audio\n` +
      `- "gamegen": generating a small browser game\n\n` +
      `Respond with ONLY minified JSON, no markdown fences, no commentary, in exactly this shape:\n` +
      `{"steps":[{"title":"short title","type":"text","prompt":"the exact standalone instruction for this step"}]}\n` +
      `Use {{previous}} inside a later step's "prompt" to refer to the previous step's output where useful.\n\n` +
      `Goal: "${trimmedGoal}"`;

    let steps: AgentPlanStep[] = [];
    try {
      const { providerManager, router } = this.services();
      const raw = await providerManager.callWithFallback('agents', router, { prompt: planningPrompt }, { temperature: 0.3, maxTokens: 2048 }, log);
      const text = typeof raw === 'string' ? raw : AgentPipeline.textify(raw);
      const parsed = AgentPipeline.parseJsonLoose(text);
      if (parsed && Array.isArray(parsed.steps) && parsed.steps.length) {
        steps = parsed.steps.slice(0, 8).map((s: any, i: number) => ({
          id: `plan-${Date.now()}-${i}`,
          title: String(s?.title || `Step ${i + 1}`).slice(0, 120),
          modeType: (AGENT_PLANNABLE_TYPES.includes(s?.type) ? s.type : 'agents') as NodeType,
          promptTemplate: String(s?.prompt || trimmedGoal).slice(0, 8000),
        }));
      }
    } catch (err: any) {
      log?.(`Auto-planning failed (${err?.message || err}) — falling back to a single-step plan.`, 'warn');
    }

    if (!steps.length) {
      steps = [{ id: `plan-${Date.now()}-0`, title: 'Complete the task', modeType: 'agents', promptTemplate: trimmedGoal }];
    }
    return { goal: trimmedGoal, steps };
  }

  /**
   * Requirement 6 (Prompt Optimization): a best-effort rewrite pass that
   * preserves intent while improving clarity — never blocks or fails the
   * step it belongs to. Skips very long prompts (already detailed, and
   * round-tripping 4000+ characters through another provider call for
   * marginal gain isn't "lightweight" per Requirement 9) and silently keeps
   * the original on any error, timeout, or suspicious-length response.
   */
  async optimizePrompt(rawPrompt: string, goalContext: string, log?: AgentLogFn): Promise<string> {
    const prompt = (rawPrompt || '').trim();
    if (!prompt || prompt.length > 4000) return rawPrompt;
    try {
      const { providerManager, router } = this.services();
      const optPrompt =
        `Rewrite the following instruction to be clearer and more specific, while strictly preserving its ` +
        `original meaning, intent, and any placeholders like {{previous}} exactly as written. Respond with ONLY ` +
        `the rewritten instruction — no commentary, no quotes, no markdown fences.\n\n` +
        `Original instruction:\n"""\n${prompt}\n"""\n\nOverall goal for context: "${goalContext}"`;
      const result = await providerManager.callWithFallback('agents', router, { prompt: optPrompt }, { temperature: 0.2, maxTokens: 1024 }, log);
      const text = (typeof result === 'string' ? result : AgentPipeline.textify(result)).trim().replace(/^["']|["']$/g, '');
      // Sanity guard: an empty/near-empty or wildly longer response is more
      // likely a misfire (or the model padding with commentary despite the
      // instruction) than a genuine improvement — keep the original rather
      // than risk sending something worse than what the user/planner wrote.
      if (text && text.length > 3 && text.length < prompt.length * 4) {
        return text;
      }
    } catch {
      // Optimization is best-effort — never blocks the step.
    }
    return rawPrompt;
  }

  /**
   * Requirement 7 (Reflection): judges whether a step's output reasonably
   * completes that step. If the judge call itself is unavailable or fails,
   * defaults to accepting the step's own output rather than blocking the
   * whole pipeline on a second, non-essential AI call.
   */
  async reflectStep(stepGoal: string, output: any, log?: AgentLogFn): Promise<{ acceptable: boolean; reason: string }> {
    const outputText = AgentPipeline.textify(output).slice(0, 4000);
    if (!outputText.trim()) return { acceptable: false, reason: 'The step produced no usable output.' };
    try {
      const { providerManager, router } = this.services();
      const judgePrompt =
        `Judge whether this AI output reasonably completes the given step. Respond with ONLY minified JSON, ` +
        `no commentary, no markdown fences: {"acceptable":true|false,"reason":"one short sentence"}.\n\n` +
        `Step: "${stepGoal}"\n\nOutput:\n"""\n${outputText.slice(0, 3000)}\n"""`;
      const raw = await providerManager.callWithFallback('agents', router, { prompt: judgePrompt }, { temperature: 0, maxTokens: 256 }, log);
      const parsed = AgentPipeline.parseJsonLoose(typeof raw === 'string' ? raw : AgentPipeline.textify(raw));
      if (parsed && typeof parsed.acceptable === 'boolean') {
        return { acceptable: parsed.acceptable, reason: String(parsed.reason || '').slice(0, 300) };
      }
    } catch {
      // Reflection is a best-effort quality gate, not a hard requirement.
    }
    return { acceptable: true, reason: 'Reflection unavailable — accepted by default.' };
  }

  /**
   * Runs one plan step as its own single-node workflow, reusing whichever
   * NodeExecutor is already registered for step.modeType (TextNodeExecutor,
   * AgentNodeExecutor, CodingNodeExecutor, ...) — same provider-fallback
   * behavior, same config wiring, as every other tab. This is the seam that
   * keeps the shared WorkflowEngine/Registry untouched while still letting
   * this pipeline own retry/skip/continue decisions between steps.
   */
  private async executeSingleStep(step: AgentPlanStep, prompt: string, persona: any, log?: AgentLogFn): Promise<any> {
    const inputKey = NODE_PRIMARY_INPUT_KEY[step.modeType] || 'prompt';
    const workflow: Workflow = {
      id: 'agent-step-' + step.id,
      name: step.title,
      graph: {
        nodes: [{
          id: step.id,
          type: step.modeType,
          label: step.title,
          // ROOT CAUSE FIX: the legacy Agents pipeline builder hardcoded
          // `{ model: 'openai', temp: 0.7 }` for every step regardless of
          // the chosen persona — `temp` is never read (callProvider/Node.ts
          // reads `node.config?.temperature`), so a persona's temperature
          // setting silently had no effect, and its model choice was
          // dropped entirely. Wiring the real field names here fixes both;
          // the 'openai' Pollinations-alias default is preserved exactly
          // for steps with no persona attached, for backward compatibility.
          config: { model: persona?.model || 'openai', temperature: persona?.temp ?? 0.7 },
          inputs: { [inputKey]: prompt },
          enabled: true,
        }],
        edges: [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const result = await this.kernel.getWorkflowEngine().execute(workflow, {}, log);
    const nodeResult = result.nodeResults[0];
    if (!nodeResult || nodeResult.status !== 'completed') {
      throw new Error(nodeResult?.error || 'Step failed with no further detail.');
    }
    return nodeResult.output;
  }

  /**
   * Requirement 3 (Dynamic Workflow) + Requirement 4 (Agent Memory) +
   * Requirement 7 (Reflection) + Requirement 8 (Execution Summary), all in
   * one runner used for BOTH auto-planned and manually-authored pipelines
   * (AgentsMode.ts no longer builds its own separate multi-node graph —
   * see Requirement 9, "avoid duplicate logic"). Steps run sequentially;
   * a step that fails or a reflection judged unacceptable gets up to
   * `maxRetriesPerStep` extra attempts, then the run continues to the next
   * step regardless (never aborts the whole pipeline on one bad step) — the
   * per-step failure is recorded and reported in the summary instead.
   */
  async runSteps(opts: AgentRunOptions): Promise<AgentRunOutcome> {
    const { steps, personas, log } = opts;
    const optimize = opts.optimizePrompts !== false;
    const reflect = opts.reflect !== false;
    const maxRetries = Math.max(0, opts.maxRetriesPerStep ?? 1);
    const runId = 'run-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const startTime = Date.now();

    const outputs = new Map<string, any>();
    const results: AgentStepRunResult[] = [];
    const providersUsed = new Set<string>();

    for (let idx = 0; idx < steps.length; idx++) {
      const step = steps[idx];
      const prevStep = idx > 0 ? steps[idx - 1] : null;
      const stepStart = Date.now();

      let promptTemplate = step.promptTemplate || '';
      if (prevStep) {
        const prevText = AgentPipeline.textify(outputs.get(prevStep.id));
        promptTemplate = promptTemplate.replace(/\{\{\s*previous\s*\}\}/gi, prevText);
      }

      // Requirement 3, "skip unnecessary steps": a step whose only content
      // was a {{previous}} reference into a step that produced nothing
      // usable (failed/skipped) would just send an empty prompt to a
      // provider and fail anyway — report a clean skip instead.
      if (!promptTemplate.trim()) {
        results.push({
          nodeId: step.id, title: step.title, modeType: step.modeType, status: 'skipped',
          error: 'Skipped — the referenced previous step produced no usable output.',
          startTime: stepStart, endTime: Date.now(), duration: 0, attempts: 0,
        });
        log?.(`Step "${step.title}" skipped — no input available.`, 'warn');
        continue;
      }

      let optimizedPrompt: string | undefined;
      if (optimize) {
        optimizedPrompt = await this.optimizePrompt(promptTemplate, opts.goal, log);
        if (optimizedPrompt === promptTemplate) optimizedPrompt = undefined;
      }
      const effectivePrompt = optimizedPrompt || promptTemplate;

      const persona = step.personaId ? personas.find((p: any) => p.id === step.personaId) : null;
      const finalPrompt = persona?.instructions ? `${persona.instructions}\n\n${effectivePrompt}` : effectivePrompt;

      let attempts = 0;
      let output: any;
      let error: string | undefined;
      let status: AgentStepRunResult['status'] = 'completed';
      let providerUsed: string | undefined;
      let reflection: { acceptable: boolean; reason: string } | undefined;

      // Requirement 3, "retry failed steps" + Requirement 7, reflection-driven retry.
      while (attempts <= maxRetries) {
        attempts++;
        const seenLogs: string[] = [];
        const wrappedLog: AgentLogFn = (msg, level) => { seenLogs.push(msg); log?.(msg, level); };
        try {
          output = await this.executeSingleStep(step, finalPrompt, persona, wrappedLog);
          providerUsed = AgentPipeline.extractProvider(seenLogs) || providerUsed;
          status = 'completed';
          error = undefined;
        } catch (err: any) {
          status = 'failed';
          error = err?.message || String(err);
          providerUsed = AgentPipeline.extractProvider(seenLogs) || providerUsed;
        }

        if (status === 'completed' && reflect) {
          reflection = await this.reflectStep(step.promptTemplate || step.title, output, log);
          if (!reflection.acceptable && attempts <= maxRetries) {
            log?.(`Reflection: step "${step.title}" needs another pass (${reflection.reason}) — retrying.`, 'warn');
            continue;
          }
        }
        break;
      }

      if (status === 'failed') {
        // Requirement 3, "continue execution automatically": log and move
        // on to the next step rather than throwing out of runSteps().
        log?.(`Step "${step.title}" failed after ${attempts} attempt(s): ${error} — continuing with remaining steps.`, 'error');
      }

      outputs.set(step.id, output);
      if (providerUsed) providersUsed.add(providerUsed);
      if (status === 'completed') this.agentMemory.recordStep(runId, step.id, output);

      results.push({
        nodeId: step.id,
        title: step.title,
        modeType: step.modeType,
        status,
        output: status === 'completed' ? output : undefined,
        error,
        startTime: stepStart,
        endTime: Date.now(),
        duration: Date.now() - stepStart,
        attempts,
        providerUsed,
        reflection,
        optimizedPrompt,
      });
    }

    const endTime = Date.now();
    const completedSteps = results.filter(r => r.status === 'completed').length;
    const skippedSteps = results.filter(r => r.status === 'skipped').length;
    const failedSteps = results.filter(r => r.status === 'failed').length;
    const lastCompleted = [...results].reverse().find(r => r.status === 'completed');

    const summary: AgentRunSummary = {
      goal: opts.goal,
      planSteps: steps.length,
      completedSteps,
      skippedSteps,
      failedSteps,
      durationMs: endTime - startTime,
      providersUsed: Array.from(providersUsed),
      finalResult: lastCompleted?.output,
    };

    return { nodeResults: results, summary };
  }
}
