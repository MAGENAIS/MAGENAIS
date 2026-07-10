# Scripts

Small maintenance scripts. Run with Node directly (no build step needed).

| Script | Purpose |
|---|---|
| [`check-providers.mjs`](check-providers.mjs) | Sanity-checks that every `adapterId` referenced in `src/providers/defaultProviders.ts` is registered somewhere in `src/core/Kernel.ts`, catching the "provider defined but no adapter wired up" class of bug. |
