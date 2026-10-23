# F01: Model Property Reflection & Accessor Generation

## 1. Description
Provides metadata reflection and accessor generation for entity models.
Inspects `@classProp` annotations to construct getter and setter properties.
Supports dynamic property registration at runtime.

## 2. Core Components
- `@classProp` decorator: Registers target property into reflection metadata.
- `setupClassAccessors`: Generates getter and setter pairs for prototype properties.
- `registerDynamicProperty`: Appends unannotated dynamic fields to entity schemas.
- `extractedData`: Extracts normalized raw data payloads with dereferenced identifiers.

## 3. Operational Rules
- Decorate entity fields with `@classProp` to generate reactive accessors.
- Getter accessors retrieve values directly from internal `data` stores.
- Setter accessors invoke internal update routines when modified.
- Include `_id` in extracted data payloads regardless of class property decorators.

## 4. Key Interfaces
- `Paths<T>`: Type-safe property path resolution.
- `PathValueOf<T, K>`: Resolved value type for nested entity keys.
- `ExtractedData<T>`: Serialized representation of entity state without live object pointers.

## 5. Edge Cases
- Properties missing reflection decorators return raw undefined or bypass reactivity.
- Deeply nested properties require recursive path navigation.
- Dynamic properties added after initialization require explicit accessor generation.
