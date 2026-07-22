/**
 * VisionModelCatalog — item 3 of the Universal Vision Provider Manager
 * upgrade: "Populate the Vision model list with these models" (Gemini 2.5
 * Flash Vision, Qwen2.5-VL, Pixtral, Llama Vision, SmolVLM, MiniCPM-V,
 * Molmo, Phi-4 Multimodal, InternVL, Florence-2), each carrying the
 * requested metadata (context length, multimodal, image understanding,
 * OCR, document analysis, chart analysis, realtime-capable, streaming
 * support).
 *
 * SCOPE — this is a reference catalog, not a new provider system: it does
 * NOT replace or duplicate ProviderConfig/DEFAULT_PROVIDERS (per the brief:
 * "Do NOT redesign the Provider Manager. Only extend."). Every entry below
 * points at `viaAdapterId` — one of the SAME adapters
 * VISION_CAPABLE_ADAPTERS in registry/Manager.ts already recognizes — and,
 * where a matching built-in preset exists in defaultProviders.ts,
 * `builtinProviderId`. VisionMode.ts's Model selector (item 8) reads this
 * module to offer named-model suggestions for whichever provider is
 * currently selected, then passes the chosen `modelId` through
 * ProviderManager.callVision's `model` override — see that method's
 * `extraOptions.model` doc comment. Nothing here is required reading for
 * callVision itself; a provider with no catalog entry still works exactly
 * as before, using its own `defaultModel`.
 *
 * ACCURACY NOTE (same spirit as LocalModelRegistry.ts's `verified` field):
 * context-length figures and capability flags below reflect each model's
 * publicly documented specs and marketing focus as of this writing. Vision
 * model releases move fast and provider-side model catalogs get pruned or
 * renamed — treat `modelId` as a solid current default, not a permanent
 * guarantee; the "Discover" button already on every OpenAI-compatible
 * provider's editor (GET /v1/models) is the source of truth for what a
 * given account can actually see right now.
 */

export interface VisionCapabilities {
  imageUnderstanding: boolean;
  ocr: boolean;
  documentAnalysis: boolean;
  chartAnalysis: boolean;
}

export interface VisionModelDefinition {
  /** Short catalog id, stable within this file — not sent to any API. */
  id: string;
  /** Display name, matches the name requested in the project brief verbatim. */
  name: string;
  /** The adapterId this model is called through — must be one VISION_CAPABLE_ADAPTERS (Manager.ts) recognizes. */
  viaAdapterId: string;
  /** If a matching built-in preset exists in defaultProviders.ts, its id — lets the UI auto-select the right provider when a person picks this model. */
  builtinProviderId?: string;
  /** The exact model identifier to send as `model` in the API call (see ProviderManager.callVision's `extraOptions.model`). */
  modelId: string;
  /** Context window, in tokens, per the model's own published specs. */
  contextLength: number;
  /** Always true in this catalog (every entry here is a vision-language model) — kept explicit because the brief asked for it per-model. */
  multimodal: true;
  capabilities: VisionCapabilities;
  /** Whether this model is fast/small enough to be a reasonable fit for VisionMode's continuous "Live mode" analysis loop (see Config.vision.continuousIntervalMs) — not a claim of true frame-by-frame video streaming, which no provider here actually offers. */
  realtimeCapable: boolean;
  /** Whether the provider's API supports token-streaming for this model's text output. */
  streamingSupport: boolean;
  /** One line, plain language, for the Model selector's tooltip/help text. */
  notes: string;
}

export const VISION_MODEL_CATALOG: VisionModelDefinition[] = [
  {
    id: 'gemini-2.5-flash-vision',
    name: 'Gemini 2.5 Flash Vision',
    viaAdapterId: 'gemini',
    builtinProviderId: 'preset-gemini-vision',
    modelId: 'gemini-2.5-flash',
    contextLength: 1048576,
    multimodal: true,
    capabilities: { imageUnderstanding: true, ocr: true, documentAnalysis: true, chartAnalysis: true },
    realtimeCapable: true,
    streamingSupport: true,
    notes: 'Google\'s fast, low-latency tier — free API tier available, 1M-token context, strong all-round vision including OCR and charts.',
  },
  {
    id: 'qwen2.5-vl',
    name: 'Qwen2.5-VL',
    viaAdapterId: 'openrouter',
    builtinProviderId: 'preset-openrouter-vision',
    modelId: 'qwen/qwen2.5-vl-72b-instruct',
    contextLength: 128000,
    multimodal: true,
    capabilities: { imageUnderstanding: true, ocr: true, documentAnalysis: true, chartAnalysis: true },
    realtimeCapable: false,
    streamingSupport: true,
    notes: 'Alibaba\'s vision-language line, particularly strong at dense document OCR, charts, and long-document layout understanding. 72B via OpenRouter; smaller 3B/7B variants exist on Hugging Face for lighter use.',
  },
  {
    id: 'pixtral',
    name: 'Pixtral',
    viaAdapterId: 'openai-compatible',
    builtinProviderId: 'preset-mistral-pixtral',
    modelId: 'pixtral-12b-2409',
    contextLength: 128000,
    multimodal: true,
    capabilities: { imageUnderstanding: true, ocr: true, documentAnalysis: true, chartAnalysis: true },
    realtimeCapable: false,
    streamingSupport: true,
    notes: 'Mistral\'s own vision-language model, natively interleaves image and text tokens. Solid general-purpose vision with good chart/diagram reading.',
  },
  {
    id: 'llama-vision',
    name: 'Llama Vision',
    viaAdapterId: 'groq',
    builtinProviderId: 'preset-groq-vision',
    modelId: 'meta-llama/Llama-3.2-11B-Vision-Instruct',
    contextLength: 128000,
    multimodal: true,
    capabilities: { imageUnderstanding: true, ocr: true, documentAnalysis: false, chartAnalysis: false },
    realtimeCapable: true,
    streamingSupport: true,
    notes: 'Meta\'s vision-instruct line — good general image Q&A and captioning, less specialized for dense documents/charts than the Qwen/Phi/InternVL entries. Also reachable via the Hugging Face Vision and GitHub Models Vision presets.',
  },
  {
    id: 'smolvlm',
    name: 'SmolVLM',
    viaAdapterId: 'transformers',
    modelId: 'HuggingFaceTB/SmolVLM-256M-Instruct',
    contextLength: 8192,
    multimodal: true,
    capabilities: { imageUnderstanding: true, ocr: false, documentAnalysis: false, chartAnalysis: false },
    realtimeCapable: true,
    streamingSupport: false,
    // Deliberately NOT wired into LocalModelRegistry.ts/TransformersAdapter
    // as an installable local model in this pass: transformers.js's
    // built-in image-to-text pipeline (what builtin-transformers-vision
    // uses today) doesn't cover SmolVLM's conversational image-text-to-text
    // architecture, and shipping a "Download" button that silently fails
    // would be worse than not offering it — see this catalog's top-level
    // doc comment. Listed here as a genuine, verified-real model (it does
    // run fully offline via @huggingface/transformers in a browser today,
    // just not yet through this app's existing caption pipeline) so it's
    // accurately represented rather than omitted.
    notes: 'A genuinely tiny (256M-parameter) vision-language model designed to run fully offline in a browser — no API key, ever. Not yet wired into this app\'s local-model download pipeline (see the comment on this entry in VisionModelCatalog.ts); listed for completeness and as a near-term local-model candidate.',
  },
  {
    id: 'minicpm-v',
    name: 'MiniCPM-V',
    viaAdapterId: 'openai-compatible',
    builtinProviderId: 'preset-huggingface-vision',
    modelId: 'openbmb/MiniCPM-V-2_6',
    contextLength: 32768,
    multimodal: true,
    capabilities: { imageUnderstanding: true, ocr: true, documentAnalysis: true, chartAnalysis: true },
    realtimeCapable: false,
    streamingSupport: true,
    notes: 'OpenBMB\'s efficiency-focused VLM (8B) — strong OCR/document reading for its size, plus multi-image and video-frame support. Reachable through the Hugging Face Vision preset\'s router.',
  },
  {
    id: 'molmo',
    name: 'Molmo',
    viaAdapterId: 'openai-compatible',
    builtinProviderId: 'preset-huggingface-vision',
    modelId: 'allenai/Molmo-7B-D-0924',
    contextLength: 4096,
    multimodal: true,
    capabilities: { imageUnderstanding: true, ocr: false, documentAnalysis: false, chartAnalysis: false },
    realtimeCapable: false,
    streamingSupport: true,
    notes: 'Allen Institute\'s open VLM, notable for precise object "pointing" (pixel-coordinate grounding) and counting rather than document/chart reading — a good fit for object-detection-style prompts.',
  },
  {
    id: 'phi-4-multimodal',
    name: 'Phi-4 Multimodal',
    viaAdapterId: 'openai-compatible',
    builtinProviderId: 'preset-github-models-vision',
    modelId: 'microsoft/Phi-4-multimodal-instruct',
    contextLength: 131072,
    multimodal: true,
    capabilities: { imageUnderstanding: true, ocr: true, documentAnalysis: true, chartAnalysis: true },
    realtimeCapable: false,
    streamingSupport: true,
    notes: 'Microsoft\'s compact multimodal model (also handles speech/audio input, not just images) with a large context window and solid document/chart reading. Reachable via GitHub Models Vision or NVIDIA NIM Vision.',
  },
  {
    id: 'internvl',
    name: 'InternVL',
    viaAdapterId: 'openai-compatible',
    builtinProviderId: 'preset-huggingface-vision',
    modelId: 'OpenGVLab/InternVL2_5-8B',
    contextLength: 8192,
    multimodal: true,
    capabilities: { imageUnderstanding: true, ocr: true, documentAnalysis: true, chartAnalysis: true },
    realtimeCapable: false,
    streamingSupport: true,
    notes: 'OpenGVLab\'s open VLM line, competitive with much larger closed models on document/OCR/chart benchmarks for its size. Reachable through the Hugging Face Vision or NVIDIA NIM Vision presets.',
  },
  {
    id: 'florence-2',
    name: 'Florence-2',
    viaAdapterId: 'transformers',
    modelId: 'microsoft/Florence-2-base',
    contextLength: 1024,
    multimodal: true,
    capabilities: { imageUnderstanding: true, ocr: true, documentAnalysis: true, chartAnalysis: false },
    realtimeCapable: true,
    streamingSupport: false,
    // Same status as SmolVLM above: Florence-2 is a real, tiny (0.23B),
    // genuinely offline-capable model, but it's task-prompted (e.g.
    // "<OD>", "<OCR>" prefix tokens select behavior) rather than a
    // freeform chat VLM, so it doesn't fit transformers.js's plain
    // image-to-text pipeline used by builtin-transformers-vision today
    // without dedicated handling. Listed for completeness, not yet wired
    // in as an installable local model.
    notes: 'Microsoft\'s tiny, fast, task-prompted vision model (captioning, OCR, and object detection in one small model) — designed to run offline. Not yet wired into this app\'s local-model download pipeline; listed for completeness and as a near-term local-model candidate alongside SmolVLM.',
  },
];

/** Every catalog entry reachable through a given adapterId — the exact grouping VisionMode.ts's Model selector needs once a provider (and therefore its adapterId) is chosen. */
export function getVisionModelsForAdapter(adapterId: string): VisionModelDefinition[] {
  return VISION_MODEL_CATALOG.filter((m) => m.viaAdapterId === adapterId);
}

/** Every catalog entry that's actually usable today with zero extra setup beyond what defaultProviders.ts already ships — i.e. it names a real builtinProviderId. Local (transformers) entries are excluded here since neither is wired into the download pipeline yet (see their notes above). */
export function getCatalogedModelsWithBuiltinProvider(): VisionModelDefinition[] {
  return VISION_MODEL_CATALOG.filter((m) => !!m.builtinProviderId);
}
