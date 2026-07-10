/**
 * Team Collaboration – user and role management.
 * Stub for future multi-user support.
 */

import { User, ProjectShare } from './types';
import { Logger } from '../core/Logger';
import { EventBus } from '../core/EventBus';

export class TeamManager {
  private users: Map<string, User> = new Map();
  private shares: ProjectShare[] = [];
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    // Add a default admin user
    this.users.set('admin', {
      id: 'admin',
      name: 'Admin',
      role: 'admin',
    });
  }

  /**
   * Add a user.
   */
  addUser(user: User): void {
    this.users.set(user.id, user);
    this.eventBus.emit('team:userAdded', user);
  }

  /**
   * Get a user.
   */
  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  /**
   * Get all users.
   */
  getUsers(): User[] {
    return Array.from(this.users.values());
  }

  /**
   * Share a project with a user.
   */
  shareProject(projectId: string, userId: string, permission: 'read' | 'write' | 'admin'): void {
    this.shares.push({ projectId, userId, permission });
    this.eventBus.emit('team:projectShared', { projectId, userId, permission });
  }

  /**
   * Get projects shared with a user.
   */
  getSharedProjects(userId: string): ProjectShare[] {
    return this.shares.filter(s => s.userId === userId);
  }

  /**
   * Remove a share.
   */
  unshareProject(projectId: string, userId: string): void {
    this.shares = this.shares.filter(s => !(s.projectId === projectId && s.userId === userId));
    this.eventBus.emit('team:projectUnshared', { projectId, userId });
  }
}
