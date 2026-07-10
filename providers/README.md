# Custom Provider Definitions

Custom, user-defined AI providers can be described here as portable JSON
files and imported through the app's **Keys & Providers** panel, instead of
being hard-coded into [`src/providers/defaultProviders.ts`](../src/providers/defaultProviders.ts).

See [`templates/openai-compatible.provider.json`](templates/openai-compatible.provider.json)
for the shape, and the [Provider SDK](../docs/providers/PROVIDER_SDK.md) /
[Provider Registry](../docs/providers/PROVIDER_REGISTRY.md) docs for the full
field reference and how the adapter/type/priority fields are used by the
Smart Router's fallback chain.
