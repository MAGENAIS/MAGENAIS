# 02 · Architecture Principles

> *"Architecture is not about today's implementation. It is about tomorrow's evolution."*

---

# Purpose

This document defines the architectural principles that govern every component, module, plugin, provider, workflow, and future subsystem within MAGENAIS.

These principles are intended to ensure that the platform remains maintainable, extensible, performant, secure, and adaptable as it grows from a single browser application into a comprehensive AI Operating System.

Every contribution to MAGENAIS should align with these principles.

---

# The Golden Rule

> **The Kernel owns orchestration. Modules own functionality. Events connect everything.**

This single statement summarizes the architectural philosophy of MAGENAIS.

The Kernel coordinates.

Modules perform work.

The Event Bus enables communication.

Nothing else should create hidden dependencies.

---

# Core Principles

## 1. Browser-First

The browser is the primary runtime.

The platform must execute entirely inside modern browsers whenever technically possible.

Server-side services are optional enhancements rather than architectural requirements.

Benefits include:

- Zero installation
- GitHub Pages deployment
- Offline capability
- Cross-platform compatibility
- Privacy-first execution
- Simplified distribution

---

## 2. Kernel-First

The Kernel remains intentionally small.

It is responsible only for:

- bootstrapping
- lifecycle management
- dependency registration
- service discovery
- event routing
- configuration

The Kernel must never become a "God Object."

Business logic belongs elsewhere.

---

## 3. Plugin-First

Every feature should be designed as if it could become a plugin.

If a feature can exist outside the Kernel, it should.

Examples include:

- AI Providers
- UI Panels
- Studios
- Commands
- Workflow Nodes
- Themes
- Prompt Packs
- Agents
- Importers
- Exporters

This approach minimizes coupling and enables long-term extensibility.

---

## 4. Provider-Agnostic

MAGENAIS must never depend on a single AI vendor.

Every provider implements a shared contract.

Examples include:

- OpenAI
- Anthropic
- Google
- xAI
- Mistral
- Ollama
- LM Studio
- Hugging Face
- OpenRouter
- Novita
- Replicate
- Stability AI

The platform interacts with capabilities rather than provider-specific APIs.

---

## 5. Capability-Driven Design

Providers advertise capabilities.

The Router selects providers based on capability requirements.

Examples:

```
Text Generation

Image Generation

Speech Recognition

Text-to-Speech

Music Generation

Embeddings

Vision

Video Generation

Code Completion
```

The application should request capabilities instead of providers.

---

## 6. Event-Driven Architecture

Modules communicate through events.

Never through direct references whenever avoidable.

Instead of:

```
Workflow → Provider
```

Prefer:

```
Workflow

↓

Event Bus

↓

Provider Platform
```

Benefits:

- Loose coupling
- Easier testing
- Runtime extensibility
- Plugin compatibility
- Better observability

---

## 7. Composition Over Inheritance

Inheritance increases coupling.

Composition increases flexibility.

Instead of large inheritance trees, MAGENAIS composes behavior from small reusable services.

Example:

```
Provider

↓

Authentication

↓

Streaming

↓

Retry

↓

Rate Limiting

↓

Health Check
```

Each concern remains independent.

---

## 8. Interface-First Development

Implementation details should never leak into public APIs.

Every subsystem exposes interfaces.

Example:

```
IProvider

IRouter

IWorkflowNode

IPlugin

IAssetStorage

IProjectRepository
```

Implementations remain interchangeable.

---

## 9. Dependency Inversion

High-level modules should not depend on low-level implementations.

Both depend on abstractions.

This enables:

- testing
- mocking
- future replacement
- enterprise customization

---

## 10. Single Responsibility

Each module has exactly one responsibility.

Examples:

| Component | Responsibility |
|------------|----------------|
| Event Bus | Event delivery |
| Router | Provider selection |
| Registry | Provider registration |
| Asset Manager | Asset lifecycle |
| Project Manager | Project organization |
| Workflow Engine | Graph execution |

Responsibilities must never overlap unnecessarily.

---

## 11. Progressive Enhancement

Everything should work locally first.

Cloud services extend functionality.

Never replace local functionality.

Examples:

Local:

- Prompt Library
- Projects
- Assets
- IndexedDB

Optional Cloud:

- Sync
- Collaboration
- Marketplace
- Remote Compute

---

## 12. Offline-First

Internet connectivity should not be assumed.

Users must still be able to:

- browse projects
- manage assets
- edit workflows
- use local models
- prepare prompts

Offline functionality is a first-class requirement.

---

## 13. Lazy Loading

Nothing should load before it is needed.

Candidates include:

- Providers
- Studios
- Themes
- Plugins
- Workflow Nodes
- Documentation

Benefits:

- faster startup
- smaller bundles
- lower memory usage

---

## 14. Asynchronous by Default

AI operations are inherently asynchronous.

Every major subsystem should support:

- async execution
- cancellation
- progress reporting
- retries
- streaming

Blocking operations should be avoided.

---

## 15. Security by Design

Security is designed into the architecture.

Not added later.

Requirements include:

- permission-based plugins
- CSP compatibility
- WebCrypto integration
- secure API key storage
- sandboxed extensions
- origin validation

---

## 16. Privacy by Default

User data belongs to the user.

MAGENAIS should never require telemetry.

Any optional analytics must be:

- transparent
- opt-in
- documented
- removable

---

## 17. Performance-Oriented Design

Performance is a feature.

Goals include:

- fast startup
- responsive UI
- low memory footprint
- incremental rendering
- efficient caching
- background processing

Performance should be measured continuously.

---

## 18. Scalability

The architecture should support growth without redesign.

Target scale:

- 200+ AI Providers
- 100+ Studios
- 500+ Workflow Nodes
- 1,000+ Plugins
- Millions of Assets
- Thousands of Projects

Growth should occur through modular expansion rather than Kernel modification.

---

## 19. Backward Compatibility

Existing user projects should continue to function after upgrades.

Breaking changes require:

- migration tools
- compatibility layers
- version detection
- documentation

---

## 20. Developer Experience

Developers are first-class users.

The platform should prioritize:

- clear APIs
- strong typing
- predictable behavior
- excellent documentation
- comprehensive testing
- fast feedback loops

A great architecture enables great contributors.

---

# Architectural Priorities

When principles conflict, follow this order:

1. Correctness
2. Security
3. Simplicity
4. Extensibility
5. Performance
6. Developer Experience
7. Feature Completeness

---

# Decision Checklist

Before introducing a new feature, ask:

- Does it increase coupling?
- Can it be a plugin instead?
- Can it be event-driven?
- Does it belong in the Kernel?
- Is it browser compatible?
- Can it work offline?
- Is it provider independent?
- Does it preserve backward compatibility?

If the answer to multiple questions is "No", reconsider the design.

---

# Summary

These principles are the architectural constitution of MAGENAIS.

They guide not only today's implementation but also the platform's evolution over the coming years.

Every subsystem described in the following documents builds upon these foundations.

---

**Next Document**

→ `03-runtime.md`
