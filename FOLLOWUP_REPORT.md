# MAGENAIS — Follow-up Fix Report (round 2, from live testing)

All 8 issues below were reproduced/verified in code and fixed. Same
verification approach as before: `tsc --noEmit`, `vite build`, existing
`npm test`, plus targeted `tsx` scripts (network-mocked, no real API calls)
that fail on the old code and pass on the fixed code.

## The "many providers checked while not set yet" note first, since it
explains a lot of the confusion in the other reports

`SettingsModal.ts` colored a provider's name **green** purely from its
`enabled` toggle — a separate concept from whether it has a working API
key. Nearly every built-in preset ships `enabled: true` by design (so it
activates the instant a key is added, no second switch to remember), which
made a totally fresh install's provider list look like a wall of ready,
green providers. Fixed: the name is now green only when the provider can
actually be called right now (enabled **and** keyed, or genuinely keyless);
amber if enabled but missing its key; gray if actually disabled. The
"no key set" label now also says "— add one below to activate."
File: `src/ui/SettingsModal.ts`.

## 1) Regenerate button not working

Root cause was actually in last round's Priority-1 fix, which had an
unintended side effect: making the workflow cache key include the resolved
inputs correctly stopped a *second, different* prompt from returning stale
output — but it also meant an *identical* repeat request (exactly what
clicking "Regenerate" with an unchanged prompt does) now legitimately
cache-hit and replayed the same image/audio forever, which looks just as
broken from the user's side.

**Real fix:** made the engine's cross-call cache **opt-in only** (a node
must explicitly set `node.cacheKey`; nothing does today), instead of an
implicit content-based default. Every Generate/Regenerate click across
every tab now always executes fresh — which is what "Regenerate" and
"Generate" both need. File: `src/workflows/Engine.ts`. Verified via
`scripts/verify-cache-fix.ts` (extended with a third "identical repeat
click" case — still executes fresh, `executor call count === 3`).

## 2) Podcast plays system sound then stops — no downloadable file, no text

Two real, separate bugs stacked here:
- The browser-speech fallback genuinely can't produce a downloadable file
  (no capture API for `speechSynthesis`) — playing it aloud as a live
  preview is reasonable behavior, not a bug.
- But `generatePodcast()` **threw an Error** when no line could be
  recorded, discarding the perfectly good `script` it had already
  generated (and which the browser had just read aloud). The user was left
  with nothing but a bare error box — no way to see or copy the text that
  was actually produced.

**Fix:** `generatePodcast()` now returns `{ url: null, script, ... }`
instead of throwing in that case. `AudioMode.ts` renders the script (and a
clear explanation of why there's no audio file) whenever `url` is null,
instead of only ever showing script+audio together or nothing at all.
Files: `src/workflows/legacy/podcast.ts`, `src/ui/modes/AudioMode.ts`.

## 3) Data Analytics: "No configured/enabled provider for 'data'"

Same bug class as the Documents fix from last round, just not caught
there: `'data'` is a valid `NodeType` but was never a valid
`ProviderType` — `DataNodeExecutor`'s AI-answer path called
`callProvider()` with no override, defaulting to `node.type` ('data'),
which has zero possible providers regardless of any key configured. Fixed
to route through `'text'`, same pattern as Documents. File:
`src/workflows/Node.ts`.

## 4 & 6) Research / Agents: "Unsupported Hugging Face pipeline type 'research'"

The built-in "Hugging Face (Research)" preset's own `notes` field says,
verbatim, that it "reuses the Hugging Face text pipeline for
research/summarization-style prompts" — but `HuggingFaceAdapter`'s
dispatch `switch` never actually had a case for `'research'` (or
`'coding'`/`'agents'`/`'gamegen'`), so every call fell through to the
`default: throw`. `OpenAICompatibleAdapter` already routes those same
types through its text pipeline correctly — this brings the HF adapter in
line with that existing, working pattern. Agents tab hit the identical
error because an agent step using a research-type node goes through the
same code path — one fix covers both. File:
`src/providers/adapters/HuggingFaceAdapter.ts`.

## 5) Game: "No configured/enabled provider for 'gamegen'"

Same bug class as #3: `GameGenNodeExecutor` generates an HTML/JS game by
asking an LLM to write it — a text-generation task — but called
`callProvider()` with no override, defaulting to `node.type` ('gamegen'),
whose only built-in provider is a **disabled, empty-baseUrl template**
meant for someone to plug in a dedicated game-gen endpoint. This meant it
always failed regardless of what text providers were configured — even
though the executor's own existing comment said it should "go through the
same fallback chain as any text node." Fixed to route through `'text'`.
File: `src/workflows/Node.ts`.

## 7) Code: GitHub Models 401 "Bad credentials"

This one's not a code bug in the sense of broken logic — it's a **dead
API endpoint**. I searched to confirm current status: GitHub deprecated
`https://models.inference.ai.azure.com` (the Azure-hosted endpoint this
preset was pointed at) on **2025-07-17** and fully decommissioned it on
**2025-10-17** — every request to it now returns an auth failure
regardless of key validity, which is exactly the "Bad credentials" you
saw. The correct current endpoint is `https://models.github.ai/inference`,
and it also requires model ids in `publisher/model` form (e.g.
`openai/gpt-4o-mini`, not bare `gpt-4o-mini`) and a PAT with the
`models: read` permission specifically.

**Time-sensitive heads-up, please read:** GitHub announced on 2026-07-01
that GitHub Models — the whole product, not just this old endpoint — is
being **fully retired on 2026-07-30**, with brownout test outages on
**2026-07-16 and 2026-07-23**. That's about three weeks from today. I
fixed the endpoint/model id so it works correctly for the time remaining,
and put the retirement dates directly in the provider's `notes` field so
they're visible in Keys & Providers, but you should plan to move off
GitHub Models (e.g. to OpenRouter, or Azure AI Foundry which is GitHub's
own suggested replacement) before end of July regardless of this fix.

Because your existing install already has this provider saved with the
old endpoint, and last round's persistence fix intentionally preserves
your stored settings over new defaults, I also added a narrowly-scoped
**one-time migration**: if a stored provider's `baseUrl` is *exactly* the
old decommissioned URL, it's corrected automatically on next load (your
API key is preserved) — this is safe specifically because nobody
hand-types a decommissioned Microsoft endpoint as a deliberate customization,
unlike, say, a custom base URL you actually typed in yourself. Files:
`src/providers/defaultProviders.ts`, `src/providers/registry/Manager.ts`.

## 8) Vision: "add an API key for Anthropic or Google Gemini"

This message was accurate as written, but the underlying restriction was
needlessly narrow: `callVision()` only ever considered the two
Anthropic/Gemini adapters as vision-capable, so anyone with, say, an
OpenRouter or GitHub Models key but no Anthropic/Gemini key got blocked
even though many OpenAI-compatible providers/models also support image
understanding.

**Fix:** `OpenAICompatibleAdapter.callText()` now builds the standard
multimodal `image_url` content-block format (what OpenRouter, GitHub
Models' gpt-4o, Groq's vision models, etc. already accept) whenever an
image is passed in, and `callVision()` now includes `'openai-compatible'`
providers as candidates. Whether a *specific* configured model actually
supports images is still down to what the user picked — that now surfaces
as a normal per-provider fallback error instead of being blocked at the
door. Error message updated to reflect the real option set. Files:
`src/providers/adapters/OpenAICompatibleAdapter.ts`,
`src/providers/registry/Manager.ts`.

---

## Files touched this round
- `src/ui/SettingsModal.ts` — provider status color reflects real usability
- `src/workflows/Engine.ts` — cache made opt-in only
- `src/workflows/legacy/podcast.ts`, `src/ui/modes/AudioMode.ts` — script
  survives a TTS-only failure
- `src/workflows/Node.ts` — Data + GameGen route through `'text'`
- `src/providers/adapters/HuggingFaceAdapter.ts` — research/coding/agents/
  gamegen pipeline types
- `src/providers/defaultProviders.ts` — GitHub Models endpoint/model id +
  retirement notice
- `src/providers/registry/Manager.ts` — GitHub Models migration, vision
  candidate broadening
- `src/providers/adapters/OpenAICompatibleAdapter.ts` — multimodal image
  support

## New verification scripts
- `scripts/verify-provider-routing-fixes.ts` — HF research pipeline,
  GitHub Models migration, Doc/Data/GameGen text-routing (all mocked, no
  real network calls)
- `scripts/verify-cache-fix.ts` — extended with the Regenerate
  (identical-repeat-click) case

## Remaining issues / things I did not fix
- **GitHub Models is being fully retired 2026-07-30** regardless of the
  endpoint fix — see #7 above. This isn't something code can fix; it needs
  a provider decision on your end before end of month.
- Vision through OpenAI-compatible providers is best-effort: it now
  *attempts* any configured provider whose model might support images, but
  can't know in advance which specific models do. A wrong-model failure
  will show up as a normal per-provider fallback error rather than being
  pre-filtered — that's the tradeoff for not being artificially restrictive.
- I did not audit every other preset's `baseUrl` for staleness beyond the
  GitHub Models one specifically reported — if other presets in
  `defaultProviders.ts` have drifted from their providers' current APIs,
  those would surface the same way (an auth or 404 error) and are worth a
  dedicated pass if you'd like one.
