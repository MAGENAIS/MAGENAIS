# Node Types

## Building Blocks of Intelligence

---

## Overview

Nodes are the smallest executable units inside the MAGENAIS Workflow Engine.

Every workflow, automation pipeline, AI chain, research agent, creative process, or multimodal application is ultimately composed of interconnected nodes.

Rather than treating AI requests as isolated prompts, MAGENAIS models every operation as a directed graph of reusable components. Each node performs a well-defined responsibility while exchanging typed data through standardized ports.

This architecture provides flexibility, transparency, reproducibility, and scalability while remaining independent of any specific AI provider or runtime.

Node definitions are intentionally decoupled from execution logic, allowing workflows to remain portable across providers, browser environments, future execution engines, and deployment targets.

---

# Design Principles

Node architecture follows several core principles.

### Single Responsibility

Each node should perform one task exceptionally well.

Examples include:

- Generate text
- Analyze an image
- Load a document
- Execute JavaScript
- Query memory
- Route data
- Merge outputs

Complex behavior emerges from composition rather than monolithic nodes.

---

### Provider Independence

Nodes never contain provider-specific logic.

Instead they express required capabilities.

For example:

```
Requires:
- Text Generation
- Vision
- Embeddings
```

The Smart Router determines which provider satisfies those capabilities.

This allows workflows to migrate between providers without modification.

---

### Strong Typing

Each node exposes explicit input and output types.

Example:

```
Input

Image

↓

Vision Analysis

↓

Output

Caption
Objects
Confidence
Metadata
```

Typed ports enable:

- validation
- auto-completion
- graph optimization
- static analysis
- intelligent suggestions

---

### Stateless Execution

Whenever possible, nodes remain stateless.

Execution state belongs to:

- Runtime
- Workflow Engine
- State Manager

This enables:

- retries
- parallel execution
- caching
- distributed processing
- deterministic behavior

---

### Composability

Small reusable nodes are preferred over highly specialized nodes.

Instead of one massive "Create Marketing Campaign" node, a workflow combines:

- Research
- Web Search
- Summarization
- Image Generation
- Copywriting
- Translation
- Publishing

This philosophy mirrors modular software engineering.

---

# Node Anatomy

Each node contains several logical sections.

```
Node

├── Metadata
├── Inputs
├── Outputs
├── Configuration
├── Validation
├── Runtime
├── UI
├── Execution
└── Documentation
```

---

## Metadata

Metadata identifies the node.

Typical information includes:

- unique identifier
- version
- author
- category
- icon
- description
- tags
- supported capabilities

Metadata powers search, documentation, compatibility checks, and marketplace discovery.

---

## Inputs

Inputs define the data accepted by the node.

Examples include:

- Text
- Image
- Audio
- Video
- Document
- JSON
- Number
- Boolean
- Array
- Object
- Binary
- Embedding

Inputs may include:

- default values
- optional fields
- validation rules
- accepted MIME types
- size limits

---

## Outputs

Outputs expose generated information.

Examples:

- response text
- generated image
- embedding vector
- metadata
- confidence score
- classification
- execution statistics

Outputs become inputs for downstream nodes.

---

## Configuration

Configuration controls node behavior.

Examples:

- temperature
- model
- language
- timeout
- retry count
- creativity
- safety level
- streaming mode

Configurations remain separate from workflow data.

---

## Validation

Validation executes before runtime.

Examples:

- required inputs
- schema validation
- provider availability
- capability compatibility
- security policy
- quota checks

Invalid nodes fail early with descriptive diagnostics.

---

## Runtime

Runtime metadata includes:

- execution duration
- memory usage
- provider selected
- cache status
- token usage
- latency
- retry attempts
- execution logs

Runtime information supports monitoring and optimization.

---

## UI Definition

Each node may define optional editor behavior.

Examples:

- icon
- color
- inspector panel
- configuration forms
- preview
- live validation
- drag handles
- documentation links

This allows the visual editor to render nodes dynamically.

---

# Core Node Categories

MAGENAIS includes several families of nodes.

---

## AI Nodes

Responsible for interacting with AI models.

Examples:

- Chat
- Completion
- Reasoning
- Vision
- Speech
- Image Generation
- Video Generation
- Embeddings
- Translation
- Summarization
- Classification

---

## Data Nodes

Handle structured information.

Examples:

- JSON
- CSV
- XML
- YAML
- Markdown
- SQL
- Vector
- Tables
- Metadata

---

## Logic Nodes

Control execution.

Examples:

- If
- Switch
- Loop
- Parallel
- Merge
- Split
- Delay
- Retry
- Wait
- Stop

---

## Workflow Nodes

Coordinate larger workflows.

Examples:

- Subflow
- Trigger
- Schedule
- Agent
- Queue
- Batch
- Session
- Pipeline

---

## Storage Nodes

Interact with storage systems.

Examples:

- IndexedDB
- Local Storage
- Cache
- Files
- Assets
- Project Store
- Vector Database

---

## Communication Nodes

Exchange information with external systems.

Examples:

- HTTP
- WebSocket
- REST
- GraphQL
- SSE
- WebRTC

---

## Utility Nodes

General-purpose processing.

Examples:

- Math
- Regex
- Parser
- Converter
- Formatter
- Encryption
- Compression
- Hashing

---

## Media Nodes

Operate on multimedia.

Examples:

- Image Resize
- Crop
- OCR
- Audio Processing
- Video Editing
- Subtitle Extraction
- Speech Recognition

---

## Browser Nodes

Leverage browser-native APIs.

Examples:

- Clipboard
- File Picker
- Camera
- Microphone
- Notifications
- Geolocation
- Screen Capture

---

# Execution Modes

Nodes support multiple execution patterns.

### Synchronous

Immediate execution.

Suitable for:

- formatting
- parsing
- validation

---

### Asynchronous

Promise-based execution.

Suitable for:

- AI inference
- HTTP requests
- storage access
- file operations

---

### Streaming

Produces incremental outputs.

Examples:

- token streaming
- speech streaming
- video generation progress
- live transcription

---

### Event Driven

Activated by events.

Examples:

- user action
- timer
- provider response
- workflow trigger
- plugin event

---

# Future Node Ecosystem

The architecture is designed to grow into a rich ecosystem containing hundreds of interoperable node types developed by both the core project and the community.

Future categories may include:

- Scientific Computing
- Robotics
- IoT
- GIS
- Quantum Computing
- CAD
- Bioinformatics
- Financial Analysis
- Education
- Medical AI
- Simulation
- Game Development
- Creative Coding
- Digital Twin Systems

Because all nodes conform to a common lifecycle, capability model, and execution contract, they can be composed seamlessly regardless of origin.

---

# Relationship to the Architecture

Node Types are intentionally independent from:

- Providers
- Plugins
- Runtime implementation
- Workflow storage
- User interface

Their only responsibility is to define reusable computational building blocks.

This separation ensures that workflows remain portable, maintainable, and future-proof as MAGENAIS evolves into a GENAI Operating System capable of supporting hundreds of providers, thousands of workflows, and a rapidly expanding ecosystem of community-developed extensions.
