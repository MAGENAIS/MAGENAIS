/**
 * Project Manager – manages projects, each containing assets, workflows, and history.
 * Projects can be versioned and exported/imported.
 */

import { Project, ProjectSnapshot, VersionInfo } from './types';
import { AssetManager } from './AssetManager';
import { EventBus } from '../core/EventBus';
import { Logger } from '../core/Logger';
import { Persistence } from '../core/state/Persistence';

export class ProjectManager {
  private projects: Map<string, Project> = new Map();
  private currentProjectId: string | null = null;
  private eventBus: EventBus;
  private persistence: Persistence;
  private assetManager: AssetManager;
  private storageKey: string = 'magenais:projects';

  constructor(eventBus: EventBus, persistence: Persistence, assetManager: AssetManager) {
    this.eventBus = eventBus;
    this.persistence = persistence;
    this.assetManager = assetManager;
  }

  /**
   * Load projects from persistence.
   */
  async load(): Promise<void> {
    const data = await this.persistence.load();
    if (data && data.projects) {
      data.projects.forEach((p: Project) => {
        // Re-hydrate assets? They are stored separately.
        this.projects.set(p.id, p);
      });
      Logger.info(`ProjectManager: loaded ${this.projects.size} projects.`);
    }
  }

  /**
   * Save projects to persistence.
   */
  async save(): Promise<void> {
    const data = await this.persistence.load() || {};
    data.projects = Array.from(this.projects.values());
    await this.persistence.save(data);
  }

  /**
   * Create a new project.
   */
  createProject(name: string, description?: string): Project {
    const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const project: Project = {
      id,
      name,
      description,
      assets: [],
      workflows: [],
      history: [],
      settings: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
    };
    this.projects.set(id, project);
    this.eventBus.emit('project:created', project);
    Logger.info(`Project created: ${name} (${id})`);
    this.save();
    return project;
  }

  /**
   * Get a project by id.
   */
  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  /**
   * Get all projects.
   */
  getProjects(): Project[] {
    return Array.from(this.projects.values());
  }

  /**
   * Get the current project (if any).
   */
  getCurrentProject(): Project | null {
    if (!this.currentProjectId) return null;
    return this.projects.get(this.currentProjectId) || null;
  }

  /**
   * Set the current project.
   */
  setCurrentProject(id: string): void {
    if (!this.projects.has(id)) {
      throw new Error(`Project ${id} not found`);
    }
    this.currentProjectId = id;
    this.eventBus.emit('project:selected', id);
    Logger.info(`Current project set to ${id}`);
  }

  /**
   * Update project metadata.
   */
  updateProject(id: string, updates: Partial<Project>): Project | undefined {
    const project = this.projects.get(id);
    if (!project) return undefined;
    Object.assign(project, updates);
    project.updatedAt = Date.now();
    project.version += 1;
    this.eventBus.emit('project:updated', project);
    this.save();
    return project;
  }

  /**
   * Delete a project.
   */
  deleteProject(id: string): boolean {
    if (!this.projects.has(id)) return false;
    // Also delete associated assets?
    const assets = this.assetManager.getProjectAssets(id);
    assets.forEach(a => this.assetManager.deleteAsset(a.id));
    this.projects.delete(id);
    if (this.currentProjectId === id) this.currentProjectId = null;
    this.eventBus.emit('project:deleted', id);
    this.save();
    return true;
  }

  /**
   * Add an asset to a project (by id).
   */
  addAssetToProject(projectId: string, assetId: string): void {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    const asset = this.assetManager.getAsset(assetId);
    if (!asset) throw new Error(`Asset ${assetId} not found`);
    if (!project.assets.some(a => a.id === assetId)) {
      project.assets.push(asset);
      project.updatedAt = Date.now();
      project.version += 1;
      this.save();
      this.eventBus.emit('project:assetAdded', { projectId, assetId });
    }
  }

  /**
   * Remove an asset from a project.
   */
  removeAssetFromProject(projectId: string, assetId: string): void {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    project.assets = project.assets.filter(a => a.id !== assetId);
    project.updatedAt = Date.now();
    project.version += 1;
    this.save();
    this.eventBus.emit('project:assetRemoved', { projectId, assetId });
  }

  /**
   * Export project as JSON.
   */
  exportProject(id: string): any {
    const project = this.projects.get(id);
    if (!project) throw new Error(`Project ${id} not found`);
    const assets = this.assetManager.getProjectAssets(id);
    return {
      project: { ...project, assets: assets.map(a => ({ ...a, data: null })) }, // omit binary data
      assetData: assets.map(a => ({ id: a.id, data: a.data })), // keep data separately
    };
  }

  /**
   * Import a project from JSON.
   */
  importProject(data: any): void {
    const { project, assetData } = data;
    // Generate new ids to avoid collisions
    const newId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newProject: Project = {
      ...project,
      id: newId,
      assets: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
    };
    // Import assets
    if (assetData) {
      assetData.forEach((ad: any) => {
        const newAsset = this.assetManager.createAsset(
          ad.name || 'Imported Asset',
          ad.type || 'other',
          ad.data,
          ad.metadata || {},
          newId
        );
        newProject.assets.push(newAsset);
      });
    }
    this.projects.set(newId, newProject);
    this.save();
    this.eventBus.emit('project:imported', newProject);
    Logger.info(`Project imported: ${newProject.name} (${newId})`);
  }

  /**
   * Get version history of a project (simplified – returns a snapshot list).
   */
  getVersionHistory(projectId: string): VersionInfo[] {
    // In a real implementation, we would store snapshots.
    // For now, we return a single entry based on current version.
    const project = this.projects.get(projectId);
    if (!project) return [];
    return [{
      version: project.version,
      timestamp: project.updatedAt,
      comment: 'Current version',
    }];
  }

  /**
   * Create a snapshot (version) of a project.
   */
  createSnapshot(projectId: string, comment?: string): ProjectSnapshot {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    // In a full implementation, we would deep-clone the project state.
    // For now, we just increment version.
    project.version += 1;
    project.updatedAt = Date.now();
    this.save();
    const snapshot: ProjectSnapshot = {
      project: { ...project },
      timestamp: Date.now(),
      comment,
    };
    this.eventBus.emit('project:snapshot', snapshot);
    return snapshot;
  }
}
