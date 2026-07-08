import { Node, NodeExecutor, NodeType, ExecutionContext } from './types';
import { Logger } from '../core/Logger';
import { getProviderManager, getRouter } from '../core/Kernel'; // will be injected later

/**
 * Abstract base executor that provides common functionality.
 */
export abstract class BaseNodeExecutor implements NodeExecutor {
  abstract type: NodeType;

  /**
   * Execute the node. Subclasses must implement.
   */
  abstract execute(node: Node, context: ExecutionContext): Promise<any>;

  /**
   * Helper to resolve node inputs using the GraphUtils.
   */
  protected resolveInputs(
    node: Node,
    outputs: Map<string, any>,
    staticInputs: Record<string, any> = {}
  ): Record<string, any> {
    // Use GraphUtils.resolveInputs (import from Graph.ts)
    const { GraphUtils } = await import('./Graph');
    return GraphUtils.resolveInputs(node, outputs, staticInputs);
  }

  /**
   * Get a provider for the given node type and call it.
   * This uses the global provider registry and router.
   */
  protected async callProvider(
    node: Node,
    input: any,
    context: ExecutionContext
  ): Promise<any> {
    // We need to access the provider manager and router from the kernel.
    // For now, we'll use a global singleton pattern (to be replaced with DI later).
    const { getProviderManager, getRouter } = await import('../core/Kernel');
    const manager = getProviderManager();
    const router = getRouter();

    // Map node type to provider type
    const providerType = node.type as any; // text, image, video, etc. match provider types
    const selected = router.selectProvider(providerType);
    if (!selected) {
      throw new Error(`No provider available for type ${providerType}`);
    }

    // Prepare options: model, parameters from node config
    const options = {
      model: node.config.model || selected.defaultModel,
      temperature: node.config.temperature,
      maxTokens: node.config.maxTokens,
      width: node.config.width,
      height: node.config.height,
      duration: node.config.duration,
      voice: node.config.voice,
      style: node.config.style,
      // ... any other config
    };

    // Call the provider via the manager (which uses the adapter)
    const adapter = manager.getAdapter(selected);
    if (!adapter) {
      throw new Error(`No adapter for provider ${selected.id}`);
    }
    // The adapter's call method expects (provider, input, options)
    const result = await adapter.call(selected, { prompt: input, ...options }, options);
    return result;
  }
}

// --- Concrete Executors ---

export class TextNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'text';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    // Resolve input: expect a 'prompt' field
    const inputs = this.resolveInputs(node, context.variables);
    const prompt = inputs.prompt || inputs.text || '';
    if (!prompt) throw new Error('Text node requires a prompt input.');
    // Call provider
    const result = await this.callProvider(node, prompt, context);
    return result; // returns text string
  }
}

export class ImageNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'image';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables);
    const prompt = inputs.prompt || '';
    if (!prompt) throw new Error('Image node requires a prompt.');
    const result = await this.callProvider(node, prompt, context);
    return result; // returns image URL (string)
  }
}

export class VideoNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'video';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables);
    const prompt = inputs.prompt || '';
    if (!prompt) throw new Error('Video node requires a prompt.');
    const result = await this.callProvider(node, prompt, context);
    return result; // returns video URL (string)
  }
}

export class AudioNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'audio';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables);
    const audioInput = inputs.audio || inputs.file;
    if (!audioInput) throw new Error('Audio node requires audio data.');
    // For transcription, we might need to pass the file data.
    const result = await this.callProvider(node, audioInput, context);
    return result; // returns transcribed text
  }
}

export class SpeechNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'speech';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables);
    const text = inputs.text || '';
    if (!text) throw new Error('Speech node requires text.');
    const result = await this.callProvider(node, text, context);
    return result; // returns audio URL
  }
}

export class MusicNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'music';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables);
    const prompt = inputs.prompt || '';
    if (!prompt) throw new Error('Music node requires a prompt.');
    const result = await this.callProvider(node, prompt, context);
    return result; // returns audio URL
  }
}

export class ResearchNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'research';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    // Research node: search academic sources and synthesize
    const inputs = this.resolveInputs(node, context.variables);
    const query = inputs.query || inputs.prompt || '';
    if (!query) throw new Error('Research node requires a query.');

    // Use the existing gatherResearchSources function (will be refactored later)
    // For now, we'll import and call it.
    const { gatherResearchSources } = await import('../workflows/legacy/research'); // placeholder
    const sources = await gatherResearchSources(query, 6, context.log, ['semanticscholar', 'openalex', 'arxiv']);
    // Then synthesize using a text provider
    const synthesisPrompt = `Based on these papers, answer: ${query}\n\n${sources.papers.map(p => `- ${p.title}`).join('\n')}`;
    const result = await this.callProvider(node, synthesisPrompt, context);
    return {
      papers: sources.papers,
      summary: result,
    };
  }
}

export class GameGenNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'gamegen';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    // Generate a playable game HTML
    const inputs = this.resolveInputs(node, context.variables);
    const concept = inputs.concept || '';
    if (!concept) throw new Error('GameGen node requires a concept.');
    // Use the existing generateGame function (will be refactored)
    const { generateGame } = await import('../workflows/legacy/game'); // placeholder
    const html = await generateGame({ concept, engine: '2d', genre: '', complexity: 'standard' }, context.log);
    return html;
  }
}

export class DataNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'data';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    // Data analysis node: process spreadsheet and generate stats/chart
    // For now, just pass through
    const inputs = this.resolveInputs(node, context.variables);
    const fileData = inputs.file;
    if (!fileData) throw new Error('Data node requires file input.');
    // Use existing parseSpreadsheetFile, compute stats, etc.
    // We'll implement a simplified version.
    const { parseSpreadsheetFile } = await import('../workflows/legacy/data'); // placeholder
    const parsed = await parseSpreadsheetFile(fileData);
    // ... compute stats and return
    return parsed;
  }
}

export class DocNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'doc';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    // Document processing: extract text, summarize/qa
    const inputs = this.resolveInputs(node, context.variables);
    const file = inputs.file;
    if (!file) throw new Error('Doc node requires file input.');
    const { extractTextFromPDF, extractTextFromDocx, extractTextFromImageOCR } = await import('../workflows/legacy/doc'); // placeholder
    // Detect file type and extract
    let text = '';
    if (file.name.endsWith('.pdf')) {
      text = await extractTextFromPDF(await file.arrayBuffer());
    } else if (file.name.endsWith('.docx')) {
      text = await extractTextFromDocx(await file.arrayBuffer());
    } else {
      text = await extractTextFromImageOCR(file);
    }
    // Then optionally summarize/qa based on node config
    if (node.config.action === 'summary') {
      const summaryPrompt = `Summarize the following document:\n\n${text.slice(0, 12000)}`;
      const result = await this.callProvider(node, summaryPrompt, context);
      return { extractedText: text, summary: result };
    } else {
      return { extractedText: text };
    }
  }
}

// Registry of all built-in executors
export const BUILTIN_EXECUTORS: NodeExecutor[] = [
  new TextNodeExecutor(),
  new ImageNodeExecutor(),
  new VideoNodeExecutor(),
  new AudioNodeExecutor(),
  new SpeechNodeExecutor(),
  new MusicNodeExecutor(),
  new ResearchNodeExecutor(),
  new GameGenNodeExecutor(),
  new DataNodeExecutor(),
  new DocNodeExecutor(),
];
