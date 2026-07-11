# MAGENAIS — Runtime Stability, Initialization, Persistence & Validation Fix Report

Scope note up front: this is **one integrated codebase** with the fixes for
all four priorities applied and verified together (full `tsc` type-check,
full `vite build`, existing unit suite, plus two new runtime regression
scripts — all passing). A few of the root causes live in the same file
(e.g. provider persistence and provider validation both touch
`ProviderManager`), so artificially splitting the *working tree* into four
separate zips would mean shipping three of them in a deliberately
half-fixed state. Instead: **one zip** (`MAGENAIS-fixed.zip`), with every
change below tagged to its Priority/Phase and file:line, so you can review
or selectively adopt them in order. Happy to cut real phase-by-phase
branches/zips on request if you want to merge them incrementally.

---

## PRIORITY 1 — Runtime Stability ("Generate only works once")

### Root cause #1 (the main one): workflow cache key ignored the prompt

Every mode builds its workflow with a **fixed node id** per modality
(`'text1'`, `'img1'`, `'research1'`, …) and a `node.config` that only holds
UI option state (model, temperature, sliders). The actual prompt/text/file
lives in `node.inputs`, resolved separately by each node executor.

`WorkflowEngine`'s per-node cache key (`src/workflows/Engine.ts`) was:

```
`${nodeId}:${JSON.stringify(node.config)}:${JSON.stringify(Array.from(outputs.entries()))}`
```

— it never included `node.inputs`. Since the engine's cache (`this.cache`)
is a single `Map` shared for the **entire app lifetime** (constructed once
in `Kernel.ts`), a second click with the same node id and same options but
a **different prompt** hashed to the *same key* and returned the **first
click's stale output**, forever. That's exactly "Generate only works once"
— the promise chain completes fine, but the result never changes again.

Reproduced and verified: I wrote a standalone script that runs the old
formula and the new one back-to-back. Old formula: second click returns
`echo:first prompt` (wrong, 1 executor call for 2 requests). New formula:
second click returns `echo:second prompt` (correct, 2 calls). See
`scripts/verify-cache-fix.ts`.

**Fix:** cache key now also includes the node's *resolved* inputs:
```
`${nodeId}:${JSON.stringify(node.config)}:${JSON.stringify(resolvedInputs)}`
```
File: `src/workflows/Engine.ts`.

### Root cause #2: no re-entrancy/disabled-state guard on any Generate button

No mode disabled its button, tracked a busy flag, or guaranteed
try/catch/**finally** cleanup. A slow in-flight request could be joined by
a second click, racing two workflow executions against the same output
panel; nothing ever visibly told the user the button was still "armed" or
recovered gracefully from an unexpected error.

**Fix:** added `Mode.runGuarded(buttonId, task)` to the shared base class
(`src/ui/modes/Mode.ts`) — ignores re-entrant clicks while busy, disables +
relabels the button, and **always** restores state in `finally` even if
`task` throws. Wired into every mode's button-click registration.
`WorkflowModal.ts` (the linear workflow builder, doesn't extend `Mode`) got
an equivalent local guard since it can't inherit the base class.

### Files modified (Priority 1)
- `src/workflows/Engine.ts` — cache key fix (root cause)
- `src/ui/modes/Mode.ts` — new `runGuarded()` / `renderError()` helpers
- `src/ui/modes/TextMode.ts` — wired guard; also removed a dead, never-mounted
  `new Button(...)` instantiation that duplicated (but didn't actually fire,
  since `render()` was never called) the click wiring — pure dead-code cleanup
- `src/ui/modes/ImageMode.ts`, `VideoMode.ts`, `AudioMode.ts`, `DataMode.ts`,
  `DocMode.ts`, `ResearchMode.ts`, `VisionMode.ts`, `CodingMode.ts`,
  `AgentsMode.ts`, `GameMode.ts` — wired guard onto Generate/Run (and, for
  ImageMode, Regenerate; for GameMode, both the initial Run and the
  re-bound Iterate button)
- `src/ui/WorkflowModal.ts` — local busy guard on the Workflow tab's Run button

### Verified for every tab in the list
Text, Image, Video, Audio, Music (part of AudioMode), Research, Game, Code,
Vision, Documents, Workflow, Agents — all route through either
`Mode.runGuarded` or WorkflowModal's local equivalent, and all share the
now-fixed `WorkflowEngine` cache key.

---

## PRIORITY 2 — Initialization

### Root cause: Documents tab routed to a provider type that doesn't exist

`NodeType` includes `'doc'`, but `ProviderType`/`DEFAULT_PROVIDERS`
**never did** — there is no `'doc'` provider pool. `DocNodeExecutor`'s
summarization path called `this.callProvider(node, ...)`, which resolves
the provider type straight from `node.type` (`'doc'`). Result: Document
summarization **always** failed with "No configured/enabled provider is
available for 'doc'", regardless of any API key configured — because no
provider of that type could ever exist. This is what "no default
configuration, cannot work after startup" looks like for this tab: it's
not a missing default, it's a routing dead end.

(For comparison: Vision has the identical shape of problem but was already
handled correctly — `ProviderManager.callVision()` explicitly routes vision
through the `'text'` provider pool. Doc summarization didn't have that.)

**Fix:** `callProvider()` now accepts an optional provider-type override
(`src/workflows/Node.ts`); `DocNodeExecutor` passes `'text'`, reusing the
text provider pool the same way vision already does.

### Audit of the rest of Priority 2's tab list
I checked NodeType → ProviderType routing for Research (`research`),
Game (`gamegen`), Code (`coding`), Agents (`agents`) — all match an actual
`DEFAULT_PROVIDERS` entry. None of the modes read any persisted per-mode
settings object that could be `undefined` on first run (they all render
fully-defaulted HTML controls on `activate()`), so there's no "blank config
crashes the tab" failure mode to fix there. Where these tabs *do*
legitimately fail on a clean install, it's because their one built-in
provider requires an API key (by design — there's no free/no-key
alternative to invent without changing what the app actually offers), and
Priority 4's validation now makes that failure clear instead of opaque.

### Dead-code cleanup (found during this audit, not the reported bug, but
directly confusing to "which init path is real")
`src/main.ts` ran **two** unrelated initialization paths: the real
`bootstrap()` (Kernel → ProviderManager → DEFAULT_PROVIDERS, the one
everything in the app actually reads from) *and* `new Bootstrap().start()`
(`src/bootstrap/Bootstrap.ts` + `src/config/ProviderRegistry.ts` +
`src/config/appDefaults.ts`), an earlier, fully disconnected scaffold that
writes to `magenais.providers` / `magenais.settings` — keys nothing else in
the app ever reads. It didn't cause a functional bug (no shared state with
the real path) but it's dead weight that actively muddies any future
"where does provider config actually come from" investigation, so I
stopped it from running. Files left in place, just un-called, in case you
want to revive that direction deliberately later.

### Files modified (Priority 2)
- `src/workflows/Node.ts` — `callProvider` override param; `DocNodeExecutor`
  now targets `'text'`
- `src/main.ts` — stopped invoking the orphaned parallel bootstrap
- `src/config/ProviderFactory.ts` — unrelated pre-existing compile error in
  this same orphaned scaffold (wrong import name, and a `Provider[]` return
  type that didn't match its own data); fixed so the project actually
  type-checks (see "Remaining issues" — the project didn't `tsc` cleanly
  before this pass at all)

---

## PRIORITY 3 — Provider Persistence

### Root cause: four subsystems share one localStorage key; two of them
overwrite it instead of merging into it

`Store`, `ProviderManager`, `AssetManager`, and `ProjectManager` all
persisted through the *same* `Persistence` instance / localStorage key
(`{namespace}:state`). `AssetManager` and `ProjectManager` do this safely —
`load() || {}`, patch only their own slice (`data.assets` / `data.projects`),
`save()`. **`Store.dispatch()` and `ProviderManager.saveProviders()` did
not** — they each built a fresh object from only their own data and called
`persistence.save(...)` directly, replacing the *entire* stored blob.

`Store.dispatch()` is called after **every single successful generation**
(`ADD_HISTORY_ENTRY`, fired by every mode's success handler). Sequence:
1. User adds an API key in Settings → `ProviderManager.saveProviders()`
   correctly writes `{ providers: [...with the key...] }`.
2. User clicks Generate → succeeds → `addHistoryEntry` dispatches →
   `Store.dispatch()` calls `persistence.save(this.state)`, where
   `this.state.providers` is `AppState`'s own copy — **always `[]`**,
   since nothing ever populates it. That blind write **erases** what step 1
   just saved.
3. Next app start: `ProviderManager.loadProviders()` reads back an empty
   `providers` array → falls through to defaults → the key is gone.

I reproduced this exactly with a standalone script
(`scripts/verify-persistence-fix.ts`, shared-persistence variant): save a
key, dispatch a history entry, "restart" → `apiKey` comes back `undefined`.
With the fix applied, it comes back correctly.

There was a second, related issue: **even with merge-writes fixed**,
`loadProviders()` unconditionally re-merged the *entire* `defaultProviders`
list under whatever was stored, on **every boot** — so a built-in provider
the user explicitly deleted would silently reappear on the next restart
("Never overwrite existing user settings during startup" was being
violated for deletions specifically).

**Fixes** (`src/core/state/Store.ts`, `src/providers/registry/Manager.ts`,
`src/core/Kernel.ts`):
- `Store.dispatch()`/`persist()` now read-merge-write, and explicitly
  **exclude** `providers`/`assets`/`projects` from what it writes (those
  are owned elsewhere; Store's copies are never populated, so including
  them would just reintroduce the same clobber).
- `ProviderManager.saveProviders()` / `clearAllData()` now read-merge-write
  instead of blind-overwrite.
- `ProviderManager` now gets its **own dedicated Persistence
  instance/localStorage namespace** (`{namespace}:providers`) in
  `Kernel.ts`, rather than sharing Store's — defense in depth on top of the
  merge fix, and it's what `ProviderManager`'s own (previously declared but
  never actually used) `storageKey` field already implied was intended.
  A one-time migration reads any provider data left under the old shared
  key so nobody's existing saved keys appear to vanish because of the
  namespace change.
- **Version-safe default seeding:** the persisted blob now also tracks
  `seededDefaultIds` — the set of built-in provider ids ever merged in. On
  later boots, a default is only (re-)added if its id has *never* been
  seeded before (first launch, or a new built-in shipped in a later app
  version) — never one that was seeded before and is simply absent from
  storage now, which means the user deleted it on purpose.
- Bumped a `version` field (`SCHEMA_VERSION = 2`) into the saved shape so a
  future format change has something to branch on.

### Files modified (Priority 3)
- `src/core/state/Store.ts`
- `src/providers/registry/Manager.ts`
- `src/core/Kernel.ts`

---

## PRIORITY 4 — Provider Validation

### Root cause: a validator existed, but validated the wrong (dead) type and
was never called from anywhere

`src/config/ProviderValidator.ts` predates the real provider platform — it
validated a `Provider` interface (`src/config/ProviderTypes.ts`) with
fields (`adapter`, `endpoint`, `timeout`, `retry`) that don't exist on the
real `ProviderConfig` (`src/providers/types.ts`) used everywhere else in
the running app, and it was never imported by anything. The only real
"validation" in the actual call path was an implicit
`noKeyNeeded || !!apiKey` filter in `SmartRouter` — no check for an empty
base URL, an invalid URL, a zero/negative timeout, a missing adapter
registration, or auth-field-specific requirements before attempting a call.
A misconfigured custom provider would surface as a raw fetch error, or (for
the filtered-out no-key case) fail silently by just skipping to the next
fallback candidate with no message at all.

**Fix:**
- Rewrote `ProviderValidator` against the real `ProviderConfig`, checking
  name, adapter id, base URL (required + well-formed, except for adapters
  that legitimately don't use one), timeout > 0, retries ≥ 0, API key
  required per `authType`, and header/query-auth field requirements. Two
  entry points: `validate()` (config shape only) and `validateForCall()`
  (also checks the adapter is actually registered).
- Wired into `ProviderManager.callWithFallback()` and `callVision()`
  (`src/providers/registry/Manager.ts`): each candidate is validated
  *before* the call attempt; invalid ones are skipped with a clear,
  provider-named reason logged and folded into the aggregate error message
  instead of a raw exception or a silent skip.
- Wired into the Settings modal's provider save handler
  (`src/ui/SettingsModal.ts`): replaces a bare `name`/`baseUrl`-only check
  with the full validator, so misconfiguration is caught and explained at
  save time, not first discovered mid-generation.

### Files modified (Priority 4)
- `src/config/ProviderValidator.ts` (rewritten)
- `src/providers/registry/Manager.ts`
- `src/ui/SettingsModal.ts`

---

## PRIORITY 5 — Testing

What I actually ran, and what passed:
- `npx tsc --noEmit` — clean (see "Remaining issues": this **did not pass
  before this fix pass**, unrelated to the reported bugs — see below).
- `npm run build` (`tsc && vite build`) — clean, 75 modules, all chunks
  emit.
- `npm test` (existing suite) — 4/4 passing, unchanged.
- `scripts/verify-cache-fix.ts` (new, run via `npx tsx`) — proves two
  Generate calls with the same node id/config but different prompts now
  return different results. I also **reverted the fix temporarily and
  reran it** to confirm it reproduces the original bug (1 executor call
  for 2 requests, stale output) — then restored the fix and reconfirmed
  the pass.
- `scripts/verify-persistence-fix.ts` (new, run via `npx tsx`, in-memory
  localStorage polyfill) — simulates save key → dispatch → "restart", with
  both the fixed (separate namespaces) and pre-fix (shared namespace,
  blind overwrite) code paths. Fixed: key survives. Pre-fix: key is lost —
  matching the reported symptom exactly.

These two scripts aren't wired into `npm test` — see "Remaining issues."

Scenarios from your list and how they're covered:
- **First launch** — `seededDefaultIds` empty ⇒ all defaults seeded; no
  stored providers.
- **Restart** — dedicated provider namespace + migration + merge-writes
  everywhere ⇒ verified via script.
- **Multiple Generate requests** — cache-key fix + busy guard ⇒ verified
  via script + code path for every mode.
- **Switching tabs** — unaffected by these fixes; `App.setMode()` already
  re-renders each mode's control panel from scratch on activation, so
  listeners aren't duplicated across tab switches (only *within* a tab,
  which the busy guard now also covers).
- **Switching providers / saving settings** — validated at save time now
  (Priority 4); persists correctly (Priority 3).
- **Provider recovery after failure** — `callWithFallback` already moved
  to the next candidate on failure; it now also does so on a *validation*
  failure with a clear reason, not just a runtime exception.

---

## Remaining issues / things I did not fix

1. **The project didn't `tsc`-compile cleanly before this pass**, for
   reasons unrelated to the reported bugs: `src/config/ProviderFactory.ts`
   (part of the orphaned `config/` scaffold discussed in Priority 2)
   imported a non-existent export and returned a type its own data didn't
   satisfy. I fixed it minimally so the project actually builds via `tsc`,
   but the whole `src/config/*` cluster
   (`ProviderTypes.ts`/`ProviderRegistry.ts`/`appDefaults.ts`/
   `defaultProviders.ts`/`defaultModels.ts`/`defaultPipelines.ts`/
   `providerCapabilities.ts`) is disconnected scaffold that doesn't share a
   type shape with the real provider platform in `src/providers/*`. It
   doesn't affect runtime (nothing on the real path imports most of it
   anymore, after un-calling `Bootstrap`), but it's worth a deliberate
   decision — delete it, or actually reconcile it with the real
   `ProviderConfig` — rather than leaving it half-alive.
2. **`npm test`'s Node ESM resolver can't follow this codebase's
   extensionless relative imports** (`from './types'` etc.) — Vite/esbuild
   resolve these fine, but Node's `--experimental-strip-types` loader
   requires explicit extensions. The existing suite only tests a leaf
   module (`legacy/data.ts`) with no internal imports, which is why this
   has never surfaced. I verified both fixes at runtime with `npx tsx`
   (esbuild-based, same resolution as Vite) instead of trying to retrofit
   extensions across the whole import graph, which felt like unrelated
   scope creep for a bug-fix pass. If you want real `npm test` coverage of
   modules like `Engine.ts`, the fix is either adding explicit `.ts`
   extensions project-wide or switching the test runner to something
   Vite-aware (e.g. Vitest).
3. **Workflow-node cache key still can't meaningfully distinguish two
   different uploaded files** (Documents/Vision-style file inputs) —
   `JSON.stringify` on a `File`/`Blob` produces `"{}"` regardless of
   content, so two different files with identical other config could still
   collide in the cache. This is a strict improvement over the previous
   "ignores all inputs" bug, but not a complete fix for file-shaped inputs.
   A follow-up could add `file.name`/`size`/`lastModified` into the key
   specifically when an input value is a `File`.
4. **The single built-in provider for Research/Game/Code/Agents each
   require an API key**, with no free/no-key fallback — this is existing,
   intentional behavior (there's no legitimate free provider to substitute
   without changing what the app actually offers), not something I altered
   Priority 4 now makes the resulting error message clear and specific
   instead of opaque.
5. I did not touch `src/ui/components/WorkflowCanvas.ts` (a separate,
   apparently more experimental drag-and-drop graph canvas alongside the
   simpler `WorkflowModal.ts` linear builder) — I didn't find it wired into
   `App.ts`'s tab switch, so it doesn't appear to be the "Workflow" tab
   surfaced in the running app today; flagging in case it's meant to
   replace `WorkflowModal` at some point.

## Recommendations
- Decide the fate of `src/config/*` + `src/bootstrap/Bootstrap.ts` (delete
  vs. reconcile) rather than leaving it dormant — it's exactly the kind of
  half-wired code that produced the Priority 2/3 bugs in the first place.
- Consider Vitest (or adding explicit import extensions) so the real
  `Engine`/`Manager`/`Store` modules can be unit-tested directly instead of
  only via ad-hoc `tsx` scripts.
- Add `npx tsc --noEmit` to CI/pre-commit — it would have caught the
  pre-existing `ProviderFactory.ts` break immediately.
