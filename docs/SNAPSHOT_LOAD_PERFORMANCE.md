# Snapshot Load Performance Plan

## Evidence

Source: two Firefox Profiler captures of the `ukolnicek-geodeta` web app.

| Finding | Measured cost |
| --- | --- |
| `saveSnapshot` reads the `extractedData` getter. The getter runs `_.cloneDeep`. | 150–300 ms |
| `hydrateManagersFromSnapshot` constructs all objects. | about 100–160 ms |
| App waits for `requestDeltaSync` before it publishes the handler. | about 4 s idle (app code) |
| localStorage `getItem` and `JSON.parse`. | about 26 ms (not a problem) |

The 4 s wait is in the application. The library must give the application the tools to avoid it.

## Scope

Four parts. Execute them in order. Each part starts with a failing test.

### Part 1: Snapshot serialization API

- Add `ClientStateReconciler.serializeState(manager, revision)`.
- Return a `StoredManagerState`.
- Read `getRawExtractedData()`. Do not call the cloning `extractedData` getter.
- Keep lazy stubs as stubs.
- Make `persistToStorage` call `serializeState`.
- Document the cost of the `extractedData` getter in its JSDoc.
- Test: an object whose `extractedData` getter throws must serialize without error.

### Part 2: Shared snapshot hydration API

- Add `ClientStateReconciler.restoreFromState(manager, state)`.
- It is synchronous. It needs no storage adapter.
- Make `restoreFromStorage` load the state, then call `restoreFromState`.
- Applications can then hydrate from their own snapshot with the same code path.
- Test: hydrate a manager from a state object. Verify objects, counters, `isLoaded_` and `globalCache`.

### Part 3: Lower constructor cost

- Replace the per-object `Promise.resolve().then` with one batched microtask for all new objects.
- Keep the same timing: the cleanup still runs after the derived constructors.
- Build the per-object `loggers` object lazily on first use.
- Do not change socket listener registration. A lazy listener could lose live updates.
- Test: constructing N objects schedules one microtask. Accessors still work after the microtask.
- Measure construction time before and after with a benchmark test.

### Part 4: Stale-while-revalidate load

- Add `ClientStateReconciler.restoreAndRevalidate(manager, storageAdapter, fetchDelta)`.
- Restore from storage first. Return at once with `restored`, `revision`, `count`.
- Return a `revalidation` promise in the same result.
- The promise calls `fetchDelta(revision)`, then applies the payload.
- A `full` status or a failure makes the promise resolve with `fullResyncRequired: true`.
- The caller decides how to load the full data.
- Test: the result returns before `fetchDelta` resolves. A late delta updates the objects.

## Application follow-up (`ukolnicek-geodeta`, outside this repo)

1. Publish `DB_HANDLER` after hydration. Run the delta sync in the background.
2. Read `getRawExtractedData()` in `saveSnapshot`. Run it in idle time.
3. Replace the 200 ms `SocketConnectionReady` polling with an event.
4. Profile the SharedWorker thread to find the cause of the delta round trip time.

## Versioning

All four parts add methods only. They are compatible. Release as a patch.

## Verification

1. `npx tsc --noEmit`
2. `npm run test_for_AI`
