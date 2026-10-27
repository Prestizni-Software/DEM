import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import { AutoUpdatedServerObject } from "../AutoUpdatedServerObjectClass.js";
import { AutoUpdateClientManager } from "../AutoUpdateClientManagerClass.js";
import {
  globalCache,
  DEMError,
  DEMErrorCode,
  DEMArray,
  LoggersType,
  EVENT_UPDATE,
  DEMArrayMutationRequest,
  DEMArrayMutationResponse,
} from "../CommonTypes.js";
import { ServerChangeTracker } from "../sync/ServerChangeTracker.js";

/**
 * Interface representing a mock socket for event routing.
 */
interface IMockSocket {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler?: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
  trigger: (event: string, ...args: unknown[]) => void;
  handlers: Record<string, ((...args: unknown[]) => void)[]>;
}

/**
 * Creates an event-driven mock socket for bidirectional test communication.
 *
 * @returns Initialized mock socket object.
 */
function makeMockSocket(): IMockSocket {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    on: (event: string, handler: (...args: unknown[]) => void): void => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
    },
    off: (event: string, handler?: (...args: unknown[]) => void): void => {
      if (!handler) {
        delete handlers[event];
      } else if (handlers[event]) {
        handlers[event] = handlers[event].filter((h) => h !== handler);
      }
    },
    emit: (event: string, ...args: unknown[]): void => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        cb({ success: true, message: "OK" });
      }
    },
    trigger: (event: string, ...args: unknown[]): void => {
      const targetHandlers = handlers[event];
      if (targetHandlers) {
        for (const handler of targetHandlers) {
          handler(...args);
        }
      }
    },
    handlers,
  };
}

/**
 * Computes the arithmetic mean of a numeric array.
 *
 * @param values - Array of numeric samples.
 * @returns Arithmetic mean of values.
 */
function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((total, val) => total + val, 0);
  return sum / values.length;
}

/**
 * Computes a canonical content hash string from an array of elements.
 *
 * @param items - Array of elements to hash.
 * @returns Comma-delimited content hash representation.
 */
function calculateContentHash(items: readonly unknown[]): string {
  return items
    .map((item) => {
      if (item && typeof item === "object" && "_id" in item) {
        return String((item as { _id: unknown })._id);
      }
      return String(item);
    })
    .join(",");
}

/**
 * Mock entity class representing a task child in relational arrays.
 */
class MockTask extends AutoUpdatedClientObject<Record<string, unknown>> {
  declare title: string;
  declare parent: string;

  /**
   * Retrieves the entity primary key identifier.
   *
   * @returns Entity string identifier.
   */
  get _id(): string | undefined {
    return (this as unknown as { data?: { _id?: string } }).data?._id;
  }

  /**
   * Overrides preload waiting logic for testing.
   *
   * @returns Resolved promise.
   */
  override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}
Reflect.defineMetadata("props", ["_id", "title", "parent"], MockTask.prototype);
Reflect.defineMetadata("isRef", true, MockTask.prototype, "parent");
Reflect.defineMetadata("refsTo", "MockProject", MockTask.prototype, "parent");

/**
 * Mock entity class representing a project parent in relational arrays.
 */
class MockProject extends AutoUpdatedClientObject<Record<string, unknown>> {
  declare name: string;
  declare tags: string[];
  declare tasks: MockTask[];

  /**
   * Retrieves the entity primary key identifier.
   *
   * @returns Entity string identifier.
   */
  get _id(): string | undefined {
    return (this as unknown as { data?: { _id?: string } }).data?._id;
  }

  /**
   * Overrides preload waiting logic for testing.
   *
   * @returns Resolved promise.
   */
  override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}
Reflect.defineMetadata("props", ["_id", "name", "tags", "tasks"], MockProject.prototype);
Reflect.defineMetadata("isRef", true, MockProject.prototype, "tasks");
Reflect.defineMetadata("refsTo", "MockTask", MockProject.prototype, "tasks");

/**
 * Mock server entity class for array mutation serialization.
 */
class MockServerProject extends AutoUpdatedServerObject<Record<string, unknown>> {
  declare name: string;
  declare tags: string[];
  declare tasks: string[];

  /**
   * Retrieves the entity primary key identifier.
   *
   * @returns Entity string identifier.
   */
  get _id(): string | undefined {
    return (this as unknown as { data?: { _id?: string } }).data?._id;
  }
}
Reflect.defineMetadata("props", ["_id", "name", "tags", "tasks"], MockServerProject.prototype);

describe("DEMArray High-Volume Stress & Algorithmic Complexity Benchmark", () => {
  let loggers: LoggersType;
  let emitter: EventEmitter;
  let mockSocket: IMockSocket;

  beforeEach(() => {
    delete (MockTask as unknown as { __metaCache?: unknown }).__metaCache;
    delete (MockProject as unknown as { __metaCache?: unknown }).__metaCache;
    delete (MockServerProject as unknown as { __metaCache?: unknown }).__metaCache;
    globalCache.clear();
    emitter = new EventEmitter();
    mockSocket = makeMockSocket();
    loggers = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
  });

  test("1. Direct index queries scale with O(1) constant time across large array positions", () => {
    // Construct a large array containing 10,000 elements.
    const elementCount = 10000;
    const initialElements: string[] = new Array(elementCount);
    for (let i = 0; i < elementCount; i++) {
      initialElements[i] = `item-${i}`;
    }

    const project = new MockProject(
      MockProject,
      mockSocket as unknown as any,
      { _id: "proj-large-1", name: "Large Project", tags: initialElements },
      loggers,
      "MockProject",
      {} as unknown as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    const tags = project.tags as unknown as DEMArray<string>;

    // Verify index access retrieves expected elements.
    expect(tags.length).toBe(elementCount);
    expect(tags[0]).toBe("item-0");
    expect(tags[5000]).toBe("item-5000");
    expect(tags[9999]).toBe("item-9999");

    // Execute warm-up reads to stabilize runtime optimizations.
    for (let w = 0; w < 500; w++) {
      const _w0 = tags[0];
      const _wMid = tags[5000];
      const _wEnd = tags[9999];
      const _wLen = tags.length;
    }

    const queryIterations = 10000;

    // Benchmark read latency at beginning index.
    const startIdx0 = performance.now();
    for (let i = 0; i < queryIterations; i++) {
      const val = tags[0];
      if (!val) throw new Error("Index query failed");
    }
    const elapsedIdx0 = performance.now() - startIdx0;

    // Benchmark read latency at middle index.
    const startIdx5000 = performance.now();
    for (let i = 0; i < queryIterations; i++) {
      const val = tags[5000];
      if (!val) throw new Error("Index query failed");
    }
    const elapsedIdx5000 = performance.now() - startIdx5000;

    // Benchmark read latency at end index.
    const startIdx9999 = performance.now();
    for (let i = 0; i < queryIterations; i++) {
      const val = tags[9999];
      if (!val) throw new Error("Index query failed");
    }
    const elapsedIdx9999 = performance.now() - startIdx9999;

    // Benchmark length property access latency.
    const startLength = performance.now();
    for (let i = 0; i < queryIterations; i++) {
      const len = tags.length;
      if (len !== elementCount) throw new Error("Length query failed");
    }
    const elapsedLength = performance.now() - startLength;

    // Verify constant O(1) query time across all positions.
    // Average read time must remain well under 0.05 milliseconds per read.
    const avgMs0 = elapsedIdx0 / queryIterations;
    const avgMs5000 = elapsedIdx5000 / queryIterations;
    const avgMs9999 = elapsedIdx9999 / queryIterations;
    const avgMsLen = elapsedLength / queryIterations;

    expect(avgMs0).toBeLessThan(0.05);
    expect(avgMs5000).toBeLessThan(0.05);
    expect(avgMs9999).toBeLessThan(0.05);
    expect(avgMsLen).toBeLessThan(0.05);

    // Verify index position does not cause linear scan degradation.
    // The difference between arbitrary indices must remain bounded under constant time O(1).
    const maxLatency = Math.max(elapsedIdx0, elapsedIdx5000, elapsedIdx9999);
    const minLatency = Math.min(elapsedIdx0, elapsedIdx5000, elapsedIdx9999);
    const absoluteDifferenceMs = maxLatency - minLatency;
    const perLookupDifferenceMs = absoluteDifferenceMs / queryIterations;

    expect(perLookupDifferenceMs).toBeLessThan(0.05);
    expect(absoluteDifferenceMs).toBeLessThan(250);
  });

  test("2. Referential cache provides stable O(1) access without graph traversal", () => {
    const taskCount = 500;
    const taskIds: string[] = new Array(taskCount);

    const taskManager = new AutoUpdateClientManager(
      MockTask as unknown as any,
      "MockTask",
      mockSocket as unknown as any,
      loggers,
      {},
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    const projectManager = new AutoUpdateClientManager(
      MockProject as unknown as any,
      "MockProject",
      mockSocket as unknown as any,
      loggers,
      { MockTask: taskManager },
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    // Initialize 500 mock child task entities.
    for (let i = 0; i < taskCount; i++) {
      const taskId = `task-${i}`;
      taskIds[i] = taskId;
      const task = new MockTask(
        MockTask,
        mockSocket as unknown as any,
        { _id: taskId, title: `Task Title ${i}` },
        loggers,
        "MockTask",
        taskManager,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        emitter,
      );
      (taskManager as unknown as { objects_: Record<string, unknown> }).objects_[taskId] = task;
      globalCache.objects[taskId] = { className: "MockTask", object: task as unknown as any };
    }

    const project = new MockProject(
      MockProject,
      mockSocket as unknown as any,
      { _id: "proj-ref-1", name: "Relational Project", tasks: taskIds },
      loggers,
      "MockProject",
      projectManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );
    (projectManager as unknown as { objects_: Record<string, unknown> }).objects_["proj-ref-1"] = project;
    globalCache.objects["proj-ref-1"] = { className: "MockProject", object: project as unknown as any };

    // Initial read populates proxy and resolves reference graph.
    const initialProxy = project.tasks;
    expect(initialProxy.length).toBe(taskCount);

    // Attach spy to findReference to monitor graph scans.
    const findRefSpy = jest.spyOn(project, "findReference");
    findRefSpy.mockClear();

    // Benchmark 5,000 repeated property accesses on cached proxy.
    const accessIterations = 5000;
    const startCacheBench = performance.now();
    for (let i = 0; i < accessIterations; i++) {
      const currentProxy = project.tasks;
      if (currentProxy !== initialProxy) {
        throw new Error("Proxy reference mismatch detected");
      }
    }
    const elapsedCacheMs = performance.now() - startCacheBench;

    // Verify findReference was never invoked during cached reads.
    expect(findRefSpy).not.toHaveBeenCalled();

    // Verify cached property access completes in sub-millisecond time without graph scan.
    const avgCacheReadMs = elapsedCacheMs / accessIterations;
    expect(avgCacheReadMs).toBeLessThan(1.0);
    expect(elapsedCacheMs).toBeLessThan(5000);
  });

  test("3. Sequential mutation throughput maintains amortized O(1) performance", async () => {
    const authoritativeTags: string[] = ["initial-0", "initial-1"];

    mockSocket.emit = jest.fn((event: string, ...args: unknown[]): void => {
      const payload = args[0] as { mutation?: DEMArrayMutationRequest };
      const cb = args[args.length - 1] as (res: DEMArrayMutationResponse) => void;
      const mutation = payload?.mutation;

      if (mutation) {
        if (mutation.op === "push") {
          authoritativeTags.push(...((mutation.items as string[]) || []));
        } else if (mutation.op === "pop") {
          authoritativeTags.pop();
        } else if (mutation.op === "set") {
          if (mutation.index !== undefined && mutation.items?.length) {
            authoritativeTags[mutation.index] = mutation.items[0] as string;
          }
        }
        if (typeof cb === "function") {
          cb({ success: true, updatedArray: [...authoritativeTags] });
        }
      }
    });

    const project = new MockProject(
      MockProject,
      mockSocket as unknown as any,
      { _id: "proj-mutation-stress", name: "Mutation Project", tags: [...authoritativeTags] },
      loggers,
      "MockProject",
      {} as unknown as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    const tags = project.tags as unknown as DEMArray<string>;
    const mutationCount = 1000;
    const operationLatencies: number[] = new Array(mutationCount);

    const memoryBefore = process.memoryUsage().heapUsed;
    const startTotalTime = performance.now();

    // Execute 1,000 sequential array mutations across push, set, and pop.
    for (let i = 0; i < mutationCount; i++) {
      const opStart = performance.now();
      const opChoice = i % 3;

      if (opChoice === 0) {
        await tags.push(`item-${i}`);
      } else if (opChoice === 1) {
        await tags.set(tags.length - 1, `updated-${i}`);
      } else {
        if (tags.length > 2) {
          await tags.pop();
        } else {
          await tags.push(`item-${i}`);
        }
      }

      operationLatencies[i] = performance.now() - opStart;
    }

    const elapsedTotalTime = performance.now() - startTotalTime;
    const memoryAfter = process.memoryUsage().heapUsed;
    const heapDifferenceBytes = memoryAfter - memoryBefore;

    // Verify local array state matches authoritative state.
    expect(tags.length).toBe(authoritativeTags.length);
    expect(tags.slice()).toEqual(authoritativeTags);

    // Verify writeQueue resolves cleanly without pending promises.
    await (project as unknown as { writeQueue: Promise<unknown> }).writeQueue;

    // Verify amortized O(1) performance without quadratic degradation.
    const first100Avg = calculateAverage(operationLatencies.slice(0, 100));
    const last100Avg = calculateAverage(operationLatencies.slice(900, 1000));

    // In O(1) performance, the final batch latency must not grow quadratically.
    // The last 100 operations must stay within reasonable bounds of initial batch.
    expect(last100Avg).toBeLessThan(first100Avg * 5 + 0.5);

    // Verify total execution completed in bounded time.
    expect(elapsedTotalTime).toBeLessThan(10000);

    // Verify heap growth remains strictly bounded under 20 megabytes.
    expect(heapDifferenceBytes).toBeLessThan(20 * 1024 * 1024);
  });

  test("4. Multi-client concurrent writes serialize cleanly and converge to identical state", async () => {
    const clientCount = 4;
    const mutationsPerClient = 100;
    const totalExpectedMutations = clientCount * mutationsPerClient;

    const tracker = new ServerChangeTracker<Record<string, unknown>>("MockServerProject");
    const mockModel = {
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
    };

    const mockServerMgr = {
      className: "MockServerProject",
      model: mockModel,
      managers: {},
      changeTracker: tracker,
    };

    const clientSockets: IMockSocket[] = [
      makeMockSocket(),
      makeMockSocket(),
      makeMockSocket(),
      makeMockSocket(),
    ];

    // Server socket broadcasts updates to all client sockets.
    const serverSocket = {
      emit: (event: string, update: unknown): void => {
        for (const cs of clientSockets) {
          cs.trigger(event, update);
        }
      },
    };

    const serverProject = new MockServerProject(
      MockServerProject,
      serverSocket as unknown as any,
      { _id: "shared-stress-proj", name: "Shared Project", tags: [] },
      loggers,
      "MockServerProject",
      mockServerMgr as unknown as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    const receivedRevisions: number[] = [];

    // Attach client sockets to server array mutation pipeline.
    const clients = clientSockets.map((cs) => {
      cs.emit = (event: string, ...args: unknown[]): void => {
        const payload = args[0] as { key: string; mutation: DEMArrayMutationRequest };
        const cb = args[args.length - 1] as (res: DEMArrayMutationResponse) => void;

        if (event === "updateMockServerProjectshared-stress-proj") {
          serverProject
            .mutateArray(payload.key, payload.mutation)
            .then((res) => {
              if (res.newRevision !== undefined) {
                receivedRevisions.push(res.newRevision);
              }
              if (typeof cb === "function") cb(res);
            })
            .catch((err: Error) => {
              if (typeof cb === "function") {
                cb({ success: false, message: err.message });
              }
            });
        }
      };

      return new MockProject(
        MockProject,
        cs as unknown as any,
        { _id: "shared-stress-proj", tags: [] },
        loggers,
        "MockServerProject",
        {} as unknown as any,
        { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
        emitter,
      );
    });

    // Dispatch 4 concurrent client batches with 100 mutations each.
    const clientPromises: Promise<void>[] = [];
    for (let c = 0; c < clientCount; c++) {
      const clientEntity = clients[c];
      clientPromises.push(
        (async (): Promise<void> => {
          for (let j = 0; j < mutationsPerClient; j++) {
            const clientTags = clientEntity.tags as unknown as DEMArray<string>;
            await clientTags.push(`c${c}-item${j}`);
          }
        })(),
      );
    }

    // Wait for all 400 mutations across 4 clients to complete.
    await Promise.all(clientPromises);

    // Verify server saveLock processed all 400 mutations without deadlocks.
    expect(receivedRevisions.length).toBe(totalExpectedMutations);

    // Verify monotonic revision sequence increments exactly 400 times without skipping.
    expect(tracker.getCurrentRevision()).toBe(totalExpectedMutations);
    const sortedRevisions = [...receivedRevisions].sort((a, b) => a - b);
    for (let r = 0; r < totalExpectedMutations; r++) {
      expect(sortedRevisions[r]).toBe(r + 1);
    }

    // Verify server authoritative array has exactly 400 elements.
    const serverTags = (serverProject.data as { tags: string[] }).tags;
    expect(serverTags.length).toBe(totalExpectedMutations);

    // Verify all 4 clients converged to the identical state and content hash.
    const serverHash = calculateContentHash(serverTags);

    for (let c = 0; c < clientCount; c++) {
      const clientTags = clients[c].tags as unknown as DEMArray<string>;
      expect(clientTags.length).toBe(totalExpectedMutations);
      const clientHash = calculateContentHash(clientTags.slice());
      expect(clientHash).toBe(serverHash);
    }
  });

  test("5. Element-anchored splices scale on large 5,000 element arrays", async () => {
    const totalElements = 5000;
    const initialElements: string[] = new Array(totalElements);
    for (let i = 0; i < totalElements; i++) {
      initialElements[i] = `elem-${i}`;
    }

    const tracker = new ServerChangeTracker<Record<string, unknown>>("MockServerProject");
    const mockModel = {
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
    };

    const mockServerMgr = {
      className: "MockServerProject",
      model: mockModel,
      managers: {},
      changeTracker: tracker,
    };

    const serverSocket = { emit: jest.fn() };

    const serverProject = new MockServerProject(
      MockServerProject,
      serverSocket as unknown as any,
      { _id: "anchor-stress-proj", name: "Anchor Project", tags: initialElements },
      loggers,
      "MockServerProject",
      mockServerMgr as unknown as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    // Execute beginning anchored splice with index drift.
    // TargetId is elem-0, drifted index is provided as 5.
    const startBeginning = performance.now();
    const resBeginning = await serverProject.mutateArray("tags", {
      key: "tags",
      op: "splice",
      index: 5,
      deleteCount: 1,
      items: ["inserted-beginning"],
      targetId: "elem-0",
    });
    const elapsedBeginning = performance.now() - startBeginning;

    expect(resBeginning.success).toBe(true);
    expect(elapsedBeginning).toBeLessThan(50);
    const updatedTagsBeginning = (serverProject.data as { tags: string[] }).tags;
    expect(updatedTagsBeginning[0]).toBe("inserted-beginning");

    // Execute middle anchored splice with index drift.
    // TargetId is elem-2500, drifted index is provided as 2600.
    const startMiddle = performance.now();
    const resMiddle = await serverProject.mutateArray("tags", {
      key: "tags",
      op: "splice",
      index: 2600,
      deleteCount: 1,
      items: ["inserted-middle"],
      targetId: "elem-2500",
    });
    const elapsedMiddle = performance.now() - startMiddle;

    expect(resMiddle.success).toBe(true);
    expect(elapsedMiddle).toBeLessThan(50);
    const updatedTagsMiddle = (serverProject.data as { tags: string[] }).tags;
    expect(updatedTagsMiddle[2500]).toBe("inserted-middle");

    // Execute end anchored splice with index drift.
    // TargetId is elem-4999, drifted index is provided as 100.
    const startEnd = performance.now();
    const resEnd = await serverProject.mutateArray("tags", {
      key: "tags",
      op: "splice",
      index: 100,
      deleteCount: 1,
      items: ["inserted-end"],
      targetId: "elem-4999",
    });
    const elapsedEnd = performance.now() - startEnd;

    expect(resEnd.success).toBe(true);
    expect(elapsedEnd).toBeLessThan(50);
    const updatedTagsEnd = (serverProject.data as { tags: string[] }).tags;
    expect(updatedTagsEnd[updatedTagsEnd.length - 1]).toBe("inserted-end");

    // Verify end-to-end client proxy splice with automatic targetId anchoring.
    let clientCapturedPayload: { mutation?: DEMArrayMutationRequest } | undefined;
    mockSocket.emit = jest.fn((event: string, ...args: unknown[]): void => {
      clientCapturedPayload = args[0] as { mutation?: DEMArrayMutationRequest };
      const cb = args[args.length - 1] as (res: DEMArrayMutationResponse) => void;
      const updated = [...(clientProject.data as { tags: string[] }).tags];
      updated.splice(1250, 1, "client-inserted-elem");
      if (typeof cb === "function") {
        cb({ success: true, updatedArray: updated });
      }
    });

    const clientProject = new MockProject(
      MockProject,
      mockSocket as unknown as any,
      { _id: "anchor-client-proj", name: "Client Anchor Project", tags: [...initialElements] },
      loggers,
      "MockProject",
      {} as unknown as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    const clientTags = clientProject.tags as unknown as DEMArray<string>;
    const removedItems = await clientTags.splice(1250, 1, "client-inserted-elem");

    // Verify automatic targetId was generated from element at index 1250.
    expect(removedItems).toEqual(["elem-1250"]);
    expect(clientCapturedPayload?.mutation?.targetId).toBe("elem-1250");
    expect(clientTags[1250]).toBe("client-inserted-elem");
  });
});
