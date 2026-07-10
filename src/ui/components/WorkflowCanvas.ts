/**
 * Visual Workflow Editor – simple canvas-based node graph editor.
 * Displays nodes and edges, allows dragging nodes.
 */

import { Component } from './Component';
import { Graph, Node } from '../../workflows/types';

export interface WorkflowCanvasOptions {
  graph: Graph;
  onNodeClick?: (node: Node) => void;
  onNodeDoubleClick?: (node: Node) => void;
  onEdgeClick?: (edge: any) => void;
}

export class WorkflowCanvas extends Component {
  private options: WorkflowCanvasOptions;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private dragNodeId: string | null = null;
  private dragOffsetX: number = 0;
  private dragOffsetY: number = 0;
  private nodePositions: Map<string, { x: number; y: number }> = new Map();

  constructor(container: HTMLElement, options: WorkflowCanvasOptions) {
    super(container);
    this.options = options;
    // Initialize node positions from graph (if not set, use random)
    this.initPositions();
  }

  private initPositions(): void {
    const nodes = this.options.graph.nodes;
    const spacing = 200;
    nodes.forEach((node, index) => {
      if (!this.nodePositions.has(node.id)) {
        this.nodePositions.set(node.id, {
          x: 100 + (index % 3) * spacing,
          y: 100 + Math.floor(index / 3) * spacing,
        });
      }
    });
  }

  render(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.position = 'relative';
    wrapper.style.background = 'var(--bg)';
    wrapper.style.border = '1px solid var(--line)';
    wrapper.style.borderRadius = 'var(--radius)';
    wrapper.style.overflow = 'hidden';

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    wrapper.appendChild(this.canvas);

    // Resize to match container
    this.resizeCanvas();

    // Setup event listeners
    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));

    // Draw the graph
    this.draw();

    return wrapper;
  }

  private resizeCanvas(): void {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (rect) {
      this.canvas.width = rect.width;
      this.canvas.height = rect.height;
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = rect.height + 'px';
      this.draw();
    }
  }

  private draw(): void {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    this.ctx = ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Draw edges
    const edges = this.options.graph.edges || [];
    ctx.strokeStyle = 'var(--line-bright)';
    ctx.lineWidth = 2;
    edges.forEach(edge => {
      const from = this.nodePositions.get(edge.from);
      const to = this.nodePositions.get(edge.to);
      if (from && to) {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        // Draw arrow head
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const arrowSize = 10;
        const endX = to.x - 10 * Math.cos(angle);
        const endY = to.y - 10 * Math.sin(angle);
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - arrowSize * Math.cos(angle - 0.5), endY - arrowSize * Math.sin(angle - 0.5));
        ctx.lineTo(endX - arrowSize * Math.cos(angle + 0.5), endY - arrowSize * Math.sin(angle + 0.5));
        ctx.closePath();
        ctx.fillStyle = 'var(--line-bright)';
        ctx.fill();
      }
    });

    // Draw nodes
    const nodes = this.options.graph.nodes;
    nodes.forEach(node => {
      const pos = this.nodePositions.get(node.id);
      if (!pos) return;
      const x = pos.x;
      const y = pos.y;
      const radius = 30;
      const isSelected = this.dragNodeId === node.id;

      // Circle
      const gradient = ctx.createRadialGradient(x - 10, y - 10, 5, x, y, radius);
      gradient.addColorStop(0, isSelected ? 'var(--amber)' : 'var(--bg-raised)');
      gradient.addColorStop(1, isSelected ? 'var(--amber-dim)' : 'var(--bg-panel)');
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = isSelected ? 'var(--amber)' : 'var(--line-bright)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      ctx.fillStyle = 'var(--ink)';
      ctx.font = '12px var(--mono)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.label || node.id, x, y);

      // Type badge
      ctx.fillStyle = 'var(--ink-faint)';
      ctx.font = '9px var(--mono)';
      ctx.textBaseline = 'bottom';
      ctx.fillText(node.type, x, y + radius + 12);
    });
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Find if we clicked on a node
    for (const [id, pos] of this.nodePositions) {
      const dx = x - pos.x;
      const dy = y - pos.y;
      if (dx * dx + dy * dy < 30 * 30) {
        this.dragNodeId = id;
        this.dragOffsetX = x - pos.x;
        this.dragOffsetY = y - pos.y;
        break;
      }
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.dragNodeId || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - this.dragOffsetX;
    const y = e.clientY - rect.top - this.dragOffsetY;
    const pos = this.nodePositions.get(this.dragNodeId);
    if (pos) {
      pos.x = x;
      pos.y = y;
      this.draw();
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (this.dragNodeId) {
      // Optionally emit event
      this.dragNodeId = null;
      this.draw();
    }
  }

  private onDoubleClick(e: MouseEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (const node of this.options.graph.nodes) {
      const pos = this.nodePositions.get(node.id);
      if (!pos) continue;
      const dx = x - pos.x;
      const dy = y - pos.y;
      if (dx * dx + dy * dy < 30 * 30) {
        if (this.options.onNodeDoubleClick) {
          this.options.onNodeDoubleClick(node);
        }
        break;
      }
    }
  }

  mounted(): void {
    // Resize observer
    const ro = new ResizeObserver(() => this.resizeCanvas());
    if (this.container) ro.observe(this.container);
    // Also re-draw on window resize
    window.addEventListener('resize', this.resizeCanvas.bind(this));
  }

  destroy(): void {
    // Cleanup
  }

  /**
   * Update the graph data and redraw.
   */
  updateGraph(graph: Graph): void {
    this.options.graph = graph;
    this.initPositions();
    this.draw();
  }
}
