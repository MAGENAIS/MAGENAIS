<div align="center">

# MAGENAIS

### Browser-First AI Operating System

*An extensible, provider-agnostic, plugin-driven AI platform for the next generation of intelligent applications.*

---

[Vision](VISION.md) •
[Architecture](architecture/ARCHITECTURE.md) •
[Documentation](docs/) •
[Roadmap](docs/ROADMAP.md)

</div>

---

# Welcome to MAGENAIS

MAGENAIS is an open-source **Browser-First AI Operating System** designed to unify modern Artificial Intelligence tools into a single extensible platform.

Instead of creating another chatbot or another AI wrapper, MAGENAIS provides an operating system architecture for AI applications.

Everything inside MAGENAIS is modular.

Everything is extensible.

Everything is replaceable.

The platform is designed to support hundreds of AI providers, workflows, plugins, studios, and intelligent applications without architectural changes.

---

# Vision

Our long-term vision is simple:

> Build the Visual Studio Code of Artificial Intelligence.

A platform where developers, researchers, creators, educators and enterprises can build AI applications without being locked into a specific provider or ecosystem.

MAGENAIS is designed around five principles:

- Browser First
- Provider Agnostic
- Plugin Driven
- Workflow Native
- Open Architecture

Read more in:

docs/VISION.md

---

# Why MAGENAIS?

Today's AI ecosystem is fragmented.

Every provider has:

- different APIs
- different pricing
- different authentication
- different capabilities
- different limitations

Every AI application solves only one problem.

MAGENAIS unifies them into one operating system.

Instead of switching between applications,
users switch between AI capabilities.

---

# 🏗 Browser-First Architecture

MAGENAIS is **not** a traditional Electron desktop application.

Instead it is designed as a **Browser Operating System for AI**.

Everything executes inside modern browsers whenever possible.

Advantages:

- Zero installation
- GitHub Pages deployment
- Offline capable
- Progressive Web App
- Cross platform
- Sandbox security
- Mobile compatible
- Cloud optional
- Server optional

The browser becomes the operating system.

# ⚙ Kernel

The Kernel is the heart of MAGENAIS.

Every subsystem communicates through the Kernel.

Responsibilities include:

- Service lifecycle
- Dependency injection
- Provider loading
- Plugin loading
- Extension registration
- Event dispatching
- Configuration
- Runtime initialization
- Version compatibility

The Kernel itself contains **no UI**.

Everything above the Kernel is replaceable.

```
Application
     │
UI Components
     │
Extensions
     │
Plugins
     │
Workflow Engine
     │
Provider Registry
     │
State Manager
     │
Event Bus
     │
Kernel
```

The Kernel follows a microkernel architecture.

# 📡 Event Bus

Every component communicates through the Event Bus.

No direct dependencies.

Example

```
Provider Loaded

↓

Event

↓

Workflow Engine

↓

Studio

↓

Notification

↓

Logger

↓

History
```

Examples

```
provider:loaded

provider:error

workflow:start

workflow:finish

plugin:installed

plugin:removed

model:selected

chat:new

asset:imported

project:opened
```

Benefits

- loose coupling
- extensibility
- easier testing
- replay support
- debugging
- telemetry

  # 🧠 State Manager

MAGENAIS uses a centralized immutable state.

```
Application State

├── UI
├── Providers
├── Projects
├── Assets
├── Workflows
├── Models
├── Extensions
├── Plugins
├── Settings
└── Runtime
```

Features

- Undo
- Redo
- Time Travel
- Snapshots
- Serialization
- Persistence
- Multi-tab synchronization

  # 💾 Storage Manager

The Storage Manager abstracts browser storage.

Supported backends

- IndexedDB
- LocalStorage
- Cache API
- File System Access API
- OPFS
- Cloud Storage

Everything shares one API.

```
StorageManager

↓

save()

↓

IndexedDB

↓

or

↓

Cloud

↓

or

↓

GitHub
```

Capabilities

- automatic migrations
- versioning
- backup
- import/export
- compression
- encryption hooks

  # 🤖 Provider Registry

The Provider Registry knows every available AI provider.

Examples

```
OpenAI

Anthropic

Google

OpenRouter

Groq

DeepSeek

Mistral

Gemini

Claude

Together

Replicate

Novita

Ollama

LM Studio

HuggingFace

Stability

ElevenLabs

Azure OpenAI

AWS Bedrock

Cohere

etc...
```

Provider information includes

- capabilities
- pricing
- latency
- health
- authentication
- supported models
- supported modalities

Providers are loaded dynamically.

# 🧭 Smart Provider Router

One of MAGENAIS' defining innovations.

Users do **not** need to manually choose providers.

The router automatically selects the optimal provider.

Decision factors

- Health
- Cost
- Latency
- Context Length
- Model Quality
- Availability
- User Preferences
- Previous Success
- Rate Limits
- Geographic Location

```
Request

↓

Capability Analysis

↓

Candidate Providers

↓

Scoring Engine

↓

Best Provider

↓

Execution

↓

Fallback

↓

Result
```

Supports

- automatic fallback
- retries
- circuit breaker
- health monitoring
- provider balancing

  # 🔄 Workflow Engine

Inspired by

- ComfyUI
- Langflow
- Node-RED

Every workflow is a graph.

```
Input

↓

Prompt

↓

LLM

↓

Image

↓

Upscaler

↓

Save

↓

Export
```

Features

- DAG execution
- Parallel nodes
- Conditional execution
- Loops
- Variables
- Templates
- Scheduling
- Streaming
- Cancellation
- Resume

Future support

- Agent workflows
- Multi-agent systems
- Autonomous execution

  # 🔌 Plugin System

Everything is a plugin.

Including

- Providers
- Studios
- Themes
- Tools
- Exporters
- Importers
- Panels
- Widgets

Plugin lifecycle

```
Install

↓

Validate

↓

Load

↓

Activate

↓

Execute

↓

Unload

↓

Remove
```

Plugin Manifest

```
plugin.json
```

Includes

- id
- version
- permissions
- dependencies
- capabilities
- entry
- icons
- settings

  # 🧩 Extension API

Extensions can contribute

- Commands
- Views
- Panels
- Menus
- Providers
- Models
- Themes
- Nodes
- Tools
- Editors
- Pipelines

Example

```typescript
registerCommand()

registerProvider()

registerStudio()

registerNode()

registerPanel()
```

Extensions never modify core files.

Everything happens through APIs.

This guarantees

- compatibility
- maintainability
- version stability
---

# 🎨 AI Studios

MAGENAIS is organized around **Studios**.

A Studio is a complete workspace focused on a specific creative or technical domain.

Unlike traditional AI applications that revolve around a single chat window, MAGENAIS provides specialized environments optimized for different workflows.

Each Studio is implemented as an independent extension that integrates with the Kernel through the Extension API.

```
Kernel
   │
   ├── Chat Studio
   ├── Image Studio
   ├── Video Studio
   ├── Music Studio
   ├── Podcast Studio
   ├── Document Studio
   ├── Research Studio
   ├── Code Studio
   ├── Agent Studio
   ├── Workflow Studio
   └── Future Studios...
```

Every Studio provides:

- Independent UI
- Dedicated tools
- Workspace layout
- Commands
- Workflow templates
- Asset integration
- Provider recommendations
- Plugin support

Studios can evolve independently without affecting the core platform.

---

# 💬 Chat Studio

The Chat Studio is the primary interface for interacting with language models.

Features include:

- Multi-chat sessions
- Conversation history
- Streaming responses
- Prompt templates
- Markdown rendering
- Code highlighting
- Image support
- Audio playback
- Citation management
- Model comparison
- Multi-provider conversations

Future capabilities include collaborative chat sessions, shared workspaces, and AI memory management.

---

# 🖼 Image Studio

The Image Studio provides a complete environment for AI-powered visual creation.

Capabilities include:

- Image generation
- Image editing
- Inpainting
- Outpainting
- Upscaling
- Background removal
- Face restoration
- Prompt enhancement
- Batch generation
- Style transfer

Supported providers include cloud APIs as well as local inference engines.

---

# 🎬 Video Studio

Video Studio enables modern AI-powered video production.

Planned capabilities:

- Text-to-video
- Image-to-video
- Video extension
- Frame interpolation
- Motion transfer
- Lip synchronization
- Video upscaling
- Subtitle generation
- Scene editing
- Storyboard generation

The architecture is provider-independent, allowing seamless integration of future video models.

---

# 🎵 Music Studio

Music Studio focuses on AI-assisted music creation.

Features include:

- Text-to-music
- Instrumental generation
- Lyrics generation
- Stem separation
- Audio enhancement
- Voice cloning (where legally permitted)
- Mixing assistance
- Mastering assistance
- Prompt presets
- Style libraries

Designed to support providers such as Suno, Udio, Stable Audio and future local models.

---

# 🎙 Podcast Studio

Podcast Studio streamlines spoken-content production.

Features:

- Script generation
- Multi-speaker synthesis
- Voice assignment
- Timeline editing
- Background music
- Noise reduction
- Chapter generation
- Transcript export
- Subtitle generation
- RSS publishing

---

# 📄 Document Studio

Document Studio assists with document-centric workflows.

Supported tasks:

- PDF analysis
- OCR
- Summarization
- Translation
- Citation extraction
- Knowledge indexing
- Report generation
- Academic writing
- Presentation generation
- Document comparison

---

# 💻 Code Studio

A development environment powered by AI.

Capabilities include:

- Code generation
- Refactoring
- Bug fixing
- Test generation
- Documentation
- Repository analysis
- Terminal integration
- Git support
- Pull request assistance
- Architecture visualization

Designed to complement—not replace—professional IDEs.

---

# 🤖 Agent Studio

Agent Studio enables autonomous AI systems.

Features:

- Multi-agent orchestration
- Task planning
- Memory management
- Tool execution
- Internet search
- Long-running jobs
- Scheduling
- Human approval checkpoints
- Collaboration between agents

---

# 🔄 Workflow Studio

Workflow Studio provides a visual graph editor inspired by modern node-based systems.

Users can build complex AI pipelines without writing code.

Example:

```
Prompt
    │
    ▼
Language Model
    │
    ▼
Image Generation
    │
    ▼
Upscaler
    │
    ▼
Video Generator
    │
    ▼
Exporter
```

Future releases will support reusable workflow packages and marketplace sharing.

---

# 📁 Project Manager

Everything inside MAGENAIS is organized into Projects.

Projects encapsulate all assets, workflows, settings, and history required for reproducible AI work.

Project structure:

```
Project

├── Assets
├── Chats
├── Documents
├── Images
├── Audio
├── Video
├── Workflows
├── Models
├── Metadata
├── Settings
└── History
```

Project features:

- Auto-save
- Version history
- Snapshots
- Backup
- Import/export
- Template projects
- Collaboration-ready architecture

Projects remain portable and self-contained.

---

# 🗂 Asset Manager

The Asset Manager is the unified repository for every resource created or imported into MAGENAIS.

Supported asset types:

- Images
- Videos
- Audio
- Documents
- Models
- Prompts
- Workflows
- Templates
- Embeddings
- Vector indexes
- Metadata

Core capabilities:

- Tagging
- Search
- Preview
- Collections
- Versioning
- Duplicate detection
- Metadata editing
- Dependency tracking

Future versions will include semantic search powered by vector embeddings.

---

# 🌐 Supported Providers

MAGENAIS is designed to support **200+ AI providers** through a unified provider interface.

Examples include:

### Large Language Models

- OpenAI
- Anthropic
- Google Gemini
- DeepSeek
- Mistral AI
- Cohere
- Groq
- Together AI
- OpenRouter
- Azure OpenAI
- AWS Bedrock
- Ollama
- LM Studio

### Image Generation

- Stability AI
- FLUX
- Black Forest Labs
- Ideogram
- Novita AI
- Replicate
- Hugging Face Inference

### Video Generation

- Runway
- Pika
- Luma AI
- Kling AI
- Hailuo AI
- Wan
- Veo
- Future providers

### Audio & Speech

- ElevenLabs
- Cartesia
- PlayHT
- OpenAI Audio
- Suno
- Udio
- Stable Audio

Support is provider-independent and future-proof.

---

# 🎭 Supported Modalities

MAGENAIS is a truly multimodal AI operating system.

Supported modalities include:

- Text
- Image
- Audio
- Music
- Video
- Speech
- Documents
- Code
- Embeddings
- Vector Databases
- Structured Data
- Workflows
- Agents
- Tool Calling
- Function Calling

Future modalities can be added through plugins without modifying the Kernel.

---

# 🌳 Directory Structure

```
MAGENAIS/

├── apps/
├── packages/
├── kernel/
├── runtime/
├── providers/
├── plugins/
├── extensions/
├── workflows/
├── studios/
├── assets/
├── docs/
├── tests/
├── scripts/
├── public/
├── examples/
├── .github/
├── package.json
├── vite.config.ts
└── README.md
```

The repository follows a modular monorepo architecture that supports long-term scalability.

---

# ⚡ Quick Start

Clone the repository:

```bash
git clone https://github.com/MAGENAIS/MAGENAIS.git
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build the application:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

---

# 💻 Development

Development principles:

- Browser-first
- TypeScript-first
- ES Modules
- Modular architecture
- Strong typing
- Dependency injection
- Event-driven communication
- Extensive documentation
- Test-driven development where applicable

All new features should be implemented as plugins or extensions whenever possible.

---

# 🧪 Testing

MAGENAIS adopts a multi-layer testing strategy.

### Unit Testing

- Vitest

### Component Testing

- Testing Library

### Integration Testing

- Vitest Integration

### End-to-End Testing

- Playwright

### Performance Testing

- Lighthouse
- Web Vitals

### Continuous Integration

- GitHub Actions
- Automated builds
- Static analysis
- Linting
- Type checking
- Security scanning

The goal is to maintain a reliable, maintainable, and production-ready codebase throughout the project's evolution.

  
