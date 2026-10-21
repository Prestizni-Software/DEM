# AI Agent Guidelines & Operating Instructions

This file defines the mandatory operating guidelines and instructions for AI agents working on this codebase.

---

## 1. Core Mandates for AI Agents

1. **Consult Documentation First**:
   - Inspect files in the `docs/` directory before examining or modifying unfamiliar code.
   - Read the architectural guides to understand system invariants and protocols.

2. **Maintain Documentation**:
   - Keep root `README.md` synchronized with features, API changes, and architecture updates.
   - Keep all documentation in `docs/` synchronized with code changes.
   - Create a new document in `docs/` whenever you introduce a significant architectural change or feature.
   - Update `docs/README.md` when adding a new document.

3. **Single-Repository Release Workflow & Versioning**:
   - The release process is unified in `scripts/release.js`.
   - Never synchronize or deploy to external repositories (`../client`, `../server`).
   - Run `node scripts/release.js [both|client|server] [patch|minor|major] [-m "description"]`.
   - Client package is `@prestizni-software/client-dem` without `@typegoose/typegoose`.
   - Server package is `@prestizni-software/server-dem`.
   - Versions are tracked in `version.ts` as `DEM_CLIENT_VERSION` and `DEM_SERVER_VERSION`.
   - Compatibility rule: All patches are compatible. Incompatible breaking changes require incrementing the middle (minor) version number.
   - Handshake rule: The client sends `clientVersion` on handshake (`startup<ClassName>`). If the version differs and is incompatible (different minor or major), the connection is rejected.
   - AI Agent rule: Whenever you introduce an incompatible breaking change to protocol or APIs, automatically bump the middle (minor) version number in `version.ts`.
   - Releases run all tests automatically and commit a dedicated version bump with an automated or provided title.

4. **Verification Protocol**:
   - Run `npx tsc --noEmit` to verify type safety and compilation.
   - Run `npm run test_for_AI` to ensure full test suite passes.
   - If tests fail, run `npm test` for detailed diagnostics and fix failing tests.

5. **Type Safety Standard**:
   - Never use `as any` unless strictly necessary.
   - Maintain explicit types across all interfaces and functions.

6. **Test Coverage & Test-Driven Fixes**:
   - All bug fixes must begin with a reproduction test.
   - Ensure the test fails before applying the fix.
   - Do not claim completion until the test passes.
   - Add tests for new features.

7. **In-Code Documentation Mandate**:
   - Provide complete JSDoc documentation for every function, method, and class.
   - Specify descriptions, `@param` tags, `@returns` tags, and `@throws` tags.
   - Keep all in-code comments and JSDoc blocks updated whenever changing functions.

---

## 2. Version Control Workflow

1. **Pre-Work Commit**:
   - Commit existing working state before starting modifications.
   - Use the commit message format: `<Description> --pre GEMINI`.

2. **Final Commit**:
   - Commit completed work after verification passes.
   - Use the commit message format: `<Description> --GEMINI`.

---

## 3. General Implementation Rules

- Prefer Vanilla CSS for web components.
- Do not stage or commit files unless completing mandatory `--pre GEMINI` or `--GEMINI` workflow steps.
- Socket listeners registered in `AutoUpdateServerManagerClass.ts` whitelist dynamic incoming events via `socket.eventNames()`. Do not remove them.

---

## 4. Agent skills

### Issue tracker

Issues and specifications exist in GitHub Issues with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five standard triage roles map to issue labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repository layout (`GLOSSARY.md` and `docs/adr/` at repository root). See `docs/agents/domain.md`.

