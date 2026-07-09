
# MAGENAIS Architecture

**Version:** 2.1.0  
**License:** Apache License 2.0  
**Repository:** https://github.com/your-username/magenais

---

## 1. Design Principles

| Principle | Description |
|-----------|-------------|
| **Browser First** | No server required; all logic executes in the browser. |
| **Plugin First** | The core never changes; all new features are added as plugins. |
| **Provider Agnostic** | No dependency on any specific AI provider. |
| **Offline Ready** | Works with Service Workers and caching where possible. |
| **GitHub Pages Ready** | Deployable as a static site. |
| **Progressive Enhancement** | Optional backend adds features like remote compute and cloud sync. |

---

## 2. Architecture Layers

```

┌─────────────────────────────────────────────────────────┐
│                     APPLICATION                         │
│                   src/main.ts                           │
└───────────────────────────┬─────────────────────────────┘
│
┌───────────────────────────▼─────────────────────────────┐
│                         UI LAYER                        │
│                     src/ui/                             │
│              App · Theme · Components · Modes           │
└───────────────────────────┬─────────────────────────────┘
│
┌───────────────────────────▼─────────────────────────────┐
│                      WORKFLOW LAYER                     │
│                   src/workflows/                        │
│           Graph Engine · Nodes · Executors              │
└───────────────────────────┬─────────────────────────────┘
│
┌───────────────────────────▼─────────────────────────────┐
│                      PROVIDER LAYER                     │
│                   src/providers/                        │
│         Registry · Router · Health · Adapters           │
└───────────────────────────┬─────────────────────────────┘
│
┌───────────────────────────▼─────────────────────────────┐
│                         KERNEL                          │
│                   src/core/Kernel.ts                    │
│   Boot · Shutdown · Config · EventBus · State           │
└───────────────────────────┬─────────────────────────────┘
│
┌───────────────────────────▼─────────────────────────────┐
│                       BROWSER APIs                      │
│   DOM · localStorage · IndexedDB · Web Audio · Media    │
└─────────────────────────────────────────────────────────┘

```

All modules communicate via a central **Event Bus** – no module calls another directly.

---

## 3. Core Modules

### 3.1 Kernel (`src/core/Kernel.ts`)

The Kernel is the single orchestrator. It:

- Boots and shuts down the application.
- Provides getters for all subsystems.
- Loads configuration and providers.
- Handles plugin loading.

```typescript
// Example usage
const kernel = new Kernel(options);
await kernel.boot();

const providerManager = kernel.getProviderManager();
const workflowEngine = kernel.getWorkflowEngine();
const pluginManager = kernel.getPluginManager();
// ... and many more getters
```

3.2 Event Bus (src/core/EventBus.ts)

A typed event emitter.

```typescript
// Listen
eventBus.on('workflow:started', (workflowId) => {
  console.log(`Workflow ${workflowId} started`);
});

// Emit
eventBus.emit('asset:created', asset);
```

Common Events:

Event Payload
kernel:boot –
kernel:shutdown –
provider:registered providerId
workflow:started workflowId
workflow:finished workflowId
workflow:failed { workflowId, error }
asset:created Asset
project:selected projectId
plugin:activated pluginId
ui:modeChanged modeId

3.3 State Manager (src/core/state/)

Component Responsibility
Store Central state container.
Actions Dispatch actions to modify state.
Reducers Pure functions that update state.
Selectors Read state.
Persistence Pluggable storage (localStorage, IndexedDB, memory).

```typescript
store.dispatch({ type: 'SET_THEME', payload: 'light' });
const theme = store.selectors.getTheme();
```

---

4. Provider Platform (src/providers/)

Component Responsibility
Registry Stores provider configurations and adapters.
Manager Loads/saves provider configs, merges with defaults.
Router Scores providers and selects the best for each request.
HealthMonitor Periodically tests providers and updates health status.
Adapters Each provider has an adapter implementing its API logic.

Providers are defined as plain objects and can be added/removed at runtime.

---

5. Workflow Engine (src/workflows/)

Component Responsibility
Graph Nodes and edges define the workflow.
Nodes Each node has a type, config, inputs, and outputs.
Executors Built‑in executors for text, image, video, etc.
Engine Executes graphs with parallel execution, retries, timeouts, and caching.
WorkflowStore In‑memory store for workflow definitions.

---

6. UI Architecture (src/ui/)

Component Responsibility
App Main shell, mode switching, theme, status bar.
ThemeEngine CSS variable‑based theming (dark/light).
Components Reusable UI blocks (Button, ChipGroup, Dropzone, Modal).
Modes Each mode (Text, Image, Video, etc.) renders its control panel and handles generation.
WorkflowCanvas Basic visual node editor for workflows.

---

7. Plugin SDK (src/plugins/)

Component Responsibility
PluginLoader Discovers and loads plugins from a known directory.
PluginManager Manages plugin lifecycle, permissions, and activation.
PluginAPI Restricted API granted to plugins based on requested permissions.

Permissions

Permission Description
storage:read Read from plugin storage.
storage:write Write to plugin storage.
network:fetch Make network requests.
provider:register Register new providers.
workflow:register Register new workflow nodes.
ui:menu Add menu items.
ui:panel Add panels.
ui:command Register commands.
agent:register Register new agents.
model:register Register new models (future).

---

8. Enterprise Features (src/enterprise/)

Component Responsibility
AssetManager Stores and retrieves assets with metadata.
ProjectManager Creates projects, associates assets, tracks versions, exports/imports.

---

9. AI Operating System (src/aios/)

Component Responsibility
Memory Key‑value store with TTL and tags.
PromptLibrary Manage reusable prompts with tags, categories, favourites.
AgentOrchestrator Run multiple agents (workflows, LLMs, research) in sequence or parallel.
ModelMarketplace Fetch and list models from a remote registry.
PluginMarketplace Fetch and list plugins from a remote registry.
RemoteCompute Offload tasks to a backend (stub).
TeamManager User/role and project sharing (stub).

---

10. Data Flow

```
User clicks "Generate"
    │
    ▼
UI Mode (e.g., TextMode)
    │
    ▼
Event `workflow:started`
    │
    ▼
Workflow Engine
    │
    ▼
Smart Router → selects best provider
    │
    ▼
Provider Adapter → API call
    │
    ▼
Result → saved to AssetManager → displayed in UI
```

All steps are decoupled and asynchronous, enabling parallel execution and real‑time updates.

---

11. Security

Aspect Implementation
API Keys Stored in localStorage (plain text – planned encryption with WebCrypto).
Plugins Sandboxed by permission checks – no eval or arbitrary code execution.
CSP Can be enabled via meta tags.
XSS Input sanitisation (escapeHtml) used throughout the UI.

---

12. Performance

Technique Application
Code Splitting Vite splits the bundle.
Lazy Loading Modes and plugins are loaded on demand.
Web Workers Planned for OCR, PDF parsing, audio stitching.
Caching Workflow results are cached; providers are health‑checked to avoid slow ones.
Virtual Lists For large history/gallery views.

---

13. Future Roadmap

· Full‑featured Visual Workflow Editor (using a library like @xyflow/react).
· Multi‑Agent Orchestrator with branching and conditionals.
· AI Memory with decay and retrieval strategies.
· Remote Compute integration with a real backend.
· Team Collaboration with authentication and real‑time sync.
· Plugin and Model Marketplaces with online registries.

---

14. Project Structure

```
src/
├── core/           # Kernel, EventBus, Logger, Config, State
├── providers/      # Provider registry, adapters, router, health
├── workflows/      # Graph engine, nodes, executors
├── ui/             # App shell, theme, components, modes
├── plugins/        # Plugin loader, manager, API
├── enterprise/     # Asset and Project management
├── aios/           # AIOS: Memory, Prompt Library, Orchestrator, Marketplaces
└── css/            # Theme variables and styles
```

---

15. License

```
Copyright 2024 Mehdi Alireza / MAGENAIS

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

End of Architecture Document

```

---

This Markdown file is ready to be placed in the `docs/` folder of your repository. It provides a comprehensive, readable overview of the MAGENAIS architecture for contributors, users, and future maintainers.
