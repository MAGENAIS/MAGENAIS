import { NodeType } from './types';

/**
 * The primary input field each NodeType's executor actually reads (see
 * each *NodeExecutor.execute() in Node.ts for the authoritative
 * inputs.xxx it resolves). Any UI that builds a workflow graph node by
 * hand (WorkflowModal, AgentsMode, ...) should use this instead of
 * assuming every node type wants `prompt` — that assumption is exactly
 * what made 'speech' steps fail (SpeechNodeExecutor requires `text`, with
 * no `prompt` fallback) and made 'doc-summarize' silently unusable (never
 * a valid NodeType to begin with, so it's intentionally absent here).
 */
export const NODE_PRIMARY_INPUT_KEY: Partial<Record<NodeType, string>> = {
  text: 'prompt',
  image: 'prompt',
  video: 'prompt',
  music: 'prompt',
  coding: 'prompt',
  gamegen: 'concept',
  research: 'query',
  vision: 'prompt',
  speech: 'text',
  audio: 'audio', // STT — expects an audio file/blob, not text; not offered by text-prompt-only step UIs
  // 'data' and 'doc' aren't offered by these linear step builders — they
  // need a file input, which those UIs don't collect.
};

/** Node types that accept a plain natural-language prompt/query as their primary input. */
export const TEXT_PROMPT_NODE_TYPES: NodeType[] = ['text', 'image', 'video', 'music', 'coding', 'gamegen', 'research', 'vision', 'speech'];
