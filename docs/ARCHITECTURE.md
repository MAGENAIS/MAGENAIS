# MAGENAIS Architecture

> **Version:** 2.2 (Living Architecture)
>
> **Status:** Active
>
> **Audience:** Contributors, Plugin Developers, Provider Developers, Core Maintainers, AI Researchers
>
> This document defines the architectural foundation of MAGENAIS. It serves as the single source of truth for the design, implementation, evolution, and governance of the platform.

---

# Table of Contents

1. Introduction
2. Vision
3. Architecture Principles
4. System Goals
5. Design Philosophy
6. High-Level Architecture
7. Architectural Layers
8. Core Kernel
9. Runtime
10. Event Bus
11. State Manager
12. Storage Manager
13. Provider Registry
14. Smart Provider Router
15. Workflow Engine
16. Plugin System
17. Extension API
18. Studio Architecture
19. Project & Asset Management
20. Security Architecture
21. Performance Strategy
22. Scalability
23. Deployment Architecture
24. Migration Strategy
25. Future Evolution

---

# Introduction

MAGENAIS is not a chatbot.

It is not a prompt interface.

It is not simply another AI web application.

MAGENAIS is designed as a **Browser-First Artificial Intelligence Operating System**—a modular platform that unifies AI models, providers, workflows, plugins, assets, and projects into a cohesive development environment.

The architecture is inspired by modern extensible platforms such as:

- Visual Studio Code
- ComfyUI
- Langflow
- OpenWebUI
- Blender
- Figma
- Obsidian
- Kubernetes
- Electron

while remaining lightweight enough to run entirely inside a modern web browser.

---

# Vision

The long-term vision of MAGENAIS is to become a universal operating environment for Artificial Intelligence.

Instead of requiring users to switch between dozens of AI services, MAGENAIS provides a unified platform where providers, workflows, and tools coexist behind a consistent interface.

Every AI capability becomes a modular component.

Every workflow becomes reusable.

Every provider becomes interchangeable.

Every extension can expand the platform without modifying the core.

---

# Core Philosophy

The architecture is guided by one fundamental principle:

> **The Core Never Knows the Details.**

The Kernel defines contracts.

Modules implement contracts.

Providers implement contracts.

Plugins implement contracts.

Everything communicates through abstractions rather than concrete implementations.

This enables continuous evolution without destabilizing the platform.

---

# Architecture Principles

## Browser First

MAGENAIS is designed to execute entirely within the browser whenever possible.

The browser is treated as the primary runtime—not a limited fallback.

Capabilities include:

- Local storage
- IndexedDB
- Web Workers
- WebAssembly
- Streaming APIs
- File System Access API
- Media APIs
- Canvas/WebGL
- Service Workers

No backend is required for the core experience.

---

## Extensibility First

Every major subsystem is designed as an extension point.

Examples include:

- AI Providers
- Plugins
- Workflows
- UI Panels
- Commands
- Themes
- Studios
- Exporters
- Importers
- Asset Types

The platform grows through composition rather than modification.

---

## Provider Agnostic

MAGENAIS does not depend on any specific AI provider.

OpenAI is not privileged.

Claude is not privileged.

Gemini is not privileged.

Every provider implements the same capability interfaces, allowing seamless replacement or combination.

---

## Workflow Native

Automation is a core capability.

Workflows are treated as first-class entities rather than optional features.

Every operation can become part of a reusable workflow graph.

---

## Event Driven

Subsystems never communicate directly.

Instead, they publish and subscribe to events through the Event Bus.

This minimizes coupling and simplifies extensibility.

---

## Offline Capable

Core functionality remains available without network connectivity.

Projects, assets, workflows, prompts, and settings are stored locally and synchronized only when requested.

---

## Progressive Enhancement

MAGENAIS adapts to the execution environment.

Basic browsers receive the essential experience.

Modern browsers unlock advanced capabilities such as GPU acceleration, streaming, and local AI execution.

---

# System Goals

The architecture is designed to support:

- 200+ AI Providers
- 100+ Plugins
- Unlimited Projects
- Large Asset Libraries
- Complex Workflow Graphs
- Browser Deployment
- GitHub Pages Hosting
- Future Desktop Packaging
- Mobile Compatibility
- Collaborative Features

without requiring architectural redesign.

---

# High-Level Architecture

```text
                         +----------------------+
                         |      User Interface  |
                         +----------+-----------+
                                    |
                                    ▼
                          +----------------------+
                          |        Kernel        |
                          +----------+-----------+
                                     |
         +---------------------------+---------------------------+
         |                           |                           |
         ▼                           ▼                           ▼
 +---------------+         +----------------+         +------------------+
 |   Event Bus   |         |  State Manager |         | Storage Manager  |
 +---------------+         +----------------+         +------------------+
         |                           |                           |
         +-------------+-------------+-------------+-------------+
                       |                           |
                       ▼                           ▼
              +------------------+       +----------------------+
              | Provider Registry|       |  Workflow Engine     |
              +--------+---------+       +----------+-----------+
                       |                            |
                       ▼                            ▼
              +------------------+       +----------------------+
              | Smart Router     |       | Plugin Runtime       |
              +--------+---------+       +----------+-----------+
                       |                            |
        +--------------+--------------+             |
        |              |              |             |
        ▼              ▼              ▼             ▼
   OpenAI          Claude         Gemini      Community Plugins
   Ollama         DeepSeek       Mistral      Extensions
```

---

# Architectural Layers

The system is organized into independent layers.

```text
Presentation Layer

↓

Application Layer

↓

Kernel Layer

↓

Runtime Layer

↓

Infrastructure Layer

↓

Provider Layer

↓

Storage Layer
```

Each layer communicates only through stable interfaces.

No layer depends directly on implementation details of lower layers.

This separation ensures maintainability, testability, and long-term scalability.

---

# Design Characteristics

The architecture emphasizes:

- Loose Coupling
- High Cohesion
- Dependency Injection
- Event-Driven Communication
- Lazy Loading
- Dynamic Module Resolution
- Capability-Based APIs
- Immutable State
- Predictable Data Flow
- Progressive Enhancement
- Plugin Isolation
- Provider Independence
- Browser Performance
- Security by Default
- Future-Proof Extensibility

---

> **Architecture Rule #1:** The Kernel owns the platform, but knows nothing about providers or plugins.

> **Architecture Rule #2:** Every feature is replaceable.

> **Architecture Rule #3:** Every module communicates through contracts.

> **Architecture Rule #4:** The browser is the primary operating environment.

> **Architecture Rule #5:** Extensibility always takes precedence over short-term convenience.
