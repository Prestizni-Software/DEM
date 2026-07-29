# Project Guidelines & Memory

Welcome to the DEM Project. This file serves as the root of the project's memory and operational guidelines.

## Core Mandates

1.  **GEMINI Files First**: Every time, look first through all `GEMINI` files before examining the code to find architectural information, workflows, or logic explanations.
2.  **Continuous Learning**: When learning new information or not finding something in the `GEMINI` files, create an entry about it.
3.  **Modular Memory**: If a finding is complex, create a dedicated `GEMINI_<TOPIC>.md` file and link it here in the Knowledge Index.
4.  **Verification**: Whenever you change anything:
    - Run `npx tsc` to verify that no compilation errors have been made.
    - Run `npm run test_for_AI` to confirm all functionality was preserved.
    - If tests fail, run `npm test` for more info and fix the failing tests.
5.  **Type Safety**: NEVER (only if very necessary) use `as any`. All types should be working correctly.
6.  **Test Coverage**: When adding or fixing a feature, check for existing tests. If none exist, create them.

## Version Control Workflow

1.  **Pre-Work Commit**: Always commit all changes before starting new work with a clear description and the suffix `--pre GEMINI`.
    - Example: `git add .; git commit -m "Description of current state --pre GEMINI"`
2.  **Final Commit**: After completing a task or after consultation, commit the changes with the suffix `--GEMINI`.
    - Example: `git add .; git commit -m "Description of changes --GEMINI"`

## Knowledge Index

- [DEM Loading Process](./GEMINI_LOADING.md) - Detailed analysis of how objects and references are initialized and synchronized, including performance optimizations for recursion and parallelization.
- [Client Population Bypass](./GEMINI_CLIENT_POPULATION.md) - Documentation on the architectural change to ship fully populated objects to the client and bypass client-side reference population logic.
- [DEM Object Creation & Browser Safeguards](./GEMINI_CREATE_OBJECT.md) - Analysis of client-side createObject execution, socket ACK loss safeguards, payload serialization, and Edge browser failure modes.

## General Rules
- Prefer Vanilla CSS for web components.
- Do not stage or commit changes unless explicitly requested by the user (except for the mandatory --pre and --GEMINI commits).

