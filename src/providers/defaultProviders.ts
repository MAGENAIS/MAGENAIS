/**
 * Default provider configurations extracted from index.html (PROVIDER_PRESETS).
 * All 52 providers from the original application, converted to TypeScript types.
 * Contains built-in, preset, and custom provider definitions.
 */

import { ProviderConfig } from './types';
import { getRegistryDefaultId } from './LocalModelRegistry';

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  // ============================================================
  // TRUE ZERO-SETUP DEFAULTS — Local > Browser > Free Public
  // ------------------------------------------------------------
  // These are what actually makes MAGENAIS "fully functional after install
  // with zero API keys and zero paid services" (see OllamaAdapter.ts,
  // WebLLMAdapter.ts, TransformersAdapter.ts, PollinationsFreeImageAdapter.ts,
  // WikipediaAdapter.ts for the implementations). They sit at the very top
  // of every fallback chain (lowest `priority` numbers = tried first) and
  // are all `noKeyNeeded: true` + `enabled: true`, so ProviderManager's
  // "re-enable free built-ins" rule (see Manager.loadProviders) keeps them
  // on even if a stray localStorage edit ever turned one off.
  // ============================================================
  {
    id: 'builtin-ollama-text',
    name: 'Ollama (Local)',
    type: 'text',
    adapterId: 'ollama',
    baseUrl: 'http://localhost:11434',
    authType: 'none',
    defaultModel: 'llama3.2',
    priority: 1,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Requirement #4 local-provider default: if the free, open-source Ollama runtime (ollama.com) is installed and running on this machine, MAGENAIS detects it automatically (a fast /api/tags health check, see OllamaAdapter.testConnection) and routes Text, Coding, Agents, and Research synthesis through it first, completely private, completely free, no signup, no API key. If Ollama is not installed, this entrys health check simply fails and the fallback chain moves on to WebLLM/Transformers.js in the browser, then Puter, then any keyed provider you enable. Pull a model with e.g. "ollama pull llama3.2" (general) or "ollama pull qwen2.5-coder" (coding, used automatically for Coding-tab requests, see CodingNodeExecutor). ROOT CAUSE FIX (item 10 — "timeout after 60 seconds"): raised from 60000ms — a model Ollama hasn\'t already loaded into RAM/VRAM (first request after the daemon starts, or after keep_alive expired) can genuinely take longer than 60s to load on modest hardware, especially anything above ~7B parameters on CPU-only inference; 120000ms gives that cold load real headroom. Two companion fixes reduce how often this ceiling is even approached: OllamaAdapter.call() now runs a fast 1.5s-bounded preflight probe before the real request, so a genuinely unreachable Ollama (wrong port, firewall silently dropping the connection) fails in ~1.5s instead of consuming this whole window; and every chat/embeddings request now sends keep_alive so a model stays resident in memory between requests instead of unloading after Ollama\'s own 5-minute default, so only the very first prompt in a while pays the cold-load cost at all.',
    timeoutMs: 120000,
    retries: 1,
  },
  {
    id: 'builtin-ollama-research',
    name: 'Ollama (Local)',
    type: 'research',
    adapterId: 'ollama',
    baseUrl: 'http://localhost:11434',
    authType: 'none',
    defaultModel: 'llama3.2',
    priority: 1,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Synthesizes the free papers already gathered from Semantic Scholar/OpenAlex/arXiv (see legacy/research.ts) into an answer, using a local Ollama model when available, no key, no signup, nothing leaves this machine. See builtin-ollama-text above for why timeoutMs is 120000, not 60000.',
    timeoutMs: 120000,
    retries: 1,
  },
  {
    id: 'builtin-ollama-agents',
    name: 'Ollama (Local)',
    type: 'agents',
    adapterId: 'ollama',
    baseUrl: 'http://localhost:11434',
    authType: 'none',
    defaultModel: 'llama3.2',
    priority: 1,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'General-purpose local agent tasks (see AgentNodeExecutor in Node.ts) run through this first when Ollama is installed and running — completely private, free, no signup. See builtin-ollama-text above for why timeoutMs is 120000, not 60000.',
    timeoutMs: 120000,
    retries: 1,
  },
  {
    id: 'builtin-webllm-agents',
    name: 'WebLLM (Browser, WebGPU)',
    type: 'agents',
    adapterId: 'webllm',
    baseUrl: 'browser:webllm',
    authType: 'none',
    defaultModel: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    priority: 8,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'ROOT CAUSE FIX (user-reported: Agents tab always routed general tasks through the narrow academic-only research pipeline, producing wrong results like a Wikipedia "IATA airport code" answer for "book a flight"): the dedicated agents provider pool previously had only two entries (Ollama, and OpenRouter which needs a key), so it was effectively unusable without local Ollama. This mirrors builtin-webllm-text — a real LLM running entirely in-browser via WebGPU, no server, no key — as a free fallback when Ollama is not installed. See builtin-webllm-text above for details on the one-time model download and timeout.',
    timeoutMs: 120000,
    retries: 0,
  },
  {
    id: 'builtin-transformers-agents',
    name: 'Transformers.js Text (Browser, no key)',
    type: 'agents',
    adapterId: 'transformers',
    baseUrl: 'internal:transformers-text',
    authType: 'none',
    defaultModel: getRegistryDefaultId('text-generation') || 'HuggingFaceTB/SmolLM2-360M-Instruct',
    priority: 15,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Broad-compatibility zero-key fallback for the agents pool, mirroring builtin-transformers-text — runs fully in-browser via ONNX Runtime Web (WASM or WebGPU), works even where WebLLM cannot run at all. See builtin-transformers-text above for model size/caching details.',
    timeoutMs: 120000,
    retries: 0,
  },
  {
    id: 'builtin-ollama-vision',
    name: 'Ollama Vision (Local)',
    // Same type:'text'+visionOnly:true convention as every other Vision
    // entry in this file — see the note on builtin-transformers-vision
    // below for why 'vision' is deliberately not a ProviderType.
    type: 'text',
    adapterId: 'ollama',
    baseUrl: 'http://localhost:11434',
    authType: 'none',
    // 'llava' is the single most commonly pulled Ollama vision model and a
    // safe, well-tested default — but ANY vision-capable Ollama model
    // works (llama3.2-vision, gemma3, qwen2.5vl, minicpm-v, moondream, …):
    // just change Preferred model in Keys & Providers to whatever's
    // already pulled. Deliberately a SEPARATE default model from
    // builtin-ollama-text's 'llama3.2' — sharing one provider entry (and
    // therefore one Preferred-model field) between general text chat and
    // vision would force a person to choose one model for both jobs,
    // usually a worse fit for at least one of them.
    defaultModel: 'llava',
    // Tried right after (not instead of) the plain Ollama text entry, same
    // spirit as builtin-ollama-text's priority 1 — if Ollama is installed
    // AND a vision model is pulled, that's genuinely a better, fully
    // private answer than the small in-browser ViT-GPT2 captioner
    // (builtin-transformers-vision, priority 40) or any cloud provider, so
    // it's worth trying first. If no vision model is pulled, Ollama
    // returns a fast, clear "model not found"-style error (see
    // OllamaAdapter.chat's 404 handling) and the race simply moves on —
    // same fail-fast behavior as builtin-ollama-text's own equivalent case.
    priority: 2,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    visionOnly: true,
    capabilities: ['image-understanding', 'ocr', 'object-detection', 'scene-description', 'image-captioning', 'visual-question-answering'],
    notes: 'ROOT CAUSE FIX (user-reported: Vision\'s Ollama candidate "succeeded" but answered "I don\'t see an image"): this entry didn\'t exist before — Vision calls were reusing builtin-ollama-text\'s general-purpose model, which OllamaAdapter also wasn\'t even sending the image to (see OllamaAdapter.chat\'s images-array fix). Pull a real vision-capable model with e.g. "ollama pull llava" for this to actually work; until then it fails fast and cleanly, and Vision falls through to the next candidate (local Transformers.js captioning, or any cloud Vision provider you\'ve enabled) rather than returning a confusing wrong answer.',
    timeoutMs: 120000,
    retries: 1,
  },
  {
    id: 'builtin-webllm-text',
    name: 'WebLLM (Browser, WebGPU)',
    type: 'text',
    adapterId: 'webllm',
    baseUrl: 'browser:webllm',
    authType: 'none',
    defaultModel: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    priority: 8,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Requirement #4 browser/local model default, the step reached when no local Ollama server is detected. Runs a real LLM entirely inside this browser tab via WebGPU, no server, no key, no signup. Deliberately uses a small ~1B-parameter model (not a larger one) so first-time load has a real chance of finishing inside the timeout below on typical hardware; the model downloads once (roughly 700MB-1GB) and is cached by the browser afterward. If WebGPU is not available, or the model cannot finish loading within timeoutMs, this entry fails cleanly (see ProviderManager.withTimeout) and the chain moves on to Puter / any keyed provider — it can never block the rest of the app. ROOT CAUSE FIX: this was previously 25000ms, which real-world reports showed was consistently too short to finish a genuine first-time ~700MB-1GB download+init on typical home connections — WebLLM timed out on every single request and therefore never got the chance to finish caching the model even once. Raised to 120000ms (2 minutes) so a normal-speed connection has a realistic shot at completing the ONE-TIME download; every request after that reuses the already-initialized in-memory engine and returns almost immediately, so this longer ceiling is only ever actually spent once per browser session.',
    timeoutMs: 120000,
    retries: 0,
  },
  {
    id: 'builtin-transformers-text',
    name: 'Transformers.js Text (Browser, no key)',
    type: 'text',
    adapterId: 'transformers',
    baseUrl: 'internal:transformers-text',
    authType: 'none',
    defaultModel: getRegistryDefaultId('text-generation') || 'HuggingFaceTB/SmolLM2-360M-Instruct',
    priority: 15,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    // Genuine text-generation, unlike builtin-transformers-vision below
    // (which is intentionally NOT this — see its visionOnly flag). Sits
    // just after WebLLM: a real LLM in WebLLM is a better answer when
    // WebGPU is available, but this one works via WASM/CPU on browsers
    // WebLLM can't run on at all, so it's a broader-compatibility
    // zero-key fallback, not a replacement for WebLLM.
    notes: 'Small (360M-parameter) instruction-tuned model running fully in-browser via ONNX Runtime Web — noticeably weaker than WebLLM\'s model but works on any modern browser (WASM), not just WebGPU-capable ones. Uses WebGPU automatically when a real adapter is available, WASM otherwise (see TransformersAdapter.detectDevice). First request downloads and caches the model (~200-400MB); later requests are fast. ROOT CAUSE FIX: on WASM/CPU (no WebGPU), generation length is now capped lower than on WebGPU (see TransformersAdapter.generateText) — CPU-only autoregressive decoding has no acceleration, so the previous flat 1024-token ceiling could alone exceed this timeout even after the model had already finished downloading, which read exactly like a hang. timeoutMs raised alongside that fix so a slower first-time download still has room left for inference afterward.',
    timeoutMs: 120000,
    retries: 0,
  },
  {
    id: 'builtin-transformers-vision',
    name: 'Transformers.js Vision (Browser, no key)',
    // NOTE: 'vision' is not a distinct ProviderType, Vision-tab requests are
    // routed by ProviderManager.callVision() through the 'text' provider
    // pool, filtered down to adapters registered as vision-capable (see
    // VISION_CAPABLE_ADAPTERS in registry/Manager.ts, which now includes
    // 'transformers'). Registering this as type: 'text' (rather than
    // inventing a non-existent 'vision' ProviderType) is what makes it show
    // up as a real Vision candidate without any type-system changes.
    type: 'text',
    adapterId: 'transformers',
    baseUrl: 'browser:transformers',
    authType: 'none',
    defaultModel: getRegistryDefaultId('image-to-text', 'caption') || 'Xenova/vit-gpt2-image-captioning',
    priority: 40,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    visionOnly: true, // captioning-only pipeline — cannot answer a genuine text-generation request; see types.ts
    notes: 'Requirement default for VISION: local, in-browser image captioning + OCR via Transformers.js/ONNX Runtime Web, works with zero keys and no camera data ever leaving the device — genuinely free and unlimited since nothing leaves the browser. It describes the image and reads any text in it, but (unlike a full multimodal chat model) cannot answer arbitrary open-ended questions, the adapter notes this plainly in its output and suggests enabling a multimodal provider (Anthropic/Gemini) for that. Priority 40 is the primary Vision default — tried before the cloud fallback below — and above every disabled-by-default keyed vision option, guaranteeing Vision always produces a real, free result out of the box. ROOT CAUSE FIX: raised to 90000ms — this now runs captioning AND OCR sequentially (see TransformersAdapter.caption), each a separate one-time model download on first use, so the combined budget needs more headroom than a single pipeline did.',
    timeoutMs: 90000,
    retries: 0,
  },
  {
    // Cloud fallback for Vision, tried only after the local/free default
    // above AND after every one of the eight keyed cloud vision presets
    // below (Google AI Studio, OpenRouter, Hugging Face, GitHub Models,
    // Cloudflare, NVIDIA NIM, Mistral Pixtral, Groq — priorities 50-57).
    // PuterAdapter already implements genuine multimodal vision Q&A
    // (puter.ai.chat(prompt, imageDataUrl) — see PuterAdapter.vision()),
    // zero signup, and can actually answer open-ended questions the local
    // captioning model above can't ("what color is the car", "read this
    // sign and translate it"). It's deliberately NOT the primary default,
    // and — per explicit user request — deliberately not prioritized above
    // ANY other vision option either, keyed or not: unlike the fully local
    // pipeline above, Puter's hosted usage isn't guaranteed unlimited and
    // can occasionally hit their own paid-usage paywall, so priority 90+
    // (last, right before nothing) means it only ever gets a turn if every
    // other configured vision candidate — local, and any cloud one you've
    // actually added a key for — has already failed.
    id: 'builtin-puter-vision',
    name: 'Puter.js Vision — GPT (cloud fallback, no key)',
    type: 'text',
    adapterId: 'puter',
    baseUrl: 'puter.ai.chat',
    authType: 'none',
    defaultModel: 'openai/gpt-5.4-nano',
    priority: 90,
    enabled: false, // Disabled by default per user request — Puter's occasional "Upgrade Now" paywall modal was unwanted. Enable manually in Keys & Providers if you want this as a zero-key vision fallback, or add a real vision-capable key (Anthropic/Gemini/OpenAI) instead.
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    visionOnly: true,
    // ROOT CAUSE (user asked for two more free/no-key/unlimited cloud
    // vision providers besides this one): genuinely free *and* keyless
    // *and* unlimited is a narrow combination — most "free" vision APIs
    // still require signing up for a key (Groq, Gemini, OpenRouter,
    // Cloudflare, current-day Pollinations — see that preset's own notes)
    // even on their free tier, which fails the "no key" half of the ask.
    // Puter is close to the reference example of this exact combination
    // (their own docs literally title pages "Free, Unlimited Image
    // Recognition API — no API keys, no usage limits"), and it fronts
    // 400+ underlying models — so rather than three unrelated services
    // (which don't really exist in this category), this and the two
    // entries below are three DIFFERENT underlying models (OpenAI/
    // Anthropic/Google) through that same zero-key gateway: genuine
    // redundancy against any one model being down, overloaded, or
    // hitting a rate limit, without needing three separate signups.
    notes: "Cloud fallback for VISION (1 of 3), tried after the local captioning+OCR default: real multimodal image Q&A via Puter.js's hosted GPT model, zero signup. Not the primary default because Puter's hosted usage can occasionally hit their own paid-usage paywall modal — if that happens, add a real vision-capable key (Anthropic/Gemini/OpenAI) in Keys & Providers instead.",
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-puter-vision-claude',
    name: 'Puter.js Vision — Claude (cloud fallback, no key)',
    type: 'text',
    adapterId: 'puter',
    baseUrl: 'puter.ai.chat',
    authType: 'none',
    defaultModel: 'anthropic/claude-sonnet-5',
    priority: 91,
    enabled: false, // Disabled by default per user request — see builtin-puter-vision above.
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    visionOnly: true,
    notes: "Cloud fallback for VISION (2 of 3) — same zero-key Puter.js gateway as the GPT entry above, routed to Claude instead, so a GPT-specific outage/rate-limit doesn't take out the whole cloud fallback path. If Puter ever renames/retires this exact model id, this entry simply fails over to the next candidate below rather than breaking Vision.",
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-puter-vision-gemini',
    name: 'Puter.js Vision — Gemini (cloud fallback, no key)',
    type: 'text',
    adapterId: 'puter',
    baseUrl: 'puter.ai.chat',
    authType: 'none',
    defaultModel: 'google/gemini-2.5-flash',
    priority: 92,
    enabled: false, // Disabled by default per user request — see builtin-puter-vision above.
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    visionOnly: true,
    notes: "Cloud fallback for VISION (3 of 3) — same zero-key Puter.js gateway, routed to Gemini. Same graceful-failover note as the Claude entry above applies here too.",
    timeoutMs: 30000,
    retries: 1,
  },
  // ---------------------------------------------------------------------
  // BUILT-IN CLOUD VISION PROVIDERS — all eight (Google AI Studio,
  // OpenRouter, Hugging Face, GitHub Models, Cloudflare, NVIDIA NIM,
  // Mistral Pixtral, Groq) are registered out of the box (no need to
  // manually add them via "+ Add custom provider") but disabled until the
  // person supplies an API key, exactly like every other keyed preset below
  // (see the "Requirement #3/#9" comment repeated throughout this file).
  // All eight use the type:'text' + visionOnly:true convention documented
  // on builtin-transformers-vision above and on ProviderConfig.visionOnly
  // in types.ts — there is no separate 'vision' ProviderType. Priorities
  // 50-57 sit after the local/free captioning default (the
  // builtin-transformers-vision entry above, priority 40) so that one is
  // always tried first; among each other, priority roughly
  // follows how generous/reliable each free tier is.
  // ---------------------------------------------------------------------
  {
    id: 'preset-gemini-vision',
    name: 'Google AI Studio — Gemini 2.5 Flash Vision',
    type: 'text',
    adapterId: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authType: 'query',
    authQueryParam: 'key',
    defaultModel: 'gemini-2.5-flash',
    priority: 50,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    visionOnly: true,
    capabilities: ['image-understanding', 'ocr', 'document-analysis', 'table-recognition', 'chart-analysis', 'ui-screenshot-analysis', 'math-ocr', 'object-detection', 'scene-description', 'image-captioning', 'visual-question-answering', 'multi-image-reasoning'],
    notes: 'Google AI Studio offers a genuinely free API tier for Gemini 2.5 Flash (rate-limited, not a trial) — get a free key at aistudio.google.com/apikey. Same GeminiAdapter/endpoint as the plain "Google Gemini" text preset above; this entry just defaults to a vision-strong model and is flagged visionOnly so it lists under Vision, not Text.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-openrouter-vision',
    name: 'OpenRouter Vision',
    type: 'text',
    adapterId: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    authType: 'bearer',
    defaultModel: 'meta-llama/llama-3.2-11b-vision-instruct:free',
    priority: 51,
    enabled: false,
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    visionOnly: true,
    capabilities: ['image-understanding', 'ocr', 'document-analysis', 'chart-analysis', 'object-detection', 'scene-description', 'image-captioning', 'visual-question-answering'],
    notes: 'Same OpenAI-compatible gateway as "OpenRouter (Free Models)" above, routed through the same OpenAICompatibleAdapter (see VISION_CAPABLE_ADAPTERS in registry/Manager.ts). Free vision-capable models on OpenRouter rotate — if this exact ":free" model id 404s, browse openrouter.ai/models?modalities=image for a current one and update Preferred model.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-huggingface-vision',
    name: 'Hugging Face Vision',
    type: 'text',
    // Routed through the generic OpenAICompatibleAdapter (via HF's own
    // OpenAI-compatible Inference Providers router) rather than the
    // dedicated 'huggingface' adapter — HuggingFaceAdapter only implements
    // image/audio/video/music generation and plain text chat today, no
    // multimodal image-input path, so reusing the already vision-capable
    // openai-compatible pipeline (see Manager.ts's callVision) gets this
    // working with zero new adapter code instead of duplicating that logic.
    adapterId: 'openai-compatible',
    baseUrl: 'https://router.huggingface.co/v1',
    authType: 'bearer',
    defaultModel: 'meta-llama/Llama-3.2-11B-Vision-Instruct',
    priority: 52,
    enabled: false,
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    visionOnly: true,
    capabilities: ['image-understanding', 'ocr', 'document-analysis', 'chart-analysis', 'object-detection', 'scene-description', 'image-captioning', 'visual-question-answering'],
    notes: 'Hugging Face\'s OpenAI-compatible router (router.huggingface.co/v1/chat/completions) rather than the classic Inference API — get a free token at huggingface.co/settings/tokens. Swap Preferred model for any other vision-capable model hosted behind the router.',
    timeoutMs: 45000,
    retries: 1,
  },
  {
    id: 'preset-github-models-vision',
    name: 'GitHub Models Vision',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: 'https://models.github.ai/inference',
    authType: 'bearer',
    defaultModel: 'openai/gpt-4o',
    priority: 53,
    enabled: false,
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    visionOnly: true,
    capabilities: ['image-understanding', 'ocr', 'document-analysis', 'table-recognition', 'chart-analysis', 'ui-screenshot-analysis', 'object-detection', 'scene-description', 'image-captioning', 'visual-question-answering', 'multi-image-reasoning'],
    notes: 'Same free-with-any-GitHub-PAT gateway as the "GitHub Models" text preset above, defaulted to a vision-capable model. IMPORTANT: GitHub announced GitHub Models (playground, catalog, inference API, and BYOK) is being fully retired 2026-07-30, with brownout test outages on 2026-07-16 and 2026-07-23 — plan to switch to another vision provider before then.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-cloudflare-vision',
    name: 'Cloudflare Workers AI Vision',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1',
    authType: 'bearer',
    defaultModel: '@cf/llava-hf/llava-1.5-7b-hf',
    priority: 54,
    enabled: false,
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    visionOnly: true,
    // Same CORS gap as every other api.cloudflare.com preset in this file —
    // see preset-cloudflare-text's notes for the full explanation.
    requiresServerProxy: true,
    capabilities: ['image-understanding', 'ocr', 'image-captioning', 'visual-question-answering', 'scene-description'],
    notes: 'Replace YOUR_ACCOUNT_ID in the Base URL with your own Cloudflare account ID (same placeholder pattern as "Cloudflare Workers AI" above — this app warns if it\'s left unedited). Free tier with a Cloudflare account + API token. Requires the local CORS proxy (requiresServerProxy) — Cloudflare sends no Access-Control-Allow-Origin header on any /client/v4/* endpoint.',
    timeoutMs: 45000,
    retries: 1,
  },
  {
    id: 'preset-nvidia-nim-vision',
    name: 'NVIDIA NIM Vision',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    authType: 'bearer',
    defaultModel: 'meta/llama-3.2-90b-vision-instruct',
    priority: 55,
    enabled: false,
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    visionOnly: true,
    capabilities: ['image-understanding', 'ocr', 'document-analysis', 'chart-analysis', 'object-detection', 'scene-description', 'image-captioning', 'visual-question-answering'],
    notes: 'OpenAI-compatible NVIDIA NIM catalog — free API credits available with an NVIDIA developer account at build.nvidia.com. Model catalog moves; use the "Discover" button in this provider\'s editor (GET /v1/models) to confirm the current vision-capable model roster.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-mistral-pixtral',
    name: 'Mistral Pixtral',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    authType: 'bearer',
    defaultModel: 'pixtral-12b-2409',
    priority: 56,
    enabled: false,
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    visionOnly: true,
    capabilities: ['image-understanding', 'ocr', 'document-analysis', 'chart-analysis', 'object-detection', 'scene-description', 'image-captioning', 'visual-question-answering', 'multi-image-reasoning'],
    notes: 'Mistral\'s own vision-language model family (Pixtral), served through the same OpenAI-compatible endpoint as "Mistral AI" above. Has a free/experimental tier for limited use — get a key at console.mistral.ai. Swap Preferred model for pixtral-large-latest for the larger variant.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-groq-vision',
    name: 'Groq Vision',
    type: 'text',
    adapterId: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    authType: 'bearer',
    // ROOT CAUSE FIX (verified via web search, July 2026): Groq deprecated
    // meta-llama/llama-4-scout-17b-16e-instruct (its previous default
    // vision model) on 2026-06-17 — see console.groq.com/docs/deprecations
    // and preset-groq's identical note above for the sibling text-only
    // deprecation. Their own current recommendation for multimodal is
    // qwen/qwen3.6-27b, which Promptfoo's Groq provider docs also confirm
    // as "the current vision-capable model" as of this writing — though
    // Groq itself flags it as a preview model (eval, not production).
    defaultModel: 'qwen/qwen3.6-27b',
    priority: 57,
    enabled: false,
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    visionOnly: true,
    capabilities: ['image-understanding', 'ocr', 'document-analysis', 'chart-analysis', 'object-detection', 'scene-description', 'image-captioning', 'visual-question-answering'],
    notes: 'Same free-tier, very-fast-inference gateway as the "Groq" text preset above, routed to a vision-capable model. Groq\'s multimodal lineup changes often and the currently-recommended model is itself a preview — if this id 404s or is retired, check console.groq.com/docs/vision for the current roster and update Preferred model. Get a free key at console.groq.com/keys.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-transformers-audio',
    name: 'Transformers.js Whisper (Browser, no key)',
    type: 'audio',
    adapterId: 'transformers',
    baseUrl: 'browser:transformers',
    authType: 'none',
    defaultModel: getRegistryDefaultId('automatic-speech-recognition') || 'Xenova/whisper-tiny.en',
    priority: 5,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Requirement default for AUDIO (speech-to-text): runs OpenAIs Whisper model locally in the browser via Transformers.js/ONNX Runtime Web, no key, fully offline after the first (cached) model download. This is what the mic button (src/ui/VoiceInput.ts) and any future Audio-upload transcription feature fall back on when the browsers native SpeechRecognition API is unavailable or fails.',
    timeoutMs: 25000,
    retries: 0,
  },
  {
    id: 'builtin-transformers-music',
    name: 'Transformers.js MusicGen (Browser, no key)',
    type: 'music',
    adapterId: 'transformers',
    baseUrl: 'browser:transformers',
    authType: 'none',
    defaultModel: getRegistryDefaultId('text-to-audio') || 'Xenova/musicgen-small',
    priority: 40,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Requirement default for MUSIC: MusicGen running locally via Transformers.js, no key needed. This is a large model and generation is genuinely slow on CPU-only/WASM execution, so timeoutMs below is intentionally short (fails fast rather than blocking the Music tab for minutes) — if it times out, enable a keyed Music provider (Hugging Face MusicGen, Stable Audio, ...) in Advanced Settings for reliably fast results.',
    timeoutMs: 30000,
    retries: 0,
  },
  {
    id: 'builtin-transformers-embeddings',
    name: 'Transformers.js Embeddings (Browser, no key)',
    type: 'embeddings',
    adapterId: 'transformers',
    baseUrl: 'internal:transformers-embeddings',
    authType: 'none',
    defaultModel: getRegistryDefaultId('feature-extraction') || 'Xenova/all-MiniLM-L6-v2',
    priority: 10,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Local sentence-embedding vectors (384-dim, all-MiniLM-L6-v2) via Transformers.js, no key needed, fully offline after first (cached) model download — for any feature needing semantic similarity/vector search (e.g. a future local RAG/search feature). Currently the only provider registered under the \'embeddings\' type.',
    timeoutMs: 30000,
    retries: 0,
  },
  {
    id: 'builtin-pollinations-free-image',
    name: 'Pollinations (Free Image, no key)',
    type: 'image',
    adapterId: 'pollinations-free',
    baseUrl: 'https://image.pollinations.ai',
    authType: 'none',
    defaultModel: 'flux',
    priority: 5,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Requirement default for IMAGE: Pollinations original, still-live, genuinely unauthenticated image endpoint (image.pollinations.ai, distinct from gen.pollinations.ai, which now requires a Pollen API key for everything, see PollinationsAdapters notes). Free, unlimited-for-reasonable-use, no signup. This is also what makes VIDEO work with zero keys by default: KenBurnsFallbackAdapter (the built-in last-resort video provider) generates its source still image through this same free image pipeline, then pans/zooms it into a real video file, so Image being free-by-default cascades into Video being free-by-default too.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    // Second genuinely free, no-key image option (see PuterAdapter.image())
    // — NOT enabled by default, per user request, matching every other
    // Puter-backed preset here (text/agents/research above): Puter's
    // hosted models can hit its own paid-usage paywall ("Upgrade Now"
    // modal) unpredictably, which this app can't control or suppress.
    // Enable manually in Keys & Providers if you want it as a fallback
    // when Pollinations' anonymous tier is rate-limited or Turnstile-
    // blocked (see builtin-pollinations-free-image's own known caveat).
    id: 'builtin-puter-image',
    name: 'Puter.js (optional, no key)',
    type: 'image',
    adapterId: 'puter',
    baseUrl: 'puter.ai.txt2img',
    authType: 'none',
    priority: 6, // right after Pollinations Free (5) — the intended "next free thing to try" slot, only reached if you enable it.
    enabled: false,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: "No signup, dozens of models (FLUX, Stable Diffusion, GPT Image, and more) — disabled by default so image generation never risks Puter's occasional paid-usage paywall modal. Enable here any time you want a second free fallback alongside Pollinations.",
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-wikipedia-research',
    name: 'Wikipedia (Free, no key)',
    type: 'research',
    adapterId: 'wikipedia',
    baseUrl: 'https://en.wikipedia.org',
    authType: 'none',
    priority: 210,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Absolute last-resort research/search fallback, deliberately the single lowest-priority provider in the entire default set (higher than even Puters 200), since it does not use an LLM at all: it looks up the best-matching Wikipedia article and returns its summary directly. Only reached if every other research provider (the free papers-synthesis pipeline via Ollama/WebLLM/Puter, and any keyed provider you have enabled) is unavailable, but guarantees the Research tab never hard-fails with "no provider available" on a totally fresh install with a browser that lacks WebGPU.',
    timeoutMs: 15000,
    retries: 1,
  },

  // ============================================================
  // BUILT-IN PROVIDERS (from index.html)
  // ============================================================
  {
    id: 'builtin-puter-text',
    name: 'Puter.js (optional, no key)',
    type: 'text',
    adapterId: 'puter',
    baseUrl: 'puter.ai.chat',
    authType: 'none',
    priority: 200,
    enabled: false, // Disabled by default per user request — no longer force-enabled on first launch either (see the adapterId!=='puter' check in Manager.ts's force-enable loop). Enable manually in Keys & Providers if you want Puter back as a last-resort text fallback.
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: "Independent infra, no signup — disabled by default so text generation never risks Puter's own occasional paid-usage paywall (\"Upgrade Now\" modal). For a genuine zero-signup text path, use the local Ollama/WebLLM steps above, or add a free key for a provider like Pollinations Text (see builtin-pollinations-text) in Keys & Providers. Re-enable here any time if you'd rather have Puter as a last-resort fallback than have generation fail outright when nothing else is configured.",
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-puter-agents',
    name: 'Puter.js (optional, no key)',
    type: 'agents',
    adapterId: 'puter',
    baseUrl: 'puter.ai.chat',
    authType: 'none',
    priority: 200,
    enabled: false, // matches builtin-puter-text — disabled by default to avoid Puter's occasional paid-usage paywall modal; enable manually in Keys & Providers if wanted as a last-resort agents fallback.
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Last-resort no-key agents fallback, same rationale as builtin-puter-text above.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    // ROOT CAUSE ("Research and Agent tabs errors — need a default provider
    // that doesn't need provider settings for start"): the research node
    // already gathers real papers for free from Semantic Scholar/OpenAlex/
    // arXiv (no key needed, see legacy/research.ts), but the final
    // synthesis step (turning those papers into an answer) called a
    // 'research'-type provider — and the ONLY one registered
    // (preset-huggingface-research) requires an API key, with no free
    // fallback. So research failed by default for anyone who hadn't
    // configured a keyed provider, on both the Research tab and any Agent
    // pipeline step using the research node. This reuses the same
    // zero-setup Puter pipeline that already backs free text generation.
    id: 'builtin-puter-research',
    name: 'Puter.js (optional, no key)',
    type: 'research',
    adapterId: 'puter',
    baseUrl: 'puter.ai.chat',
    authType: 'none',
    priority: 200,
    enabled: false, // Disabled by default per user request — see builtin-puter-text above for the same reasoning.
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: "Synthesizes the free papers already gathered from Semantic Scholar/OpenAlex/arXiv into an answer, with no signup — disabled by default so this never risks Puter's occasional paywall modal. The Research tab still falls back to Wikipedia (builtin-wikipedia-research) as an absolute last resort, so it won't hard-fail; add a keyed provider or re-enable Puter here for a fuller synthesized answer.",
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-huggingface-text',
    name: 'Hugging Face (built-in text)',
    type: 'text',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    priority: 20,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: true,
    notes: 'PHASE 2 FIX: this used to be a hardcoded step with no adjustable priority, which meant it (and Pollinations) always ran before ANY registry provider regardless of what priority you set there — even a priority-1 OpenAI entry. Now a real registry entry like everything else, so its position in the chain genuinely reflects this priority number.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-pollinations-text',
    name: 'Pollinations Text (needs free key)',
    type: 'text',
    adapterId: 'pollinations',
    baseUrl: 'https://gen.pollinations.ai',
    authType: 'bearer',
    defaultModel: 'openai',
    priority: 9, // Promoted per user request to take Puter's former place as the go-to text fallback right after the free local steps (Ollama=1, WebLLM=8) — tried before every other keyed provider.
    enabled: false, // Still starts disabled: Pollinations text genuinely requires an API key now (see notes below), so — same as every keyed provider — it only activates once you add one in Keys & Providers. It does NOT work key-free the way Puter used to.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: true,
    notes: "CONFIRMED CHANGE (per Pollinations' own docs, mid-2026): Pollinations no longer offers true no-key client-side generation — publishable (pk_) keys were replaced by a Bring-Your-Own-Pollen OAuth flow, and \"all generation requests require an API key.\" Get a free key at enter.pollinations.ai (a free Pollen allowance is included), then add it in Keys & Providers — once added, this is now the FIRST provider tried for text after the free local steps (Ollama/WebLLM), ahead of every other keyed provider, taking the spot Puter used to occupy. Without a key it's correctly skipped rather than erroring.",
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-pollinations-image',
    name: 'Pollinations Flux Image (needs free key)',
    type: 'image',
    adapterId: 'pollinations',
    baseUrl: 'https://gen.pollinations.ai',
    authType: 'bearer',
    defaultModel: 'flux',
    priority: 18,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Same confirmed change as the text entry — Pollinations now requires a key for all generation, including image. Get a free key at enter.pollinations.ai.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-huggingface-image',
    name: 'Hugging Face (built-in image)',
    type: 'image',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'black-forest-labs/FLUX.1-dev',
    priority: 20,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Phase 2 fix: same as builtin-huggingface-text — now a real, priority-adjustable registry entry instead of an unconditionally-first hardcoded step.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-huggingface-video',
    name: 'Hugging Face (built-in video)',
    type: 'video',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'Wan-AI/Wan2.1-T2V-14B',
    priority: 20,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: true,
    notes: "Phase 2 fix: now a real registry entry. Video support is additionally gated by a live check against Hugging Face's own model registry before any generation attempt.",
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-huggingface-speech',
    name: 'Hugging Face (built-in speech)',
    type: 'speech',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'hexgrad/Kokoro-82M',
    priority: 25,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Phase 2 fix: now a real registry entry with an adjustable priority.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-huggingface-audio',
    name: 'Hugging Face Whisper (built-in transcription)',
    type: 'audio',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'openai/whisper-large-v3',
    priority: 20,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Phase 2 fix: now a real registry entry with an adjustable priority.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-huggingface-music',
    name: 'Hugging Face MusicGen (built-in music)',
    type: 'music',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'facebook/musicgen-large',
    priority: 20,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: true,
    notes: "Phase 2 fix: now a real registry entry. Availability is additionally gated by a live check against Hugging Face's own model registry before any generation attempt.",
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-pollinations-music',
    name: 'Pollinations ElevenMusic (needs free key)',
    type: 'music',
    adapterId: 'pollinations',
    baseUrl: 'https://gen.pollinations.ai',
    authType: 'bearer',
    defaultModel: 'elevenmusic',
    priority: 18,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Phase 2 fix: now a real registry entry with an adjustable priority, instead of a hardcoded step.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-puter-tts',
    name: 'Puter.js Speech (optional, no key)',
    type: 'speech',
    adapterId: 'puter',
    baseUrl: 'puter.ai.txt2speech',
    authType: 'none',
    priority: 200,
    enabled: false, // Disabled by default per user request — see builtin-puter-text above. Browser Speech Synthesis (builtin-browser-speech) already covers zero-setup speech, so nothing is left without a free fallback.
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Real recordable audio file, no key needed — disabled by default so speech generation never risks Puter\'s occasional paywall modal. Browser Speech Synthesis (see builtin-browser-speech below) is the zero-setup default instead; re-enable here if you want an actual downloadable audio file rather than live browser TTS.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-browser-speech',
    name: 'Browser Speech Synthesis (built-in, no key)',
    type: 'speech',
    adapterId: 'browser-speech',
    baseUrl: 'speechSynthesis',
    authType: 'none',
    priority: 90,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Last-resort fallback. Can be heard live but NOT saved to a file — browser limitation, not something this app can fix.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'builtin-kenburns-video',
    name: 'Pan/Zoom Still Fallback (built-in, no key)',
    type: 'video',
    adapterId: 'internal-fallback',
    baseUrl: 'internal:ken-burns',
    authType: 'none',
    priority: 95,
    enabled: true,
    noKeyNeeded: true,
    isPreset: true,
    isBuiltIn: true,
    notes: 'Not real AI video — an animated still image, used only when every real video provider fails or isn\'t configured.',
    timeoutMs: 30000,
    retries: 1,
  },

  // ============================================================
  // PRESET PROVIDERS (from index.html)
  // ============================================================
  {
    id: 'preset-groq',
    name: 'Groq',
    type: 'text',
    adapterId: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    authType: 'bearer',
    defaultModel: 'openai/gpt-oss-120b', // ROOT CAUSE FIX (verified via web search, July 2026): llama-3.3-70b-versatile was deprecated by Groq on June 17, 2026 — this is Groq's own recommended replacement (console.groq.com/docs/deprecations).
    priority: 11,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'OpenAI-compatible, very fast inference, generous free tier. Get a free key at console.groq.com/keys.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-openrouter-free',
    name: 'OpenRouter (Free Models)',
    type: 'text',
    adapterId: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    authType: 'bearer',
    defaultModel: 'openrouter/free',
    priority: 12,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    // ROOT CAUSE FIX (user-reported HTTP 404 "This model is unavailable for
    // free. The paid version is available now - use this slug instead:
    // meta-llama/llama-3.3-70b-instruct"): OpenRouter's free-model roster
    // rotates — a hardcoded ":free" id can get pulled or upstream-throttled
    // at any time (OpenRouter's own docs warn about this). openrouter/free
    // is OpenRouter's own "Free Models Router": it auto-selects a
    // currently-available free model per request, filtered to whatever
    // capabilities the request needs, so this default keeps working even
    // after any individual free model rotates out. See
    // openrouter.ai/docs/cookbook/get-started/free-models-router-playground.
    notes: 'OpenAI-compatible. Defaults to openrouter/free (OpenRouter\'s own Free Models Router, which auto-picks whichever free model is currently available) so this preset keeps working as the free-model roster rotates. Pin a specific ":free" model id instead if you want repeatable behavior — browse them at openrouter.ai/models?max_price=0.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-cerebras',
    name: 'Cerebras',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.cerebras.ai/v1',
    authType: 'bearer',
    defaultModel: 'llama3.1-8b', // ROOT CAUSE FIX (verified via web search, July 2026): llama-4-scout-17b-16e-instruct matches the exact "Model does not exist" error reported — Cerebras's lineup has been genuinely volatile (one report shows their public model list cut to ~4 in April 2026), and sources disagree on Scout's current status. llama3.1-8b is the one model confirmed present across every source checked. Use the "Discover" button in this provider's editor (queries GET /v1/models directly) to see Cerebras's actual current lineup rather than trust any hardcoded list, this one included.
    priority: 13,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: "OpenAI-compatible, free tier (1M tokens/day). CAUTION: Cerebras's free-model catalog is unusually volatile — it has shrunk to as few as two models at times in 2026 — so a 404 'model_not_found' here means their catalog moved on, not a misconfiguration. If that happens, check the live list with: curl https://api.cerebras.ai/v1/models -H \"Authorization: Bearer YOUR_KEY\" and set whatever's returned as this provider's Preferred model.",
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-sambanova',
    name: 'SambaNova',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.sambanova.ai/v1',
    authType: 'bearer',
    defaultModel: 'Meta-Llama-3.3-70B-Instruct',
    priority: 14,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'OpenAI-compatible, free tier. Get a free key at cloud.sambanova.ai.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-moonshot',
    name: 'Moonshot AI (Kimi)',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.moonshot.ai/v1',
    authType: 'bearer',
    defaultModel: 'kimi-k3',
    priority: 14,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    // PHASE 4 FIX: api.moonshot.ai does not send Access-Control-Allow-Origin,
    // so a direct browser POST to /v1/chat/completions is blocked by CORS
    // before it ever leaves the page (the exact "Failed to fetch" bug
    // report this preset was added to fix). requiresServerProxy routes it
    // through the local same-origin proxy instead — see the PHASE 4 doc
    // comment on BaseAdapter.fetchWithRetry and server/proxyHandler.mjs.
    // This is plain provider configuration, not Moonshot-specific code:
    // any future provider with the same CORS restriction sets the same
    // one flag and needs nothing else.
    requiresServerProxy: true,
    notes: 'OpenAI-compatible Chat Completions API (platform.moonshot.ai). Requires the local CORS proxy — see requiresServerProxy above. Model catalog moves fairly often; if kimi-k3 404s, check the current model list at platform.moonshot.ai/docs and update Preferred model.',
    timeoutMs: 45000, // K3 "always reasons" per Moonshot's own docs — noticeably slower per response than a non-reasoning chat model, so it gets a longer window than the 30s default.
    retries: 1,
  },
  {
    id: 'preset-github-models',
    name: 'GitHub Models',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: 'https://models.github.ai/inference',
    authType: 'bearer',
    defaultModel: 'openai/gpt-4o-mini',
    priority: 15,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'OpenAI-compatible, free with any GitHub PAT that has the "models: read" permission — no separate signup. ' +
      'IMPORTANT: GitHub announced on 2026-07-01 that GitHub Models (playground, catalog, inference API, and BYOK) ' +
      'is being fully retired on 2026-07-30, with brownout test outages on 2026-07-16 and 2026-07-23 — expect ' +
      'errors during those windows and plan to switch to another text provider before the end of July 2026.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-cloudflare-text',
    name: 'Cloudflare Workers AI',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1',
    authType: 'bearer',
    defaultModel: '@cf/meta/llama-3.1-8b-instruct',
    priority: 16,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    // ROOT CAUSE FIX (user-reported "Failed to fetch" on every Cloudflare
    // preset): api.cloudflare.com sends no Access-Control-Allow-Origin
    // header on any /client/v4/* endpoint (confirmed via Cloudflare's own
    // community forum — this is a known, longstanding gap, not
    // account-specific), so a direct browser call is blocked by CORS
    // before it ever reaches the network — the browser reports the same
    // generic, contextless "Failed to fetch" for that as for a real outage.
    // Same fix as fal.ai/Replicate/Moonshot above: route through the local
    // CORS proxy instead. See BaseAdapter.fetchWithRetry / server/proxyHandler.mjs.
    requiresServerProxy: true,
    notes: 'Replace YOUR_ACCOUNT_ID in the base URL with your Cloudflare account ID. Free tier with a Cloudflare account + API token. Requires the local CORS proxy (requiresServerProxy) — see preset-fal-ai above for why.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-huggingface-inference',
    name: 'Hugging Face Inference',
    type: 'text',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    priority: 30,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: "Free tier, no credit card. Manually enter the model id — HF doesn't expose a single browsable /models list across all pipeline types. Confirm the exact id is currently live on huggingface.co before relying on it; providers occasionally retire model ids (a previous default here, Qwen/Qwen3-32B-Instruct, stopped resolving).",
    timeoutMs: 300000,
    retries: 3,
  },
  {
    id: 'preset-deepseek',
    name: 'DeepSeek',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    authType: 'bearer',
    defaultModel: 'deepseek-chat',
    priority: 26,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'OpenAI-compatible. Strong, inexpensive general + reasoning models (deepseek-chat / deepseek-reasoner). Get a key at platform.deepseek.com.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-qwen-dashscope',
    name: 'Qwen (Alibaba Cloud)',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    authType: 'bearer',
    defaultModel: 'qwen-plus',
    priority: 27,
    enabled: false,
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'OpenAI-compatible ("compatible-mode" endpoint). Alibaba Cloud DashScope — qwen-turbo (fastest/cheapest), qwen-plus (default, balanced), or qwen-max (strongest) as the Preferred model. Get a key at dashscope.console.aliyun.com (international sign-up available at modelstudio.console.alibabacloud.com).',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-together',
    name: 'Together AI',
    type: 'text',
    adapterId: 'together',
    baseUrl: 'https://api.together.xyz/v1',
    authType: 'bearer',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    priority: 25,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: '',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-deepinfra',
    name: 'DeepInfra',
    type: 'text',
    adapterId: 'deepinfra',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    authType: 'bearer',
    defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
    priority: 25,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: '',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-openai',
    name: 'OpenAI',
    type: 'text',
    adapterId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    defaultModel: 'gpt-5.4-mini', // ROOT CAUSE FIX (verified via web search, July 2026): gpt-4o-mini is on OpenAI's confirmed GPT-4o-family retirement path; gpt-5.4-mini is a current, documented model string (released March 17, 2026).
    priority: 15,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: '',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-anthropic',
    name: 'Anthropic',
    type: 'text',
    adapterId: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    authType: 'header',
    authHeaderName: 'x-api-key',
    defaultModel: 'claude-haiku-4-5-20251001', // ROOT CAUSE FIX (verified via web search, July 2026): claude-3-5-haiku-latest is from the Claude 3.5 generation, well before Claude 4 — this is the current Haiku, using the full dated ID per Anthropic's own guidance to avoid alias strings in production.
    priority: 15,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: "Anthropic's API blocks direct browser calls via CORS unless the anthropic-dangerous-direct-browser-access header is sent — added automatically by this adapter.",
    timeoutMs: 30000,
    retries: 1,
    headers: '{"anthropic-version":"2023-06-01"}',
  },
  {
    id: 'preset-gemini',
    name: 'Google Gemini',
    type: 'text',
    adapterId: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authType: 'query',
    authQueryParam: 'key',
    defaultModel: 'gemini-flash-latest', // ROOT CAUSE FIX (verified via web search, July 2026): gemini-1.5-flash is FULLY SHUT DOWN — Google's own docs confirm "all requests to these models return a 404 error." Using the auto-updating -latest alias (currently gemini-3.5-flash) instead of a dated string so this default doesn't go stale the same way again.
    priority: 15,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: '',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-xai',
    name: 'xAI (Grok)',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.x.ai/v1',
    authType: 'bearer',
    defaultModel: 'grok-2-latest',
    priority: 20,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: '',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-mistral',
    name: 'Mistral AI',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    authType: 'bearer',
    defaultModel: 'mistral-small-latest',
    priority: 20,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'OpenAI-compatible. France/EU-based, GDPR-relevant if that matters for your use case. Has a free/experimental tier for limited use. Get a key at console.mistral.ai.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-huggingface-flux',
    name: 'Hugging Face FLUX',
    type: 'image',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'black-forest-labs/FLUX.1-dev',
    priority: 30,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Alternate default: stabilityai/stable-diffusion-xl-base-1.0. Manually enter the model id.',
    timeoutMs: 300000,
    retries: 3,
  },
  {
    id: 'preset-cloudflare-flux',
    name: 'Cloudflare FLUX',
    type: 'image',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/run',
    authType: 'bearer',
    defaultModel: '@cf/black-forest-labs/flux-1-schnell',
    // ROOT CAUSE FIX (July 2026): Workers AI selects the model via the URL
    // path (".../ai/run/{model}"), not a body field — baseUrl already ends
    // at ".../ai/run", so imageEndpoint just appends the model.
    imageEndpoint: '/{model}',
    imageIncludeModelInBody: false,
    priority: 31,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    // ROOT CAUSE FIX — see preset-cloudflare-text above: api.cloudflare.com
    // sends no CORS headers on any /client/v4/* endpoint, so this failed
    // client-side with a generic "Failed to fetch" before ever reaching
    // the network.
    requiresServerProxy: true,
    notes: "Replace YOUR_ACCOUNT_ID with your Cloudflare account ID. Cloudflare Workers AI's request/response shape differs slightly from plain OpenAI images — if the generic adapter can't parse the response, add a small custom adapter or use the backend proxy. Requires the local CORS proxy (requiresServerProxy).",
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-openrouter-flux',
    name: 'OpenRouter FLUX',
    type: 'image',
    adapterId: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    authType: 'bearer',
    defaultModel: 'black-forest-labs/flux.2-klein', // ROOT CAUSE FIX (verified via web search, July 2026): flux-1-schnell:free matches the exact "not a valid model ID" error reported — OpenRouter's black-forest-labs catalog has moved entirely to the FLUX.2 family (Klein/Max/Flex/Pro); flux-1-schnell isn't offered at all anymore, free or otherwise. flux.2-klein is their current fastest/cheapest tier, but it is NOT free — see notes.
    // No imageEndpoint/imageRequestFormat override needed — OpenRouter's
    // Unified Image API (launched June 2026) speaks the plain OpenAI
    // POST /images/generations shape, which is OpenAICompatibleAdapter's
    // default. See callImage() in that file for how this is now
    // config-driven instead of hardcoded per provider.
    priority: 32,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: "Paid — OpenRouter's black-forest-labs image models (FLUX.2 family) no longer have a free tier as of mid-2026. Priced per megapixel; flux.2-klein is their cheapest current option. For a genuinely free image option, see Pollinations, already enabled by default.",
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-fal-ai',
    name: 'fal.ai',
    type: 'image',
    adapterId: 'falai',
    baseUrl: 'https://fal.run',
    authType: 'header',
    authHeaderName: 'Authorization',
    authHeaderPrefix: 'Key ', // ROOT CAUSE FIX (verified via web search, July 2026): fal.ai uses a custom "Key" auth scheme (Authorization: Key {FAL_KEY}), not a bare token — without this prefix, every request would send a malformed Authorization header regardless of whether the key itself is valid.
    defaultModel: 'fal-ai/flux/schnell',
    priority: 25,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Requires the local CORS proxy (requiresServerProxy) — fal.run does not send Access-Control-Allow-Origin, so a direct browser call is blocked before it reaches the network. See BaseAdapter.fetchWithRetry / server/proxyHandler.mjs.',
    requiresServerProxy: true,
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-replicate-image',
    name: 'Replicate',
    type: 'image',
    adapterId: 'replicate',
    baseUrl: 'https://api.replicate.com/v1',
    authType: 'bearer', // ROOT CAUSE FIX (verified via web search, July 2026 — Replicate's own changelog): was authType:'header' with no prefix, sending a bare unprefixed key. Replicate migrated from a custom "Token" scheme to standard Bearer auth in 2024 — this matches the exact "did not pass a valid authentication token" error reported.
    defaultModel: 'black-forest-labs/flux-schnell',
    priority: 25,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Requires the local CORS proxy (requiresServerProxy) — api.replicate.com does not send Access-Control-Allow-Origin either. See BaseAdapter.fetchWithRetry / server/proxyHandler.mjs.',
    requiresServerProxy: true,
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-stability-ai',
    name: 'Stability AI',
    type: 'image',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.stability.ai/v2beta',
    authType: 'bearer',
    defaultModel: 'core', // engine name, not a chat-style model id — substituted directly into imageEndpoint below. Other valid values: 'ultra', 'sd3'.
    // ROOT CAUSE FIX (July 2026): v2beta Stable Image endpoints are
    // multipart/form-data POSTs to a task-specific subpath
    // (".../stable-image/generate/{engine}"), not JSON to the bare
    // v2beta root, and only return raw image bytes (instead of a base64
    // JSON envelope) when Accept: image/* is sent.
    imageEndpoint: '/stable-image/generate/{model}',
    imageRequestFormat: 'multipart',
    imageResponseFormat: 'binary',
    imageIncludeModelInBody: false,
    priority: 20,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: '',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-huggingface-wan',
    name: 'Hugging Face Wan',
    type: 'video',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'Wan-AI/Wan2.1-T2V-14B',
    priority: 30,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: "CONFIRMED FIX: the model id previously had a fabricated \"-Diffusers\" suffix that isn't a real HF repo, and requests were wrongly routed through hf-inference, which never serves video (confirmed via HF's own docs: video is fal-ai/Replicate/Novita/WaveSpeedAI only). Alternate default: Wan-AI/Wan2.1-T2V-1.3B (smaller/faster). Raw REST for video isn't a publicly stabilized contract per HF's own SDK docs — if this fails consistently, use the backend proxy option, which can call fal.ai's own SDK server-side instead of guessing at the raw shape.",
    timeoutMs: 300000,
    retries: 3,
  },
  {
    id: 'preset-huggingface-ltx',
    name: 'Hugging Face LTX',
    type: 'video',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'Lightricks/LTX-Video',
    priority: 31,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Faster/lighter text-to-video alternative to Wan. Same raw-REST caveat applies.',
    timeoutMs: 300000,
    retries: 3,
  },
  {
    id: 'preset-huggingface-image-to-video',
    name: 'Hugging Face (Image-to-Video)',
    type: 'video',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'Wan-AI/Wan2.2-TI2V-5B',
    priority: 33,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Animates a source image into real video motion. Same raw-REST caveat as text-to-video applies.',
    timeoutMs: 300000,
    retries: 3,
  },
  {
    id: 'preset-cloudflare-video',
    name: 'Cloudflare AI (Video)',
    type: 'video',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/run',
    authType: 'bearer',
    defaultModel: '@cf/lucataco/stable-video-diffusion',
    priority: 32,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    // ROOT CAUSE FIX — see preset-cloudflare-text above: api.cloudflare.com
    // sends no CORS headers on any /client/v4/* endpoint.
    requiresServerProxy: true,
    notes: "Replace YOUR_ACCOUNT_ID with your Cloudflare account ID. Availability/model ids on Workers AI change over time — check developers.cloudflare.com/workers-ai/models for the current video model id. Requires the local CORS proxy (requiresServerProxy).",
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-fal-ai-video',
    name: 'fal.ai (Video)',
    type: 'video',
    adapterId: 'falai',
    baseUrl: 'https://fal.run',
    authType: 'header',
    authHeaderName: 'Authorization',
    authHeaderPrefix: 'Key ', // see preset-fal-ai above — same root cause fix
    defaultModel: 'fal-ai/luma-dream-machine',
    priority: 25,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Requires the local CORS proxy (requiresServerProxy) — see preset-fal-ai above.',
    requiresServerProxy: true,
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-replicate-video',
    name: 'Replicate (Video)',
    type: 'video',
    adapterId: 'replicate',
    baseUrl: 'https://api.replicate.com/v1',
    authType: 'bearer', // see preset-replicate-image above — same root cause fix
    defaultModel: 'minimax/video-01',
    priority: 25,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Requires the local CORS proxy (requiresServerProxy) — see preset-replicate-image above.',
    requiresServerProxy: true,
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-novita-ai',
    name: 'Novita AI',
    type: 'video',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.novita.ai/v3',
    authType: 'bearer',
    defaultModel: 'default',
    priority: 30,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: '',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-pollinations-video',
    name: 'Pollinations Video (fallback only)',
    type: 'video',
    adapterId: 'pollinations',
    baseUrl: 'https://gen.pollinations.ai/video',
    authType: 'bearer',
    defaultModel: 'wan',
    priority: 80,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Paid (Pollen balance required) — kept low-priority as a fallback per the request, since it\'s not free despite needing a Pollinations key.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-groq-whisper',
    name: 'Groq Whisper',
    type: 'audio',
    adapterId: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    authType: 'bearer',
    defaultModel: 'whisper-large-v3-turbo',
    priority: 20,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'OpenAI-compatible /audio/transcriptions endpoint, free tier, very fast.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-whisper-hf',
    name: 'Whisper (Hugging Face)',
    type: 'audio',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'openai/whisper-large-v3',
    priority: 30,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: '',
    timeoutMs: 300000,
    retries: 3,
  },
  {
    id: 'preset-cloudflare-whisper',
    name: 'Cloudflare Whisper',
    type: 'audio',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/run',
    authType: 'bearer',
    defaultModel: '@cf/openai/whisper',
    priority: 31,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    // ROOT CAUSE FIX (this is the exact provider reported failing with
    // "Failed to fetch") — see preset-cloudflare-text above:
    // api.cloudflare.com sends no CORS headers on any /client/v4/*
    // endpoint, so this was blocked client-side before it ever reached
    // the network.
    requiresServerProxy: true,
    notes: 'Replace YOUR_ACCOUNT_ID with your Cloudflare account ID. Requires the local CORS proxy (requiresServerProxy).',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-deepgram',
    name: 'Deepgram',
    type: 'audio',
    adapterId: 'deepgram',
    baseUrl: 'https://api.deepgram.com/v1',
    authType: 'header',
    authHeaderName: 'Authorization',
    authHeaderPrefix: 'Token ', // ROOT CAUSE FIX (verified via Deepgram's own official docs and SDKs, July 2026): Deepgram requires "Authorization: Token {key}", a custom prefix — a bare key fails auth even when it's a valid key.
    defaultModel: 'nova-2',
    priority: 25,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Auth header value should be "Token YOUR_KEY".',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-assemblyai',
    name: 'AssemblyAI',
    type: 'audio',
    adapterId: 'assemblyai',
    baseUrl: 'https://api.assemblyai.com/v2',
    authType: 'header',
    authHeaderName: 'Authorization',
    defaultModel: 'default',
    priority: 25,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: '',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-elevenlabs',
    name: 'ElevenLabs',
    type: 'speech',
    adapterId: 'elevenlabs',
    baseUrl: 'https://api.elevenlabs.io/v1',
    authType: 'header',
    authHeaderName: 'xi-api-key',
    defaultModel: 'eleven_multilingual_v2',
    priority: 20,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: '',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-kokoro-hf',
    name: 'Kokoro (Hugging Face)',
    type: 'speech',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'hexgrad/Kokoro-82M',
    priority: 35,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: '',
    timeoutMs: 300000,
    retries: 3,
  },
  {
    id: 'preset-piper',
    name: 'Piper (self-hosted)',
    type: 'speech',
    adapterId: 'openai-compatible',
    baseUrl: '',
    authType: 'none',
    defaultModel: '',
    priority: 40,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: true, // matches authType:'none' — Piper doesn't use an API key at all, only a Base URL pointing at wherever it's actually running (see ProviderValidator's fix for why an empty default here used to produce a confusing same-origin 404 instead of a clear "Base URL is required" message)
    isPreset: true,
    isBuiltIn: false,
    notes: 'Piper typically runs locally/self-hosted — set Base URL to your own running instance.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-playht',
    name: 'PlayHT',
    type: 'speech',
    adapterId: 'playht',
    baseUrl: 'https://api.play.ht/api/v2',
    authType: 'header',
    authHeaderName: 'Authorization',
    // ROOT CAUSE FIX (verified via PlayHT's own docs, July 2026): PlayHT
    // requires a SECOND credential beyond the API key — an X-User-ID
    // header with your PlayHT account's user ID — on every request. There
    // was no field for this at all before, so even a perfectly valid API
    // key would still fail every request. `headers` already exists and is
    // merged into every outgoing request (see BaseAdapter) — this was
    // simply never populated for this preset. ProviderValidator now also
    // catches an unedited placeholder here, the same way it already does
    // for Cloudflare's account ID in baseUrl.
    headers: { 'X-User-ID': 'YOUR_USER_ID' },
    defaultModel: 'PlayHT2.0',
    priority: 25,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Requires TWO credentials: the API key above, AND your PlayHT User ID — edit the "X-User-ID" value in this provider\'s Headers field (currently the placeholder "YOUR_USER_ID") to your real user ID from the PlayHT dashboard.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-musicgen-hf',
    name: 'MusicGen (Hugging Face)',
    type: 'music',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'facebook/musicgen-large',
    priority: 20,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: '',
    timeoutMs: 300000,
    retries: 3,
  },
  {
    id: 'preset-stable-audio',
    name: 'Stable Audio',
    type: 'music',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.stability.ai/v2beta',
    authType: 'bearer',
    defaultModel: 'stable-audio-2',
    priority: 25,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: '',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-local-musicgen',
    name: 'Local MusicGen (self-hosted)',
    type: 'music',
    adapterId: 'openai-compatible',
    baseUrl: '',
    authType: 'none',
    defaultModel: 'musicgen',
    priority: 30,
    enabled: false,
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: "Only useful if you're running a local MusicGen server (e.g. via audiocraft or a local inference server) — set Base URL to that instance. Disabled by default since most people don't have one running.",
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-github-models-coding',
    name: 'GitHub Models (Coding)',
    type: 'coding',
    adapterId: 'openai-compatible',
    baseUrl: 'https://models.github.ai/inference',
    authType: 'bearer',
    defaultModel: 'openai/gpt-4o-mini',
    priority: 20,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Same GitHub Models endpoint as the text category (needs a PAT with the "models: read" permission), listed here too since it\'s commonly used for coding assistance. ' +
      'IMPORTANT: GitHub Models is being fully retired on 2026-07-30 — see the text-category entry\'s notes for details.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-openrouter-agents',
    name: 'OpenRouter (Agents)',
    type: 'agents',
    adapterId: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    authType: 'bearer',
    defaultModel: 'openrouter/free', // ROOT CAUSE FIX — see preset-openrouter-free above: this was 'meta-llama/llama-3.3-70b-instruct:free', the exact id OpenRouter's API is now rejecting with "This model is unavailable for free". openrouter/free auto-routes to whatever free model is currently live.
    priority: 20,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Real agentic/task workflows now route here via AgentNodeExecutor (see Node.ts) — builds on OpenRouter\'s free models (openrouter/free auto-selects whichever is currently live). Add a free OpenRouter key at openrouter.ai/keys to enable.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-groq-agents',
    name: 'Groq (Agents)',
    type: 'agents',
    adapterId: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    authType: 'bearer',
    defaultModel: 'openai/gpt-oss-120b',
    priority: 11,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Same Groq endpoint as the text category — very fast inference, generous free tier — listed here too for agent tasks. Get a free key at console.groq.com/keys.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-custom-mcp',
    name: 'Custom MCP Server',
    type: 'mcp',
    adapterId: 'openai-compatible',
    baseUrl: '',
    authType: 'none',
    defaultModel: '',
    priority: 50,
    enabled: false,
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Point Base URL at a locally-running MCP-compatible server. This category is registry-only in this build — no built-in MCP client pipeline is wired up yet.',
    timeoutMs: 30000,
    retries: 1,
  },
  {
    id: 'preset-huggingface-research',
    name: 'Hugging Face (Research)',
    type: 'research',
    adapterId: 'huggingface',
    baseUrl: 'https://router.huggingface.co',
    authType: 'bearer',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    priority: 30,
    enabled: false, // Requirement #3/#9: keyed/paid providers are OPTIONAL and never selected by default — surfaced only in Advanced Settings (Keys & Providers). Flip to true (or simply add an API key, which auto-behaves the same via ProviderManager.callWithFallback's key filter) to opt in.
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Reuses the Hugging Face text pipeline for research/summarization-style prompts.',
    timeoutMs: 300000,
    retries: 3,
  },
  {
    id: 'preset-custom-gamegen',
    name: 'Custom Game-Gen Endpoint',
    type: 'gamegen',
    adapterId: 'openai-compatible',
    baseUrl: '',
    authType: 'none',
    defaultModel: '',
    priority: 50,
    enabled: false,
    noKeyNeeded: false,
    isPreset: true,
    isBuiltIn: false,
    notes: 'Registry-only placeholder for a procedural/game-content generation API — add your own endpoint here.',
    timeoutMs: 30000,
    retries: 1,
  },
];
