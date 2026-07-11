import { DEFAULT_PROVIDERS } from "../config/defaultProviders";

// NOTE: this is part of an orphaned scaffold (src/config/Provider* +
// src/bootstrap/Bootstrap.ts) that predates the real provider platform in
// src/providers/*, which is what the running app actually uses (see
// Kernel.ts / ProviderManager). It isn't imported anywhere on the real
// code path. It's kept buildable (rather than deleted, per "don't remove
// features") but its `Provider` shape intentionally does not match the
// real `ProviderConfig` in src/providers/types.ts — do not wire this into
// the real ProviderManager without reconciling the two shapes first.
export class ProviderFactory {
  static createDefaults(): typeof DEFAULT_PROVIDERS {
    return structuredClone(DEFAULT_PROVIDERS);
  }
}
