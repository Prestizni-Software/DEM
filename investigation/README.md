# DEM Investigation & Defect Audit Report

## 1. Directory Structure

- [`README.md`](file:///E:/destop/_data/projects/DEM/src/investigation/README.md): Entrypoint index and payout accounting ledger.
- [`GIT_HISTORY_ANALYSIS.md`](file:///E:/destop/_data/projects/DEM/src/investigation/GIT_HISTORY_ANALYSIS.md): Root-cause chronology across DEM and consumer mobile project git commits.
- [`UNCERTAINTIES.md`](file:///E:/destop/_data/projects/DEM/src/investigation/UNCERTAINTIES.md): Analysis of borderline defects and architectural risks ($10 bounty review).
- [`bugs/`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs): Detailed defect specifications and markdown solution blocks.
  - [`BUG_01_SERVER_DELETE_OBJECT_BYPASS.md`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_01_SERVER_DELETE_OBJECT_BYPASS.md)
  - [`BUG_02_HARDCODED_24_CHAR_ID_DROP.md`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_02_HARDCODED_24_CHAR_ID_DROP.md)
  - [`BUG_03_CLIENT_DELETE_ECHO_STORM.md`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_03_CLIENT_DELETE_ECHO_STORM.md)
  - [`BUG_04_DELETE_CALLBACK_MANAGER_INSTANCE.md`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_04_DELETE_CALLBACK_MANAGER_INSTANCE.md)
  - [`BUG_05_CLIENT_LISTENER_LEAK_ON_RECONNECT.md`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_05_CLIENT_LISTENER_LEAK_ON_RECONNECT.md)
  - [`BUG_06_LAZY_STUB_DUPLICATE_LISTENERS.md`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_06_LAZY_STUB_DUPLICATE_LISTENERS.md)
  - [`BUG_07_SERVER_SETVALUE_DOTTED_KEY.md`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_07_SERVER_SETVALUE_DOTTED_KEY.md)
  - [`BUG_08_CLIENT_SETVALUE_UNDEFINED_INTERMEDIATE.md`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_08_CLIENT_SETVALUE_UNDEFINED_INTERMEDIATE.md)
  - [`BUG_09_GETRAWID_ARRAY_CORRUPTION.md`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_09_GETRAWID_ARRAY_CORRUPTION.md)
  - [`BUG_10_SERVER_LAZY_GRAPH_UNHYDRATED_DROP.md`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_10_SERVER_LAZY_GRAPH_UNHYDRATED_DROP.md)
  - [`BUG_11_SERVER_EXTRACTED_DATA_MUTABLE_REF.md`](file:///E:/destop/_data/projects/DEM/src/investigation/bugs/BUG_11_SERVER_EXTRACTED_DATA_MUTABLE_REF.md)
- [`tests/investigation/bugs_reproduction.test.ts`](file:///E:/destop/_data/projects/DEM/src/tests/investigation/bugs_reproduction.test.ts): Automated reproduction test suite (11 failing tests).

---

## 2. Bounty Accounting Ledger

Pricing formula: Low = $50. Medium = $100. High = $200. Critical = $400. Solution bonus = +50%.

| Bug ID | Title | Severity | Base Bounty | Solution Bonus (+50%) | Total Claim |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BUG-01** | Server deleteObject DB Deletion Bypass on Unhydrated Entities | Critical | $400 | $200 | **$600** |
| **BUG-02** | Socket Handler Hardcoded 24-Char ID Length Drops Non-Hex IDs | Critical | $400 | $200 | **$600** |
| **BUG-03** | Client deleteObject Echo Storm on Incoming Server Deletions | High | $200 | $100 | **$300** |
| **BUG-04** | callbacks.delete Receives Manager Instance Instead of Entity | High | $200 | $100 | **$300** |
| **BUG-05** | Client loadFromServer Leaks Socket Listeners on Reconnection | High | $200 | $100 | **$300** |
| **BUG-06** | Duplicate Socket Listeners Attached on Lazy Stub Hydration | Medium | $100 | $50 | **$150** |
| **BUG-07** | Server setValueInternal Creates Literal Dotted Key | High | $200 | $100 | **$300** |
| **BUG-08** | Client setValue Crashes on Undefined Intermediate Objects | Medium | $100 | $50 | **$150** |
| **BUG-09** | getRawId Corrupts Reference Arrays into Comma Strings | Low | $50 | $25 | **$75** |
| **BUG-10** | Server collectEntityGraph Ignores Unhydrated DB Relations | Critical | $400 | $200 | **$600** |
| **BUG-11** | Server extractedData Exposes Mutable Cached Object Reference | Medium | $100 | $50 | **$150** |
| **UNC-01** | Uncertainties and Architectural Edge Cases Report | Review | $10 | $0 | **$10** |
| **TOTAL** | | | **$2,360** | **$1,175** | **$3,535** |

---

## 3. Test Verification Command

Run the test command below to execute the dedicated reproduction suite:

```powershell
node --no-warnings --experimental-vm-modules node_modules/jest/bin/jest.js tests/investigation/bugs_reproduction.test.ts
```
