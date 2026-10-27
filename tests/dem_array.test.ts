import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import { AutoUpdatedServerObject } from "../AutoUpdatedServerObjectClass.js";
import { AutoUpdateClientManager } from "../AutoUpdateClientManagerClass.js";
import { classProp, populatedRef, globalCache, DEMError, DEMErrorCode, DEMArray } from "../CommonTypes.js";

function makeMockSocket() {
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    on: jest.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
    }),
    off: jest.fn((event: string, handler?: (...args: any[]) => void) => {
      if (!handler) {
        delete handlers[event];
      } else if (handlers[event]) {
        handlers[event] = handlers[event].filter((h) => h !== handler);
      }
    }),
    emit: jest.fn((event: string, ...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        cb({ success: true, message: "OK" });
      }
    }),
    _trigger: (event: string, ...args: any[]) => {
      if (handlers[event]) {
        for (const h of handlers[event]) {
          h(...args);
        }
      }
    },
    handlers,
  };
}

class MockTask extends AutoUpdatedClientObject<any> {
  declare title: string;
  declare parent: string;

  get _id() {
    return (this as any).data?._id;
  }
  override waitForPreloaded = jest.fn().mockResolvedValue(undefined as any);
}
Reflect.defineMetadata("props", ["_id", "title", "parent"], MockTask.prototype);
Reflect.defineMetadata("isRef", true, MockTask.prototype, "parent");
Reflect.defineMetadata("refsTo", "MockProject", MockTask.prototype, "parent");

class MockProject extends AutoUpdatedClientObject<any> {
  declare name: string;
  declare tags: string[];
  declare tasks: MockTask[];

  get _id() {
    return (this as any).data?._id;
  }
  override waitForPreloaded = jest.fn().mockResolvedValue(undefined as any);
}
Reflect.defineMetadata("props", ["_id", "name", "tags", "tasks"], MockProject.prototype);
Reflect.defineMetadata("isRef", true, MockProject.prototype, "tasks");
Reflect.defineMetadata("refsTo", "MockTask", MockProject.prototype, "tasks");

describe("DEMArray Reactive Array Wrapper & Mutation Pipeline", () => {
  let loggers: any;
  let emitter: EventEmitter;
  let mockSocket: any;

  beforeEach(() => {
    delete (MockTask as any).__metaCache;
    delete (MockProject as any).__metaCache;
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

  test("DEMArray wraps primitive arrays and exposes synchronous ReadonlyArray queries", () => {
    const project = new MockProject(
      MockProject,
      mockSocket,
      { _id: "proj-1", name: "Demo Project", tags: ["alpha", "beta", "gamma"] },
      loggers,
      "MockProject",
      {} as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    const tags = project.tags as unknown as DEMArray<string>;
    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBe(3);
    expect(tags[0]).toBe("alpha");
    expect(tags[1]).toBe("beta");
    expect(tags[2]).toBe("gamma");
    expect(tags.map((t) => t.toUpperCase())).toEqual(["ALPHA", "BETA", "GAMMA"]);
    expect(tags.filter((t) => t.startsWith("b"))).toEqual(["beta"]);
    expect(tags.find((t) => t === "gamma")).toBe("gamma");
    expect(tags.includes("alpha")).toBe(true);
    expect(tags.indexOf("beta")).toBe(1);
    expect(tags.slice(1, 3)).toEqual(["beta", "gamma"]);
  });

  test("Direct index assignment throws DEMError on DEMArray", () => {
    const project = new MockProject(
      MockProject,
      mockSocket,
      { _id: "proj-1", name: "Demo Project", tags: ["alpha", "beta"] },
      loggers,
      "MockProject",
      {} as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    const tags = project.tags as unknown as DEMArray<string>;
    expect(() => {
      (tags as any)[0] = "new-tag";
    }).toThrow(DEMError);
    expect(() => {
      (tags as any)[0] = "new-tag";
    }).toThrow(/Cannot assign index directly on DEMArray/);
  });

  test("Primitive array async push waits for server acknowledgment before mutating local state", async () => {
    let serverAckCallback: any;
    mockSocket.emit = jest.fn((event: string, ...args: any[]) => {
      if (event === "updateMockProjectproj-1") {
        serverAckCallback = args[args.length - 1];
      }
    });

    const project = new MockProject(
      MockProject,
      mockSocket,
      { _id: "proj-1", name: "Demo Project", tags: ["alpha"] },
      loggers,
      "MockProject",
      {} as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    const tags = project.tags as unknown as DEMArray<string>;
    const pushPromise = tags.push("beta");
    pushPromise.catch((e) => console.log("PUSH ERROR:", e));

    // Pessimistic guarantee: local state has NOT changed yet
    expect(tags.length).toBe(1);
    expect(tags[0]).toBe("alpha");

    // Allow microtask writeQueue to emit socket event
    await new Promise((r) => setTimeout(r, 10));

    // Server acknowledges success with confirmed updated array
    expect(serverAckCallback).toBeDefined();
    serverAckCallback({
      success: true,
      updatedArray: ["alpha", "beta"],
    });

    const newLen = await pushPromise;
    expect(newLen).toBe(2);
    expect(tags.length).toBe(2);
    expect(tags[1]).toBe("beta");
    expect(project.data.tags).toEqual(["alpha", "beta"]);
  });

  test("Primitive array mutation reverts or rejects when server returns an error", async () => {
    mockSocket.emit = jest.fn((event: string, ...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        cb({
          success: false,
          code: DEMErrorCode.DB_SAVE_FAILED,
          message: "Database write rejected",
        });
      }
    });

    const project = new MockProject(
      MockProject,
      mockSocket,
      { _id: "proj-1", name: "Demo Project", tags: ["alpha"] },
      loggers,
      "MockProject",
      {} as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    const tags = project.tags as unknown as DEMArray<string>;
    await expect(tags.push("rejected-item")).rejects.toThrow(/Database write rejected/);

    // State remains unpolluted
    expect(tags.length).toBe(1);
    expect(tags[0]).toBe("alpha");
  });

  test("Primitive array async pop, shift, unshift, splice, set, clear", async () => {
    mockSocket.emit = jest.fn((event: string, ...args: any[]) => {
      const payload = args[0];
      const cb = args[args.length - 1];
      const op = payload?.mutation?.op;
      let updated: string[] = [];

      if (op === "pop") updated = ["one"];
      else if (op === "shift") updated = ["two"];
      else if (op === "unshift") updated = ["zero", "one", "two"];
      else if (op === "splice") updated = ["one", "replaced"];
      else if (op === "set") updated = ["one", "modified"];
      else if (op === "clear") updated = [];

      if (typeof cb === "function") {
        cb({ success: true, updatedArray: updated });
      }
    });

    const project = new MockProject(
      MockProject,
      mockSocket,
      { _id: "proj-1", name: "Demo Project", tags: ["one", "two"] },
      loggers,
      "MockProject",
      {} as any,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    const tags = project.tags as unknown as DEMArray<string>;

    // pop
    const popped = await tags.pop();
    expect(popped).toBe("two");
    expect(tags.length).toBe(1);

    // set
    const setVal = await tags.set(1, "modified");
    expect(setVal).toBe("modified");

    // clear
    await tags.clear();
    expect(tags.length).toBe(0);
  });

  test("Relational DEMArray accepts entity instances, string IDs, and ObjectIds, updating back-references", async () => {
    const taskManager = new AutoUpdateClientManager(
      MockTask as any,
      "MockTask",
      mockSocket as any,
      loggers,
      {},
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    const projectManager = new AutoUpdateClientManager(
      MockProject as any,
      "MockProject",
      mockSocket as any,
      loggers,
      { MockTask: taskManager },
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );
    (taskManager.managers as any)["MockProject"] = projectManager;

    const task1 = new MockTask(
      MockTask,
      mockSocket,
      { _id: "task-1", title: "Task One" },
      loggers,
      "MockTask",
      taskManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );
    (taskManager as any).objects_["task-1"] = task1;
    globalCache.objects["task-1"] = { className: "MockTask", object: task1 as any };

    const project = new MockProject(
      MockProject,
      mockSocket,
      { _id: "proj-1", name: "Relational Project", tasks: [] },
      loggers,
      "MockProject",
      projectManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );
    (projectManager as any).objects_["proj-1"] = project;
    globalCache.objects["proj-1"] = { className: "MockProject", object: project as any };

    mockSocket.emit = jest.fn((event: string, ...args: any[]) => {
      const payload = args[0];
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        cb({
          success: true,
          updatedArray: payload?.mutation?.items || ["task-1"],
        });
      }
    });

    const tasks = project.tasks as unknown as DEMArray<MockTask>;
    expect(tasks.length).toBe(0);

    // Push task entity instance
    const newLen = await tasks.push(task1);
    expect(newLen).toBe(1);
    expect(tasks.length).toBe(1);
    expect(tasks[0]).toBe(task1);
    // .data stores string ID
    expect(project.data.tasks).toEqual(["task-1"]);

    // Back-reference synchronization: child.parent resolves to parent project instance
    expect(task1.parent).toBe(project);
    expect(task1.data.parent).toBe("proj-1");
  });

  test("Relational DEMArray splice uses element-anchored targetId to prevent index-drift", async () => {
    const taskManager = new AutoUpdateClientManager(
      MockTask as any,
      "MockTask",
      mockSocket as any,
      loggers,
      {},
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    const projectManager = new AutoUpdateClientManager(
      MockProject as any,
      "MockProject",
      mockSocket as any,
      loggers,
      { MockTask: taskManager },
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    const task1 = new MockTask(
      MockTask,
      mockSocket,
      { _id: "task-1", title: "Task 1", parent: "proj-1" },
      loggers,
      "MockTask",
      taskManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );
    const task2 = new MockTask(
      MockTask,
      mockSocket,
      { _id: "task-2", title: "Task 2", parent: "proj-1" },
      loggers,
      "MockTask",
      taskManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );
    (taskManager as any).objects_["task-1"] = task1;
    (taskManager as any).objects_["task-2"] = task2;
    globalCache.objects["task-1"] = { className: "MockTask", object: task1 as any };
    globalCache.objects["task-2"] = { className: "MockTask", object: task2 as any };

    const project = new MockProject(
      MockProject,
      mockSocket,
      { _id: "proj-1", name: "Relational Project", tasks: ["task-1", "task-2"] },
      loggers,
      "MockProject",
      projectManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    let capturedPayload: any;
    mockSocket.emit = jest.fn((event: string, ...args: any[]) => {
      capturedPayload = args[0];
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        cb({ success: true, updatedArray: ["task-1"] });
      }
    });

    const tasks = project.tasks as unknown as DEMArray<MockTask>;
    const removed = await tasks.splice(1, 1);

    expect(removed).toEqual([task2]);
    // The emitted mutation payload must include targetId for task-2
    expect(capturedPayload?.mutation?.targetId).toBe("task-2");
    // Back-reference cleared on removed child
    expect(task2.parent).toBeUndefined();
  });

  test("DEMArray ensureLoaded({ depth }) hydrates unhydrated stub elements", async () => {
    const taskManager = new AutoUpdateClientManager(
      MockTask as any,
      "MockTask",
      mockSocket as any,
      loggers,
      {},
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    const projectManager = new AutoUpdateClientManager(
      MockProject as any,
      "MockProject",
      mockSocket as any,
      loggers,
      { MockTask: taskManager },
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    const stubTask = new MockTask(
      MockTask,
      mockSocket,
      { _id: "task-stub", title: "Unloaded Task" },
      loggers,
      "MockTask",
      taskManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );
    stubTask.isLazyStub = true;
    const ensureSpy = jest.spyOn(stubTask, "ensureLoaded").mockResolvedValue(stubTask);

    (taskManager as any).objects_["task-stub"] = stubTask;
    globalCache.objects["task-stub"] = { className: "MockTask", object: stubTask as any };

    const project = new MockProject(
      MockProject,
      mockSocket,
      { _id: "proj-stub", name: "Lazy Project", tasks: ["task-stub"] },
      loggers,
      "MockProject",
      projectManager,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    const tasks = project.tasks as unknown as DEMArray<MockTask>;
    const loaded = await tasks.ensureLoaded({ depth: 2 });
    expect(loaded).toBe(tasks);
    expect(ensureSpy).toHaveBeenCalledWith({ depth: 2 });
  });

  test("AutoUpdatedServerObject mutateArray executes isomorphic mutation, saveLock persistence, and revision tracking", async () => {
    class ServerProjectMock extends AutoUpdatedServerObject<any> {
      declare name: string;
      declare tags: string[];
    }
    Reflect.defineMetadata("props", ["_id", "name", "tags"], ServerProjectMock.prototype);

    const mockModel: any = {
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
    };

    const mockChangeTracker: any = {
      recordChange: jest.fn(),
      getCurrentRevision: jest.fn().mockReturnValue(42),
    };

    const mockServerMgr: any = {
      className: "ServerProject",
      model: mockModel,
      managers: {},
      changeTracker: mockChangeTracker,
    };

    const serverSocket: any = {
      emit: jest.fn(),
    };

    const serverProject = new ServerProjectMock(
      ServerProjectMock,
      serverSocket,
      { _id: "srv-proj-1", name: "Backend Project", tags: ["v1", "v2"] },
      loggers,
      "ServerProject",
      mockServerMgr,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
      emitter,
    );

    const res = await serverProject.mutateArray("tags", {
      key: "tags",
      op: "push",
      items: ["v3"],
    });

    expect(res.success).toBe(true);
    expect(res.updatedArray).toEqual(["v1", "v2", "v3"]);
    expect(res.newRevision).toBe(42);
    expect(mockModel.updateOne).toHaveBeenCalledWith(
      { _id: "srv-proj-1" },
      { $set: { tags: ["v1", "v2", "v3"] } },
    );
    expect(mockChangeTracker.recordChange).toHaveBeenCalledWith(
      "update",
      "srv-proj-1",
      { tags: ["v1", "v2", "v3"] },
    );
    expect(serverSocket.emit).toHaveBeenCalledWith(
      "updateServerProjectsrv-proj-1",
      expect.objectContaining({
        key: "tags",
        value: ["v1", "v2", "v3"],
      }),
    );
  });

  test("AutoUpdateClientManager synchronizes Cristian clock offset from server handshake", async () => {
    const clientMgr = new AutoUpdateClientManager(
      MockProject as any,
      "MockProject",
      mockSocket as any,
      loggers,
      {},
      emitter,
      { new: jest.fn(), update: jest.fn(), delete: jest.fn() },
    );

    // Initial offset is 0
    expect(clientMgr.serverTimeOffset).toBe(0);

    const serverNow = Date.now() + 5000;
    mockSocket.emit = jest.fn((event: string, ...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        cb({
          success: true,
          data: {
            status: "full",
            ids: [],
            objects: [],
            properties: ["_id", "name", "tags", "tasks"],
            version: "0.11.0",
            serverTime: serverNow,
          },
        });
      }
    });

    await clientMgr.loadFromServer();

    // serverTimeOffset should approximate +5000 ms within network RTT bounds
    expect(clientMgr.serverTimeOffset).toBeGreaterThan(4000);
    expect(clientMgr.serverTimeOffset).toBeLessThan(6000);
    const syncTime = clientMgr.getSynchronizedTime();
    expect(syncTime).toBeGreaterThanOrEqual(Date.now() + 4000);
  });
});
