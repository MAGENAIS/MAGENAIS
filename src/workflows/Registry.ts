import { NodeExecutor, NodeType, NodeRegistry as INodeRegistry } from './types';

export class NodeRegistry implements INodeRegistry {
  private executors: Map<NodeType, NodeExecutor> = new Map();

  register(executor: NodeExecutor): void {
    if (this.executors.has(executor.type)) {
      console.warn(`Overwriting executor for type ${executor.type}`);
    }
    this.executors.set(executor.type, executor);
  }

  getExecutor(type: NodeType): NodeExecutor | undefined {
    return this.executors.get(type);
  }

  getAllExecutors(): NodeExecutor[] {
    return Array.from(this.executors.values());
  }
}
