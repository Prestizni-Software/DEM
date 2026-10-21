# DEM Documentation Index

This directory contains architectural documentation and technical guides for the DEM project.

---

## Technical Specifications & Guides

- [Delta Sync Guide](./DELTA_SYNC.md) - Implementer guide, runtime state inspection, configuration options, and storage adapters.
- [Delta Sync Architecture](./DELTA_SYNC_ARCHITECTURE.md) - Modular change tracking, monotonic revisions, and pruning engine.
- [Database State & Error Architecture](./ERRORS_AND_DB_STATE.md) - Database pre-load state verification, DEMError class, and error codes.
- [Object Loading Process](./LOADING_PROCESS.md) - Object loading, reference resolution, parallelization, and recursion safeguards.
- [Client Population Bypass](./CLIENT_POPULATION.md) - Server-side population architecture and client-side bypass optimizations.
- [Object Creation & Safeguards](./CREATE_OBJECT.md) - Client `createObject` lifecycle, ACK loss resilience, and browser safeguards.
- [Performance Optimization](./PERFORMANCE_OPTIMIZATION.md) - Startup optimization benchmarks, profiling results, and fast shapes.
- [Dynamic Permissions & Concurrency](./DYNAMIC_PERMISSIONS.md) - Startup middleware permissions and writeQueue deadlock prevention.
- [Comprehensive Progress Report](./PROGRESS_REPORT.md) - Audit history, issue resolution log, and test verification summary.
- [Single-Repository Release Workflow](./RELEASE_WORKFLOW.md) - Unified build, automated testing, version bump, and tagging workflow.
- [Source Restoration Log](./RESTORATION_LOG.md) - Historical incident log and codebase reconstruction analysis.
- [Agent Skills: Issue Tracker](./agents/issue-tracker.md) - GitHub issue tracker conventions, CLI workflow, and wayfinder operations.
- [Agent Skills: Triage Labels](./agents/triage-labels.md) - Canonical triage roles and repository label mappings.
- [Agent Skills: Domain Documentation](./agents/domain.md) - Domain documentation consumption rules, layout, and ADR conflict flags.
- [Domain Glossary](../GLOSSARY.md) - Core domain terminology and entity definitions.
- [ADR 0001: Smart Lazy Loading & Static Snapshots](./adr/0001-smart-lazy-loading-and-static-snapshots.md) - Architectural decision for lazy manifests, depth resolution, and raw references.
