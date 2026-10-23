# F03: Reference Array Proxy & Mutation Interception

## 1. Description
Wraps relational array properties in JavaScript Proxy handlers.
Intercepts array mutation methods to preserve back-references and foreign key integrity.
Prevents uncoordinated array operations from desynchronizing relationships.

## 2. Core Components
- `createReadOnlyArrayProxy`: Constructs Proxy interceptor for reference arrays.
- `DEM_RAW_ARRAY`: Unique symbol providing access to underlying scalar identifier arrays.
- `MUTATING_ARRAY_METHODS`: Trapped methods including `push`, `pop`, `splice`, `shift`, `unshift`.
- `createdWithParent`: Back-reference synchronization hook linking child objects to parents.

## 3. Operational Rules
- Trap mutating array operations to update internal identifier lists.
- Synchronize child foreign keys when elements are inserted into parent arrays.
- Clear child foreign keys when elements are removed from parent arrays.
- Access raw identifier arrays via the `DEM_RAW_ARRAY` symbol for serialization.

## 4. Key Interfaces
- `DEM_RAW_ARRAY`: Unique symbol token retrieving the unwrapped identifier array.
- `MUTATING_ARRAY_METHODS`: Set of trapped array prototype functions.

## 5. Edge Cases
- Invoking `splice` with multiple element insertions and deletions simultaneously.
- Direct array index assignments bypassing method calls require accessor traps.
- Rapid successive pushes must not generate duplicate socket mutation requests.
