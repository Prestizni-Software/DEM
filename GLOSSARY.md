# DEM Domain Glossary

Core concepts and domain language for the Data Exchange Manager (DEM) framework.

## Hydration & Loading

**Eager Hydration**:
Complete instantiation and reference resolution of all managed entities during startup.
_Avoid_: Full preload, eager sync

**Smart Lazy Loading**:
On-demand retrieval and graph resolution of entity records up to a designated reference depth.
_Avoid_: Partial loading, lazy evaluation

**Hydration Depth**:
The integer count of reference graph traversals resolved during entity hydration.
_Avoid_: Hop count, link level

**Manifest Descriptor**:
A human-readable summary string generated from direct entity attributes for unhydrated records.
_Avoid_: Label, preview, snippet

## Entity Models

**Self-Contained Entity**:
A standard entity class defined with `@classProp` and without `@populatedRef`, presenting raw embedded snapshot data directly.
_Avoid_: Static object, dead object, dummy object

## Entity Mutation & Arrays

**DEMArray**:
A reactive array wrapper managing entity array properties. It intercepts mutating operations to await asynchronous server persistence while preserving synchronous query methods.
_Avoid_: Array proxy, dynamic array, async array

**Pessimistic Mutation**:
An operational pattern where entity state modifications in local memory occur only after the server acknowledges successful persistence.
_Avoid_: Synchronous commit, optimistic lock, server-first write

**Element-Anchored Mutation**:
An array mutation referencing unique element identifiers rather than numeric indices to eliminate index-drift under concurrency.
_Avoid_: Positional mutation, blind splice

**Canonical Array State**:
The authoritative array state persisted and resolved by the server, returned to mutating clients and broadcast to peers.
_Avoid_: Master array, server array
