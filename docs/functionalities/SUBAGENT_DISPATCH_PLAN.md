# Subagent Dispatch Plan & Prompt Specification

## 1. Relevant Skills Selection

Based on analyzing available skills in the environment, the following skills match this goal:

1. **`dispatching-parallel-agents`**:
   - Manages independent, parallel subagent dispatching without shared state.
   - Ensures isolated context per problem domain.

2. **`subagent-driven-development`**:
   - Manages task execution with subagents.
   - Preserves parent context while subagents execute test implementations.

3. **`unit-testing-test-generate`**:
   - Generates comprehensive unit tests across TypeScript models and managers.
   - Emphasizes edge case discovery, assertion quality, and mock setup.

4. **`test-automator`**:
   - Enforces TDD cycles (red-green-refactor) and deep assertion rigor.
   - Validates failure modes, cycle metrics, and regression resistance.

5. **`test-driven-development`**:
   - Mandatory TDD protocol: write failing reproduction test first before applying code fixes.
   - Ensures no untested code changes enter production.

6. **`verification-before-completion`**:
   - Mandates running verification commands (`npx tsc --noEmit` and `npm run test_for_AI`).
   - Requires confirming command output before asserting completion.

---

## 2. Subagent Batching & Tasking Structure

To test all 2-way and 3-way combinations without exceeding system concurrency limits, combinations are partitioned into six focused domains:

| Subagent Task | Domain / Subsystem Focus | Key Combinations Tested | Target Test Suite |
|---|---|---|---|
| **Subagent 1** | Model Reflection, Relational Graphs & Proxies | F01, F02, F03, F11 (Pairs & Triplets) | `tests/combinations/domain1_relational_proxies.test.ts` |
| **Subagent 2** | Lifecycle, Versioning, Permissions & Handshakes | F04, F05, F12, F13 (Pairs & Triplets) | `tests/combinations/domain2_lifecycle_permissions.test.ts` |
| **Subagent 3** | Real-Time Mutation, Dynamic Sockets & CRUD | F06, F07, F14 (Pairs & Triplets) | `tests/combinations/domain3_mutation_crud_errors.test.ts` |
| **Subagent 4** | Smart Lazy Loading Combinations | F08 combined with F01-F07, F11-F14 | `tests/combinations/domain4_lazy_combinations.test.ts` |
| **Subagent 5** | Delta Sync & Monotonic Revision Combinations | F09 combined with F01-F07, F10-F14 | `tests/combinations/domain5_delta_sync_combinations.test.ts` |
| **Subagent 6** | Triplet Convergence: Lazy + Delta + Storage + Self-Contained | F08 + F09 + F10 + F11 + F13 + F14 | `tests/combinations/domain6_convergence_triplets.test.ts` |
| **Subagent 7** | DEMArray Concurrency & Ecosystem Combinations | F03 combined with F01, F02, F04-F14 (4-client concurrent writes, anchoring, lazy hydration, delta sync, clock sync) | `tests/combinations/domain7_demarray_combinations.test.ts` |

---

## 3. Standard Subagent Prompt Template

Each subagent receives the following structured prompt:

```markdown
# TASK: Implement Edge-Case Combination Tests for Domain [DOMAIN_NAME]

## 1. Domain Scope & Assigned Combinations
You are responsible for testing the following 2-way and 3-way subsystem combinations:
[LIST_OF_COMBINATIONS]

Reference documentation:
- docs/functionalities/README.md
- docs/functionalities/COMBINATIONS_MATRIX.md
- Individual subsystem files in docs/functionalities/

## 2. Applicable Skills to Follow
- unit-testing-test-generate
- test-automator
- test-driven-development
- verification-before-completion

## 3. Strict Operating Rules
1. ASD-STE100 Rules: Write all code comments and explanations using Controlled English. Max 20 words for procedural steps; max 25 words for descriptive statements.
2. TypeScript Type Integrity: Use existing project types from CommonTypes.ts, sync/types.ts, DEMErrors.ts. Never use `as any` unless strictly necessary.
3. TDD Protocol: Write tests first. Run `npx jest [TEST_PATH]`. Confirm tests run properly. If a test exposes a bug in DEM, fix the bug following TDD.
4. JSDoc Mandate: Provide complete JSDoc documentation for any newly added helper, function, or class.
5. Invariants Preservation: Do not remove dynamic socket listeners in AutoUpdateServerManagerClass.ts.

## 4. Execution Steps
1. Create dedicated test file: [TARGET_TEST_FILE]
2. Construct realistic test entities using @classProp, @populatedRef, and static descriptors.
3. Write test cases covering every assigned pairwise and triplet interaction, specifically exercising edge cases:
   - Null / undefined foreign entity references
   - Circular reference loops
   - Empty collections and missing identifiers
   - Network timeout and disconnected socket emissions
   - Permission denials and filtered change streams
   - Corrupted or unparseable local storage snapshots
4. Run `npx tsc --noEmit` to verify type safety.
5. Run `npx jest [TARGET_TEST_FILE]` and verify that all test cases pass.
6. Report results back to parent agent with exact test counts and any resolved defects.
```
