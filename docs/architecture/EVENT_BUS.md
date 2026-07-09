# EVENT_BUS.md

> **The Nervous System of MAGENAIS**
>
> Event Bus is the communication backbone of MAGENAIS.
> Every subsystem—including the Kernel, Runtime, Providers, Plugins,
> Studios, Workflow Engine, UI Components, Asset Manager,
> Project Manager, and Extensions—communicates exclusively through
> the Event Bus.

---

# Philosophy

Traditional web applications become increasingly coupled as they grow.

Component A imports Component B.

Component B imports Component C.

Plugins directly call internal APIs.

Providers manipulate application state.

Eventually every module depends on every other module.

The result is:

• impossible testing

• circular dependencies

• difficult maintenance

• poor scalability

• fragile architecture

MAGENAIS intentionally avoids this architecture.

Instead, every subsystem communicates by publishing and subscribing
to events.

No module should directly know the implementation details of another.

Instead they know only:

> "Something happened."

This principle enables a browser-first AI Operating System where
hundreds of independent modules can evolve without breaking each other.

---

# Design Principles

The Event Bus is designed around several principles.

## Loose Coupling

Modules never directly depend on one another.

Instead:

Kernel
↓

Event Bus
↓

Interested Components

---

## Browser Native

The implementation is optimized for modern browsers.

No external message broker is required.

No server dependency exists.

Everything works completely offline.

---

## Type Safety

Every event has a defined schema.

Examples:

ProviderLoaded

WorkflowStarted

ProjectOpened

ModelDownloaded

PluginInstalled

AssetImported

PromptExecuted

UIThemeChanged

Unknown events should never silently propagate.

---

## Predictable

Every event follows exactly the same lifecycle.

Publish

↓

Validation

↓

Middleware

↓

Subscribers

↓

Completion

↓

Logging

---

## Observable

Every event may be inspected.

Developer Tools can display:

Current Event

Execution Time

Subscribers

Publisher

Errors

Propagation Chain

This greatly simplifies debugging.

---

# High-Level Architecture

```

                    +----------------------+
                    |     Kernel           |
                    +----------+-----------+
                               |
                               |
                    publish()
                               |
                 +-------------v-------------+
                 |       Event Bus           |
                 +-------------+-------------+
                               |
      +-----------+------------+-------------+-----------+
      |           |            |             |           |
      |           |            |             |           |
+-----v----+ +----v-----+ +----v-----+ +-----v----+ +----v-----+
| Runtime  | | Providers| | Plugins  | | Studios  | | Workflow |
+----------+ +----------+ +----------+ +----------+ +----------+

```

Everything communicates through this single abstraction.

---

# Core Responsibilities

The Event Bus is responsible for:

• Event publishing

• Event subscription

• Event routing

• Event validation

• Event logging

• Event replay

• Event filtering

• Middleware execution

• Priority scheduling

• Error isolation

• Performance monitoring

• Debug inspection

---

# Event Lifecycle

Every event follows a deterministic lifecycle.

```

Publisher

↓

Create Event

↓

Validate Schema

↓

Apply Middleware

↓

Priority Queue

↓

Dispatch

↓

Subscribers Execute

↓

Results Collected

↓

Logger

↓

Metrics

↓

Complete

```

No component bypasses this pipeline.

---

# Event Structure

Every event contains standardized metadata.

```ts
interface Event {

id:string;

type:string;

timestamp:number;

source:string;

target?:string;

priority:number;

payload:any;

metadata:{

version:string;

sessionId:string;

projectId?:string;

userId?:string;

traceId:string;

};

}
```

This structure allows:

• tracing

• replay

• debugging

• persistence

• distributed synchronization

---

# Event Categories

MAGENAIS defines several event domains.

## Kernel Events

KernelReady

KernelShutdown

KernelRestart

KernelError

RuntimeInitialized

ConfigurationLoaded

---

## Provider Events

ProviderRegistered

ProviderRemoved

ProviderEnabled

ProviderDisabled

ProviderHealthUpdated

ProviderQuotaExceeded

ProviderLatencyMeasured

ProviderAuthenticationFailed

ProviderCapabilitiesUpdated

---

## Workflow Events

WorkflowCreated

WorkflowStarted

WorkflowPaused

WorkflowResumed

WorkflowCancelled

WorkflowCompleted

WorkflowFailed

NodeStarted

NodeCompleted

NodeError

EdgeExecuted

---

## Project Events

ProjectCreated

ProjectOpened

ProjectSaved

ProjectClosed

ProjectExported

ProjectImported

---

## Asset Events

AssetImported

AssetDeleted

AssetIndexed

AssetUpdated

AssetGenerated

AssetCached

ThumbnailGenerated

---

## Plugin Events

PluginInstalled

PluginUpdated

PluginEnabled

PluginDisabled

PluginRemoved

PluginLoaded

PluginUnloaded

PluginError

---

## Studio Events

ChatStarted

ImageGenerationStarted

MusicGenerationStarted

VideoGenerationStarted

CodeExecutionStarted

PodcastGenerated

DocumentAnalyzed

TranslationCompleted

---

## UI Events

SidebarOpened

SidebarClosed

ThemeChanged

LanguageChanged

WorkspaceChanged

NotificationCreated

DialogOpened

CommandExecuted

ShortcutPressed

---

## Storage Events

DatabaseReady

CacheHit

CacheMiss

CacheCleared

IndexedDBReady

LocalStorageUpdated

CloudSyncStarted

CloudSyncCompleted
