# Project Guidelines & Memory

Welcome to the DEM Project. This file serves as the root of the project's memory and operational guidelines.

## Core Mandates

1.  **GEMINI Files First**: Always look through all `GEMINI` files before examining the code to find architectural information or workflows.
2.  **Continuous Learning**: When learning new information or if something is missing from these files, create an entry here.
3.  **Modular Memory**: If a finding is complex, create a dedicated `GEMINI_<TOPIC>.md` file and link it here.
4.  **Verification**: After any change, run `npx tsc` and `npm run test_for_AI` to verify integrity. Use `npm test` for more verbose output if failures occur.
5.  **Type Safety**: Avoid `as any` unless absolutely necessary. Maintain strict typing.
6.  **Test Coverage**: When adding or fixing a feature, check for existing tests. If none exist, create them.

## Version Control Workflow

1.  **Pre-Work Commit**: Always commit all changes before starting new work. Use a clear description and the suffix `--pre GEMINI`.
    - Example: `git add .; git commit -m "Description of state --pre GEMINI"`
2.  **Final Commit**: After completing a task or after consultation, commit with the suffix `--GEMINI`.
    - Example: `git add .; git commit -m "Description of changes --GEMINI"`

## Knowledge Index

- [DEM Loading Process](./GEMINI_LOADING.md) - Detailed analysis of how objects and references are initialized and synchronized.

## General Rules
- Prefer Vanilla CSS for web components.
- Do not stage or commit changes unless explicitly requested.
