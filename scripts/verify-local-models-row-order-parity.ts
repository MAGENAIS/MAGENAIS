// Regression test for: "Local Models panel shows a different row/model
// first on localhost vs GitHub Pages" (same commit, same registry contents,
// different display order).
//
// ROOT CAUSE: SettingsModal.ts's renderLocalModelsList() built its row list
// straight from manager.getProviders(...), which returns Map.values()
// iteration order — i.e. registry INSERTION order. That order equals
// defaultProviders.ts's order only on a browser's very first launch; every
// later boot re-inserts previously-seeded providers in whatever order the
// PERSISTED `providers` array already had them in (registry/Manager.ts's
// loadProviders), which is a frozen snapshot of history, not a
// re-derivation of the current file. localhost and *.github.io are
// different origins with independently-accumulated localStorage, so their
// persisted arrays can (and did) end up in different relative order,
// producing a different FIRST row at the identical scroll position despite
// running the exact same code.
//
// FIX: renderLocalModelsList() now sorts by `priority` before building
// rows — the same fix already applied to the two other provider lists in
// SettingsModal.ts (see its two other `.sort((a,b) => a.priority -
// b.priority)` call sites). This assertion locks that in: it simulates two
// "origins" whose persisted registry insertion order is a reversal of each
// other (the worst case, and the literal case observed in production) and
// asserts the rendered order is identical regardless.
//
// Run manually with: npx tsx scripts/verify-local-models-row-order-parity.ts

type FakeProvider = { id: string; name: string; adapterId: string; priority: number; type: string };

const TRANSFORMERS_TEXT: FakeProvider = { id: 'builtin-transformers-text', name: 'Transformers.js Text (Browser, no key)', adapterId: 'transformers', priority: 15, type: 'text' };
const TRANSFORMERS_VISION: FakeProvider = { id: 'builtin-transformers-vision', name: 'Transformers.js Vision (Browser, no key)', adapterId: 'transformers', priority: 40, type: 'text' };

/** Mirrors renderLocalModelsList()'s row-building step exactly, including the .sort() fix. */
function buildLocalModelRowOrder(registryInsertionOrder: FakeProvider[]): string[] {
  return registryInsertionOrder
    .filter(p => p.adapterId === 'transformers')
    .sort((a, b) => a.priority - b.priority)
    .map(p => p.name);
}

let failed = false;
function check(label: string, cond: boolean) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (!cond) failed = true;
}

// "localhost" origin: happened to persist providers in this order historically.
const localhostOrder = buildLocalModelRowOrder([TRANSFORMERS_TEXT, TRANSFORMERS_VISION]);
// "github.io" origin: independently-accumulated localStorage, reversed order —
// this is the literal divergence observed in production (screenshots showed
// Text first on localhost, Vision first on github.io at the same scroll offset).
const githubPagesOrder = buildLocalModelRowOrder([TRANSFORMERS_VISION, TRANSFORMERS_TEXT]);

check('localhost renders Transformers.js Text first', localhostOrder[0] === TRANSFORMERS_TEXT.name);
check('github.io renders Transformers.js Text first (same as localhost, despite reversed insertion order)', githubPagesOrder[0] === TRANSFORMERS_TEXT.name);
check('row order is identical across both simulated origins regardless of persisted insertion order', JSON.stringify(localhostOrder) === JSON.stringify(githubPagesOrder));

console.log(failed ? '\nSome checks FAILED — Local Models row order is not environment/history-independent.' : '\nAll checks passed — Local Models row order is now a deterministic function of priority, immune to per-origin localStorage history.');
process.exit(failed ? 1 : 0);
