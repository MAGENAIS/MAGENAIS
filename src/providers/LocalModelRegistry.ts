/**
 * LocalModelRegistry — centralized, config-driven catalog of every model
 * TransformersAdapter can run entirely in-browser (ONNX Runtime Web, via
 * @huggingface/transformers). This is the single source of truth for local
 * model metadata; TransformersAdapter and the Keys & Providers UI both read
 * from it instead of hardcoding model IDs.
 *
 * DESIGN GOAL (per project brief): "Adding new models should require
 * configuration only — not code changes." Concretely, that means:
 *   1. Every model is one object literal in LOCAL_MODEL_REGISTRY below —
 *      appending an entry is the entire change needed to make a new model
 *      selectable in Keys & Providers and usable by TransformersAdapter.
 *   2. TransformersAdapter never hardcodes a model ID directly — it asks
 *      this module for "the model to use for task X" and gets back either
 *      the person's saved choice (see getSelectedModelId/setSelectedModelId)
 *      or this registry's recommended default for that task.
 *   3. No adapter code branches on a specific model ID; behavior only
 *      depends on `task` (the transformers.js pipeline task name) and the
 *      metadata carried on each LocalModelDefinition.
 *
 * Model IDs are Hugging Face repo IDs, passed straight through to
 * transformers.js's `pipeline(task, modelId, ...)` — this module does not
 * fetch or validate them over the network (no such calls are made from this
 * environment), so `verified` below records whether the exact repo ID was
 * confirmed to exist on Hugging Face at the time this registry was written,
 * not that it will always remain there. Treat `verified:false` entries
 * (currently just the Mistral catalog entry, included for completeness per
 * the project brief's requested model families) as needing a check against
 * https://huggingface.co/models?library=transformers.js before enabling.
 *
 * Size/RAM figures are approximate (quantized-weights download size and
 * rough peak RAM while running) — useful for the picker UI's "will this
 * work on my device" framing, not exact guarantees.
 */

/**
 * transformers.js pipeline task names — passed straight to `pipeline()`, so
 * this union intentionally mirrors the library's own task identifiers
 * rather than inventing MAGENAIS-specific names.
 */
export type LocalModelTask =
  | 'text-generation'
  | 'summarization'
  | 'translation'
  | 'image-to-text'
  | 'automatic-speech-recognition'
  | 'feature-extraction'
  | 'text-to-audio';

export type LocalModelBackend = 'webgpu' | 'wasm' | 'both';

export interface LocalModelDefinition {
  /** Hugging Face repo ID — passed directly to transformers.js's pipeline(). */
  id: string;
  displayName: string;
  task: LocalModelTask;
  /**
   * Distinguishes multiple models sharing one transformers.js task, e.g.
   * 'image-to-text' covers both image captioning and OCR (different models,
   * same pipeline task). Omit for tasks with only one role.
   */
  role?: 'caption' | 'ocr';
  family: string;
  version?: string;
  downloadSizeMB: number;
  ramRequirementMB: number;
  quantization: string;
  contextLength?: number;
  supportedLanguages: string[];
  capabilities: string[];
  backendCompatibility: LocalModelBackend;
  /** Shown as the suggested/default choice for its (task, role) in the picker UI. */
  recommended?: boolean;
  /** Whether this exact repo ID was confirmed to exist on Hugging Face — see module doc comment. */
  verified: boolean;
  notes?: string;
}

// ---------------------------------------------------------------------------
// The catalog. Append new entries here — nothing else needs to change for a
// new model to show up in Keys & Providers and be selectable by TextMode/
// AudioMode/VisionMode/etc via TransformersAdapter.
// ---------------------------------------------------------------------------
export const LOCAL_MODEL_REGISTRY: LocalModelDefinition[] = [
  // ---- Text generation / chat -------------------------------------------
  {
    id: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    displayName: 'SmolLM2 135M Instruct',
    task: 'text-generation',
    family: 'SmolLM2',
    version: '135M',
    downloadSizeMB: 130,
    ramRequirementMB: 300,
    quantization: 'q8/fp16 (auto-selected by transformers.js per backend)',
    contextLength: 8192,
    supportedLanguages: ['en'],
    capabilities: ['chat', 'instruction-following'],
    backendCompatibility: 'both',
    verified: true,
    notes: 'Smallest/fastest option — best for low-RAM devices or when WASM/CPU is the only backend available.',
  },
  {
    id: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    displayName: 'SmolLM2 360M Instruct',
    task: 'text-generation',
    family: 'SmolLM2',
    version: '360M',
    downloadSizeMB: 340,
    ramRequirementMB: 600,
    quantization: 'q8/fp16 (auto-selected by transformers.js per backend)',
    contextLength: 8192,
    supportedLanguages: ['en'],
    capabilities: ['chat', 'instruction-following'],
    backendCompatibility: 'both',
    recommended: true, // matches the existing zero-key default (defaultProviders.ts) — no behavior change
    verified: true,
    notes: 'Default local text model — balances quality against download size/RAM for a zero-key, works-on-any-browser fallback.',
  },
  {
    id: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',
    displayName: 'SmolLM2 1.7B Instruct',
    task: 'text-generation',
    family: 'SmolLM2',
    version: '1.7B',
    downloadSizeMB: 1700,
    ramRequirementMB: 2500,
    quantization: 'q4/fp16 (auto-selected by transformers.js per backend)',
    contextLength: 8192,
    supportedLanguages: ['en'],
    capabilities: ['chat', 'instruction-following', 'reasoning'],
    backendCompatibility: 'webgpu',
    verified: true,
    notes: 'Noticeably stronger than the 360M default, but a large first-time download — WebGPU strongly recommended; WASM/CPU will be slow.',
  },
  {
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    displayName: 'Qwen2.5 0.5B Instruct',
    task: 'text-generation',
    family: 'Qwen2.5',
    version: '0.5B',
    downloadSizeMB: 500,
    ramRequirementMB: 800,
    quantization: 'q4/fp16',
    contextLength: 32768,
    supportedLanguages: ['multilingual'],
    capabilities: ['chat', 'instruction-following', 'multilingual'],
    backendCompatibility: 'both',
    verified: true,
    notes: 'Good multilingual option at a small size — useful when the default English-centric SmolLM2 models aren\u2019t a fit.',
  },
  {
    id: 'onnx-community/Qwen2.5-1.5B-Instruct',
    displayName: 'Qwen2.5 1.5B Instruct',
    task: 'text-generation',
    family: 'Qwen2.5',
    version: '1.5B',
    downloadSizeMB: 1500,
    ramRequirementMB: 2200,
    quantization: 'q4/fp16',
    contextLength: 32768,
    supportedLanguages: ['multilingual'],
    capabilities: ['chat', 'instruction-following', 'multilingual', 'reasoning'],
    backendCompatibility: 'webgpu',
    verified: true,
    notes: 'Strongest multilingual option in this catalog at a still-browser-plausible size; WebGPU recommended.',
  },
  {
    id: 'Xenova/TinyLlama-1.1B-Chat-v1.0',
    displayName: 'TinyLlama 1.1B Chat',
    task: 'text-generation',
    family: 'TinyLlama',
    version: '1.1B',
    downloadSizeMB: 1100,
    ramRequirementMB: 1600,
    quantization: 'q8/fp16',
    contextLength: 2048,
    supportedLanguages: ['en'],
    capabilities: ['chat', 'instruction-following'],
    backendCompatibility: 'both',
    verified: true,
  },
  {
    id: 'onnx-community/gemma-3-1b-it-ONNX',
    displayName: 'Gemma 3 1B (Instruction-tuned)',
    task: 'text-generation',
    family: 'Gemma',
    version: '3-1B',
    downloadSizeMB: 1000,
    ramRequirementMB: 1600,
    quantization: 'q4/fp16',
    contextLength: 32768,
    supportedLanguages: ['multilingual'],
    capabilities: ['chat', 'instruction-following'],
    backendCompatibility: 'webgpu',
    verified: true,
  },
  {
    id: 'Xenova/Phi-3-mini-4k-instruct',
    displayName: 'Phi-3 Mini 4K Instruct',
    task: 'text-generation',
    family: 'Phi',
    version: '3-mini (3.8B)',
    downloadSizeMB: 2400,
    ramRequirementMB: 4000,
    quantization: 'q4',
    contextLength: 4096,
    supportedLanguages: ['en'],
    capabilities: ['chat', 'instruction-following', 'reasoning'],
    backendCompatibility: 'webgpu',
    verified: true,
    notes: 'Largest, highest-quality option in this catalog — WebGPU required in practice; only recommend on higher-end hardware.',
  },
  {
    id: 'onnx-community/Llama-3.2-1B-Instruct',
    displayName: 'Llama 3.2 1B Instruct',
    task: 'text-generation',
    family: 'Llama',
    version: '3.2-1B',
    downloadSizeMB: 1000,
    ramRequirementMB: 1600,
    quantization: 'q4/fp16',
    contextLength: 8192,
    supportedLanguages: ['en', 'de', 'fr', 'it', 'pt', 'hi', 'es', 'th'],
    capabilities: ['chat', 'instruction-following'],
    backendCompatibility: 'webgpu',
    verified: true,
    notes: 'Same family/size class WebLLMAdapter uses (MLC-quantized) — this is the separate ONNX/transformers.js build, for browsers without a WebLLM-compatible WebGPU setup.',
  },
  {
    id: 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX',
    displayName: 'DeepSeek R1 Distill (Qwen 1.5B)',
    task: 'text-generation',
    family: 'DeepSeek',
    version: 'R1-Distill-Qwen-1.5B',
    downloadSizeMB: 1500,
    ramRequirementMB: 2200,
    quantization: 'q4f16',
    contextLength: 32768,
    supportedLanguages: ['en', 'multilingual'],
    capabilities: ['chat', 'reasoning', 'step-by-step'],
    backendCompatibility: 'webgpu',
    verified: true,
    notes: 'Reasoning-distilled model — noticeably slower per response than similarly-sized chat models due to longer chain-of-thought output; WebGPU recommended.',
  },
  {
    id: 'onnx-community/Mistral-7B-Instruct-v0.3',
    displayName: 'Mistral 7B Instruct v0.3',
    task: 'text-generation',
    family: 'Mistral',
    version: '7B-v0.3',
    downloadSizeMB: 4500,
    ramRequirementMB: 8000,
    quantization: 'q4',
    contextLength: 32768,
    supportedLanguages: ['multilingual'],
    capabilities: ['chat', 'instruction-following'],
    backendCompatibility: 'webgpu',
    verified: false,
    notes: 'Included per catalog requirements for completeness; a multi-GB download and high-end WebGPU/RAM are required in practice — verify this exact repo ID resolves on Hugging Face before enabling, and expect this to be impractical on most devices.',
  },

  // ---- Summarization -------------------------------------------------
  {
    id: 'Xenova/distilbart-cnn-6-6',
    displayName: 'DistilBART CNN (6-6)',
    task: 'summarization',
    family: 'DistilBART',
    downloadSizeMB: 300,
    ramRequirementMB: 500,
    quantization: 'q8',
    supportedLanguages: ['en'],
    capabilities: ['summarization'],
    backendCompatibility: 'both',
    recommended: true, // matches existing default in TransformersAdapter.summarize()
    verified: true,
  },

  // ---- Translation -----------------------------------------------------
  {
    id: 'Xenova/t5-small',
    displayName: 'T5 Small (English source only)',
    task: 'translation',
    family: 'T5',
    downloadSizeMB: 240,
    ramRequirementMB: 400,
    quantization: 'q8',
    supportedLanguages: ['en\u2192fr', 'en\u2192de', 'en\u2192ro'],
    capabilities: ['translation'],
    backendCompatibility: 'both',
    recommended: true, // matches existing default in TransformersAdapter.translate()
    verified: true,
    notes: 'English source only, and only to French/German/Romanian — a genuine model limitation, not a config restriction.',
  },

  // ---- Vision: captioning -------------------------------------------
  {
    id: 'Xenova/vit-gpt2-image-captioning',
    displayName: 'ViT-GPT2 Image Captioning',
    task: 'image-to-text',
    role: 'caption',
    family: 'ViT-GPT2',
    downloadSizeMB: 250,
    ramRequirementMB: 500,
    quantization: 'q8',
    supportedLanguages: ['en'],
    capabilities: ['image-captioning'],
    backendCompatibility: 'both',
    recommended: true, // matches existing default in TransformersAdapter.caption()
    verified: true,
  },

  // ---- Vision: OCR -----------------------------------------------------
  {
    id: 'Xenova/trocr-base-printed',
    displayName: 'TrOCR Base (Printed Text)',
    task: 'image-to-text',
    role: 'ocr',
    family: 'TrOCR',
    downloadSizeMB: 550,
    ramRequirementMB: 900,
    quantization: 'q8',
    supportedLanguages: ['en'],
    capabilities: ['ocr'],
    backendCompatibility: 'both',
    recommended: true, // matches existing default in TransformersAdapter.ocr()
    verified: true,
    notes: 'Best on clear printed text; poor on handwriting or heavily stylized text — a model limitation, not a config restriction.',
  },

  // ---- Audio: speech-to-text ---------------------------------------
  {
    id: 'Xenova/whisper-tiny.en',
    displayName: 'Whisper Tiny (English)',
    task: 'automatic-speech-recognition',
    family: 'Whisper',
    version: 'tiny.en',
    downloadSizeMB: 75,
    ramRequirementMB: 250,
    quantization: 'q8',
    supportedLanguages: ['en'],
    capabilities: ['speech-to-text'],
    backendCompatibility: 'both',
    recommended: true, // matches existing default in TransformersAdapter.transcribe()
    verified: true,
  },
  {
    id: 'Xenova/whisper-base.en',
    displayName: 'Whisper Base (English)',
    task: 'automatic-speech-recognition',
    family: 'Whisper',
    version: 'base.en',
    downloadSizeMB: 145,
    ramRequirementMB: 400,
    quantization: 'q8',
    supportedLanguages: ['en'],
    capabilities: ['speech-to-text'],
    backendCompatibility: 'both',
    verified: true,
    notes: 'Noticeably more accurate than the tiny.en default, at roughly double the download/RAM cost.',
  },

  // ---- Music generation --------------------------------------------
  {
    id: 'Xenova/musicgen-small',
    displayName: 'MusicGen Small',
    task: 'text-to-audio',
    family: 'MusicGen',
    version: 'small',
    downloadSizeMB: 1500,
    ramRequirementMB: 2500,
    quantization: 'q8',
    supportedLanguages: ['en'],
    capabilities: ['music-generation'],
    backendCompatibility: 'both',
    recommended: true, // matches existing default in TransformersAdapter's music path
    verified: true,
    notes: 'Large relative to the other zero-key defaults and genuinely slow on WASM/CPU — see the short timeoutMs on builtin-transformers-music.',
  },

  // ---- Embeddings ------------------------------------------------------
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    displayName: 'all-MiniLM-L6-v2',
    task: 'feature-extraction',
    family: 'MiniLM',
    downloadSizeMB: 90,
    ramRequirementMB: 250,
    quantization: 'q8',
    supportedLanguages: ['en'],
    capabilities: ['embeddings'],
    backendCompatibility: 'both',
    recommended: true, // matches existing default in TransformersAdapter.embed()
    verified: true,
  },
];

// ---------------------------------------------------------------------------
// Selection persistence — the person's chosen model per (task, role), saved
// to localStorage so switching models is purely a Keys & Providers setting,
// never a code change. Falls back to the registry's `recommended` entry
// (or the first matching entry, if none is marked recommended) when nothing
// has been chosen yet.
// ---------------------------------------------------------------------------
const SELECTION_STORAGE_KEY = 'magenais.localModelSelection.v1';

function selectionKey(task: LocalModelTask, role?: 'caption' | 'ocr'): string {
  return role ? `${task}:${role}` : task;
}

function readSelections(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    // Corrupt/unavailable storage (private browsing, quota, etc.) — treat as
    // "nothing selected yet" rather than throwing, callers always fall back
    // to the registry default regardless.
    return {};
  }
}

function writeSelections(map: Record<string, string>): void {
  try {
    localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Best-effort — a failed save just means the choice doesn't persist
    // across reloads; it still applies for the current session via the
    // caller's own in-memory state.
  }
}

/** All registry entries for a given task (and, for image-to-text, role). */
export function getModelsForTask(task: LocalModelTask, role?: 'caption' | 'ocr'): LocalModelDefinition[] {
  return LOCAL_MODEL_REGISTRY.filter((m) => m.task === task && (role === undefined || m.role === role));
}

/** Look up a single registry entry by its Hugging Face repo ID. */
export function getModelById(id: string): LocalModelDefinition | undefined {
  return LOCAL_MODEL_REGISTRY.find((m) => m.id === id);
}

/** The registry's recommended default for a task/role, falling back to the first matching entry. */
export function getRegistryDefaultId(task: LocalModelTask, role?: 'caption' | 'ocr'): string | undefined {
  const candidates = getModelsForTask(task, role);
  return (candidates.find((m) => m.recommended) ?? candidates[0])?.id;
}

/**
 * The model ID TransformersAdapter should actually use for a task/role right
 * now: the person's saved choice if they made one (and it still resolves to
 * a real registry entry — guards against a stale selection surviving a
 * registry update that removed that model), else the registry default.
 */
export function getSelectedModelId(task: LocalModelTask, role?: 'caption' | 'ocr'): string | undefined {
  const saved = readSelections()[selectionKey(task, role)];
  if (saved && getModelById(saved)) return saved;
  return getRegistryDefaultId(task, role);
}

/** Persist the person's chosen model for a task/role (e.g. from Keys & Providers). */
export function setSelectedModelId(task: LocalModelTask, id: string, role?: 'caption' | 'ocr'): void {
  const map = readSelections();
  map[selectionKey(task, role)] = id;
  writeSelections(map);
}

/** Clears a single saved selection, reverting that task/role to the registry default. */
export function clearSelectedModelId(task: LocalModelTask, role?: 'caption' | 'ocr'): void {
  const map = readSelections();
  delete map[selectionKey(task, role)];
  writeSelections(map);
}

/**
 * Registers an additional model at runtime (e.g. a future "paste a Hugging
 * Face repo ID" custom-model field in Keys & Providers). No-ops if the ID is
 * already present rather than creating a duplicate entry.
 */
export function registerModel(def: LocalModelDefinition): void {
  if (LOCAL_MODEL_REGISTRY.some((m) => m.id === def.id)) return;
  LOCAL_MODEL_REGISTRY.push(def);
}
