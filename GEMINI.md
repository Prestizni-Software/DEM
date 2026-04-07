# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Release**: `npm run release` (builds both client and server)
- **Release Client Only**: `npm run release_client`
- **Release Server Only**: `npm run release_server`
- **Run Tests**: `npm test`
- **Type Check**: `tsc --noEmit`

## Project Structure

This is a TypeScript library for real-time data synchronization using Socket.io with automatic reference resolution and caching.

### Core Concepts

1. **AutoUpdatedClientObject**: Base class for client-side objects that automatically sync with server
   - Uses decorators `@classProp` and `@classRef()` to define properties and relationships
   - Handles automatic reference loading and circular dependency resolution
   - Provides getter/setter proxies for seamless property access

2. **AutoUpdateManager**: Manages collections of AutoUpdatedClientObject instances
   - Handles batch loading from server via WebSocket events
   - Manages reference caching between different object types
   - Provides CRUD operations with automatic sync

3. **Metadata System**: Uses Reflect.defineMetadata to store property information
   - `@classProp` marks a property for synchronization
   - `@classRef()` marks a property as a reference to another object type
   - `populatedRef("ClassName:propertyPath")` defines bidirectional relationships

### Key Files

- `AutoUpdatedClientObjectClass.ts` - Base client object implementation
- `AutoUpdatedServerObjectClass.ts` - Extended Server variation of the base object implementation
- `AutoUpdateManagerClass.ts` - Base manager implementation  
- `AutoUpdateClientManagerClass.ts` - Client-specific manager with factory
- `AutoUpdateServerManagerClass.ts` - Server-specific manager with factory
- `CommonTypes.ts` - Shared types and decorator functions
- `test_lib.ts` - Test setup utilities for client/server initialization
- `tests/dem.test.ts` - End-to-end tests demonstrating usage
- `client.ts` - Example client implementation
- `server.ts` - Example server implementation
- `socket_test.ts` - Socket.io connection testing
- `TestTypes.ts` - Shared test constants and enums
- `ServerTypes.ts` - Server-specific type definitions
- `ClientTypes.ts` - Client-specific type definitions

### Common Patterns

1. **Defining Synchronized Classes**:
```typescript
export class MyClass extends AutoUpdatedClientObject<MyType> {
  @classProp
  public _id!: string;
  
  @classProp
  public name!: string;
  
  @classProp
  @classRef()
  public parent!: ParentClass | null;
  
  @classProp
  @classRef()
  public children!: ChildClass[];
}
```

2. **Creating Managers**:
```typescript
const managers = await AUCManagerFactory({
  MyClass: MyClass
}, loggers, socket);
```

3. **Accessing Data**:
```typescript
// Get object by ID
const obj = managers.MyClass.getObject("some-id");

// Access properties (getters handle reference resolution automatically)
console.log(obj.name); // Direct property
console.log(obj.parent?.name); // Reference property - auto-loaded

// Set properties (triggers automatic sync)
await obj.setValue("name", "new value");
await obj.setValue("parent", someParentObject);
```

### Testing

Tests use a real MongoDB instance and Socket.io server:
- Initialize with `initServerManagers()` and `initClientManagers()`
- Objects created on server automatically sync to connected clients
- Reference properties are automatically resolved and loaded
- Bidirectional updates are handled through WebSocket events

### Build Process

- Uses TypeScript with `emitDecoratorMetadata` and `experimentalDecorators` enabled
- Outputs to `./dist` directory
- Supports both CommonJS and ES module formats
- Declaration files are generated for type safety

### Debugging Tips

- Object loading progress is tracked via manager callbacks
- Reference loading errors are logged with full stack traces
- Circular reference detection prevents infinite loops
- WebSocket events are prefixed with class names (e.g., "newMyClass", "updateMyClass-id")

### Important Notes

**Everything in the root folder is important**:
- Source files (.ts) contain the core implementation
- Test files demonstrate usage patterns and should be referenced when understanding the library
- Configuration files (package.json, tsconfig.json) are essential for building and testing
- The dist/ folder contains compiled output but should not be modified directly

When working with this codebase, always check both client and server implementations as they work together to provide the synchronization functionality.