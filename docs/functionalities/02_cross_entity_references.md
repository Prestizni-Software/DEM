# F02: Cross-Entity Relationship Resolution

## 1. Description
Resolves relational pointers between independent entity managers.
Replaces scalar foreign keys with live object instances across client and server stores.
Maintains relational integrity in directed graph structures.

## 2. Core Components
- `@populatedRef(className)`: Annotates relational links to target manager classes.
- `globalCache`: Central entity registry mapping object identifiers across managers.
- `loadReferences`: Cross-manager resolution routine populating relational object instances.
- `loadMissingReferences`: Identifies and links unpopulated foreign key pointers.

## 3. Operational Rules
- Register target entity classes in `globalCache` prior to reference resolution.
- Resolve references only after all dependent managers complete initialization.
- Return null or undefined when referenced identifiers do not exist.
- Prevent infinite recursion during circular graph traversal using visited sets.

## 4. Key Interfaces
- `populatedRef(className: string)`: Property decorator registering foreign entity relationships.
- `loadMissingReferences(): Promise<void>`: Asynchronous resolution for pending relation pointers.

## 5. Edge Cases
- Missing target entities must resolve gracefully without throwing runtime null pointer exceptions.
- Circular references (Entity A pointing to Entity B and vice versa) require visited checks.
- Deleted target entities must trigger pointer invalidation in referencing parent entities.
