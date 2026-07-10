# Tests

Unit tests for pure, dependency-free logic modules, run with Node's built-in
test runner (no extra dependency needed — Node 18.1+ ships `node:test`, and
Node 22+ can execute the `.ts` source files directly via its native type-stripping,
which is why these tests import straight from `src/` rather than a compiled
`dist/`).

```bash
npm test
```

Only modules with **no import-time side effects and no external module
imports** can be exercised this way without a bundler (e.g.
`src/workflows/legacy/data.ts`, `src/workflows/legacy/research.ts`'s pure
helpers). Modules that pull in the Kernel/DOM/browser APIs are exercised
manually in the browser today — see
[`docs/development/TESTING.md`](../docs/development/TESTING.md) for the full
testing strategy and the plan for expanding coverage.
