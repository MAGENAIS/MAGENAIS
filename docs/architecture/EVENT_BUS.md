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

This principle enables a GENAI Operating System where
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

---

# Event Priorities

Not every event has the same urgency.

A UI refresh should never delay an emergency provider failure.

MAGENAIS therefore classifies events into five priority levels.

| Priority | Description | Examples |
|-----------|------------|----------|
| Critical | Immediate execution | KernelError, ProviderCrashed |
| High | User-facing actions | PromptSubmitted, WorkflowStarted |
| Normal | Standard operations | AssetImported, ProjectSaved |
| Low | Background tasks | CacheCleanup, ThumbnailGeneration |
| Idle | Maintenance work | Analytics, Telemetry, IndexRebuild |

Priority scheduling prevents heavy background work from blocking
interactive user operations.

---

# Event Queue

The Event Bus internally maintains multiple queues.

```
Critical Queue

↓

High Queue

↓

Normal Queue

↓

Low Queue

↓

Idle Queue
```

Each queue is processed independently.

Advantages include:

• smoother UI

• lower latency

• predictable execution

• background scheduling

• better responsiveness

---

# Asynchronous Dispatch

Nearly every event inside MAGENAIS is asynchronous.

```ts
await EventBus.publish({
    type: "WorkflowStarted",
    payload: workflow
});
```

Subscribers may execute:

- synchronously

- asynchronously

- in parallel

- sequentially

depending on event configuration.

---

# Event Propagation

Each event propagates through three phases.

```
Capture Phase

↓

Target Phase

↓

Bubble Phase
```

This resembles the browser DOM event model while remaining framework
independent.

Example

```
Kernel

↓

Workflow Engine

↓

Node Executor

↓

Provider

↓

Storage

↓

Logger
```

Each stage may observe or modify the event.

---

# Middleware Pipeline

Before an event reaches subscribers it passes through middleware.

Example pipeline

```
Validation

↓

Permission Check

↓

Performance Timer

↓

Tracing

↓

Logging

↓

Metrics

↓

Dispatch
```

Middleware enables cross-cutting functionality without polluting
business logic.

---

# Middleware Interface

```ts
interface EventMiddleware{

execute(

event: Event,

next: () => Promise<void>

):Promise<void>;

}
```

Examples include

AuthenticationMiddleware

PermissionMiddleware

LoggerMiddleware

TracingMiddleware

MetricsMiddleware

ProfilerMiddleware

RateLimiterMiddleware

SecurityMiddleware

---

# Event Filtering

Subscribers can filter events.

```ts
EventBus.subscribe(

"ProviderHealthUpdated",

handler,

{

provider:"OpenAI",

priority:"high"

}

);
```

Filtering reduces unnecessary processing and improves scalability.

---

# Sticky Events

Some events should remain available for future subscribers.

Example

```
KernelReady

ConfigurationLoaded

ThemeChanged

WorkspaceInitialized
```

Late subscribers immediately receive the latest state.

---

# Buffered Events

Certain systems may temporarily disconnect.

Examples

Plugin loading

Lazy-loaded studios

Background workers

Offline synchronization

The Event Bus can buffer events until the consumer becomes available.

---

# Transaction Events

Some operations span multiple components.

Example

```
Project Save

↓

Storage

↓

Assets

↓

Workflow

↓

Plugins

↓

Settings

↓

Success
```

If any step fails,

the transaction may rollback.

This guarantees consistency across the platform.

---

# Event Replay

Every event may optionally be recorded.

Recorded events can later be replayed.

Applications include

• debugging

• regression testing

• workflow recovery

• demonstrations

• crash recovery

Replay dramatically simplifies reproducing difficult bugs.

---

# Dead Letter Queue (DLQ)

Some events cannot be processed.

Examples

Unknown event type

Missing subscriber

Validation failure

Plugin crash

Instead of silently disappearing,

failed events are moved into the Dead Letter Queue.

```
Publish

↓

Dispatch

↓

Failure

↓

Dead Letter Queue

↓

Inspection

↓

Retry
```

This makes failures observable rather than hidden.

---

# Error Isolation

One failing subscriber must never stop others.

Incorrect

```
Subscriber A

↓

Crash

↓

Everything Stops
```

Correct

```
Subscriber A

↓

Crash

↓

Logged

↓

Subscriber B Continues

↓

Subscriber C Continues
```

Fault isolation is essential for third-party plugins.

---

# Event Timeouts

Subscribers may define execution limits.

```ts
EventBus.subscribe(

"ImageGenerated",

handler,

{

timeout:5000

}

);
```

Slow handlers are automatically cancelled or reported.

This prevents UI freezes.

---

# Event Cancellation

Subscribers may stop propagation.

Example

```ts
event.preventDefault();

event.stopPropagation();
```

Typical use cases include

Permission denied

Invalid workflow

Duplicate execution

Plugin override

---

# Event Versioning

Events evolve over time.

Each event carries a version.

```json
{
  "type":"ProviderRegistered",
  "version":"2.1.0"
}
```

Backward compatibility allows older plugins to continue functioning.

---

# Event Namespaces

To prevent naming conflicts, events use namespaces.

Examples

```
kernel.ready

provider.registered

provider.health.updated

workflow.started

workflow.completed

asset.imported

project.saved

plugin.installed

studio.chat.started

ui.sidebar.opened
```

Namespaces improve discoverability and tooling support.

---

# Performance Monitoring

The Event Bus continuously measures its own performance.

Every published event produces runtime metrics.

Collected metrics include:

- Publish time
- Dispatch latency
- Queue waiting time
- Subscriber execution time
- Total processing time
- Failed handlers
- Timeout count
- Retry count
- Queue depth
- Memory usage

Example

```
ProviderRegistered

Publish:
0.08 ms

Dispatch:
0.21 ms

Subscribers:
4

Completed:
1.04 ms

Total:
1.33 ms
```

These metrics are available through Developer Tools.

---

# Event Tracing

Every event carries a globally unique Trace ID.

```
Kernel

↓

Workflow

↓

Node

↓

Provider

↓

Storage

↓

Logger
```

Example

```
Trace ID

3FD2-A21C-91BC

KernelReady

↓

WorkflowStarted

↓

ProviderSelected

↓

InferenceStarted

↓

InferenceCompleted

↓

AssetSaved
```

Tracing enables complete request reconstruction for debugging and profiling.

---

# Cross-Tab Communication

Future versions of MAGENAIS support multiple browser tabs.

The Event Bus abstracts browser communication using:

- BroadcastChannel API
- Shared Workers
- Service Workers
- MessageChannel

Example

```
Browser Tab A

↓

BroadcastChannel

↓

Browser Tab B
```

Projects remain synchronized without requiring a server.

---

# Web Worker Integration

Heavy operations should never block the UI.

The Event Bus transparently communicates with

- AI Workers
- Image Workers
- Audio Workers
- Video Workers
- Workflow Workers

Example

```
UI

↓

Event Bus

↓

Worker

↓

Result Event

↓

UI Update
```

The UI remains responsive even during intensive AI workloads.

---

# Developer Tools

MAGENAIS includes an integrated Event Inspector.

Features include:

- Live Event Stream
- Event Timeline
- Queue Viewer
- Subscriber Graph
- Performance Charts
- Failed Events
- Dead Letter Queue
- Middleware Inspection
- Trace Viewer
- Replay Controls

This tooling significantly improves debugging productivity.

---

# Security Model

The Event Bus enforces security at the messaging layer.

Security features include:

- Event schema validation
- Plugin permission verification
- Origin validation
- Namespace isolation
- Payload sanitization
- Read-only system events
- Capability-based subscriptions

Sensitive kernel events cannot be published by third-party plugins.

Example

```
Plugin

×

KernelShutdown
```

Only trusted system components may emit privileged events.

---

# Best Practices

Recommended

✔ Publish events instead of calling modules directly.

✔ Keep payloads immutable.

✔ Use descriptive event names.

✔ Prefer namespaces.

✔ Keep events focused.

✔ Subscribe only when necessary.

✔ Always unsubscribe when disposing components.

✔ Design events to be deterministic.

---

# Anti-Patterns

Avoid

✘ Global mutable payloads

✘ Circular event chains

✘ Blocking subscribers

✘ Long-running handlers

✘ Anonymous event names

✘ Hidden side effects

✘ Publishing inside rendering loops

✘ Direct component references

---

# TypeScript API

Publishing

```ts
EventBus.publish({
    type: "provider.registered",
    payload: provider
});
```

Subscribing

```ts
EventBus.subscribe(
    "workflow.started",
    async (event) => {

    }
);
```

Unsubscribing

```ts
const dispose =
EventBus.subscribe(...);

dispose();
```

Once

```ts
EventBus.once(
    "kernel.ready",
    initialize
);
```

Middleware

```ts
EventBus.use(
    new LoggerMiddleware()
);
```

---

# Internal Components

The Event Bus consists of several collaborating services.

```
Event Bus

├── Event Dispatcher
├── Event Queue
├── Event Registry
├── Middleware Pipeline
├── Priority Scheduler
├── Event Validator
├── Dead Letter Queue
├── Metrics Collector
├── Trace Manager
├── Replay Engine
├── Broadcast Adapter
├── Worker Adapter
└── DevTools Bridge
```

Each component has a single, clearly defined responsibility.

---

# Scalability Goals

The Event Bus is designed to support:

- 10,000+ events per minute
- 200+ AI Providers
- 100+ Plugins
- 50+ Studios
- Thousands of assets
- Multiple simultaneous workflows
- Browser-first execution
- GitHub Pages deployment
- Offline-first operation

No architectural redesign should be required to reach these targets.

---

# Future Evolution

Planned capabilities include:

- Distributed Event Bus
- Collaborative sessions
- Real-time synchronization
- Cloud execution adapters
- Remote providers
- Plugin marketplaces
- Workflow streaming
- Multi-device event synchronization
- AI-assisted event diagnostics
- Event recording and playback for tutorials

These features build upon the same Event Bus abstraction without breaking existing APIs.

---

# Acceptance Criteria

The Event Bus implementation is considered complete when:

- All core modules communicate exclusively through events.
- No circular dependencies exist between major subsystems.
- Event dispatch remains deterministic and observable.
- Middleware can be extended without modifying core code.
- Plugins communicate only through public events.
- Performance metrics are available in Developer Tools.
- Failed events are isolated and recoverable.
- Cross-tab synchronization functions correctly.
- Event replay reproduces workflows consistently.
- The architecture scales to hundreds of providers and extensions.

---

# Conclusion

The Event Bus is the communication backbone of MAGENAIS.

Rather than serving as a simple publish/subscribe utility, it forms the foundation of a browser-native AI Operating System.

By separating components through a deterministic, observable, and extensible messaging architecture, MAGENAIS achieves loose coupling, exceptional scalability, and long-term maintainability.

Every action within the platform—from opening a project to executing an AI workflow—flows through the Event Bus.

As the ecosystem grows to include hundreds of providers, plugins, workflows, and studios, the Event Bus ensures that innovation can continue without introducing architectural complexity.

In MAGENAIS, **everything is an event**.
