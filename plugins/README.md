# Local Plugins

Drop local plugin packages here during development. Each plugin is a folder
containing a `Plugin.json` manifest and an entry script, following the same
shape as the bundled sample plugin at
[`public/plugins/sample-plugin/`](../public/plugins/sample-plugin/).

```
plugins/
└── my-plugin/
    ├── Plugin.json
    └── index.js
```

See the [Plugin SDK](../docs/plugins/PLUGIN_SDK.md) and
[Plugin System](../docs/plugins/PLUGIN_SYSTEM.md) docs for the manifest schema
and the API surface exposed to plugins (`registerWorkflowNode`,
`registerMode`, permissions, etc.).

Plugins placed here are for local development only — for distribution, publish
through the [Marketplace](../docs/plugins/MARKETPLACE.md) workflow instead.
