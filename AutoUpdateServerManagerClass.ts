import { Server, Socket } from "socket.io";
import { AutoUpdateManager } from "./AutoUpdateManagerClass.js";
import { createAutoUpdatedClass } from "./AutoUpdatedServerObjectClass.js";
import {
  Constructor,
  IsData,
  LoggersType,
  globalCache,
  ServerResponse,
  IAutoUpdatedClientObject,
  EVENT_NEW,
  EVENT_UPDATE,
  EVENT_DELETE,
  EVENT_GET,
  EVENT_STARTUP,
  EVENT_VERSION,
  EVENT_DEAUTHENTICATE,
  DEM_VERSION,
  DEM_SERVER_VERSION,
  DEM_PROTOCOL_VERSION,
  EventEmitter3,
  MongoId,
  IAutoUpdatedClientObjectBase,
  IAutoUpdateManager,
  safeStringify,
  verifyDEMVersion,
  DEMError,
  DEMErrorCode,
  toDEMError,
  EntityDescriptor,
  LazyLoadingOptions,
} from "./CommonTypes.js";
import { BeAnObject, ReturnModelType } from "@typegoose/typegoose/lib/types";
import { EventEmitter } from "eventemitter3";
import * as machineId from "node-machine-id";
import { getModelForClass } from "@typegoose/typegoose";
import { Paths } from "./CommonTypes.js";
import {
  AutoUpdatedClientObject,
  beginReverseReferenceIndexScope,
  endReverseReferenceIndexScope,
  getMetadataRecursive,
  setupClassAccessors,
} from "./AutoUpdatedClientObjectClass.js";
import {
  ServerChangeTracker,
  ServerDeltaSyncOptions,
  ChangeEntry,
} from "./sync/index.js";

export type WrappedInstances<
  T extends Record<string, IAutoUpdatedClientObject<any>>,
> = {
  [K in keyof T]: AutoUpdateServerManager<T[K]>;
};

export type AUSDefinitions<
  T extends Record<string, IAutoUpdatedClientObject<any>>,
> = {
  [K in keyof T]: ServerManagerDefinition<T[K], T>;
};

export type EventMiddlewareFunction<
  T extends Record<string, IAutoUpdatedClientObject<any>>,
  C extends IAutoUpdatedClientObject<any>,
> = (
  event: DEMEvent<C>,
  managers: WrappedInstances<T>,
  socket: Socket,
) => Promise<void>;

export type StartupMiddlewareFunction<
  T extends Record<string, IAutoUpdatedClientObject<any>>,
  C extends IAutoUpdatedClientObject<any>,
> = (ids: C[], managers: WrappedInstances<T>, socket: Socket) => Promise<C[]>;

export type AccessMiddleware<
  T extends Record<string, IAutoUpdatedClientObject<any>>,
  C extends IAutoUpdatedClientObject<any>,
> = {
  eventMiddleware?: EventMiddlewareFunction<T, C>;
  startupMiddleware?: StartupMiddlewareFunction<T, C>;
};

export type AUSOption<
  C extends IAutoUpdatedClientObject<any>,
  T extends Record<string, IAutoUpdatedClientObject<any>>,
> = {
  accessDefinitions?: AccessMiddleware<T, C>;
  onUpdate?: (
    obj: C,
    set: (
      key: Paths<C, AutoUpdatedClientObject<any>>,
      val: any,
    ) => Promise<{ success: boolean; msg: string }>,
    key: Paths<C, AutoUpdatedClientObject<any>>,
  ) => Promise<void>;
  onDeletion?: (obj: C) => Promise<void>;
  deltaSync?: boolean | ServerDeltaSyncOptions;
  lazyLoading?: boolean | LazyLoadingOptions;
};

export type ServerManagerDefinition<
  C extends IAutoUpdatedClientObject<any>,
  T extends Record<string, IAutoUpdatedClientObject<any>>,
> = {
  class: Constructor<C>;
  options?: AUSOption<C, T>;
};

export type BaseManagers = Record<string, IAutoUpdateManager<any>>;

export enum DEMEventTypes {
  "new" = "new",
  "update" = "update",
  "delete" = "delete",
  "get" = "get",
  "startup" = "startup",
}

export type DEMEvent<C extends IAutoUpdatedClientObject<any>> =
  | {
      type: DEMEventTypes.delete | DEMEventTypes.get;
      manager: IAutoUpdateManager<C>;
      object: C;
      data: never;
    }
  | {
      type: DEMEventTypes.update;
      manager: IAutoUpdateManager<C>;
      object: C;
      data: { _id: string; key: string; value: unknown };
    }
  | {
      type: DEMEventTypes.startup;
      manager: IAutoUpdateManager<C>;
      object: never;
      data: never;
    }
  | {
      type: DEMEventTypes.new;
      manager: IAutoUpdateManager<C>;
      object: never;
      data: Omit<IsData<C>, "_id">;
    };

/**
 * Configures event whitelisting and permission middleware for the Socket.IO server.
 *
 * @param socket_server - Socket.IO server instance.
 * @param loggers - Logging interfaces.
 * @param managers - Registry of server managers.
 * @param _models - Optional models registry.
 */
export function setupSocketMiddleware(
  socket_server: Server,
  loggers: LoggersType,
  managers: BaseManagers,
  _models?: unknown,
) {
  socket_server.use(async (socket, next) => {
    socket.use((async (
      event: [string, unknown?, ((res: ServerResponse<unknown>) => void)?],
      nextEvent: (err?: Error) => void,
    ) => {
      const hasAck = typeof event[2] === "function";
      const isValidPayload =
        typeof event[0] === "string" &&
        (event.length === 2 || (event.length === 3 && hasAck));

      if (!isValidPayload) {
        loggers.warn?.(
          "Invalid event: [" +
            event
              .map((e) => (typeof e === "object" ? "[object]" : String(e)))
              .join("], [") +
            "]",
        );
        return;
      }
      if (
        !socket
          .eventNames()
          .some(
            (e) =>
              e.toString() === event[0] ||
              e.toString() === event[0].slice(0, -24),
          )
      ) {
        loggers.warn?.(
          "Undefined event: [" +
            event
              .map((e) => (typeof e === "object" ? "[object]" : String(e)))
              .join("], [") +
            "]",
        );
        if (typeof event[2] === "function") {
          event[2]({
            success: false,
            code: DEMErrorCode.UNDEFINED_EVENT,
            message: "Undefined event, event: " + event[0] + " not found",
          });
        }
        return;
      }
      try {
        const e = event[0];
        let demEvent: DEMEvent<IAutoUpdatedClientObject<any>>;
        const id = e.slice(-24);
        switch (true) {
          case e.startsWith(EVENT_NEW):
            demEvent = {
              type: DEMEventTypes.new,
              manager: managers[
                e.replace(EVENT_NEW, "")
              ] as IAutoUpdateManager<any>,
              data: event[1] as IsData<any>,
              object: undefined as never,
            } as DEMEvent<any>;
            break;
          case e.startsWith(EVENT_UPDATE):
            {
              const manager =
                managers[e.replace(EVENT_UPDATE, "").replace(id, "")];
              demEvent = {
                type: DEMEventTypes.update,
                manager: manager as IAutoUpdateManager<any>,
                object: (manager as IAutoUpdateManager<any>).getObject(
                  id,
                ) as any,
                data: event[1] as { _id: string; key: string; value: unknown },
              } as DEMEvent<any>;
            }
            break;
          case e.startsWith(EVENT_DELETE):
            {
              const manager = managers[e.replace(EVENT_DELETE, "")];
              const obj = (manager as IAutoUpdateManager<any>).getObject(
                event[1] as string,
              );
              if (!obj) {
                if (typeof event[2] === "function") {
                  event[2]({
                    success: true,
                    message: "Object already deleted",
                    data: undefined,
                  });
                }
                return;
              }
              demEvent = {
                type: DEMEventTypes.delete,
                manager: manager as IAutoUpdateManager<any>,
                object: obj as any,
                data: undefined as never,
              } as DEMEvent<any>;
            }
            break;
          case e.startsWith(EVENT_GET):
            {
              const manager =
                managers[e.replace(EVENT_GET, "").replace(id, "")];
              demEvent = {
                type: DEMEventTypes.get,
                manager: manager as IAutoUpdateManager<any>,
                object: (manager as IAutoUpdateManager<any>).getObject(
                  id,
                ) as any,
                data: undefined as never,
              } as DEMEvent<any>;
            }
            break;
          case e.startsWith(EVENT_STARTUP):
            demEvent = {
              type: DEMEventTypes.startup,
              manager: managers[
                e.replace(EVENT_STARTUP, "")
              ] as IAutoUpdateManager<any>,
              object: undefined as never,
              data: undefined as never,
            } as DEMEvent<any>;
            break;
          default:
            if (socket.eventNames().some((name) => name.toString() === e)) {
              return nextEvent();
            }
            throw new DEMError(
              DEMErrorCode.UNKNOWN_EVENT,
              "Unknown event: " +
                e +
                " - known events: [" +
                Object.values(DEMEventTypes).join(", ") +
                "]",
            );
        }
        try {
          await (
            demEvent.manager as any
          ).options?.accessDefinitions?.eventMiddleware?.(
            demEvent,
            managers as any,
            socket,
          );
          nextEvent();
        } catch (error: unknown) {
          loggers.warn?.(
            "Someone got access denied:\nUser (" +
              safeStringify(socket.handshake.auth) +
              ")\nWith ID: '" +
              socket.id +
              "'\nFrom: '" +
              socket.handshake.address +
              "'\nTo the event: '" +
              event[0] +
              "'\nFor: '" +
              (error instanceof Error ? error.message : String(error)) +
              "'",
          );
          if (typeof event[2] === "function") {
            event[2]({
              success: false,
              code: DEMErrorCode.ACCESS_DENIED,
              message:
                "You were denied access to this event '" +
                event[0] +
                "' by the server.\n" +
                (error instanceof Error ? error.message : String(error)),
            });
          }
        }
      } catch (error: unknown) {
        const demErr = toDEMError(error, DEMErrorCode.INTERNAL_ERROR);
        loggers.error?.(
          "Error with event: " +
            event[0] +
            "\nError: " +
            demErr.message,
        );
        if (typeof event[2] === "function") {
          event[2]({
            success: false,
            code: demErr.code,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
    }) as any);
    next();
  });
}

/**
 * Inspects database readiness states across all configured server managers.
 *
 * @param managers - Registry of server managers to inspect.
 * @param loggers - Optional logger callbacks.
 * @param emitter - Optional event emitter for error events.
 * @throws {DEMError} Throws DEMErrorCode.DB_NOT_CONNECTED if any database is disconnected.
 */
export function checkServerDbStates(
  managers: Record<string, AutoUpdateServerManager<any>>,
  loggers?: LoggersType,
  emitter?: EventEmitter3,
): void {
  for (const [key, manager] of Object.entries(managers)) {
    if (!manager) continue;
    const status = manager.checkDbState();
    if (!status.connected) {
      const err = new DEMError(
        DEMErrorCode.DB_NOT_CONNECTED,
        `Server DB state check failed for '${key}': Database is in state '${status.stateName}' (code: ${status.readyState}). Database must be connected before DEM starts loading.`,
        { manager: key, readyState: status.readyState, stateName: status.stateName },
      );
      emitter?.emit("error", err);
      loggers?.error?.(err.message);
      throw err;
    }
  }
}

/**
 * Initializes and starts all server managers, executes DB state assertions, preloads data, and attaches sockets.
 *
 * @param defs - Server manager definitions including class constructors and options.
 * @param loggers_ - Loggers interface.
 * @param socket - Socket.IO server instance.
 * @param doDebug - Flag indicating whether debug logging is enabled.
 * @param emitter - Shared event emitter.
 * @param models - Optional model registry.
 * @returns Promise resolving to the map of initialized server managers.
 */
export async function AUSManagerFactory<
  T extends Record<string, IAutoUpdatedClientObject<any>>,
>(
  defs: AUSDefinitions<T>,
  loggers_: LoggersType,
  socket: Server,
  doDebug: boolean = true,
  emitter: EventEmitter3 = new EventEmitter(),
  models?: unknown,
): Promise<WrappedInstances<T>> {
  // Use delegation instead of cloning or direct mutation to ensure late-added spies work
  const loggers: LoggersType = {
    info: (s: string) => loggers_.info?.(s),
    debug: (s: string) => (doDebug ? loggers_.debug?.(s) : undefined),
    error: (s: string) => loggers_.error?.(s),
    warn: (s: string) => loggers_.warn?.(s),
  };

  socket.use((socket, next) => {
    socket.onAny((event) => {});
    next();
  });

  const managers = {} as WrappedInstances<T>;
  const keys = Object.keys(defs);

  // 1. Create all managers
  for (const key of keys) {
    loggers.debug?.(`Creating manager for ${key}`);
    const def = defs[key];
    const model = getModelForClass(def.class as any);
    try {
      const c = new AutoUpdateServerManager(
        def.class,
        key,
        socket,
        loggers,
        model as any,
        managers as unknown as Record<string, IAutoUpdateManager<any>>,
        emitter,
        def.options as any,
      );
      (managers as any)[key] = c;
    } catch (error: unknown) {
      loggers.error?.("Error creating manager: " + key);
      loggers.error?.(error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.stack) loggers.error?.(error.stack);
    }
  }

  // 1.5. Inspect database states before loading starts
  checkServerDbStates(
    managers as unknown as Record<string, AutoUpdateServerManager<any>>,
    loggers,
    emitter,
  );

  // 2. Pre-load all managers in parallel
  await Promise.all(
    keys.map(async (key) => {
      if (!managers[key]) return;
      loggers.debug?.("Loading DB for manager: " + key);
      try {
        await (managers[key] as any).preLoad();
      } catch (error: unknown) {
        loggers.error?.("Error loading DB for manager: " + key);
        loggers.error?.(error instanceof Error ? error.message : String(error));
        if (error instanceof Error && error.stack) loggers.error?.(error.stack);
      }
    }),
  );

  // 3. Load references for all managers in parallel.
  // Phase 1 (initial references) completes on all managers before phase 2 starts.
  // Phase 2 has no external writers, so missing back-reference lookups use cached reverse indexes.
  const runReferencePhase = async (
    phase: "loadInitialReferences" | "loadPointerReferences",
  ): Promise<void> => {
    await Promise.all(
      (Object.values(managers) as AutoUpdateServerManager<any>[]).map(
        async (manager) => {
          try {
            await manager[phase]();
          } catch (error: unknown) {
            loggers.error?.(
              "Error loading DB for manager: " +
                manager.className +
                " (loadReferences)",
            );
            loggers.error?.(
              error instanceof Error ? error.message : String(error),
            );
            if (error instanceof Error && error.stack)
              loggers.error?.(error.stack);
          }
        },
      ),
    );
  };
  await runReferencePhase("loadInitialReferences");
  beginReverseReferenceIndexScope(managers);
  try {
    await runReferencePhase("loadPointerReferences");
  } finally {
    endReverseReferenceIndexScope(managers);
  }

  socket.on("connection", async (socket: Socket) => {
    loggers.debug?.(`Client connected: ${socket?.id}`);
    socket?.emit?.(EVENT_VERSION, {
      version: DEM_VERSION,
      protocolVersion: DEM_PROTOCOL_VERSION,
    });
    for (const manager of Object.values(
      managers,
    ) as AutoUpdateServerManager<any>[]) {
      manager.registerSocket(socket);
    }
    socket?.on?.("disconnect", () => {
      loggers.debug?.(`Client disconnected: ${socket?.id}`);
    });
  });

  try {
    setupSocketMiddleware(
      socket,
      loggers,
      managers as unknown as Record<string, IAutoUpdateManager<any>>,
      models,
    );
  } catch (error: unknown) {
    loggers.error?.("Error setting up socket middleware");
    loggers.error?.(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) loggers.error?.(error.stack);
  }

  return managers;
}

export class AutoUpdateServerManager<
  T extends IAutoUpdatedClientObject<T>,
  M extends Record<string, IAutoUpdateManager<any>> = any,
> extends AutoUpdateManager<T, M> {
  public readonly model: ReturnModelType<any, BeAnObject>;
  public readonly clientSockets = new Set<Socket>();
  private readonly knownObjectIdsBySocket = new Map<Socket, Set<string>>();
  public readonly options?: AUSOption<
    T,
    Record<string, IAutoUpdatedClientObject<any>>
  >;
  protected objects_: { [_id: string]: T } = {};
  public readonly managers: M;
  public startupPayloadCache: { ids: string[]; objects?: any[]; properties: string[] } | null = null;
  private _cachedObjectsArray: T[] | null = null;
  public readonly changeTracker?: ServerChangeTracker;

  /**
   * Initializes an AutoUpdateServerManager instance.
   *
   * @param classParam - Target server object class constructor.
   * @param className - Managed entity class name.
   * @param socket - Socket.IO Server instance.
   * @param loggers - Logger callbacks interface.
   * @param model - Typegoose Mongoose model for database operations.
   * @param managers - Sibling server managers registry.
   * @param emitter - Shared event emitter.
   * @param options - Server manager options including access middlewares and delta sync settings.
   */
  constructor(
    classParam: Constructor<T>,
    className: string,
    socket: Server,
    loggers: LoggersType,
    model: ReturnModelType<any, BeAnObject>,
    managers: M,
    emitter: EventEmitter3,
    options?: AUSOption<T, Record<string, IAutoUpdatedClientObject<any>>>,
  ) {
    super(classParam, className, socket as any, loggers, managers, emitter);
    this.managers = managers;
    this.model = model;
    this.options = options;

    if (options?.deltaSync) {
      const deltaOpts = typeof options.deltaSync === "object" ? options.deltaSync : {};
      if (deltaOpts.enabled !== false) {
        this.changeTracker = new ServerChangeTracker(this.className, deltaOpts);
      }
    }
  }

  /**
   * Inspects current database connection state.
   *
   * @returns Object describing connected flag, numeric readyState, and stateName.
   */
  public checkDbState(): {
    connected: boolean;
    readyState: number;
    stateName: string;
  } {
    const db = (this.model as any)?.db;
    if (!db || typeof db.readyState !== "number") {
      return { connected: true, readyState: 1, stateName: "connected" };
    }
    const readyState: number = db.readyState;
    const stateNames: Record<number, string> = {
      0: "disconnected",
      1: "connected",
      2: "connecting",
      3: "disconnecting",
      99: "uninitialized",
    };
    const stateName = stateNames[readyState] ?? "unknown";
    return {
      connected: readyState === 1,
      readyState,
      stateName,
    };
  }

  /**
   * Verifies database connection is active.
   *
   * @throws {DEMError} Throws DEMErrorCode.DB_NOT_CONNECTED if database is not connected.
   */
  public assertDbConnected(): void {
    const status = this.checkDbState();
    if (!status.connected) {
      const err = new DEMError(
        DEMErrorCode.DB_NOT_CONNECTED,
        `Database for manager '${this.className}' is in state '${status.stateName}' (code: ${status.readyState}). Database must be connected before DEM starts loading.`,
        { className: this.className, readyState: status.readyState, stateName: status.stateName },
      );
      this.emitter.emit("error", err);
      this.loggers.error?.(err.message);
      throw err;
    }
  }

  /**
   * Preloads all database documents into memory for the manager class.
   *
   * @param options - Optional batch loading options.
   * @returns Promise resolving when all entities are loaded and populated in globalCache.
   */
  public async preLoad(options?: { batchSize?: number }): Promise<void> {
    this.assertDbConnected();
    this.loggers.debug("Loading manager DB " + this.className);
    const docs = await this.model.find({});

    // Optimization: Parallelize object creation to ensure all objects are in globalCache
    // as quickly as possible before reference resolution starts.
    await Promise.all(
      docs.map(async (doc: any) => {
        const id = (
          doc as unknown as { _id?: { toString(): string } }
        )._id?.toString();
        if (!id) {
          this.loggers.debug(
            "Invalid document, no _id: " + ((doc as any)?._id ?? "[no id]"),
          );
          return;
        }
        this.objects_[id] =
          this.objects_[id] ??
          ((await createAutoUpdatedClass(
            this.classParam as any,
            this.className,
            this.socket,
            id as unknown as IsData<any>,
            this.loggers,
            this as any,
            this.emitter,
            doc as any,
          )) as any as T);
        globalCache.objects[id] = {
          className: this.className,
          object: this.objects_[id] as IAutoUpdatedClientObjectBase,
        };
      }),
    );

    this.startupPayloadCache = null;
    this._cachedObjectsArray = null;

    this.loggers.debug(
      "Loaded manager DB " +
        this.className +
        " - [" +
        docs.length +
        "] entries",
    );
  }

  /**
   * Resolves back-references and pointers across loaded objects.
   *
   * @returns Promise resolving when reference resolution completes.
   */
  public override async loadReferences(): Promise<void> {
    await this.loadInitialReferences();
    await this.loadPointerReferences();
  }

  /**
   * Phase 1 of reference loading: initial reference resolution on all entities.
   * Includes back-references (createdWithParent) and queued parent changes.
   * Run this only after all managers have finished preLoad, so that all objects exist in globalCache.
   *
   * @returns Promise resolving when phase 1 completes for all entities of this manager.
   */
  public async loadInitialReferences(): Promise<void> {
    await Promise.all(
      this.objectsAsArray.map((object) => object.isPreLoadedAsync()),
    );
  }

  /**
   * Phase 2 of reference loading: resolves missing pointers and marks the manager as loaded.
   *
   * @returns Promise resolving when phase 2 completes for all entities of this manager.
   */
  public async loadPointerReferences(): Promise<void> {
    await super.loadReferences();
  }

  /**
   * Indicates whether smart lazy loading mode is enabled for this manager.
   *
   * @returns True if lazy loading is enabled.
   */
  public get isLazyLoadingEnabled(): boolean {
    if (typeof this.options?.lazyLoading === "object") {
      return this.options.lazyLoading.enabled !== false;
    }
    return Boolean(this.options?.lazyLoading);
  }

  /**
   * Generates an array of entity descriptors for unhydrated startup payloads.
   *
   * @param objects - Collection of server entity instances.
   * @returns Array containing entity descriptors with unique identifiers and human-readable summaries.
   */
  public generateManifest(objects: T[]): EntityDescriptor[] {
    return objects.map((obj) => {
      const objData = (obj as any).extractedData ?? (obj as any).data ?? obj;
      let desc: string;
      if (typeof (this.classParam as any).getDescriptor === "function") {
        try {
          desc = (this.classParam as any).getDescriptor(objData);
        } catch {
          desc = JSON.stringify(objData ?? {});
        }
      } else {
        desc = JSON.stringify(objData ?? {});
      }
      return {
        _id: obj._id.toString(),
        description: desc,
      };
    });
  }

  /**
   * Recursively traverses and collects referenced entity documents up to a maximum depth.
   * Uses an ID set to prevent infinite cycles.
   *
   * @param rootObj - The initial server entity instance.
   * @param maxDepth - Maximum reference graph traversal depth.
   * @returns Dictionary mapping manager class names to arrays of extracted entity data.
   */
  public collectEntityGraph(
    rootObj: T,
    maxDepth: number,
  ): Record<string, any[]> {
    const visited = new Set<string>();
    const relatedByManager: Record<string, Map<string, any>> = {};

    const rootIdStr = rootObj._id.toString();
    visited.add(rootIdStr);

    type QueueItem = {
      obj: IAutoUpdatedClientObject<any>;
      manager: IAutoUpdateManager<any>;
      currentDepth: number;
    };

    const queue: QueueItem[] = [{ obj: rootObj, manager: this, currentDepth: 0 }];

    while (queue.length > 0) {
      const { obj, manager, currentDepth } = queue.shift()!;
      if (currentDepth >= maxDepth) continue;

      const classParam = (manager as any).classParam;
      let refProps: string[] = classParam?.__refPropsCache;
      if (!refProps && classParam) {
        const meta = setupClassAccessors(classParam);
        refProps = (classParam as any).__refPropsCache = Array.from(meta.refProps);
      }
      refProps = refProps ?? [];
      const dataRec = (obj as any).extractedData ?? (obj as any).data ?? obj;

      for (const prop of refProps) {
        const val = dataRec[prop];
        if (!val) continue;

        const targetClassName =
          (classParam?.__metaCache?.refsToMap?.get?.(prop)) ??
          getMetadataRecursive("refsTo", classParam?.prototype ?? obj, prop) ??
          getMetadataRecursive("refsTo", obj, prop);

        const targetManager = targetClassName && this.managers
          ? (this.managers as Record<string, IAutoUpdateManager<any>>)[targetClassName]
          : undefined;

        if (!targetManager) continue;

        const rawIds: string[] = Array.isArray(val)
          ? val.map((v) => (v && (v as any)._id ? (v as any)._id.toString() : v?.toString())).filter(Boolean)
          : [val && (val as any)._id ? (val as any)._id.toString() : val?.toString()].filter(Boolean);

        for (const refId of rawIds) {
          if (visited.has(refId)) continue;
          visited.add(refId);

          const refObj = targetManager.getObject(refId);
          if (refObj) {
            if (!relatedByManager[targetManager.className]) {
              relatedByManager[targetManager.className] = new Map();
            }
            const extracted = (refObj as any).extractedData ?? (refObj as any).data ?? refObj;
            relatedByManager[targetManager.className].set(refId, extracted);

            queue.push({
              obj: refObj,
              manager: targetManager,
              currentDepth: currentDepth + 1,
            });
          }
        }
      }
    }

    const result: Record<string, any[]> = {};
    for (const [mgrName, map] of Object.entries(relatedByManager)) {
      result[mgrName] = Array.from(map.values());
    }
    return result;
  }

  /**
   * Asynchronously traverses entity references to collect a graph of related entities,
   * querying MongoDB for unhydrated entities when lazy loading is active.
   *
   * @param rootObj - Root entity to start traversal from.
   * @param maxDepth - Maximum reference depth to traverse.
   * @returns Promise resolving to dictionary mapping manager class names to arrays of extracted entity data.
   */
  public async collectEntityGraphAsync(
    rootObj: T,
    maxDepth: number,
  ): Promise<Record<string, any[]>> {
    const visited = new Set<string>();
    const relatedByManager: Record<string, Map<string, any>> = {};

    const rootIdStr = rootObj._id.toString();
    visited.add(rootIdStr);

    type QueueItem = {
      obj: IAutoUpdatedClientObject<any>;
      manager: IAutoUpdateManager<any>;
      currentDepth: number;
    };

    const queue: QueueItem[] = [{ obj: rootObj, manager: this, currentDepth: 0 }];

    while (queue.length > 0) {
      const { obj, manager, currentDepth } = queue.shift()!;
      if (currentDepth >= maxDepth) continue;

      const classParam = (manager as any).classParam;
      let refProps: string[] = classParam?.__refPropsCache;
      if (!refProps && classParam) {
        const meta = setupClassAccessors(classParam);
        refProps = (classParam as any).__refPropsCache = Array.from(meta.refProps);
      }
      refProps = refProps ?? [];
      const dataRec = (obj as any).extractedData ?? (obj as any).data ?? obj;

      for (const prop of refProps) {
        const val = dataRec[prop];
        if (!val) continue;

        const targetClassName =
          (classParam?.__metaCache?.refsToMap?.get?.(prop)) ??
          getMetadataRecursive("refsTo", classParam?.prototype ?? obj, prop) ??
          getMetadataRecursive("refsTo", obj, prop);

        const targetManager = targetClassName && this.managers
          ? (this.managers as Record<string, IAutoUpdateManager<any>>)[targetClassName]
          : undefined;

        if (!targetManager) continue;

        const rawIds: string[] = Array.isArray(val)
          ? val.map((v) => (v && (v as any)._id ? (v as any)._id.toString() : v?.toString())).filter(Boolean)
          : [val && (val as any)._id ? (val as any)._id.toString() : val?.toString()].filter(Boolean);

        for (const refId of rawIds) {
          if (visited.has(refId)) continue;
          visited.add(refId);

          let refObj = targetManager.getObject(refId);
          if (!refObj && typeof (targetManager as any).handleGetMissingObject === "function") {
            try {
              refObj = await (targetManager as any).handleGetMissingObject(refId);
            } catch {
              // Ignore dangling references
            }
          }

          if (refObj) {
            if (!relatedByManager[targetManager.className]) {
              relatedByManager[targetManager.className] = new Map();
            }
            const extracted = (refObj as any).extractedData ?? (refObj as any).data ?? refObj;
            relatedByManager[targetManager.className].set(refId, extracted);

            queue.push({
              obj: refObj,
              manager: targetManager,
              currentDepth: currentDepth + 1,
            });
          }
        }
      }
    }

    const result: Record<string, any[]> = {};
    for (const [mgrName, map] of Object.entries(relatedByManager)) {
      result[mgrName] = Array.from(map.values());
    }
    return result;
  }

  /**
   * Registers a client socket with the manager and binds startup, delete, and new event listeners.
   *
   * @param socket - Connected client Socket instance.
   */
  public registerSocket(socket: Socket): void {
    this.clientSockets.add(socket);
    socket.on(
      EVENT_STARTUP + this.className,
      async (
        req: unknown,
        ack?: (
          res: ServerResponse<{
            ids: string[];
            objects?: any[];
            properties: string[];
            version?: string;
            protocolVersion?: string;
            status?: "up-to-date" | "delta" | "full" | "lazy";
            revision?: number;
            changes?: ChangeEntry<any>[];
            manifest?: EntityDescriptor[];
            serverTime?: number;
          }>,
        ) => void,
      ) => {
        try {
          const clientVersion =
            req && typeof req === "object" && typeof (req as any).clientVersion === "string"
              ? (req as any).clientVersion
              : undefined;

          if (clientVersion) {
            const verResult = verifyDEMVersion(clientVersion, DEM_SERVER_VERSION);
            if (!verResult.compatible) {
              const errMsg =
                verResult.message ||
                `DEM Version Incompatibility: Client (${clientVersion}) is incompatible with Server (${DEM_SERVER_VERSION})`;
              this.loggers.warn?.(`Rejecting client connection from ${socket.id}: ${errMsg}`);
              if (typeof ack === "function") {
                ack({
                  success: false,
                  code: DEMErrorCode.VERSION_MISMATCH,
                  message: errMsg,
                } as any);
              }
              return;
            }
          }

          const clientLastRev =
            req && typeof req === "object" && typeof (req as any).lastRevision === "number"
              ? (req as any).lastRevision
              : undefined;

          // Check if delta sync can be fulfilled
          if (this.changeTracker && typeof clientLastRev === "number") {
            let allowedIdsSet: Set<string> | undefined = undefined;
            if (this.options?.accessDefinitions?.startupMiddleware) {
              const allowedObjects = await this.options.accessDefinitions.startupMiddleware(
                this.objectsAsArray,
                this.managers as any,
                socket,
              );
              allowedIdsSet = new Set(
                allowedObjects.map((obj) => obj._id.toString()).filter(Boolean),
              );
              this.knownObjectIdsBySocket.set(socket, new Set(allowedIdsSet));
            }

            const changesResult = this.changeTracker.getChangesSince(
              clientLastRev,
              allowedIdsSet,
            );

            if (!changesResult.isExpired) {
              if (changesResult.changes.length === 0) {
                this.loggers.debug(
                  "Client up to date for manager " +
                    this.className +
                    " at revision " +
                    clientLastRev,
                );
                if (typeof ack === "function") {
                  ack({
                    data: {
                      status: "up-to-date",
                      revision: this.changeTracker.getCurrentRevision(),
                      ids: [],
                      properties: this.properties as string[],
                      version: DEM_VERSION,
                      protocolVersion: DEM_PROTOCOL_VERSION,
                      serverTime: Date.now(),
                    },
                    success: true,
                  });
                }
                return;
              } else {
                this.loggers.debug(
                  "Sending delta startup data (" +
                    changesResult.changes.length +
                    " changes) for manager " +
                    this.className,
                );
                if (typeof ack === "function") {
                  ack({
                    data: {
                      status: "delta",
                      revision: this.changeTracker.getCurrentRevision(),
                      changes: changesResult.changes,
                      ids: [],
                      properties: this.properties as string[],
                      version: DEM_VERSION,
                      protocolVersion: DEM_PROTOCOL_VERSION,
                      serverTime: Date.now(),
                    },
                    success: true,
                  });
                }
                return;
              }
            }
          }

          let ids: string[];
          let objects: any[];

          if (!this.options?.accessDefinitions?.startupMiddleware && this.startupPayloadCache) {
            ids = this.startupPayloadCache.ids;
            objects = this.startupPayloadCache.objects ?? [];
          } else {
            const allowedObjects = this.options?.accessDefinitions?.startupMiddleware
              ? await this.options.accessDefinitions.startupMiddleware(
                  this.objectsAsArray,
                  this.managers as any,
                  socket,
                )
              : this.objectsAsArray;

            ids = allowedObjects.map((obj) => obj._id.toString()).filter(Boolean);
            objects = allowedObjects.map((obj) => (obj as any).extractedData).filter(Boolean);

            if (!this.options?.accessDefinitions?.startupMiddleware) {
              this.startupPayloadCache = {
                ids,
                objects,
                properties: this.properties as string[],
              };
            }
          }

          this.knownObjectIdsBySocket.set(socket, new Set(ids));

          if (this.isLazyLoadingEnabled) {
            const manifest = this.generateManifest(
              this.options?.accessDefinitions?.startupMiddleware
                ? (await this.options.accessDefinitions.startupMiddleware(
                    this.objectsAsArray,
                    this.managers as any,
                    socket,
                  ))
                : this.objectsAsArray,
            );
            this.loggers.debug(
              "Sending lazy startup data (" +
                manifest.length +
                " manifest items) for manager " +
                this.className,
            );
            if (typeof ack === "function") {
              ack({
                data: {
                  status: "lazy",
                  revision: this.changeTracker ? this.changeTracker.getCurrentRevision() : 0,
                  ids,
                  manifest,
                  properties: this.properties as string[],
                  version: DEM_VERSION,
                  protocolVersion: DEM_PROTOCOL_VERSION,
                  serverTime: Date.now(),
                },
                success: true,
              });
            }
            return;
          }

          this.loggers.debug(
            "Sending startup data for manager " + this.className,
          );
          if (typeof ack === "function") {
            ack({
              data: {
                status: "full",
                revision: this.changeTracker ? this.changeTracker.getCurrentRevision() : 0,
                ids,
                objects,
                properties: this.properties as string[],
                version: DEM_VERSION,
                protocolVersion: DEM_PROTOCOL_VERSION,
                serverTime: Date.now(),
              },
              success: true,
            });
          }
        } catch (error: unknown) {
          this.loggers.error(
            "Error sending startup data for manager " +
              this.className +
              ": " +
              (error instanceof Error ? error.message : String(error)),
          );
          if (error instanceof Error && error.stack)
            this.loggers.error(error.stack);
          const demErr = toDEMError(error, DEMErrorCode.STARTUP_FAILED);
          if (typeof ack === "function") {
            ack({
              success: false,
              code: demErr.code,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      },
    );

    socket.on(
      EVENT_DELETE + this.className,
      async (id: string, ack?: (res: ServerResponse<undefined>) => void) => {
        this.loggers.debug(
          "Deleting object from manager " + this.className + " - " + id,
        );
        try {
          const res = await this.deleteObject(id as any);
          this.startupPayloadCache = null;
          if (typeof ack === "function") {
            if (res && !res.success) {
              ack({
                success: false,
                code: res.code ?? DEMErrorCode.OBJECT_DELETE_FAILED,
                message: res.message || "Deletion unsuccessful",
              });
            } else {
              ack({
                success: true,
                message: "Deleted successfully",
                data: undefined,
              });
            }
          }
        } catch (error: unknown) {
          this.loggers.error(
            "Error deleting object from manager " +
              this.className +
              " - " +
              id +
              ": " +
              (error instanceof Error ? error.message : String(error)),
          );
          if (error instanceof Error && error.stack)
            this.loggers.error(error.stack);
          const demErr = toDEMError(error, DEMErrorCode.OBJECT_DELETE_FAILED);
          if (typeof ack === "function") {
            ack({
              success: false,
              code: demErr.code,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      },
    );

    socket.on(
      EVENT_NEW + this.className,
      async (data: unknown, ack?: (res: ServerResponse<unknown>) => void) => {
        this.loggers.debug(
          "Recieved new object creation in manager " + this.className,
        );
        try {
          const newDoc = await this.createObject(data as any as IsData<T>);
          this.startupPayloadCache = null;
          if (typeof ack === "function") {
            ack({
              data: newDoc.extractedData,
              success: true,
              message: "Created successfully",
            });
          }
        } catch (error: unknown) {
          this.loggers.error(
            "Error creating new object creation in manager " +
              this.className +
              " - " +
              (error instanceof Error ? error.message : String(error)),
          );
          if (error instanceof Error && error.stack)
            this.loggers.error(error.stack);
          const demErr = toDEMError(error, DEMErrorCode.OBJECT_CREATE_FAILED);
          if (typeof ack === "function") {
            ack({
              success: false,
              code: demErr.code,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      },
    );

    // Registered into socket.eventNames() so setupSocketMiddleware can validate and permit dynamic update/get events
    socket.on(EVENT_UPDATE + this.className, async () => {});
    socket.on(EVENT_GET + this.className, async () => {});

    socket.onAny(
      async (
        event: string,
        data: unknown,
        ack?: (res: ServerResponse<unknown>) => void,
      ) => {
        const updatePrefix = EVENT_UPDATE + this.className;
        const getPrefix = EVENT_GET + this.className;

        if (event.startsWith(updatePrefix)) {
          if (this.managers) {
            const hasMoreSpecificManager = Object.keys(this.managers).some(
              (otherName) =>
                otherName !== this.className &&
                otherName.length > this.className.length &&
                otherName.startsWith(this.className) &&
                event.startsWith(EVENT_UPDATE + otherName),
            );
            if (hasMoreSpecificManager) return;
          }
          const id = event.slice(updatePrefix.length);
          if (!id) return;
          this.loggers.debug(
            "Updating object in manager " +
              this.className +
              ": " +
              event +
              " - " +
              (typeof data === "object" ? "[object]" : String(data)),
          );
          try {
            let obj = this.objects_[id];
            if (!obj) {
              obj = await this.handleGetMissingObject(id);
            }
            if (!obj)
              throw new DEMError(
                DEMErrorCode.OBJECT_GET_FAILED,
                `Never... failed to get object somehow: ${id}`,
              );
            let res: any;
            if ((data as any)?.mutation) {
              res = await (obj as any).mutateArray(
                (data as any).key,
                (data as any).mutation,
              );
            } else {
              res = await (obj as any).setValue(
                (data as any).key,
                (data as any).value,
              );
            }
            if (typeof ack === "function") {
              res.success
                ? ack({
                    data: res.updatedArray ?? null,
                    updatedArray: res.updatedArray,
                    newRevision: res.newRevision,
                    newHash: res.newHash,
                    success: res.success,
                    code: (res as any).code,
                    message: res.msg ?? res.message,
                  })
                : ack({
                    data: null,
                    success: res.success,
                    code: (res as any).code ?? DEMErrorCode.DB_SAVE_FAILED,
                    message: res.msg ?? res.message,
                  });
            }
          } catch (error: unknown) {
            this.loggers.warn(
              "Failed to update object in manager " + this.className,
            );
            const demErr = toDEMError(error, DEMErrorCode.DB_SAVE_FAILED);
            if (typeof ack === "function") {
              ack({
                success: false,
                code: demErr.code,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
        } else if (event.startsWith(getPrefix)) {
          if (this.managers) {
            const hasMoreSpecificManager = Object.keys(this.managers).some(
              (otherName) =>
                otherName !== this.className &&
                otherName.length > this.className.length &&
                otherName.startsWith(this.className) &&
                event.startsWith(EVENT_GET + otherName),
            );
            if (hasMoreSpecificManager) return;
          }
          const id = event.slice(getPrefix.length);
          if (!id) return;
          try {
            let obj = this.objects_[id];
            if (!obj) {
              obj = await this.handleGetMissingObject(id);
            }
            if (!obj)
              throw new DEMError(
                DEMErrorCode.OBJECT_NOT_FOUND,
                `Object not found: ${id}`,
              );

            const requestedDepth =
              typeof data === "object" && data && typeof (data as any).depth === "number"
                ? (data as any).depth
                : 0;

            if (requestedDepth > 0) {
              const related = await this.collectEntityGraphAsync(obj, requestedDepth);
              if (typeof ack === "function") {
                ack({
                  data: (obj as any).extractedData,
                  related,
                  success: true,
                  message: "Retrieved successfully",
                });
              }
            } else {
              if (typeof ack === "function") {
                ack({
                  data: (obj as any).extractedData,
                  success: true,
                  message: "Updated successfully",
                });
              }
            }
          } catch (error: unknown) {
            this.loggers.error(
              "Error sending startup data for manager " +
                this.className +
                ": " +
                (error instanceof Error ? error.message : String(error)),
            );
            if (error instanceof Error && error.stack)
              this.loggers.error(error.stack);
            const demErr = toDEMError(error, DEMErrorCode.OBJECT_GET_FAILED);
            if (typeof ack === "function") {
              ack({
                success: false,
                code: demErr.code,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      },
    );

    socket.on("disconnect", () => {
      this.clientSockets.delete(socket);
      this.knownObjectIdsBySocket.delete(socket);
    });
  }

  /**
   * Emits standardized deauthenticate event to a target client socket or all connected client sockets,
   * triggering automatic teardown and memory cleanup on the client.
   *
   * @param targetSocket - Optional client socket to deauthenticate. If omitted, all registered client sockets are deauthenticated.
   * @param reason - Optional explanation for deauthentication.
   */
  public deauthenticate(targetSocket?: Socket, reason?: string): void {
    const payload = {
      reason: reason ?? "Session expired or unauthorized",
      timestamp: Date.now(),
    };
    if (targetSocket) {
      targetSocket.emit(EVENT_DEAUTHENTICATE, payload);
    } else {
      for (const s of this.clientSockets) {
        s.emit(EVENT_DEAUTHENTICATE, payload);
      }
    }
  }

  /**
   * Retrieves a server managed object by identifier.
   *
   * @param _id - Optional entity identifier.
   * @returns Managed entity instance, null, or undefined.
   */
  public getObject(_id?: MongoId): T | null | undefined {
    if (!_id) return null;
    return (this.objects_[_id.toString()] as any) || undefined;
  }

  /**
   * Dictionary of all managed entities keyed by their string IDs.
   *
   * @returns Map of managed entities.
   */
  public get objects(): Record<string, T> {
    return this.objects_ as any;
  }

  /**
   * Array representation of all managed entities.
   *
   * @returns Array containing all managed entities.
   */
  public get objectsAsArray(): T[] {
    if (!this._cachedObjectsArray) {
      this._cachedObjectsArray = Object.values(this.objects_) as any;
    }
    return this._cachedObjectsArray!;
  }

  /**
   * Deletes an entity from database, manager cache, and mutation tracker.
   *
   * @param _id - Identifier of entity to delete.
   * @returns Promise resolving to deletion outcome object.
   */
  public override async deleteObject(
    _id: MongoId,
    isRemote: boolean = false,
  ): Promise<{ success: boolean; message: string; code?: DEMErrorCode }> {
    this._cachedObjectsArray = null;
    this.startupPayloadCache = null;
    const idStr = _id.toString();

    let res: { success: boolean; message: string; code?: DEMErrorCode };
    const inMemoryObj = this.objects_[idStr];

    if (inMemoryObj && typeof inMemoryObj.destroy === "function") {
      res = await super.deleteObject(_id, isRemote);
    } else {
      // Unhydrated or lazy object: delete directly from database
      try {
        let doc: any = null;
        let deleted = false;
        if (typeof this.model?.findById === "function") {
          doc = await this.model.findById(idStr);
        }
        if (doc) {
          if (this.options?.onDeletion) {
            await this.options.onDeletion(doc as any);
          }
          if (typeof doc.deleteOne === "function") {
            await doc.deleteOne();
            deleted = true;
          } else if (typeof this.model?.deleteOne === "function") {
            await this.model.deleteOne({ _id: idStr });
            deleted = true;
          }
        } else if (typeof this.model?.deleteOne === "function") {
          const delRes = await this.model.deleteOne({ _id: idStr });
          if (delRes && delRes.deletedCount > 0) {
            deleted = true;
          }
        }
        delete this.objects_[idStr];
        delete globalCache.objects[idStr];
        res = { success: true, message: deleted ? "Deleted" : "Already gone" };
      } catch (error: any) {
        this.loggers.error?.(
          `Error deleting unhydrated object ${this.className} ${idStr}: ${error?.message ?? String(error)}`,
        );
        return {
          success: false,
          code: DEMErrorCode.OBJECT_DELETE_FAILED,
          message: error?.message ?? String(error),
        };
      }
    }

    if (res.success) {
      if (this.changeTracker) {
        this.changeTracker.recordChange("delete", idStr);
      }
      for (const socket of this.clientSockets) {
        const known = this.knownObjectIdsBySocket.get(socket);
        if (known) {
          known.delete(idStr);
        }
      }
    }
    return res;
  }

  private pendingMissingFetches = new Map<string, Promise<T>>();

  /**
   * Retrieves an entity missing from memory by querying MongoDB directly.
   *
   * @param _id - Identifier of missing entity.
   * @returns Promise resolving to the retrieved server object.
   * @throws {DEMError} Throws DEMErrorCode.DOCUMENT_NOT_FOUND or MANAGERS_NOT_INITIALIZED.
   */
  public async handleGetMissingObject(_id: MongoId): Promise<T> {
    const _idStr = _id.toString();
    if (this.getObject(_idStr)) return this.getObject(_idStr)!;
    if (this.pendingMissingFetches.has(_idStr)) {
      return this.pendingMissingFetches.get(_idStr)!;
    }

    const fetchPromise = (async () => {
      try {
        const document = await this.model.findById(_idStr);
        if (!document)
          throw new DEMError(
            DEMErrorCode.DOCUMENT_NOT_FOUND,
            `No document with id ${_idStr} in DB.`,
          );
        if (!this.managers)
          throw new DEMError(
            DEMErrorCode.MANAGERS_NOT_INITIALIZED,
            `No managers.`,
          );
        const object = await createAutoUpdatedClass(
          this.classParam as any,
          this.className,
          this.socket,
          document as any,
          this.loggers,
          this as any,
          this.emitter,
        );
        await object.waitForPreloaded();
        this.objects_[object._id.toString()] = object as any as T;
        this._cachedObjectsArray = null;
        globalCache.objects[object._id.toString()] = {
          className: this.className,
          object: object as IAutoUpdatedClientObjectBase,
        };
        await object.isPreLoadedAsync();
        await object.loadMissingReferences();
        await object.contactChildren();
        return object as any as T;
      } finally {
        this.pendingMissingFetches.delete(_idStr);
      }
    })();

    this.pendingMissingFetches.set(_idStr, fetchPromise);
    return fetchPromise;
  }

  /**
   * Generates creation payload for client broadcasts, returning an entity descriptor in lazy mode.
   *
   * @param object - Server entity instance.
   * @returns Entity ID string or descriptor payload.
   */
  public getNewObjectPayload(object: any): string | EntityDescriptor {
    if (this.isLazyLoadingEnabled) {
      const objData = (object as any).extractedData ?? (object as any).data ?? object;
      let desc: string;
      if (typeof (this.classParam as any).getDescriptor === "function") {
        try {
          desc = (this.classParam as any).getDescriptor(objData);
        } catch {
          desc = JSON.stringify(objData ?? {});
        }
      } else {
        desc = JSON.stringify(objData ?? {});
      }
      return {
        _id: (object as any)._id.toString(),
        description: desc,
      };
    }
    return (object as any)._id.toString();
  }

  /**
   * Creates a new entity document in MongoDB and instantiates its manager wrapper.
   * Broadcasts creation event to client sockets with authorized access.
   *
   * @param data - Initial entity properties.
   * @returns Promise resolving to the created server entity.
   * @throws {DEMError} Throws DEMErrorCode.MANAGERS_NOT_INITIALIZED.
   */
  public async createObject(data: Omit<IsData<T>, "_id">): Promise<T> {
    if (!this.managers)
      throw new DEMError(
        DEMErrorCode.MANAGERS_NOT_INITIALIZED,
        `No managers.`,
      );
    this.loggers.debug("Creating new object from manager " + this.className);
    const rawRec = { ...data } as any;
    if (rawRec._id === "" || rawRec._id === null) delete rawRec._id;

    // Sanitize creation payload to prevent property injection
    const dataRec: Record<string, unknown> = {};
    const meta = this.classParam ? setupClassAccessors(this.classParam) : null;
    for (const key of Object.keys(rawRec)) {
      if (
        key !== "__proto__" &&
        key !== "constructor" &&
        key !== "prototype" &&
        (this.properties.includes(key) ||
          key === "_id" ||
          Boolean((this.model.schema as any)?.path?.(key)))
      ) {
        const val = rawRec[key];
        const schemaPath = (this.model.schema as any)?.path?.(key);
        const isMongoRef =
          schemaPath?.instance === "ObjectID" ||
          schemaPath?.caster?.instance === "ObjectID";
        const isRef = Boolean(
          (meta ? meta.refProps.has(key) : false) ||
            getMetadataRecursive("isRef", this.classParam?.prototype, key) ||
            isMongoRef,
        );

        if (val && typeof val === "object") {
          if (Array.isArray(val)) {
            dataRec[key] = isRef
              ? val.map((v) =>
                  v && typeof v === "object" && v._id ? v._id.toString() : v,
                )
              : val;
          } else if (isRef && (val as any)._id) {
            dataRec[key] = (val as any)._id.toString();
          } else {
            dataRec[key] = val;
          }
        } else {
          dataRec[key] = val;
        }
      }
    }

    const doc = await this.model.create(dataRec);
    const id = doc._id.toString();

    const object = await createAutoUpdatedClass(
      this.classParam,
      this.className,
      this.socket,
      id as unknown as IsData<any>,
      this.loggers,
      this,
      this.emitter,
      doc,
    );
    await object.waitForPreloaded();

    // Copy virtual references from raw data payload
    const cleanedData = (object as any).handleDataCleanup(rawRec);
    for (const key of object.properties) {
      if (
        cleanedData[key] !== undefined &&
        (object as any).data[key] === undefined
      ) {
        (object as any).data[key] = cleanedData[key];
      }
    }

    this.objects_[id] = object as any as T;
    this._cachedObjectsArray = null;
    this.startupPayloadCache = null;
    globalCache.objects[id] = {
      className: this.className,
      object: object as IAutoUpdatedClientObjectBase,
    };
    await object.isPreLoadedAsync();
    await object.loadMissingReferences();
    await object.contactChildren();

    if (this.changeTracker) {
      this.changeTracker.recordChange(
        "create",
        id,
        (object as any).extractedData || (object as any).data,
      );
    }

    for (const socket of this.clientSockets) {
      try {
        const theTruth = this.options?.accessDefinitions?.startupMiddleware
          ? await this.options.accessDefinitions.startupMiddleware(
              [object as any],
              this.managers as any,
              socket,
            )
          : [object as any];

        if (theTruth.length > 0) {
          let known = this.knownObjectIdsBySocket.get(socket);
          if (!known) {
            known = new Set();
            this.knownObjectIdsBySocket.set(socket, known);
          }
          known.add(id);
          this.loggers.debug("Emitting new object " + (object as any)._id);
          socket.emit("new" + this.className, this.getNewObjectPayload(object));
        }
      } catch (error: unknown) {
        this.loggers.error(
          "Error when emitting new object to client: " +
            (error instanceof Error ? error.name : "Error"),
        );
        this.loggers.error(
          error instanceof Error ? error.message : String(error),
        );
        if (error instanceof Error && error.stack)
          this.loggers.error(error.stack);
      }
    }
    return object as any as T;
  }

  /**
   * Re-evaluates client socket permissions against dynamic startup middleware rules.
   * Emits 'new' or 'delete' socket events when client access changes dynamically.
   *
   * @param object - Entity to evaluate.
   */
  public async checkPermissionBoundaries(object: T): Promise<void> {
    if (!this.options?.accessDefinitions?.startupMiddleware) return;
    const id = object._id.toString();
    for (const socket of this.clientSockets) {
      try {
        const theTruth = await this.options.accessDefinitions.startupMiddleware(
          [object],
          this.managers as any,
          socket,
        );
        const hasAccess = theTruth && theTruth.length > 0;
        let known = this.knownObjectIdsBySocket.get(socket);
        if (!known) {
          known = new Set();
          this.knownObjectIdsBySocket.set(socket, known);
        }
        const hadAccess = known.has(id);

        if (hasAccess && !hadAccess) {
          known.add(id);
          this.loggers.debug(
            `Granting dynamic access to ${this.className} ${id} for socket ${socket.id}`,
          );
          socket.emit("new" + this.className, this.getNewObjectPayload(object));
        } else if (!hasAccess && hadAccess) {
          known.delete(id);
          this.loggers.debug(
            `Revoking dynamic access to ${this.className} ${id} for socket ${socket.id}`,
          );
          socket.emit("delete" + this.className, id);
        }
      } catch (error: unknown) {
        this.loggers.error(
          `Error checking permission boundaries for ${this.className} ${id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
