# Contributing to MAGENAIS

Thanks for your interest in contributing! This file covers the short version —
for the full engineering guidelines (coding standards, branching, review
process, release cadence) see [`docs/development/CONTRIBUTING.md`](docs/development/CONTRIBUTING.md).

## Getting started

```bash
git clone <your fork>
cd MAGENAIS
npm install
npm run dev
```

## Before opening a pull request

- Run `npm run build` and make sure it succeeds with zero TypeScript errors.
- Keep changes focused — one logical change per pull request.
- Describe *what* changed and *why* in the PR description.
- Follow the existing code style (see [`docs/development/CODING_STANDARDS.md`](docs/development/CODING_STANDARDS.md)).

## Reporting bugs / requesting features

Use the issue templates under [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/).

## Code of Conduct

Participation in this project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
