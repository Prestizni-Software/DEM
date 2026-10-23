import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import { ObjectId } from "mongodb";
import "reflect-metadata";
import {
  AutoUpdatedClientObject,
  DEM_RAW_ARRAY,
  setupClassAccessors,
} from "../../AutoUpdatedClientObjectClass.js";
import { AutoUpdateClientManager } from "../../AutoUpdateClientManagerClass.js";
import {
  classProp,
  classRef,
  populatedRef,
  globalCache,
  DEMError,
  DEMErrorCode,
  LoggersType,
  DEMClientCallbacks,
  IAutoUpdateManager,
} from "../../CommonTypes.js";

/**
 * Snapshot representation of user account configuration.
 */
export interface AccountSnapshot {
  plan: string;
  features: string[];
  maxProjects: number;
}

/**
 * Snapshot representation of project runtime settings.
 */
export interface ProjectConfigSnapshot {
  theme: string;
  flags: string[];
  settings: Record<string, unknown>;
}

/**
 * Snapshot representation of an audit event.
 */
export interface AuditLogEntry {
  action: string;
  timestamp: number;
  actor: string;
}

/**
 * Entity representing a user profile with snapshot account data.
 */
export class UserProfile extends AutoUpdatedClientObject<UserProfile> {
  @classProp
  public override get _id(): string {
    return (this.data as { _id?: string })?._id ?? "";
  }

  @classProp
  public username!: string;

  @classProp
  public email!: string;

  @classProp
  public accountSnapshot!: AccountSnapshot;

  @classProp
  @classRef()
  public projects!: Project[];

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}

/**
 * Entity representing a project with populated owner and tasks.
 */
export class Project extends AutoUpdatedClientObject<Project> {
  @classProp
  public override get _id(): string {
    return (this.data as { _id?: string })?._id ?? "";
  }

  @classProp
  public title!: string;

  @classProp
  @populatedRef("UserProfile")
  public owner?: UserProfile;

  @classProp
  @classRef()
  public tasks!: TaskItem[];

  @classProp
  public configSnapshot!: ProjectConfigSnapshot;

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}

/**
 * Entity representing a task item with back-reference, assignee, and snapshot logs.
 */
export class TaskItem extends AutoUpdatedClientObject<TaskItem> {
  @classProp
  public override get _id(): string {
    return (this.data as { _id?: string })?._id ?? "";
  }

  @classProp
  public title!: string;

  @classProp
  @populatedRef("Project:tasks")
  public project?: Project;

  @classProp
  @populatedRef("UserProfile")
  public assignee?: UserProfile;

  @classProp
  @classRef()
  public dependencies!: TaskItem[];

  @classProp
  public auditLogs!: AuditLogEntry[];

  @classProp
  public tags!: string[];

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}

/**
 * Entity NodeA for circular reference testing.
 */
export class CircularNodeA extends AutoUpdatedClientObject<CircularNodeA> {
  @classProp
  public override get _id(): string {
    return (this.data as { _id?: string })?._id ?? "";
  }

  @classProp
  public name!: string;

  @classProp
  @populatedRef("CircularNodeB")
  public nodeB?: CircularNodeB;

  @classProp
  public snapshotData!: Record<string, unknown>;

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}

/**
 * Entity NodeB for circular reference testing.
 */
export class CircularNodeB extends AutoUpdatedClientObject<CircularNodeB> {
  @classProp
  public override get _id(): string {
    return (this.data as { _id?: string })?._id ?? "";
  }

  @classProp
  public title!: string;

  @classProp
  @populatedRef("CircularNodeA")
  public nodeA?: CircularNodeA;

  @classProp
  @populatedRef("CircularNodeC")
  public nodeC?: CircularNodeC;

  @classProp
  public snapshotData!: Record<string, unknown>;

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}

/**
 * Entity NodeC for multi-node circular ring testing.
 */
export class CircularNodeC extends AutoUpdatedClientObject<CircularNodeC> {
  @classProp
  public override get _id(): string {
    return (this.data as { _id?: string })?._id ?? "";
  }

  @classProp
  public label!: string;

  @classProp
  @populatedRef("CircularNodeA")
  public nodeA?: CircularNodeA;

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}

/**
 * Entity Department for relational array and back-reference testing.
 */
export class Department extends AutoUpdatedClientObject<Department> {
  @classProp
  public override get _id(): string {
    return (this.data as { _id?: string })?._id ?? "";
  }

  @classProp
  public name!: string;

  @classProp
  @classRef()
  public members!: DepartmentMember[];

  @classProp
  public metadataSnapshot!: Record<string, unknown>;

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}

/**
 * Entity DepartmentMember with back-reference to Department and snapshot skills.
 */
export class DepartmentMember extends AutoUpdatedClientObject<DepartmentMember> {
  @classProp
  public override get _id(): string {
    return (this.data as { _id?: string })?._id ?? "";
  }

  @classProp
  public fullName!: string;

  @classProp
  @populatedRef("Department:members")
  public department?: Department;

  @classProp
  public skillsSnapshot!: string[];

  public override waitForPreloaded = jest.fn().mockResolvedValue(undefined as never);
}

/**
 * Creates mock socket instance for testing.
 *
 * @returns Mock socket interface.
 */
function createMockSocket(): {
  on: jest.Mock;
  off: jest.Mock;
  emit: jest.Mock;
} {
  return {
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn((event: string, ...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        cb({ success: true, message: "OK" });
      }
    }),
  };
}

/**
 * Creates mock logger interface for testing.
 *
 * @returns Mock logger object.
 */
function createTestLoggers(): LoggersType {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };
}

/**
 * Creates mock callback interface for client managers.
 *
 * @returns Mock callback object.
 */
function createTestCallbacks<T extends AutoUpdatedClientObject<any>>(): DEMClientCallbacks<T> {
  return {
    new: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    progress: jest.fn(),
  };
}

/**
 * Registers an entity into a client manager and global cache.
 *
 * @param manager - Target manager.
 * @param entity - Entity instance.
 */
function registerEntity<T extends AutoUpdatedClientObject<any>>(
  manager: AutoUpdateClientManager<T, any>,
  entity: T,
): void {
  const idStr = entity._id.toString();
  (manager as unknown as { objects_: Record<string, T> }).objects_[idStr] = entity;
  (manager as unknown as { _cachedObjectsArray: T[] | null })._cachedObjectsArray = null;
  globalCache.objects[idStr] = {
    className: manager.className,
    object: entity,
  };
}

/**
 * Creates and registers an entity instance.
 *
 * @param classParam - Entity constructor class.
 * @param className - Managed entity class name.
 * @param manager - Managing client manager.
 * @param data - Initial entity data payload.
 * @param socket - Mock socket connection.
 * @param loggers - Mock loggers.
 * @param callbacks - Mock callbacks.
 * @param emitter - Shared event emitter.
 * @returns The instantiated and registered entity.
 */
function createAndRegisterEntity<T extends AutoUpdatedClientObject<any>>(
  classParam: new (...args: any[]) => T,
  className: string,
  manager: AutoUpdateClientManager<T, any>,
  data: Record<string, unknown>,
  socket: unknown,
  loggers: LoggersType,
  callbacks: DEMClientCallbacks<any>,
  emitter: EventEmitter,
  isServer: boolean = false,
): T {
  const entity = new classParam(
    classParam,
    socket,
    data,
    loggers,
    className,
    manager,
    callbacks,
    emitter,
    isServer,
  );
  entity.generateSettersAndGetters();
  registerEntity(manager, entity);
  return entity;
}

describe("Domain 1: Relational Data, Model Reflection & Proxies", () => {
  let emitter: EventEmitter;
  let mockSocket: ReturnType<typeof createMockSocket>;
  let loggers: LoggersType;
  let clientManagers: Record<string, IAutoUpdateManager<any>>;

  let userManager: AutoUpdateClientManager<UserProfile, any>;
  let projectManager: AutoUpdateClientManager<Project, any>;
  let taskManager: AutoUpdateClientManager<TaskItem, any>;
  let nodeAManager: AutoUpdateClientManager<CircularNodeA, any>;
  let nodeBManager: AutoUpdateClientManager<CircularNodeB, any>;
  let nodeCManager: AutoUpdateClientManager<CircularNodeC, any>;
  let deptManager: AutoUpdateClientManager<Department, any>;
  let memberManager: AutoUpdateClientManager<DepartmentMember, any>;

  beforeEach(() => {
    // Clear global cache before every test.
    globalCache.clear();
    emitter = new EventEmitter();
    mockSocket = createMockSocket();
    loggers = createTestLoggers();
    clientManagers = {};

    // Create client managers for each test model.
    userManager = new AutoUpdateClientManager(
      UserProfile as any,
      "UserProfile",
      mockSocket as any,
      loggers,
      clientManagers,
      emitter as any,
      createTestCallbacks<UserProfile>(),
    );
    clientManagers["UserProfile"] = userManager;

    projectManager = new AutoUpdateClientManager(
      Project as any,
      "Project",
      mockSocket as any,
      loggers,
      clientManagers,
      emitter as any,
      createTestCallbacks<Project>(),
    );
    clientManagers["Project"] = projectManager;

    taskManager = new AutoUpdateClientManager(
      TaskItem as any,
      "TaskItem",
      mockSocket as any,
      loggers,
      clientManagers,
      emitter as any,
      createTestCallbacks<TaskItem>(),
    );
    clientManagers["TaskItem"] = taskManager;

    nodeAManager = new AutoUpdateClientManager(
      CircularNodeA as any,
      "CircularNodeA",
      mockSocket as any,
      loggers,
      clientManagers,
      emitter as any,
      createTestCallbacks<CircularNodeA>(),
    );
    clientManagers["CircularNodeA"] = nodeAManager;

    nodeBManager = new AutoUpdateClientManager(
      CircularNodeB as any,
      "CircularNodeB",
      mockSocket as any,
      loggers,
      clientManagers,
      emitter as any,
      createTestCallbacks<CircularNodeB>(),
    );
    clientManagers["CircularNodeB"] = nodeBManager;

    nodeCManager = new AutoUpdateClientManager(
      CircularNodeC as any,
      "CircularNodeC",
      mockSocket as any,
      loggers,
      clientManagers,
      emitter as any,
      createTestCallbacks<CircularNodeC>(),
    );
    clientManagers["CircularNodeC"] = nodeCManager;

    deptManager = new AutoUpdateClientManager(
      Department as any,
      "Department",
      mockSocket as any,
      loggers,
      clientManagers,
      emitter as any,
      createTestCallbacks<Department>(),
    );
    clientManagers["Department"] = deptManager;

    memberManager = new AutoUpdateClientManager(
      DepartmentMember as any,
      "DepartmentMember",
      mockSocket as any,
      loggers,
      clientManagers,
      emitter as any,
      createTestCallbacks<DepartmentMember>(),
    );
    clientManagers["DepartmentMember"] = memberManager;
  });

  // =========================================================================
  // F01 + F02: Model Property Reflection & Cross-Entity Relationship Resolution
  // =========================================================================
  describe("F01 + F02: Model Reflection & Relationship Resolution", () => {
    it("resolves single populated reference across client managers", () => {
      // Create user entity and register in manager.
      const user = createAndRegisterEntity(
        UserProfile,
        "UserProfile",
        userManager,
        { _id: "user-100", username: "alice", email: "alice@test.com" },
        mockSocket,
        loggers,
        createTestCallbacks<UserProfile>(),
        emitter,
      );

      // Create project entity referencing the user.
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "project-100", title: "Project Alpha", owner: "user-100" },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Verify that getter resolves live user instance.
      expect(project.owner).toBe(user);
      expect(project.owner?.username).toBe("alice");
    });

    it("returns undefined when reference pointer is null or undefined", () => {
      // Create project with undefined owner pointer.
      const project1 = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "project-101", title: "No Owner Project", owner: undefined },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Create project with null owner pointer.
      const project2 = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "project-102", title: "Null Owner Project", owner: null },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Confirm both resolve cleanly to undefined.
      expect(project1.owner).toBeUndefined();
      expect(project2.owner).toBeUndefined();
    });

    it("returns undefined when referenced entity does not exist in cache", () => {
      // Create project pointing to missing user.
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "project-103", title: "Missing Owner Project", owner: "missing-user-999" },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Confirm resolution yields undefined without throwing.
      expect(project.owner).toBeUndefined();
    });

    it("resolves populated array reference into live entity instances", () => {
      // Create task entities.
      const task1 = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-1", title: "Task 1" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );
      const task2 = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-2", title: "Task 2" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      // Create project referencing both tasks.
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "project-104", title: "Multi-Task Project", tasks: ["task-1", "task-2"] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Verify that tasks array resolves properly.
      expect(project.tasks.length).toBe(2);
      expect(project.tasks[0]).toBe(task1);
      expect(project.tasks[1]).toBe(task2);
    });

    it("filters out missing target entities from populated array reference", () => {
      // Create one valid task entity.
      const validTask = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-valid", title: "Valid Task" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      // Create project referencing valid and missing task IDs.
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        {
          _id: "project-105",
          title: "Dangling Array Project",
          tasks: ["missing-task-1", "task-valid", "missing-task-2"],
        },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Confirm only resolved entity is included in array.
      expect(project.tasks.length).toBe(1);
      expect(project.tasks[0]).toBe(validTask);
    });

    it("navigates circular references without stack overflow", () => {
      // Create circular NodeA and NodeB.
      const nodeA = createAndRegisterEntity(
        CircularNodeA,
        "CircularNodeA",
        nodeAManager,
        { _id: "node-a-1", name: "Alpha", nodeB: "node-b-1" },
        mockSocket,
        loggers,
        createTestCallbacks<CircularNodeA>(),
        emitter,
      );
      const nodeB = createAndRegisterEntity(
        CircularNodeB,
        "CircularNodeB",
        nodeBManager,
        { _id: "node-b-1", title: "Beta", nodeA: "node-a-1" },
        mockSocket,
        loggers,
        createTestCallbacks<CircularNodeB>(),
        emitter,
      );

      // Traverse circular loop back and forth.
      expect(nodeA.nodeB).toBe(nodeB);
      expect(nodeB.nodeA).toBe(nodeA);
      expect(nodeA.nodeB?.nodeA).toBe(nodeA);
      expect(nodeA.nodeB?.nodeA?.nodeB).toBe(nodeB);
      expect(nodeA.nodeB?.nodeA?.nodeB?.nodeA).toBe(nodeA);
    });

    it("navigates multi-node circular reference ring cleanly", () => {
      // Create three-node circular ring: A -> B -> C -> A.
      const nodeA = createAndRegisterEntity(
        CircularNodeA,
        "CircularNodeA",
        nodeAManager,
        { _id: "ring-a", name: "Node A", nodeB: "ring-b" },
        mockSocket,
        loggers,
        createTestCallbacks<CircularNodeA>(),
        emitter,
      );
      const nodeB = createAndRegisterEntity(
        CircularNodeB,
        "CircularNodeB",
        nodeBManager,
        { _id: "ring-b", title: "Node B", nodeC: "ring-c" },
        mockSocket,
        loggers,
        createTestCallbacks<CircularNodeB>(),
        emitter,
      );
      const nodeC = createAndRegisterEntity(
        CircularNodeC,
        "CircularNodeC",
        nodeCManager,
        { _id: "ring-c", label: "Node C", nodeA: "ring-a" },
        mockSocket,
        loggers,
        createTestCallbacks<CircularNodeC>(),
        emitter,
      );

      // Traverse complete circular ring twice.
      expect(nodeA.nodeB).toBe(nodeB);
      expect(nodeB.nodeC).toBe(nodeC);
      expect(nodeC.nodeA).toBe(nodeA);
      expect(nodeA.nodeB?.nodeC?.nodeA?.nodeB?.nodeC).toBe(nodeC);
    });

    it("prioritizes globalCache before querying sibling managers", () => {
      // Pre-populate globalCache with an explicit entry.
      const user = createAndRegisterEntity(
        UserProfile,
        "UserProfile",
        userManager,
        { _id: "cached-user", username: "cached_alice" },
        mockSocket,
        loggers,
        createTestCallbacks<UserProfile>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "project-cached", title: "Priority Project", owner: "cached-user" },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Verify that findReference finds entity in globalCache immediately.
      const resolved = project.owner;
      expect(resolved).toBe(user);
    });

    it("resolves empty relational array to empty proxy array", () => {
      // Create project with empty tasks array.
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "project-empty-arr", title: "Empty Tasks Project", tasks: [] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Confirm proxy array has length zero.
      expect(project.tasks.length).toBe(0);
      expect(Array.isArray(project.tasks)).toBe(true);
    });

    it("updates single reference via reflected setter with entity instance", () => {
      // Create initial user and replacement user.
      const user1 = createAndRegisterEntity(
        UserProfile,
        "UserProfile",
        userManager,
        { _id: "user-orig", username: "user_orig" },
        mockSocket,
        loggers,
        createTestCallbacks<UserProfile>(),
        emitter,
      );
      const user2 = createAndRegisterEntity(
        UserProfile,
        "UserProfile",
        userManager,
        { _id: "user-repl", username: "user_repl" },
        mockSocket,
        loggers,
        createTestCallbacks<UserProfile>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "project-set-ref", title: "Ref Setter Project", owner: "user-orig" },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      expect(project.owner).toBe(user1);

      // Assign replacement user via reflected setter.
      project.owner = user2;

      // Confirm owner getter resolves replacement user.
      expect(project.owner).toBe(user2);
      expect(project.owner?.username).toBe("user_repl");
    });
  });

  // =========================================================================
  // F01 + F03: Model Property Reflection & Reference Array Proxy Mutation
  // =========================================================================
  describe("F01 + F03: Model Reflection & Array Proxy Mutation Interception", () => {
    it("returns referentially stable array proxy across multiple reads", () => {
      // Create project entity with task references.
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-proxy-1", title: "Stability Project", tasks: [] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Access proxy multiple times and verify identity equality.
      const read1 = project.tasks;
      const read2 = project.tasks;
      expect(read1).toBe(read2);
      expect(Array.isArray(read1)).toBe(true);
    });

    it("intercepts push method and throws DEMError", () => {
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-proxy-2", title: "Push Test", tasks: [] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Attempt push and expect DEMError.
      expect(() => {
        project.tasks.push({} as never);
      }).toThrow(DEMError);

      expect(() => {
        project.tasks.push({} as never);
      }).toThrow(/Cannot mutate DEM reference array 'tasks' directly/);
    });

    it("intercepts pop, shift, and unshift methods and throws DEMError", () => {
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-proxy-3", title: "Mutate Test", tasks: [] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Verify pop, shift, and unshift are intercepted.
      expect(() => project.tasks.pop()).toThrow(DEMError);
      expect(() => project.tasks.shift()).toThrow(DEMError);
      expect(() => project.tasks.unshift({} as never)).toThrow(DEMError);
    });

    it("intercepts splice, sort, reverse, fill, and copyWithin methods", () => {
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-proxy-4", title: "Mutate Multi Test", tasks: [] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Verify remaining mutating methods throw DEMError.
      expect(() => project.tasks.splice(0, 1)).toThrow(DEMError);
      expect(() => project.tasks.sort()).toThrow(DEMError);
      expect(() => project.tasks.reverse()).toThrow(DEMError);
      expect(() => (project.tasks as unknown as { fill: Function }).fill(null)).toThrow(DEMError);
      expect(() => (project.tasks as unknown as { copyWithin: Function }).copyWithin(0, 1)).toThrow(DEMError);
    });

    it("intercepts index assignment and throws DEMError", () => {
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-proxy-5", title: "Index Assignment Test", tasks: [] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Verify direct index assignment throws DEMError.
      expect(() => {
        project.tasks[0] = {} as never;
      }).toThrow(DEMError);
      expect(() => {
        project.tasks[0] = {} as never;
      }).toThrow(/Cannot assign index on DEM reference array 'tasks'/);
    });

    it("intercepts element deletion and throws DEMError", () => {
      const task = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-del", title: "Task to delete" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-proxy-6", title: "Delete Test", tasks: ["task-del"] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Verify delete operator throws DEMError.
      expect(() => {
        delete project.tasks[0];
      }).toThrow(DEMError);
      expect(() => {
        delete project.tasks[0];
      }).toThrow(/Cannot delete elements from DEM reference array 'tasks'/);
    });

    it("allows standard read operations on array proxy", () => {
      const taskA = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-a", title: "Task Alpha" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );
      const taskB = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-b", title: "Task Beta" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-proxy-7", title: "Read Test", tasks: ["task-a", "task-b"] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Verify map, filter, find, slice, every, some, includes, indexOf.
      const titles = project.tasks.map((t) => t.title);
      expect(titles).toEqual(["Task Alpha", "Task Beta"]);

      const found = project.tasks.find((t) => t.title === "Task Beta");
      expect(found).toBe(taskB);

      const filtered = project.tasks.filter((t) => t.title.startsWith("Task"));
      expect(filtered.length).toBe(2);

      const sliced = project.tasks.slice(0, 1);
      expect(sliced).toEqual([taskA]);

      expect(project.tasks.includes(taskA)).toBe(true);
      expect(project.tasks.indexOf(taskB)).toBe(1);
      expect(project.tasks.some((t) => t.title === "Task Alpha")).toBe(true);
      expect(project.tasks.every((t) => t.title.length > 0)).toBe(true);
    });

    it("exposes internal mutable array via DEM_RAW_ARRAY symbol", () => {
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-proxy-8", title: "Raw Array Test", tasks: [] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Retrieve raw array via symbol and check properties.
      const raw = (project.tasks as unknown as Record<symbol, unknown[]>)[DEM_RAW_ARRAY];
      expect(Array.isArray(raw)).toBe(true);

      // Raw array permits internal mutation without error.
      expect(() => raw.push({ title: "Internal" } as never)).not.toThrow();
      expect(raw.length).toBe(1);
    });

    it("updates internal data and invalidates proxy cache on setter assignment", () => {
      const task1 = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-setter-1", title: "Task One" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );
      const task2 = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-setter-2", title: "Task Two" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-setter-1", title: "Setter Invalidation", tasks: ["task-setter-1"] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      const initialProxy = project.tasks;
      expect(initialProxy.length).toBe(1);
      expect(initialProxy[0]).toBe(task1);

      // Assign new task array via reflected prototype setter.
      project.tasks = [task2];

      // Verify proxy cache was invalidated and new proxy is returned.
      const updatedProxy = project.tasks;
      expect(updatedProxy).not.toBe(initialProxy);
      expect(updatedProxy.length).toBe(1);
      expect(updatedProxy[0]).toBe(task2);
    });
  });

  // =========================================================================
  // F01 + F11: Model Reflection & Self-Contained Snapshot Entities
  // =========================================================================
  describe("F01 + F11: Model Reflection & Self-Contained Snapshot Entities", () => {
    it("returns raw scalar values directly without manager lookups", () => {
      const user = createAndRegisterEntity(
        UserProfile,
        "UserProfile",
        userManager,
        { _id: "user-scalar", username: "bob_builder", email: "bob@builder.com" },
        mockSocket,
        loggers,
        createTestCallbacks<UserProfile>(),
        emitter,
      );

      // Verify reflected accessors return scalar values directly.
      expect(user.username).toBe("bob_builder");
      expect(user.email).toBe("bob@builder.com");
    });

    it("returns raw snapshot objects directly without manager lookups", () => {
      const snapshot: AccountSnapshot = {
        plan: "enterprise",
        features: ["sso", "audit_log", "unlimited_projects"],
        maxProjects: 100,
      };

      const user = createAndRegisterEntity(
        UserProfile,
        "UserProfile",
        userManager,
        { _id: "user-snap-1", username: "charlie", accountSnapshot: snapshot },
        mockSocket,
        loggers,
        createTestCallbacks<UserProfile>(),
        emitter,
      );

      // Verify snapshot object matches original data without reference resolution.
      expect(user.accountSnapshot).toBeDefined();
      expect(user.accountSnapshot.plan).toBe("enterprise");
      expect(user.accountSnapshot.features).toEqual(["sso", "audit_log", "unlimited_projects"]);
      expect(user.accountSnapshot.maxProjects).toBe(100);
    });

    it("preserves ID-like strings in snapshot objects without relational treatment", () => {
      const configSnapshot: ProjectConfigSnapshot = {
        theme: "dark",
        flags: ["beta_v2"],
        settings: {
          externalId: "507f1f77bcf86cd799439011",
          authorRef: "user-snap-1",
        },
      };

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-snap-ids", title: "Snapshot IDs", configSnapshot },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Verify ID strings inside snapshot remain intact and unmutated.
      expect(project.configSnapshot.settings["externalId"]).toBe("507f1f77bcf86cd799439011");
      expect(project.configSnapshot.settings["authorRef"]).toBe("user-snap-1");
    });

    it("stores snapshot property updates directly without ID coercion", () => {
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        {
          _id: "proj-snap-update",
          title: "Initial Title",
          configSnapshot: { theme: "light", flags: [], settings: {} },
        },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      const newSnapshot: ProjectConfigSnapshot = {
        theme: "high_contrast",
        flags: ["accessible_ui"],
        settings: { zoom: 125 },
      };

      // Assign new snapshot through reflected setter.
      project.configSnapshot = newSnapshot;

      // Verify snapshot property was replaced directly.
      expect(project.configSnapshot.theme).toBe("high_contrast");
      expect(project.configSnapshot.flags).toEqual(["accessible_ui"]);
      expect(project.configSnapshot.settings["zoom"]).toBe(125);
    });

    it("preserves deeply nested snapshot properties without relational conversion", () => {
      const nestedSnapshot: ProjectConfigSnapshot = {
        theme: "cyberpunk",
        flags: ["v2", "experimental"],
        settings: {
          database: {
            host: "cluster0.mongodb.net",
            ports: [27017, 27018],
            auth: { type: "scram-sha-256", enabled: true },
          },
        },
      };

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-deep-snap", title: "Deep Snapshot", configSnapshot: nestedSnapshot },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Verify that deep nested snapshot values remain intact.
      expect(project.configSnapshot.settings["database"]).toBeDefined();
      const dbConfig = project.configSnapshot.settings["database"] as Record<string, unknown>;
      expect(dbConfig["host"]).toBe("cluster0.mongodb.net");
      expect(dbConfig["ports"]).toEqual([27017, 27018]);
      expect((dbConfig["auth"] as Record<string, unknown>)["enabled"]).toBe(true);
    });
  });

  // =========================================================================
  // F02 + F03: Cross-Manager Relational Arrays with Back-References
  // =========================================================================
  describe("F02 + F03: Cross-Manager Relational Arrays with Back-References", () => {
    it("resolves cross-manager relational array and back-references", () => {
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-cross-1", title: "Cross Project", tasks: ["task-cross-1"] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      const task = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-cross-1", title: "Cross Task", project: "proj-cross-1" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      // Verify forward relational array resolves task across managers.
      expect(project.tasks.length).toBe(1);
      expect(project.tasks[0]).toBe(task);

      // Verify back-reference resolves parent project across managers.
      expect(task.project).toBe(project);
      expect(project.tasks[0].project).toBe(project);
    });

    it("resolves missing back-reference pointer via loadMissingReferences", async () => {
      // Create project containing task ID in its relational array.
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-backref", title: "Parent Project", tasks: ["task-orphan"] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Create task with missing project pointer in its initial data on server.
      const orphanTask = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-orphan", title: "Orphan Task" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
        true,
      );

      expect(orphanTask.project).toBeUndefined();

      // Trigger missing reference resolution.
      await orphanTask.loadMissingReferences();

      // Confirm back-reference was located from parent tasks array.
      expect(orphanTask.project).toBe(project);
    });

    it("purges deleted child from parent relational array proxy cache", async () => {
      const task1 = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "child-task-1", title: "Child 1" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );
      const task2 = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "child-task-2", title: "Child 2" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-parent", title: "Parent", tasks: ["child-task-1", "child-task-2"] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Initial read resolves both children into proxy.
      const initialTasks = project.tasks;
      expect(initialTasks.length).toBe(2);
      expect(initialTasks[0]).toBe(task1);
      expect(initialTasks[1]).toBe(task2);

      // Delete child-task-1 through taskManager.
      await taskManager.deleteObject("child-task-1");
      expect(globalCache.objects["child-task-1"]).toBeUndefined();

      // Next read of project.tasks must detect stale child and purge cache.
      const tasksAfterDelete = project.tasks;
      expect(tasksAfterDelete).not.toBe(initialTasks);
      expect(tasksAfterDelete.length).toBe(1);
      expect(tasksAfterDelete[0]).toBe(task2);
    });

    it("resolves multi-hop relational graph across multiple managers", () => {
      // Multi-hop graph: User -> Project -> Task -> Assignee User.
      const user = createAndRegisterEntity(
        UserProfile,
        "UserProfile",
        userManager,
        { _id: "multihop-user", username: "super_developer" },
        mockSocket,
        loggers,
        createTestCallbacks<UserProfile>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "multihop-proj", title: "Multi-Hop Project", owner: "multihop-user", tasks: ["multihop-task"] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      const task = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        {
          _id: "multihop-task",
          title: "Multi-Hop Task",
          project: "multihop-proj",
          assignee: "multihop-user",
        },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      // Traverse multi-hop graph in both directions.
      expect(project.owner).toBe(user);
      expect(project.tasks[0]).toBe(task);
      expect(project.tasks[0].assignee).toBe(user);
      expect(task.project?.owner?.username).toBe("super_developer");
      expect(task.assignee).toBe(user);
    });

    it("preserves duplicate references within relational array proxy", () => {
      const task = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-dup", title: "Duplicate Task" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      // Create project referencing the same task twice.
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-dup", title: "Duplicate Ref Project", tasks: ["task-dup", "task-dup"] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Verify proxy array preserves both duplicate entries.
      expect(project.tasks.length).toBe(2);
      expect(project.tasks[0]).toBe(task);
      expect(project.tasks[1]).toBe(task);
    });
  });

  // =========================================================================
  // F02 + F11: Hybrid Entities (Populated References & Snapshot Objects)
  // =========================================================================
  describe("F02 + F11: Hybrid Entities with References and Snapshots", () => {
    it("resolves live populated reference while preserving snapshot object", () => {
      const user = createAndRegisterEntity(
        UserProfile,
        "UserProfile",
        userManager,
        { _id: "user-hybrid-1", username: "live_author" },
        mockSocket,
        loggers,
        createTestCallbacks<UserProfile>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        {
          _id: "proj-hybrid-1",
          title: "Hybrid Project",
          owner: "user-hybrid-1",
          configSnapshot: {
            theme: "emerald",
            flags: ["experimental_v3"],
            settings: { maxUploadMb: 50 },
          },
        },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Confirm live relation resolves to user.
      expect(project.owner).toBe(user);
      expect(project.owner?.username).toBe("live_author");

      // Confirm snapshot object is preserved independently.
      expect(project.configSnapshot.theme).toBe("emerald");
      expect(project.configSnapshot.flags).toEqual(["experimental_v3"]);
    });

    it("reflects live reference updates while keeping snapshot object frozen", () => {
      const user = createAndRegisterEntity(
        UserProfile,
        "UserProfile",
        userManager,
        { _id: "user-hybrid-2", username: "original_name" },
        mockSocket,
        loggers,
        createTestCallbacks<UserProfile>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        {
          _id: "proj-hybrid-2",
          title: "Update Project",
          owner: "user-hybrid-2",
          configSnapshot: { theme: "original_theme", flags: [], settings: {} },
        },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Mutate live user entity data.
      (user as unknown as { data: { username: string } }).data.username = "renamed_user";

      // Live relation reflects name change immediately.
      expect(project.owner?.username).toBe("renamed_user");

      // Snapshot object remains strictly unmodified.
      expect(project.configSnapshot.theme).toBe("original_theme");
    });

    it("returns undefined for deleted entity while snapshot object persists", async () => {
      const user = createAndRegisterEntity(
        UserProfile,
        "UserProfile",
        userManager,
        { _id: "user-hybrid-3", username: "temporary_user" },
        mockSocket,
        loggers,
        createTestCallbacks<UserProfile>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        {
          _id: "proj-hybrid-3",
          title: "Persistent Snapshot Project",
          owner: "user-hybrid-3",
          configSnapshot: { theme: "solarized", flags: ["readonly"], settings: { id: 42 } },
        },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      expect(project.owner).toBe(user);

      // Delete referenced user from userManager.
      await userManager.deleteObject("user-hybrid-3");

      // Populated reference now resolves to undefined.
      expect(project.owner).toBeUndefined();

      // Snapshot object persists completely intact.
      expect(project.configSnapshot.theme).toBe("solarized");
      expect(project.configSnapshot.flags).toEqual(["readonly"]);
      expect(project.configSnapshot.settings["id"]).toBe(42);
    });
  });

  // =========================================================================
  // F03 + F11: Arrays inside Snapshot Subdocuments Preserved without Proxy
  // =========================================================================
  describe("F03 + F11: Snapshot Arrays Preserved without Relational Proxy Wrapping", () => {
    it("preserves snapshot array as standard JavaScript array", () => {
      const task = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        {
          _id: "task-snap-arr",
          title: "Array Task",
          tags: ["bug", "critical", "backend"],
          auditLogs: [
            { action: "created", timestamp: 1000, actor: "system" },
            { action: "triaged", timestamp: 2000, actor: "lead" },
          ],
        },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      // Verify tags snapshot array is standard array.
      expect(Array.isArray(task.tags)).toBe(true);
      expect(task.tags.length).toBe(3);

      // Verify auditLogs snapshot array is standard array.
      expect(Array.isArray(task.auditLogs)).toBe(true);
      expect(task.auditLogs.length).toBe(2);
    });

    it("permits in-place mutations on snapshot array properties", () => {
      const task = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        {
          _id: "task-snap-mut",
          title: "Mutable Snap Task",
          tags: ["frontend"],
          auditLogs: [],
        },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      // Mutating snapshot arrays must NOT throw DEMError.
      expect(() => task.tags.push("urgent")).not.toThrow();
      expect(task.tags).toContain("urgent");

      expect(() => task.tags.pop()).not.toThrow();
      expect(task.tags).not.toContain("urgent");

      expect(() => task.tags.splice(0, 1, "backend", "database")).not.toThrow();
      expect(task.tags).toEqual(["backend", "database"]);

      expect(() => task.tags.unshift("p0")).not.toThrow();
      expect(task.tags[0]).toBe("p0");

      expect(() => task.tags.shift()).not.toThrow();
      expect(task.tags[0]).toBe("backend");
    });

    it("does not expose DEM_RAW_ARRAY symbol on snapshot arrays", () => {
      const task = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-no-symbol", title: "No Symbol Task", tags: ["dev"] },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      // Confirm snapshot array lacks DEM_RAW_ARRAY symbol.
      const raw = (task.tags as unknown as Record<symbol, unknown>)[DEM_RAW_ARRAY];
      expect(raw).toBeUndefined();
    });

    it("isolates proxy wrapping between reference array and snapshot array", () => {
      const depTask = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-dep", title: "Dependency Task" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      const mainTask = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        {
          _id: "task-main",
          title: "Main Task",
          dependencies: ["task-dep"],
          tags: ["core"],
        },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      // Relational array 'dependencies' MUST block mutation.
      expect(() => {
        mainTask.dependencies.push({} as never);
      }).toThrow(DEMError);

      // Snapshot array 'tags' MUST permit mutation.
      expect(() => {
        mainTask.tags.push("release_ready");
      }).not.toThrow();
      expect(mainTask.tags).toEqual(["core", "release_ready"]);
    });
  });

  // =========================================================================
  // F01 + F02 + F03: Triplet (Model Reflection + Relation Resolution + Array Proxy)
  // =========================================================================
  describe("F01 + F02 + F03: Triplet Combination", () => {
    it("combines reflection, relationship resolution, and proxy immutability", () => {
      const task1 = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "triplet-task-1", title: "Triplet One" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );
      const task2 = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "triplet-task-2", title: "Triplet Two" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        {
          _id: "triplet-proj",
          title: "Triplet Project",
          tasks: ["triplet-task-1", "triplet-task-2"],
        },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // 1. Reflected getter resolves relational array into live entities.
      expect(project.tasks.length).toBe(2);
      expect(project.tasks[0]).toBe(task1);
      expect(project.tasks[1]).toBe(task2);

      // 2. Returned collection is protected by ReadOnlyArrayProxy.
      expect(() => project.tasks.push(task1)).toThrow(DEMError);
      expect(() => project.tasks.pop()).toThrow(DEMError);

      // 3. Consecutive reads yield referentially identical proxy.
      expect(project.tasks).toBe(project.tasks);
    });

    it("filters dangling pointers while preserving rawIdsHash", () => {
      const task = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-live", title: "Live Task" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        {
          _id: "proj-dangling",
          title: "Dangling Project",
          tasks: ["missing-task-a", "task-live", "missing-task-b"],
        },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Proxy resolves only the live task.
      const proxy = project.tasks;
      expect(proxy.length).toBe(1);
      expect(proxy[0]).toBe(task);

      // Raw IDs hash preserves all three IDs.
      const cacheEntry = project._refArrayCache?.get("tasks");
      expect(cacheEntry?.rawIdsHash).toBe("missing-task-a,task-live,missing-task-b");
    });

    it("re-resolves entities and produces new proxy after setter assignment", () => {
      const taskA = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-alpha", title: "Alpha" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );
      const taskB = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-beta", title: "Beta" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-reassign", title: "Reassignment Project", tasks: ["task-alpha"] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      const proxy1 = project.tasks;
      expect(proxy1.length).toBe(1);
      expect(proxy1[0]).toBe(taskA);

      // Update tasks array via reflected setter using entity instances.
      project.tasks = [taskB];

      const proxy2 = project.tasks;
      expect(proxy2).not.toBe(proxy1);
      expect(proxy2.length).toBe(1);
      expect(proxy2[0]).toBe(taskB);
    });

    it("invalidates proxy cache and emits update on setValue", async () => {
      const task1 = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-sv-1", title: "SV 1" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );
      const task2 = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "task-sv-2", title: "SV 2" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        { _id: "proj-sv", title: "Set Value Project", tasks: ["task-sv-1"] },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      const initialProxy = project.tasks;
      expect(initialProxy[0]).toBe(task1);

      // Perform remote setValue update on reference array.
      const result = await project.setValue("tasks" as never, ["task-sv-2"] as never);
      expect(result.success).toBe(true);

      // Verify proxy cache was invalidated.
      const newProxy = project.tasks;
      expect(newProxy).not.toBe(initialProxy);
      expect(newProxy.length).toBe(1);
      expect(newProxy[0]).toBe(task2);
    });
  });

  // =========================================================================
  // F01 + F02 + F11: Triplet (Reflection + Relations + Snapshot Extraction)
  // =========================================================================
  describe("F01 + F02 + F11: Triplet Combination & Data Extraction", () => {
    it("normalizes populated reference entities to string identifiers in extractedData", () => {
      const user = createAndRegisterEntity(
        UserProfile,
        "UserProfile",
        userManager,
        { _id: "extract-user", username: "dave" },
        mockSocket,
        loggers,
        createTestCallbacks<UserProfile>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        {
          _id: "extract-proj",
          title: "Extraction Project",
          owner: "extract-user",
          configSnapshot: { theme: "contrast", flags: ["ready"], settings: { v: 1 } },
        },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      // Extract entity data.
      const extracted = project.extractedData;

      // Populated reference owner MUST be normalized to string ID.
      expect(extracted.owner).toBe("extract-user");
      expect(typeof extracted.owner).toBe("string");
    });

    it("normalizes relational arrays to string identifiers in extractedData", () => {
      createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "extract-task-1", title: "Task 1" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );
      createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        { _id: "extract-task-2", title: "Task 2" },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        {
          _id: "extract-proj-arr",
          title: "Array Extract",
          tasks: ["extract-task-1", "extract-task-2"],
          configSnapshot: { theme: "light", flags: [], settings: {} },
        },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      const extracted = project.extractedData;

      // Relational array tasks MUST be normalized to ID strings.
      expect(extracted.tasks).toEqual(["extract-task-1", "extract-task-2"]);
    });

    it("preserves embedded snapshot subdocuments and arrays in extractedData", () => {
      const task = createAndRegisterEntity(
        TaskItem,
        "TaskItem",
        taskManager,
        {
          _id: "extract-task-full",
          title: "Full Task",
          tags: ["snapshot_tag_1", "snapshot_tag_2"],
          auditLogs: [
            { action: "created", timestamp: 12345, actor: "admin" },
            { action: "reviewed", timestamp: 67890, actor: "auditor" },
          ],
        },
        mockSocket,
        loggers,
        createTestCallbacks<TaskItem>(),
        emitter,
      );

      const extracted = task.extractedData;

      // Verify snapshot subdocuments and arrays remain completely intact.
      expect(extracted.tags).toEqual(["snapshot_tag_1", "snapshot_tag_2"]);
      expect(extracted.auditLogs).toEqual([
        { action: "created", timestamp: 12345, actor: "admin" },
        { action: "reviewed", timestamp: 67890, actor: "auditor" },
      ]);
    });

    it("serializes MongoDB ObjectId instances to strings in extractedData", () => {
      const rawObjectId = new ObjectId("507f1f77bcf86cd799439011");

      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        {
          _id: rawObjectId,
          title: "ObjectId Project",
          configSnapshot: { theme: "dark", flags: [], settings: {} },
        },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      const extracted = project.extractedData;

      // _id MUST be serialized as hex string.
      expect(extracted._id).toBe("507f1f77bcf86cd799439011");
      expect(typeof extracted._id).toBe("string");
    });

    it("returns deep clone from extractedData protecting entity state", () => {
      const project = createAndRegisterEntity(
        Project,
        "Project",
        projectManager,
        {
          _id: "deep-clone-proj",
          title: "Deep Clone Test",
          configSnapshot: {
            theme: "dark",
            flags: ["original_flag"],
            settings: { count: 10 },
          },
        },
        mockSocket,
        loggers,
        createTestCallbacks<Project>(),
        emitter,
      );

      const extracted = project.extractedData;

      // Mutate extracted snapshot object and array.
      extracted.configSnapshot.flags.push("mutated_flag");
      extracted.configSnapshot.settings["count"] = 999;

      // Confirm internal entity data remains unaffected.
      expect(project.configSnapshot.flags).toEqual(["original_flag"]);
      expect(project.configSnapshot.settings["count"]).toBe(10);
    });

    it("extracts clean string IDs from circular entity graph without infinite recursion", () => {
      // Create circular NodeA and NodeB instances.
      const nodeA = createAndRegisterEntity(
        CircularNodeA,
        "CircularNodeA",
        nodeAManager,
        {
          _id: "circ-ext-a",
          name: "Circle Alpha",
          nodeB: "circ-ext-b",
          snapshotData: { version: 1, tags: ["circ", "a"] },
        },
        mockSocket,
        loggers,
        createTestCallbacks<CircularNodeA>(),
        emitter,
      );

      const nodeB = createAndRegisterEntity(
        CircularNodeB,
        "CircularNodeB",
        nodeBManager,
        {
          _id: "circ-ext-b",
          title: "Circle Beta",
          nodeA: "circ-ext-a",
          snapshotData: { version: 2, tags: ["circ", "b"] },
        },
        mockSocket,
        loggers,
        createTestCallbacks<CircularNodeB>(),
        emitter,
      );

      // Extract data from both circular instances.
      const extA = nodeA.extractedData;
      const extB = nodeB.extractedData;

      // Confirm normalized IDs and intact snapshot subdocuments.
      expect(extA._id).toBe("circ-ext-a");
      expect(extA.nodeB).toBe("circ-ext-b");
      expect(extA.snapshotData).toEqual({ version: 1, tags: ["circ", "a"] });

      expect(extB._id).toBe("circ-ext-b");
      expect(extB.nodeA).toBe("circ-ext-a");
      expect(extB.snapshotData).toEqual({ version: 2, tags: ["circ", "b"] });
    });
  });

  // =========================================================================
  // F02 + F03 + F11: Triplet (Relational Arrays + Back-Refs + Snapshots)
  // =========================================================================
  describe("F02 + F03 + F11: Triplet Combination & Ecosystem Integrity", () => {
    it("navigates mutual circular relational arrays with snapshots without recursion", () => {
      const dept = createAndRegisterEntity(
        Department,
        "Department",
        deptManager,
        {
          _id: "dept-circ-1",
          name: "Engineering",
          members: ["member-circ-1"],
          metadataSnapshot: { budget: 500000, code: "ENG" },
        },
        mockSocket,
        loggers,
        createTestCallbacks<Department>(),
        emitter,
      );

      const member = createAndRegisterEntity(
        DepartmentMember,
        "DepartmentMember",
        memberManager,
        {
          _id: "member-circ-1",
          fullName: "Eve Developer",
          department: "dept-circ-1",
          skillsSnapshot: ["TypeScript", "Docker", "NodeJS"],
        },
        mockSocket,
        loggers,
        createTestCallbacks<DepartmentMember>(),
        emitter,
      );

      // Forward navigation from department to member.
      expect(dept.members.length).toBe(1);
      expect(dept.members[0]).toBe(member);

      // Back-reference navigation from member to department.
      expect(member.department).toBe(dept);

      // Circular navigation across managers.
      expect(dept.members[0].department?.members[0]).toBe(member);

      // Snapshot subdocuments preserved on both sides.
      expect(dept.metadataSnapshot["budget"]).toBe(500000);
      expect(member.skillsSnapshot).toEqual(["TypeScript", "Docker", "NodeJS"]);
    });

    it("produces normalized extractedData on circular entities without recursion", () => {
      const dept = createAndRegisterEntity(
        Department,
        "Department",
        deptManager,
        {
          _id: "dept-extract-1",
          name: "Design",
          members: ["member-extract-1"],
          metadataSnapshot: { lead: "Frank" },
        },
        mockSocket,
        loggers,
        createTestCallbacks<Department>(),
        emitter,
      );

      const member = createAndRegisterEntity(
        DepartmentMember,
        "DepartmentMember",
        memberManager,
        {
          _id: "member-extract-1",
          fullName: "Frank Designer",
          department: "dept-extract-1",
          skillsSnapshot: ["Figma", "UI/UX"],
        },
        mockSocket,
        loggers,
        createTestCallbacks<DepartmentMember>(),
        emitter,
      );

      // Extract data from Department.
      const deptExtracted = dept.extractedData;
      expect(deptExtracted._id).toBe("dept-extract-1");
      expect(deptExtracted.members).toEqual(["member-extract-1"]);
      expect(deptExtracted.metadataSnapshot).toEqual({ lead: "Frank" });

      // Extract data from DepartmentMember.
      const memberExtracted = member.extractedData;
      expect(memberExtracted._id).toBe("member-extract-1");
      expect(memberExtracted.department).toBe("dept-extract-1");
      expect(memberExtracted.skillsSnapshot).toEqual(["Figma", "UI/UX"]);
    });

    it("blocks relational array mutation while allowing snapshot mutation", () => {
      const dept = createAndRegisterEntity(
        Department,
        "Department",
        deptManager,
        {
          _id: "dept-mut-guard",
          name: "Operations",
          members: ["member-mut-1"],
          metadataSnapshot: { shifts: ["morning", "night"] },
        },
        mockSocket,
        loggers,
        createTestCallbacks<Department>(),
        emitter,
      );

      const member = createAndRegisterEntity(
        DepartmentMember,
        "DepartmentMember",
        memberManager,
        {
          _id: "member-mut-1",
          fullName: "Grace Ops",
          department: "dept-mut-guard",
          skillsSnapshot: ["Monitoring"],
        },
        mockSocket,
        loggers,
        createTestCallbacks<DepartmentMember>(),
        emitter,
      );

      // Relational array mutation is blocked on Department.
      expect(() => {
        dept.members.push(member);
      }).toThrow(DEMError);

      // Snapshot subdocument mutation succeeds on Department.
      expect(() => {
        (dept.metadataSnapshot["shifts"] as string[]).push("weekend");
      }).not.toThrow();
      expect(dept.metadataSnapshot["shifts"]).toContain("weekend");

      // Snapshot array mutation succeeds on Member.
      expect(() => {
        member.skillsSnapshot.push("Incident Response");
      }).not.toThrow();
      expect(member.skillsSnapshot).toContain("Incident Response");
    });

    it("blocks direct setValue on back-reference pointer with CANNOT_SET_REF_DIRECTLY", async () => {
      const member = createAndRegisterEntity(
        DepartmentMember,
        "DepartmentMember",
        memberManager,
        {
          _id: "member-direct-set",
          fullName: "Hank",
          department: "dept-any",
          skillsSnapshot: [],
        },
        mockSocket,
        loggers,
        createTestCallbacks<DepartmentMember>(),
        emitter,
      );

      // Attempting setValue on a populatedRef pointer directly MUST return CANNOT_SET_REF_DIRECTLY error.
      const res = await member.setValue("department" as never, "new-dept-id" as never);
      expect(res.success).toBe(false);
      expect(res.code).toBe(DEMErrorCode.CANNOT_SET_REF_DIRECTLY);
      expect(res.msg).toContain("Cannot set value of a reference pointer directly");
    });
  });
});
