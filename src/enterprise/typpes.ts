/**
 * Enterprise feature types for Project and Asset management.
 */

export type AssetType = 'image' | 'video' | 'audio' | 'document' | 'research' | 'game' | 'other';

export interface AssetMetadata {
  prompt?: string;
  provider?: string;
  model?: string;
  seed?: string;
  parameters?: Record<string, any>;
  workflowId?: string;
  version?: string;
  date?: string;
  [key: string]: any;
}

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  data: any;          // blob URL, text, or raw data
  metadata: AssetMetadata;
  createdAt: number;
  updatedAt: number;
  version: number;
  projectId?: string; // optional reference to a project
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  assets: Asset[];
  workflows: any[];   // references to workflow definitions
  history: any[];     // generation history entries
  settings: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface ProjectSnapshot {
  project: Project;
  timestamp: number;
  comment?: string;
}

export interface VersionInfo {
  version: number;
  timestamp: number;
  comment?: string;
  author?: string;
}
