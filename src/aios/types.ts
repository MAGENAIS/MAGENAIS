/**
 * Types for AI Operating System features.
 */

// --- AI Memory ---
export interface MemoryEntry {
  key: string;
  value: any;
  timestamp: number;
  ttl?: number; // time-to-live in ms, optional
  tags?: string[];
}

export interface MemoryStore {
  [key: string]: MemoryEntry;
}

// --- Prompt Library ---
export interface PromptEntry {
  id: string;
  name: string;
  text: string;
  description?: string;
  tags: string[];
  category?: string;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
  favorite: boolean;
  metadata?: Record<string, any>;
}

// --- Model Marketplace ---
export interface ModelListing {
  id: string;
  name: string;
  description: string;
  provider: string; // e.g., 'openai', 'huggingface'
  modelId: string;  // actual model id
  type: string;     // 'text', 'image', etc.
  cost?: number;
  capabilities: string[];
  tags: string[];
  version: string;
  icon?: string;
  rating?: number;
  downloads?: number;
}

// --- Plugin Marketplace ---
export interface PluginListing {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  permissions: string[];
  downloadUrl: string;
  icon?: string;
  rating?: number;
  downloads?: number;
  tags: string[];
}

// --- Multi-Agent Orchestrator ---
export type AgentType = 'workflow' | 'llm' | 'research' | 'custom';

export interface AgentDefinition {
  id: string;
  name: string;
  type: AgentType;
  config: Record<string, any>; // e.g., workflowId, model, prompt, etc.
  description?: string;
}

export interface OrchestrationPlan {
  agents: AgentDefinition[];
  mode: 'sequential' | 'parallel' | 'conditional';
  conditions?: Array<{ agentId: string; condition: string }>;
}

export interface OrchestrationResult {
  agentId: string;
  output: any;
  error?: string;
  duration: number;
}

// --- Remote Compute ---
export interface ComputeTask {
  id: string;
  type: string; // e.g., 'text', 'image', 'video'
  input: any;
  options?: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// --- Team Collaboration ---
export interface User {
  id: string;
  name: string;
  email?: string;
  role: 'admin' | 'editor' | 'viewer';
  avatar?: string;
}

export interface ProjectShare {
  projectId: string;
  userId: string;
  permission: 'read' | 'write' | 'admin';
}
