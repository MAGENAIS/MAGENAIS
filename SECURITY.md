# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in MAGENAIS, please report it
privately rather than opening a public issue — responsible disclosure gives
us time to prepare a fix before it becomes public knowledge.

- Describe the vulnerability and the steps to reproduce it.
- Include the affected version/commit if known.
- We aim to acknowledge reports within a reasonable timeframe and to keep you
  updated as a fix is developed.

## Scope

MAGENAIS runs entirely client-side by default — API keys you enter are stored
in your browser's local storage and are only ever sent directly to the
provider you configured them for. See
[`docs/architecture/SECURITY.md`](docs/architecture/SECURITY.md) for the full
security model (Zero Trust, Least Privilege, browser-first execution).

## Supported Versions

Security fixes are applied to the latest release on the `main` branch.

## API Key Storage

MAGENAIS never ships API keys with the source code.

API keys are stored only in the user's local browser storage and are never transmitted to GitHub.

Users are encouraged to clear stored credentials before sharing browser profiles or exported settings.
