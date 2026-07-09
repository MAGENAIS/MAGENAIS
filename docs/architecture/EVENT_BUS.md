# EVENT BUS

> The Nervous System of MAGENAIS

---

# Philosophy

MAGENAIS is built around an Event-Driven Architecture.

Nothing communicates directly.

Everything communicates through Events.

Instead of:

UI → Provider

MAGENAIS uses:

UI
 ↓
Event Bus
 ↓
Kernel
 ↓
Router
 ↓
Provider
 ↓
Storage
 ↓
UI

This creates:

- Loose coupling
- Extensibility
- Plugin compatibility
- Hot swapping
- Time travel debugging
- Offline replay

---

# Goals

The Event Bus must provide

✓ Decoupled communication

✓ Async execution

✓ Priority scheduling

✓ Broadcast messaging

✓ Scoped messaging

✓ Event replay

✓ Event history

✓ Debug inspection

✓ Plugin isolation

✓ Browser-first implementation

---

# Architecture

                 UI

                  │

          publish(Event)

                  │

          ┌───────────────┐
          │   Event Bus   │
          └───────────────┘

      │         │        │

      ▼         ▼        ▼

   Kernel    Plugins   Studios

      │

      ▼

Workflow Engine

      │

      ▼

 Smart Router

      │

      ▼

 Providers

 ---

# Event Model

Every event follows exactly the same schema.

interface MAGEvent {

id:string

type:string

timestamp:number

source:string

target?:string

payload:any

metadata?:Record<string,any>

priority?:number

cancelable?:boolean

version:number

}

---

# Event Lifecycle

Event Created

↓

Validation

↓

Middleware

↓

Priority Queue

↓

Subscribers

↓

Execution

↓

Logging

↓

Persistence

↓

Replay Cache

---

# Core Event Categories

## Kernel

kernel:init

kernel:ready

kernel:shutdown

kernel:error

kernel:warning

kernel:update

---

## UI

ui:click

ui:open

ui:close

ui:resize

ui:theme

ui:notification

---

## Project

project:create

project:open

project:save

project:export

project:close

---

## Asset

asset:add

asset:update

asset:delete

asset:index

asset:import

asset:export

---

## Provider

provider:connect

provider:disconnect

provider:health

provider:latency

provider:cost

provider:error

provider:response

---

## Workflow

workflow:start

workflow:pause

workflow:resume

workflow:cancel

workflow:complete

workflow:error

workflow:progress

---

## Plugin

plugin:install

plugin:enable

plugin:disable

plugin:uninstall

plugin:error

plugin:update

---

## AI

ai:chat

ai:image

ai:video

ai:audio

ai:embedding

ai:reasoning

ai:tool

ai:stream

---

## System

storage:save

storage:load

settings:update

cache:clear

telemetry:event

analytics:event

---

# Event Priorities

Priority 0

Emergency

Priority 1

Kernel

Priority 2

Workflow

Priority 3

Provider

Priority 4

UI

Priority 5

Plugins

Priority 6

Analytics

---

# Middleware Pipeline

Incoming Event

↓

Validation

↓

Authorization

↓

Plugin Hooks

↓

Metrics

↓

Logging

↓

Dispatch

Each middleware may:

Continue

Modify

Cancel

Retry

---

# Subscription Model

Subscribers may register using:

Exact Event

Wildcard

Namespaces

Examples

ui:*

provider:*

workflow:*

*

---

# Replay System

Every event can optionally be persisted.

Benefits

Undo

Redo

Debugging

Workflow replay

Offline synchronization

Crash recovery


```markdown
---

# Plugin Integration

Plugins never call each other directly.

Plugin A

↓

publish()

↓

Event Bus

↓

Plugin B

This guarantees complete isolation.

---

# Performance Targets

Publish latency

< 1 ms

1000 events/sec

Browser memory

< 20 MB

Replay history

Configurable

Async dispatch

Yes

---

# Future Roadmap

Phase 2.2

Basic Event Bus

Phase 2.5

Priority Queue

Phase 3.0

Middleware

Replay

Metrics

Phase 3.5

Distributed Event Channels

Phase 4.0

Cross-tab synchronization

Shared Workers

Remote Events

---

> The Event Bus is the nervous system of MAGENAIS. Every component, provider, workflow, and plugin communicates through events, enabling a scalable, decoupled, browser-first AI Operating System.
