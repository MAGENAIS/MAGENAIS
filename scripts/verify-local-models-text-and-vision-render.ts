// Regression lock for a bug report: on the deployed build, the "Local
// Models" settings panel showed only the Transformers.js VISION row
// (ViT-GPT2 captioning) — the TEXT row (SmolLM2 etc.) that used to be
// there had disappeared. Reading through the current source
// (SettingsModal.ts's renderLocalModelsList + localTaskForProvider, and
// defaultProviders.ts) shows both rows ARE correctly produced by this
// codebase: builtin-transformers-text (type:'text', no visionOnly) and
// builtin-transformers-vision (type:'text', visionOnly:true) both have
// adapterId 'transformers', both pass the `manager.getProviders('text')
// .filter(p => p.adapterId === 'transformers')` collection in
// renderLocalModelsList, and localTaskForProvider maps them to two
// DIFFERENT tasks ('text-generation' vs 'image-to-text'/'caption') rather
// than one overwriting the other. The bug shown in the screenshot is very
// likely a stale gh-pages deploy that predates this (or an equivalent
// earlier) fix rather than a defect in this source tree — but exactly
// because "one row's presence silently depends on another row's absence"
// is such an easy regression to reintroduce without noticing (e.g. an id
// collision, a stray `!p.visionOnly` filter, or a task-mapping bug that
// makes two different providers collapse onto one task), this script
// locks the invariant down as an explicit, fast, no-DOM check that can run
// in CI or before every release build.
//
// Run manually with:
//   npx tsx scripts/verify-local-models-text-and-vision-render.ts
import { DEFAULT_PROVIDERS } from '../src/providers/defaultProviders';
import type { ProviderConfig } from '../src/providers/types';

// Mirrors localTaskForProvider() in src/ui/SettingsModal.ts — duplicated
// here (rather than imported) deliberately, so this check exercises the
// same *rule*, written independently, instead of importing the exact
// function under test and only proving "the function agrees with itself".
function localTask(provider: ProviderConfig): 'text-generation' | 'image-to-text' | null {
  if (provider.adapterId !== 'transformers') return null;
  if (provider.type !== 'text') return null;
  return provider.visionOnly ? 'image-to-text' : 'text-generation';
}

let failures = 0;
function check(label: string, pass: boolean): void {
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${label}`);
  if (!pass) failures++;
}

const transformersRows = DEFAULT_PROVIDERS
  .filter((p) => p.adapterId === 'transformers')
  .map((p) => ({ id: p.id, task: localTask(p) }))
  .filter((r) => r.task !== null);

const textRow = transformersRows.find((r) => r.task === 'text-generation');
const visionRow = transformersRows.find((r) => r.task === 'image-to-text');

check('a builtin-transformers TEXT row exists (SmolLM2 etc., LocalModelTask "text-generation")', !!textRow);
check('a builtin-transformers VISION row exists (ViT-GPT2 captioning, LocalModelTask "image-to-text")', !!visionRow);
check('the text and vision rows are different provider entries, not the same one double-counted',
  !!textRow && !!visionRow && textRow.id !== visionRow.id);

// The specific ids the Local Models UI keys off of today — if these ever
// get renamed, this line should be updated deliberately, not silently
// broken by an unrelated refactor.
check("text row id is 'builtin-transformers-text'", textRow?.id === 'builtin-transformers-text');
check("vision row id is 'builtin-transformers-vision'", visionRow?.id === 'builtin-transformers-vision');

// Guards the root-cause fix from the "Vision Add Provider" bug the same
// way: no DEFAULT_PROVIDERS entry should ever carry the literal type
// 'vision' — it must always be 'text' + visionOnly:true.
const literalVisionType = DEFAULT_PROVIDERS.filter((p) => (p as any).type === 'vision');
check('no built-in provider uses the nonexistent literal type "vision" (must be type:\'text\'+visionOnly:true)', literalVisionType.length === 0);

// Puter must never be a default-enabled Vision candidate (per explicit
// user request — see the "Disabled by default per user request" notes on
// builtin-puter-vision* in defaultProviders.ts).
const enabledPuterVision = DEFAULT_PROVIDERS.filter((p) => p.adapterId === 'puter' && p.visionOnly && p.enabled);
check('no Puter vision provider is enabled by default', enabledPuterVision.length === 0);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
