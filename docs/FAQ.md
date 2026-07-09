# Frequently Asked Questions (FAQ)

Welcome to the MAGENAIS Frequently Asked Questions.

This document answers the most common questions about the project's philosophy, architecture, development process, and future direction.

---

# General

## What is MAGENAIS?

MAGENAIS is a browser-first, open-source AI Operating System designed to unify hundreds of AI providers, plugins, workflows, and creative tools into a single extensible platform.

Unlike traditional AI applications that focus on a single model or service, MAGENAIS provides a modular operating environment for AI-powered creation, research, automation, and collaboration.

---

## What does MAGENAIS stand for?

MAGENAIS is the name of the project representing a 
**Modular AI Generation and Intelligence System**.
**Founder: Mehdi Alireza GENAI Studio**
**Linguistic and Philosophy: 
The Birth of Wisdom**

More importantly, it represents the vision of an extensible AI Operating System rather than a single AI application.

---

## Is MAGENAIS just another AI Chat application?

No.

Chat is only one capability.

MAGENAIS is designed as a complete AI platform including:

- Chat
- Image Generation
- Video Generation
- Music Creation
- Podcast Production
- Document Analysis
- Workflow Automation
- AI Agents
- Plugin Ecosystem
- Project Management
- Asset Management

---

## Why is MAGENAIS browser-first?

Modern browsers have become powerful application platforms.

Running directly inside the browser provides:

- Zero installation
- Cross-platform compatibility
- Improved security
- Easy deployment
- Offline capabilities
- GitHub Pages support
- Progressive Web App compatibility

---

# Architecture

## Why does MAGENAIS use a modular architecture?

Large AI platforms continuously evolve.

A modular architecture allows:

- Independent development
- Easier maintenance
- Plugin support
- Better testing
- Future scalability
- Community contributions

---

## Why is everything event-driven?

Direct communication between components creates tight coupling.

The Event Bus enables:

- Loose coupling
- Better scalability
- Easier debugging
- Plugin compatibility
- Future distributed execution

---

## Why is the Kernel intentionally small?

MAGENAIS follows a microkernel philosophy.

The Kernel provides only essential services.

Everything else is implemented as extensions or plugins.

This minimizes complexity while maximizing flexibility.

---

# Providers

## Which AI providers are supported?

MAGENAIS is designed to support more than 200 providers.

Examples include:

- OpenAI
- Anthropic
- Google Gemini
- DeepSeek
- Mistral
- Groq
- Together AI
- OpenRouter
- Ollama
- LM Studio
- Stability AI
- Replicate
- Novita
- ElevenLabs

Additional providers can be added without modifying the core system.

---

## Can I add my own provider?

Yes.

MAGENAIS includes a Provider SDK allowing developers to integrate custom AI services through a standardized interface.

---

## Why use a Smart Provider Router?

Different providers offer different strengths.

The Smart Router automatically selects the best provider based on:

- Capability
- Availability
- Health
- Latency
- Cost
- Context length
- User preferences

This improves reliability while reducing manual configuration.

---

# Plugins

## What is a plugin?

A plugin extends MAGENAIS without modifying the core platform.

Plugins may provide:

- New AI providers
- Workflow nodes
- Panels
- Commands
- Themes
- Studios
- Tools
- Exporters
- Importers

---

## Do plugins require recompiling MAGENAIS?

No.

Plugins are loaded dynamically through the Plugin Manager.

---

## Can plugins communicate with each other?

Yes.

Communication occurs through public APIs and the Event Bus rather than direct dependencies.

---

# Development

## Which technologies are used?

Core technologies include:

- TypeScript
- Vite
- ES Modules
- IndexedDB
- Vitest
- Playwright
- GitHub Actions

The architecture avoids unnecessary framework lock-in whenever possible.

---

## Why Vite?

Vite provides:

- Fast startup
- Instant hot reload
- Efficient production builds
- Excellent TypeScript support
- Modern ES Module workflow

---

## Can MAGENAIS run without a backend?

Yes.

Most features are designed to execute entirely inside the browser.

Cloud services are optional rather than mandatory.

---

## Does MAGENAIS support local AI models?

Yes.

Local inference engines such as Ollama and LM Studio are first-class citizens within the architecture.

---

# Security

## Are API keys stored securely?

API keys are never embedded in the source code.

They are managed through the Storage Manager and can optionally be encrypted before persistence.

---

## Can plugins access everything?

No.

Plugins execute within a permission-based security model.

Permissions may include:

- Network access
- Storage access
- Provider access
- Workflow execution
- UI contribution

Future releases will introduce stronger sandboxing.

---

# Performance

## Why lazy loading?

Loading every provider and plugin at startup would significantly increase startup time.

MAGENAIS loads components only when they are required.

---

## Does MAGENAIS support offline usage?

Yes.

Many features continue to work offline through:

- IndexedDB
- Cache API
- Progressive Web App support

Cloud providers naturally require internet connectivity.

---

# Roadmap

## What is currently being developed?

Current priorities include:

- Kernel
- Runtime
- Provider Registry
- Workflow Engine
- Plugin SDK
- Studio Framework
- Project Manager

See the Roadmap document for detailed milestones.

---

## What is the long-term vision?

The long-term vision is to build an open, modular, browser-first AI Operating System that enables developers, researchers, educators, creators, and organizations to build powerful AI applications without vendor lock-in.

---

# Contributing

## How can I contribute?

There are many ways to help:

- Report bugs
- Improve documentation
- Develop plugins
- Build providers
- Improve UI
- Write tests
- Review pull requests
- Share ideas

Every contribution is valuable.

---

## Do I need permission before contributing?

No.

Community contributions are encouraged through GitHub Issues, Discussions, and Pull Requests.

Please review the Contributing Guide before submitting changes.

---

# Licensing

## Is MAGENAIS open source?

Yes.

The project is intended to remain open source and community-driven.

Please refer to the LICENSE file for licensing details.

---

# Future

## What makes MAGENAIS different?

MAGENAIS is designed as an AI Operating System rather than an AI application.

Its goals include:

- Browser-first execution
- Modular architecture
- Provider independence
- Plugin ecosystem
- Workflow automation
- Long-term maintainability
- Open standards
- Community-driven innovation

The objective is not simply to integrate AI models, but to provide an extensible foundation for the next generation of AI-powered software.

---

# Still Have Questions?

If your question is not answered here:

- Open a GitHub Issue
- Start a GitHub Discussion
- Read the documentation in the `docs/` directory

We welcome questions, ideas, feedback, and contributions from the entire community.

Together, we are building the future of an open AI Operating System.
