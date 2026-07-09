# MAGENAIS State Manager

> Reactive State Management for the Browser-First AI Operating System

---

# Overview

The State Manager is the single source of truth for the entire MAGENAIS platform.

Every component in the system reads from the State Manager instead of maintaining its own independent state.

No UI component, plugin, provider, or workflow owns application data.

Instead, every change flows through the State Manager.

This design ensures:

- Predictable behavior
- Reactive user interfaces
- Time-travel debugging
- Reliable synchronization
- Plugin interoperability
- Workflow consistency
- Scalable application architecture

---

# Philosophy

MAGENAIS follows one fundamental rule:

> State is never modified directly.

Every change must pass through the Runtime and Event Bus before reaching the State Manager.

```
User Action

↓

Runtime

↓

Event Bus

↓

State Manager

↓

Reactive UI
```

This guarantees deterministic application behavior.

---

# Responsibilities

The State Manager is responsible for:

- Global application state
- User interface state
- Provider status
- Workflow execution state
- Runtime task state
- Active projects
- Assets
- Plugin state
- Extension state
- User preferences
- Session data
- Notifications

---

# Design Goals

The architecture is designed around the following principles:

- Single Source of Truth
- Immutable Updates
- Event-Driven Synchronization
- Reactive Rendering
- Modular State Domains
- Undo / Redo Support
- Snapshot Persistence
- Offline Compatibility
- Plugin Isolation
- High Performance

---

# Architecture

```
UI Components

        │

        ▼

Reactive Store

        │

        ▼

State Manager

        │

        ▼

Event Bus

        │

        ▼

Runtime

        │

        ▼

Providers / Plugins
```

The UI never writes directly into the Store.

---

# State Domains

The application state is divided into independent domains.

```
Application

Projects

Assets

Runtime

Providers

Plugins

Extensions

Settings

Storage

Workflow

Chat

Media

History

Notifications

Diagnostics
```

Each domain is independently observable.

---

# Root State

Example structure:

```typescript
interface RootState {

    app

    runtime

    projects

    assets

    workflow

    providers

    plugins

    storage

    settings

    history

    notifications

}
```

Every feature contributes only its own domain.

---

# Immutable Updates

The State Manager never mutates existing objects.

Instead:

```
Current State

↓

Action

↓

Reducer

↓

New State
```

Previous snapshots remain available.

---

# Event Flow

Every update follows the same pipeline.

```
User Action

↓

Runtime

↓

Event Bus

↓

State Manager

↓

Reactive Components
```

No shortcuts are allowed.

---

# Reactive Rendering

UI components subscribe only to the state they require.

Example:

```
Chat Panel

↓

Chat State

Image Studio

↓

Image State

Workflow Editor

↓

Workflow State
```

Unrelated updates never trigger unnecessary rendering.

---

# State Isolation

Each module owns its own state.

Example:

```
Workflow

↓

Workflow Store

Provider

↓

Provider Store

Plugin

↓

Plugin Store
```

Isolation minimizes coupling.

---

# Runtime State

Runtime information includes:

- Active tasks
- Queue
- Scheduler
- Progress
- Streaming
- Errors
- Performance metrics

Runtime state changes frequently but remains isolated.

---

# Project State

Projects contain:

- Metadata
- Open files
- Assets
- Workflow references
- Provider settings
- History

Projects are persistent.

---

# Asset State

Assets include:

- Images
- Audio
- Video
- Documents
- Models
- Embeddings
- Datasets

Assets are referenced instead of duplicated.

---

# Provider State

Provider information includes:

- Availability
- Health
- Latency
- Authentication
- Quota
- Cost
- Capabilities
- Model list

The Smart Router continuously updates this domain.

---

# Workflow State

Workflow state tracks:

- Nodes
- Connections
- Variables
- Execution status
- Progress
- Results

Each workflow remains independent.

---

# Plugin State

Plugins receive isolated namespaces.

```
Plugin A

↓

Plugin State A

Plugin B

↓

Plugin State B
```

Plugins cannot overwrite global application state.

---

# Settings State

Settings include:

- Theme
- Language
- Accessibility
- AI preferences
- Default providers
- Performance options

Settings are synchronized across sessions.

---

# History

Every meaningful update creates an entry.

History enables:

- Undo
- Redo
- Recovery
- Version comparison

---

# Snapshots

The State Manager periodically creates snapshots.

```
Snapshot 1

↓

Snapshot 2

↓

Snapshot 3
```

Snapshots support:

- Crash recovery
- Debugging
- Future collaboration
- State migration

---

# Selectors

Components access state through selectors.

Example:

```
selectActiveProject()

selectCurrentProvider()

selectWorkflow()

selectChat()

selectTheme()
```

Selectors prevent unnecessary rendering.

---

# Transactions

Multiple updates may execute atomically.

```
Begin Transaction

↓

Update A

↓

Update B

↓

Update C

↓

Commit
```

Partial updates are never exposed.

---

# Persistence

Persistent domains include:

- Projects
- Assets
- Settings
- Workflows
- History

Temporary runtime state is excluded.

---

# Synchronization

State synchronizes with:

- IndexedDB
- Local Storage
- Cloud Storage
- Project Files

Synchronization occurs automatically.

---

# Offline Support

The State Manager is fully functional without network connectivity.

Users can:

- Browse projects
- Edit workflows
- Manage assets
- Configure providers

Online synchronization resumes automatically.

---

# Performance

Optimization techniques include:

- Structural sharing
- Lazy loading
- Incremental updates
- Selector memoization
- Batched events
- Virtualized collections

Large projects remain responsive.

---

# Error Recovery

State corruption is prevented through:

- Validation
- Immutable updates
- Snapshot recovery
- Transaction rollback
- Runtime verification

---

# Security

The State Manager enforces:

- Read-only selectors
- Controlled mutations
- Plugin isolation
- Permission validation
- Secure serialization

No component receives unrestricted write access.

---

# Future Capabilities

Future releases may include:

- Collaborative editing
- Multi-user synchronization
- CRDT-based state
- AI-assisted state optimization
- Distributed state management
- Cloud synchronization
- Live project sharing
- Real-time collaboration

without changing the core architecture.

---

# Design Principles

The State Manager follows these principles:

- Single Source of Truth
- Immutable Data
- Event-Driven Updates
- Predictable State
- Reactive Rendering
- Domain Isolation
- Transaction Safety
- Persistent Storage
- Browser-First Design
- Plugin Compatibility

These principles make the State Manager the foundation of a scalable, reliable, and extensible AI Operating System.

---

# Related Documentation

- ARCHITECTURE.md
- KERNEL.md
- RUNTIME.md
- EVENT_BUS.md
- STORAGE_MANAGER.md
- PROVIDER_REGISTRY.md
- SMART_ROUTER.md
- WORKFLOW_ENGINE.md
- PLUGIN_SDK.md
- PROVIDER_SDK.md
