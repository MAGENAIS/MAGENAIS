import { Node, NodeExecutor, NodeType, ExecutionContext } from './types';
import { GraphUtils } from './Graph';
import { Logger } from '../core/Logger';

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
   * Helper to resolve node inputs using GraphUtils.
   */
  protected resolveInputs(
    node: Node,
    outputs: Map<string, any>,
    staticInputs: Record<string, any> = {}
  ): Record<string, any> {
    return GraphUtils.resolveInputs(node, outputs, staticInputs);
  }

  /**
   * Get a provider for the given node type and call it, falling back through
   * every enabled/configured candidate (by priority/score) until one succeeds —
   * mirrors the legacy monolith's per-type fallback chain.
   */
  protected async callProvider(
    node: Node,
    input: any,
    context: ExecutionContext,
    options: Record<string, any> = {}
  ): Promise<any> {
    if (!context.services) {
      throw new Error(
        'Provider services are not available in this execution context — the workflow engine was not wired with a ProviderManager/Router.'
      );
    }
    const { providerManager, router } = context.services;

    const mergedOptions = {
      model: node.config?.model,
      // The UI's "Preferred model" pickers currently only offer Pollinations'
      // own routing aliases (openai/mistral/claude/deepseek/qwen-coder, flux,
      // wan, ...) — scope the override to that adapter so it doesn't get
      // force-applied to unrelated fallback providers. If/when a mode adds a
      // real per-provider model picker, it should set node.config.modelAdapterHint
      // to that provider's adapterId instead of leaving this default.
      modelAdapterHint: node.config?.modelAdapterHint ?? 'pollinations',
      temperature: node.config?.temperature,
      maxTokens: node.config?.maxTokens,
      width: node.config?.width,
      height: node.config?.height,
      duration: node.config?.duration,
      voice: node.config?.voice,
      style: node.config?.style,
      ...options,
    };

    // Provider type matches node type 1:1 for all generation node types.
    const providerType = node.type as any;
    return providerManager.callWithFallback(providerType, router, input, mergedOptions, context.log);
  }
}

// --- Concrete Executors ---

export class TextNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'text';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables, context.inputs);
    const prompt = inputs.prompt || inputs.text || '';
    if (!prompt) throw new Error('Text node requires a prompt input.');
    return this.callProvider(node, { prompt }, context);
  }
}

export class ImageNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'image';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables, context.inputs);
    const prompt = inputs.prompt || '';
    if (!prompt) throw new Error('Image node requires a prompt.');
    return this.callProvider(node, { prompt }, context); // returns image URL (string)
  }
}

export class VideoNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'video';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables, context.inputs);
    const prompt = inputs.prompt || '';
    if (!prompt) throw new Error('Video node requires a prompt.');
    return this.callProvider(node, { prompt }, context); // returns video URL or { url, isFallback }
  }
}

export class AudioNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'audio';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables, context.inputs);
    const audioInput = inputs.audio || inputs.file;
    if (!audioInput) throw new Error('Audio node requires audio data.');
    return this.callProvider(node, { blob: audioInput }, context); // returns transcribed text
  }
}

export class SpeechNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'speech';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables, context.inputs);
    const text = inputs.text || '';
    if (!text) throw new Error('Speech node requires text.');
    return this.callProvider(node, { prompt: text }, context); // returns audio URL
  }
}

export class MusicNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'music';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables, context.inputs);
    const prompt = inputs.prompt || '';
    if (!prompt) throw new Error('Music node requires a prompt.');
    return this.callProvider(node, { prompt }, context); // returns audio URL
  }
}

export class ResearchNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'research';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables, context.inputs);
    const query = inputs.query || inputs.prompt || '';
    if (!query) throw new Error('Research node requires a query.');

    const { gatherResearchSources } = await import('./legacy/research');
    const enabledSources = node.config?.sources || ['semanticscholar', 'openalex', 'arxiv'];
    const sources = await gatherResearchSources(query, node.config?.limitPerSource || 6, context.log, enabledSources);

    const top = [...sources.papers].sort((a, b) => (b.citations || 0) - (a.citations || 0)).slice(0, 10);
    const papersForAI = top
      .map((p, i) => `[${i + 1}] "${p.title}" (${p.year || 'n.d.'}) — ${p.authors || 'unknown'}. Abstract: ${(p.abstract || '').slice(0, 500)}`)
      .join('\n\n');
    const synthesisPrompt = `Based on these real papers, answer: "${query}"\n\n${papersForAI}\n\nSynthesize a clear answer citing papers by [number].`;

    const summary = await this.callProvider(node, { prompt: synthesisPrompt }, context);
    return { papers: sources.papers, sourceStatus: sources.sourceStatus, summary };
  }
}

export class GameGenNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'gamegen';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables, context.inputs);
    const concept = inputs.concept || inputs.prompt || '';
    if (!concept) throw new Error('GameGen node requires a concept.');

    const { generateGame } = await import('./legacy/game');
    const html = await generateGame(
      {
        concept,
        engine: node.config?.engine || '2d',
        genre: node.config?.genre || '',
        complexity: node.config?.complexity || 'standard',
        iterate: node.config?.iterate || false,
        previousCode: node.config?.previousCode,
      },
      context.log || (() => {}),
      // Text generation for both agent stages goes through the same fallback chain as any text node.
      (prompt: string, opts?: Record<string, any>) => this.callProvider(node, { prompt }, context, opts)
    );
    return html;
  }
}

export class DataNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'data';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables, context.inputs);
    const fileData = inputs.file;
    if (!fileData) throw new Error('Data node requires file input.');

    const { parseSpreadsheetFile, computeBasicStats } = await import('./legacy/data');
    const isAlreadyParsed = fileData && Array.isArray(fileData.headers) && Array.isArray(fileData.rows);
    const parsed = isAlreadyParsed ? fileData : await parseSpreadsheetFile(fileData as File);
    const stats = computeBasicStats(parsed);

    const question = node.config?.prompt || node.config?.question;
    if (question) {
      const analysisPrompt = `Given this spreadsheet data (headers: ${parsed.headers.join(', ')}; ${parsed.rows.length} rows), answer: "${question}"\n\nSummary stats: ${JSON.stringify(stats).slice(0, 4000)}`;
      const analysis = await this.callProvider(node, { prompt: analysisPrompt }, context);
      return analysis; // finalOutput consumed directly as text by DataMode
    }
    return { ...parsed, stats };
  }
}

export class DocNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'doc';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables, context.inputs);
    const file: File | undefined = inputs.file;
    if (!file) throw new Error('Doc node requires file input.');

    const { extractTextFromPDF, extractTextFromDocx, extractTextFromImageOCR } = await import('./legacy/doc');
    let text = '';
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) {
      text = await extractTextFromPDF(await file.arrayBuffer(), context.log);
    } else if (name.endsWith('.docx')) {
      text = await extractTextFromDocx(await file.arrayBuffer(), context.log);
    } else {
      text = await extractTextFromImageOCR(file, context.log);
    }

    if (node.config?.action === 'summary') {
      const summaryPrompt = node.config?.question
        ? `Given the following document, answer this question: "${node.config.question}"\n\nDocument:\n${text.slice(0, 12000)}`
        : `Summarize the following document:\n\n${text.slice(0, 12000)}`;
      const summary = await this.callProvider(node, { prompt: summaryPrompt }, context);
      return { extractedText: text, summary };
    }
    return { extractedText: text };
  }
}

export class CodingNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'coding';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables, context.inputs);
    const request = inputs.prompt || inputs.request || '';
    if (!request) throw new Error('Coding node requires a description of what to build.');

    const language = node.config?.language || 'JavaScript';
    const prompt = `You are an expert ${language} programmer. Write clean, correct, well-commented, production-quality ${language} code for the following request:\n\n"${request}"\n\nRespond with a single fenced code block in ${language}, followed by a short 1-3 sentence explanation of how it works. Do not omit any part of the implementation with placeholder comments like "rest of the code here" — write the complete, runnable code.`;

    // Coding reuses the much larger and more reliable 'text' fallback chain
    // (Groq, OpenRouter, Anthropic, Gemini, Hugging Face, Pollinations, ...)
    // rather than the single sparse 'coding'-type registry entry, since any
    // capable text model can write code — this mirrors how the legacy
    // monolith's "qwen-coder" was just one alias within the same text pipeline,
    // not a separate provider category.
    return this.callProvider(node, { prompt }, context, { model: node.config?.model });
  }
}

export class VisionNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'vision';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = this.resolveInputs(node, context.variables, context.inputs);
    const imageBase64 = inputs.imageBase64;
    if (!imageBase64) throw new Error('Vision node requires an image (data URL).');
    const prompt = inputs.prompt || 'Describe what you see in this image in detail.';

    if (!context.services) {
      throw new Error('Provider services are not available in this execution context.');
    }
    const { providerManager, router } = context.services;
    return providerManager.callVision(imageBase64, prompt, router, context.log);
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
  new CodingNodeExecutor(),
  new VisionNodeExecutor(),
];
