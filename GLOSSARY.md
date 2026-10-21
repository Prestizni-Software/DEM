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
