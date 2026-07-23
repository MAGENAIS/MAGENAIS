import { Node, NodeExecutor, NodeType, ExecutionContext } from './types';
import { GraphUtils } from './Graph';
import { Logger } from '../core/Logger';
import { stripMarkdownForSpeech } from '../core/textUtils';

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
   * Helper to resolve node inputs using GraphUtils, upgrading any
   * media-into-text-node reference (see GraphUtils.resolveInputsAsync) into
   * a real vision-generated caption when a vision-capable provider is
   * available, instead of leaving a generic "couldn't be described"
   * placeholder. This is what makes chaining e.g. Image -> Text produce an
   * actually meaningful result (a real description of the generated image)
   * rather than either a leaked blob: URL or an unhelpful apology.
   */
  protected async resolveInputs(
    node: Node,
    outputs: Map<string, any>,
    staticInputs: Record<string, any> = {},
    context?: ExecutionContext
  ): Promise<Record<string, any>> {
    const { values, pending } = GraphUtils.resolveInputsAsync(node, outputs, staticInputs);
    if (pending.length === 0 || !context?.services) return values;

    const { providerManager, router } = context.services;
    // Cache by URL so the same media referenced multiple times (whole-value
    // in one field, embedded in another) only gets captioned once per node.
    const captionCache = new Map<string, string | null>();
    for (const task of pending) {
      let caption = captionCache.get(task.url);
      if (caption === undefined) {
        try {
          caption = await providerManager.callVision(
            task.url,
            'Describe this image in one or two clear, factual sentences.',
            router,
            context.log
          );
        } catch {
          caption = null; // no vision provider available, or the call failed — leave the placeholder
        }
        captionCache.set(task.url, caption);
      }
      if (!caption) continue; // keep whatever placeholder/marker is already in values[task.key]
      const described = `[Image from a previous step, described: ${caption}]`;
      if (task.marker) {
        // Embedded case — the surrounding string is user-authored (e.g. "Summarize
        // this: ${step1}") and already supplies its own instruction, so substitute
        // the caption as-is rather than layering another directive on top of it.
        values[task.key] = String(values[task.key]).replace(task.marker, described);
      } else {
        // Whole-value case (auto-chained by WorkflowModal/AgentsMode, no
        // user-authored instruction) — same fix as GraphUtils.adaptChainedValue:
        // a bare caption with no framing reads to a text model as an unprompted
        // statement, so it tends to just react to/describe it instead of
        // producing new, on-topic content.
        values[task.key] = GraphUtils.adaptChainedValue(node.type, described);
      }
    }
    return values;
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
    options: Record<string, any> = {},
    providerTypeOverride?: string
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
      // ROOT CAUSE of "output gets cut off mid-sentence/mid-table/mid-
      // function with no way to scroll to the rest": this was
      // `node.config?.maxTokens` with no fallback. No mode UI (TextMode
      // included) ever sets maxTokens on node.config, so this was always
      // `undefined`, and every adapter's own `options?.maxTokens ?? 1024`
      // (or as low as 150 for local summarization) silently took over. A
      // modest multi-table comparison answer blows past 1024 tokens
      // easily, so the model gets cut off mid-word — that's not a
      // rendering/CSS bug, there's genuinely nothing further generated to
      // scroll to. Raised once already to 4096, but that's still not
      // enough for genuinely long-form output — a full one-file website
      // (HTML+CSS+JS with a form, validation logic, and styling, e.g. the
      // Coding tab) or a long article/report can easily need more than
      // 4096 tokens to finish without truncating mid-function. None of
      // the actual provider adapters (Anthropic/OpenAI-compatible/
      // Hugging Face/Ollama/Gemini/WebLLM) impose their own hard ceiling
      // below whatever is requested here, so there's no technical reason
      // to keep this artificially low — 8192 gives real headroom for
      // long-form generation across every mode (Text, Coding, Research,
      // Documents, Agents, ...) without special-casing any one of them.
      // An explicit node.config.maxTokens (once a mode exposes that
      // control) still always wins over this default.
      maxTokens: node.config?.maxTokens ?? 8192,
      width: node.config?.width,
      height: node.config?.height,
      duration: node.config?.duration,
      voice: node.config?.voice,
      style: node.config?.style,
      // ROOT CAUSE: several adapters (Ollama's auto-retry-with-correct-tag
      // message, WebLLM's/Transformers.js's first-time-download progress
      // notes, KenBurnsFallback) read `options?.log` expecting the same
      // live logger passed to callWithFallback — but that logger was only
      // ever threaded through as callWithFallback's separate 5th
      // positional argument (`context.log`, below), never copied into the
      // options object adapters actually receive. Every `options?.log?.()`
      // call in those adapters was silently a no-op. Adding it here once
      // fixes it for all of them.
      log: context.log,
      ...options,
    };

    // Provider type matches node type 1:1 for most generation node types,
    // but a few node types (e.g. 'doc' summarization) don't have their own
    // dedicated provider pool and are meant to reuse another modality's
    // providers — pass providerTypeOverride in that case rather than
    // routing to a provider type that was never registered (see
    // DocNodeExecutor, which reuses 'text').
    const providerType = (providerTypeOverride ?? node.type) as any;
    return providerManager.callWithFallback(providerType, router, input, mergedOptions, context.log);
  }
}

// --- Concrete Executors ---

export class TextNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'text';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = await this.resolveInputs(node, context.variables, context.inputs, context);
    const prompt = inputs.prompt || inputs.text || '';
    if (!prompt) throw new Error('Text node requires a prompt input.');
    return this.callProvider(node, { prompt }, context);
  }
}

export class ImageNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'image';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = await this.resolveInputs(node, context.variables, context.inputs, context);
    const prompt = inputs.prompt || '';
    if (!prompt) throw new Error('Image node requires a prompt.');
    return this.callProvider(node, { prompt }, context); // returns image URL (string)
  }
}

export class VideoNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'video';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = await this.resolveInputs(node, context.variables, context.inputs, context);
    const prompt = inputs.prompt || '';
    if (!prompt) throw new Error('Video node requires a prompt.');
    return this.callProvider(node, { prompt }, context); // returns video URL or { url, isFallback }
  }
}

export class AudioNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'audio';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = await this.resolveInputs(node, context.variables, context.inputs, context);
    const audioInput = inputs.audio || inputs.file;
    if (!audioInput) throw new Error('Audio node requires audio data.');
    return this.callProvider(node, { blob: audioInput }, context); // returns transcribed text
  }
}

export class SpeechNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'speech';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = await this.resolveInputs(node, context.variables, context.inputs, context);
    const text = inputs.text || '';
    if (!text) throw new Error('Speech node requires text.');
    // ROOT CAUSE of "TTS reads out # and * characters": stripMarkdownForSpeech
    // already existed and was applied to the podcast pipeline, but this node
    // — the one every OTHER speech path (Audio & Music's Speech mode, Vision's
    // spoken narration) actually runs through — sent the raw text (which can
    // contain Markdown from an upstream text-generation step) straight to the
    // provider/browser voice, which reads punctuation literally.
    return this.callProvider(node, { prompt: stripMarkdownForSpeech(text) }, context); // returns audio URL
  }
}

export class MusicNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'music';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = await this.resolveInputs(node, context.variables, context.inputs, context);
    const prompt = inputs.prompt || '';
    if (!prompt) throw new Error('Music node requires a prompt.');
    return this.callProvider(node, { prompt }, context); // returns audio URL
  }
}

export class ResearchNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'research';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = await this.resolveInputs(node, context.variables, context.inputs, context);
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

    // ROOT CAUSE (user-reported: Wikipedia fallback fails with "No Wikipedia
    // article found for <the entire multi-paragraph synthesis prompt>"):
    // callProvider forwards the SAME input to every candidate in the
    // 'research' fallback chain. Real LLM-based providers (Ollama, Puter,
    // any keyed provider) want the full `synthesisPrompt` (the papers +
    // instructions) as `prompt` — but WikipediaAdapter is not an LLM at
    // all, it does a literal Wikipedia search on whatever string it's
    // given, so handing it the whole synthesis prompt (with citations,
    // abstracts, and instructions baked in) guarantees a failed search.
    // Passing the original short `query` too lets WikipediaAdapter prefer
    // it over `prompt` (see WikipediaAdapter.call) without needing a
    // separate provider type or call path for this one adapter.
    const summary = await this.callProvider(node, { prompt: synthesisPrompt, query }, context);
    return { papers: sources.papers, sourceStatus: sources.sourceStatus, summary };
  }
}

export class AgentNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'agents';

  // ROOT CAUSE (user-reported: Agents tab pipeline step type dropdown only
  // offered 'research', 'text', 'coding', 'image', 'speech', 'gamegen' — no
  // real general-purpose "agent" node type ever existed, even though a
  // dedicated 'agents' ProviderType/provider pool (see defaultProviders.ts,
  // builtin-ollama-agents / preset-openrouter-agents) has existed the whole
  // time with no NodeType/executor ever routing to it. Users reaching for
  // an "agent that can do a task" naturally picked 'research', because it
  // was the closest-sounding option — but ResearchNodeExecutor is a narrow,
  // literal academic-paper pipeline (Semantic Scholar/OpenAlex/arXiv) with
  // a Wikipedia last-resort fallback; "Book a flight from IKA to YVR"
  // produced zero paper matches, fell through to Wikipedia, and Wikipedia
  // returned an unrelated "IATA airport code" article summary — a
  // completely wrong result for what looked like a general task request.
  // This executor is the real general-purpose task agent: any instruction,
  // not just literature questions, routed through the (now populated, see
  // defaultProviders.ts) 'agents' provider pool.
  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = await this.resolveInputs(node, context.variables, context.inputs, context);
    const task = inputs.task || inputs.prompt || '';
    if (!task) throw new Error('Agent node requires a task.');

    // This agent has no live browsing, no real-world booking/payment/device
    // control, and no tool access beyond the LLM itself — be explicit about
    // that instead of silently failing or hallucinating a fake confirmation,
    // but still give the most useful possible answer: concrete next steps,
    // specific real options/sites/tools, any info reasoning can supply, and
    // a ready-to-use draft (search query, message, checklist, itinerary...)
    // the user can act on immediately. Pure reasoning/writing/analysis/
    // planning/coding tasks just get completed directly.
    const instructions =
      'You are a general-purpose task-completing AI agent. You do not have live internet ' +
      'browsing, real-world booking/payment ability, or access to external accounts or ' +
      'devices. If the task requires an action you cannot literally perform (booking a ' +
      'flight, sending an email, making a purchase, controlling a device, etc.), say so in ' +
      'one short sentence, then still be maximally useful: give the concrete steps the user ' +
      'should take, name specific real options/sites/tools suited to the task, supply any ' +
      'information you can reason out (typical routes, requirements, considerations), and ' +
      'produce a ready-to-use draft (a search query, message, checklist, itinerary, etc.) ' +
      'they can act on immediately. For tasks that are pure reasoning, analysis, writing, ' +
      'planning, or coding, just complete them directly and fully — do not add unnecessary ' +
      'disclaimers to those.';
    const prompt = `${instructions}\n\nTask: ${task}`;
    return this.callProvider(node, { prompt }, context);
  }
}

export class GameGenNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'gamegen';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = await this.resolveInputs(node, context.variables, context.inputs, context);
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
      // ROOT CAUSE (same class as DocNodeExecutor/DataNodeExecutor below):
      // game generation is an LLM text-generation task (writing HTML/JS),
      // not a distinct modality — but without the 'text' override here,
      // callProvider defaulted to node.type ('gamegen'), a NodeType with
      // only one built-in provider (disabled, empty baseUrl — a template
      // for a dedicated game-gen endpoint, not something that works out of
      // the box). That meant this always failed with "no provider for
      // 'gamegen'" even when perfectly good text providers were configured
      // and enabled — which is exactly what this callback's own comment
      // ("goes through the same fallback chain as any text node") already
      // said should happen. If a user configures a real dedicated
      // 'gamegen' provider, `opts` can still be used to target it
      // explicitly in the future; for now this makes the common case work.
      (prompt: string, opts?: Record<string, any>) => this.callProvider(node, { prompt }, context, opts, 'text')
    );
    return html;
  }
}

export class DataNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'data';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = await this.resolveInputs(node, context.variables, context.inputs, context);
    const fileData = inputs.file;
    if (!fileData) throw new Error('Data node requires file input.');

    const { parseSpreadsheetFile, computeBasicStats } = await import('./legacy/data');
    const isAlreadyParsed = fileData && Array.isArray(fileData.headers) && Array.isArray(fileData.rows);
    const parsed = isAlreadyParsed ? fileData : await parseSpreadsheetFile(fileData as File);
    const stats = computeBasicStats(parsed);

    const question = node.config?.prompt || node.config?.question;
    if (question) {
      const analysisPrompt = `Given this spreadsheet data (headers: ${parsed.headers.join(', ')}; ${parsed.rows.length} rows), answer: "${question}"\n\nSummary stats: ${JSON.stringify(stats).slice(0, 4000)}`;
      // Same root cause/fix as DocNodeExecutor below: 'data' is a valid
      // NodeType but was never a valid ProviderType — route through 'text'.
      const analysis = await this.callProvider(node, { prompt: analysisPrompt }, context, {}, 'text');
      return analysis; // finalOutput consumed directly as text by DataMode
    }
    return { ...parsed, stats };
  }
}

export class DocNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'doc';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = await this.resolveInputs(node, context.variables, context.inputs, context);
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
      // ROOT CAUSE (Priority 2 — Documents tab never worked): 'doc' is a
      // valid NodeType but was never a valid ProviderType/DEFAULT_PROVIDERS
      // entry, so routing this call through node.type ('doc') always hit
      // "No configured/enabled provider is available for 'doc'" even with
      // API keys configured. Document summarization is a text-generation
      // task, so route it through the 'text' provider pool — the same
      // pattern ProviderManager.callVision already uses for vision.
      //
      // RUNTIME AUDIT FIX (Phase 3 #6 — "extraction must never fail because
      // AI generation failed"): text extraction above has already succeeded
      // by this point — the PDF/DOCX/OCR parsing is done and `text` is real,
      // usable output. Previously this callProvider() call was awaited
      // un-caught, so when every text provider in the fallback chain failed
      // (e.g. no API keys configured and the in-browser models timed out),
      // the thrown error propagated straight out of execute(), discarding
      // `text` entirely — DocMode's catch block then rendered a bare error
      // screen with no way to see the document that WAS successfully read.
      // Catching just this step means a failed/unconfigured AI summarizer
      // degrades to "show the extracted text, note that summarization
      // wasn't available" instead of hiding a real, successful result.
      try {
        const summary = await this.callProvider(node, { prompt: summaryPrompt }, context, {}, 'text');
        return { extractedText: text, summary };
      } catch (err: any) {
        context.log?.(
          `Document text was extracted successfully, but AI ${node.config?.question ? 'question-answering' : 'summarization'} failed: ${err?.message || err}`,
          'warn'
        );
        return { extractedText: text, summaryError: err?.message || String(err) };
      }
    }
    return { extractedText: text };
  }
}

export class CodingNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'coding';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = await this.resolveInputs(node, context.variables, context.inputs, context);
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
    // NOTE: this comment described the above intent from the start, but the
    // call below was missing the actual providerTypeOverride argument, so it
    // silently fell back to node.type ('coding') anyway — the ONE sparse,
    // keyed 'coding'-type preset — regardless of how many text providers
    // (including free/no-key ones) were configured. Fixed to actually pass
    // 'text', matching what the comment above always said it should do.
    //
    // Coding-specialized model default for Ollama: per the requested default
    // priority ("Ollama — Qwen2.5-Coder or DeepSeek-Coder"), steer Ollama
    // specifically toward a code model rather than its general-purpose
    // "llama3.2" default — `modelAdapterHint` (the same mechanism the
    // Pollinations "Preferred model" aliases already use) means this ONLY
    // overrides the model when the provider actually picked from the
    // fallback chain is Ollama; every other provider keeps using its own
    // configured defaultModel. Explicitly picking a language/coding model
    // via node.config still always wins.
    const explicitModel = node.config?.model;
    return this.callProvider(
      node,
      { prompt },
      context,
      explicitModel
        ? { model: explicitModel } // user/UI picked a specific model — leave modelAdapterHint at its normal default (Pollinations aliases)
        : { model: 'qwen2.5-coder', modelAdapterHint: 'ollama' }, // no explicit model — steer Ollama toward a coding model, other providers keep their own default
      'text'
    );
  }
}

export class VisionNodeExecutor extends BaseNodeExecutor {
  type: NodeType = 'vision';

  async execute(node: Node, context: ExecutionContext): Promise<any> {
    const inputs = await this.resolveInputs(node, context.variables, context.inputs, context);
    const imageBase64 = inputs.imageBase64;
    if (!imageBase64) throw new Error('Vision node requires an image (data URL).');
    const prompt = inputs.prompt || 'Describe what you see in this image in detail.';

    if (!context.services) {
      throw new Error('Provider services are not available in this execution context.');
    }
    const { providerManager, router } = context.services;
    return providerManager.callVision(imageBase64, prompt, router, context.log, {
      includeOcr: node.config?.includeOcr,
      // Item 8 — Provider/Model selectors (VisionMode.ts): when the person
      // picked something other than "Auto", it's threaded in here exactly
      // like CodingNodeExecutor's explicitModel/modelAdapterHint pattern
      // above — an explicit choice from the UI always wins, "Auto" (no
      // config values set) behaves exactly as it always has.
      preferredProviderId: node.config?.preferredProviderId,
      model: node.config?.model,
    });
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
  new AgentNodeExecutor(),
  new GameGenNodeExecutor(),
  new DataNodeExecutor(),
  new DocNodeExecutor(),
  new CodingNodeExecutor(),
  new VisionNodeExecutor(),
];
