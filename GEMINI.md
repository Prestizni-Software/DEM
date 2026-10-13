# AI Agent Guidelines & Operating Instructions

This file defines the mandatory operating guidelines and instructions for AI agents working on this codebase.

---

## 1. Core Mandates for AI Agents

1. **Consult Documentation First**:
   - Inspect files in the `docs/` directory before examining or modifying unfamiliar code.
   - Read the architectural guides to understand system invariants and protocols.

2. **Maintain Documentation**:
   - Keep all documentation in `docs/` synchronized with code changes.
   - Create a new document in `docs/` whenever you introduce a significant architectural change or feature.
   - Update `docs/README.md` when adding a new document.

3. **Keep Release Scripts Synchronized**:
   - Whenever you add a new file to the codebase, update `scripts/release.js` immediately.
   - Add client-bound files to `clientFiles`.
   - Add server-bound files to `serverFiles`.

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
