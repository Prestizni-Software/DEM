import { jest } from "@jest/globals";
import {
  AutoUpdatedClientObject,
  createDEMArray,
} from "../AutoUpdatedClientObjectClass.js";
import {
  AutoUpdatedServerObject,
} from "../AutoUpdatedServerObjectClass.js";
import {
  AutoUpdateServerManager,
  setupSocketMiddleware,
} from "../AutoUpdateServerManagerClass.js";
import {
  DEMArray,
  DEMError,
  DEMErrorCode,
  IsData,
  MongoId,
  ServerResponse,
} from "../CommonTypes.js";
import { prop } from "@typegoose/typegoose";
import { EventEmitter as EventEmitter3 } from "eventemitter3";
import { Server as SocketIOServer } from "socket.io";
import { io as ClientIO, Socket as ClientSocket } from "socket.io-client";
import http from "http";

describe("Reported Issues Reproduction Tests", () => {
  describe("Issue 1: Deadlock in mutateArrayQueue during onUpdate hook", () => {
    class Issue1Item extends AutoUpdatedServerObject<Issue1Item> {
      public title!: string;
      public tags!: DEMArray<string>;

      get _id() {
        return (this as any).data?._id;
      }
    }
    Reflect.defineMetadata("props", ["_id", "title", "tags"], Issue1Item.prototype);

    test("mutateArrayQueue does not deadlock when called inside onUpdate hook", async () => {
      let onUpdateCalled = false;
      let arrayMutatedSuccessfully = false;

      const mockEntry: any = {
        _id: "6a031aa132222f90f0d77daf",
        title: "Initial",
        tags: ["initial_tag"],
        save: jest.fn().mockResolvedValue(true),
      };

      const mockModel: any = {
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
        findById: jest.fn().mockResolvedValue(mockEntry),
        findOne: jest.fn().mockResolvedValue(mockEntry),
      };

      const mockServerManager: any = {
        model: mockModel,
        className: "Issue1Item",
        properties: ["title", "tags"],
        managers: {},
        options: {
          onUpdate: async (entity: Issue1Item, setValue: any, key: string) => {
            if (key === "title") {
              onUpdateCalled = true;
              // Mutate DEMArray inside onUpdate
              // Before fix, this deadlocks on this.writeQueue
              await entity.tags.push("tag_from_on_update");
              arrayMutatedSuccessfully = true;
            }
          },
        },
        changeTracker: {
          getCurrentRevision: () => 1,
          recordChange: () => ({ revision: 2, timestamp: Date.now() }),
          recordMutation: () => ({ revision: 2, timestamp: Date.now() }),
        },
      };

      const emitter = new EventEmitter3();
      const mockSocket: any = {
        emit: jest.fn(),
      };

      const entity = new Issue1Item(
        Issue1Item as any,
        mockSocket,
        {
          _id: "6a031aa132222f90f0d77daf" as any,
          title: "Initial",
          tags: ["initial_tag"],
        },
        { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() } as any,
        "Issue1Item",
        mockServerManager,
        emitter,
      );
      (entity as any).generateSettersAndGetters();

      // Trigger setValue which calls onUpdate
      // Set a 3000ms race timeout to detect deadlock
      const updatePromise = entity.setValue("title" as any, "Updated Title" as any);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("DEADLOCK_DETECTED")), 2000),
      );

      const res: any = await Promise.race([updatePromise, timeoutPromise]);
      expect(res.success).toBe(true);

      expect(onUpdateCalled).toBe(true);
      expect(arrayMutatedSuccessfully).toBe(true);
    });
  });

  describe("Issue 2: AllowStringForRefs does not recognize DEMArray<T>", () => {
    class DummyChild extends AutoUpdatedClientObject<DummyChild> {
      public _id!: MongoId;

      @prop()
      public name!: string;
    }

    class DummyParent extends AutoUpdatedClientObject<DummyParent> {
      public _id!: MongoId;

      @prop()
      public title!: string;

      @prop()
      public children!: DEMArray<DummyChild>;

      @prop()
      public tags!: DEMArray<string>;
    }

    test("IsData allows string IDs or plain arrays for DEMArray reference properties", () => {
      // Type test: verify that plain array of string IDs is accepted in IsData<DummyParent>
      type ParentData = Omit<IsData<DummyParent>, "_id">;

      const validPayload: ParentData = {
        title: "Project A",
        children: ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"],
        tags: ["tag1", "tag2"],
      };

      expect(validPayload.children).toEqual([
        "507f1f77bcf86cd799439011",
        "507f1f77bcf86cd799439012",
      ]);
      expect(validPayload.tags).toEqual(["tag1", "tag2"]);
    });
  });

  describe("Issue 3: DEMArray<T> compatibility with Array<T> (fill & copyWithin)", () => {
    test("DEMArray interface exposes fill and copyWithin declarations and throws CANNOT_SET_REF_DIRECTLY", () => {
      const parent: any = {
        data: { items: ["a", "b", "c"] },
        mutateArrayQueue: jest.fn(),
      };
      const demArr: DEMArray<string> = createDEMArray(
        parent,
        "items",
        false,
        () => parent.data.items,
      );

      // Verify that fill and copyWithin exist on DEMArray and throw DEMError
      expect(() => demArr.fill("z")).toThrow(DEMError);
      expect(() => demArr.fill("z")).toThrow(/Cannot mutate DEMArray 'items' synchronously via fill/);

      expect(() => demArr.copyWithin(0, 1)).toThrow(DEMError);
      expect(() => demArr.copyWithin(0, 1)).toThrow(/Cannot mutate DEMArray 'items' synchronously via copyWithin/);
    });
  });

  describe("Issue 4: setupSocketMiddleware throws UNKNOWN_EVENT for registered custom events", () => {
    let httpServer: http.Server;
    let ioServer: SocketIOServer;
    let clientSocket: ClientSocket;
    const port = 9876;

    beforeEach((done) => {
      httpServer = http.createServer();
      ioServer = new SocketIOServer(httpServer, {
        cors: { origin: "*" },
      });

      const mockLoggers = {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      const mockManagers: any = {};

      // Setup middleware
      setupSocketMiddleware(ioServer, mockLoggers as any, mockManagers);

      ioServer.on("connection", (socket) => {
        // Register a custom event handler (e.g. dem_delta_sync)
        socket.on("dem_delta_sync", (data: any, ack: (res: any) => void) => {
          if (typeof ack === "function") {
            ack({ success: true, customData: "delta_synced" });
          }
        });
      });

      httpServer.listen(port, () => {
        clientSocket = ClientIO(`http://localhost:${port}`, {
          transports: ["websocket"],
        });
        clientSocket.on("connect", () => {
          done();
        });
      });
    });

    afterEach((done) => {
      clientSocket.disconnect();
      ioServer.close(() => {
        done();
      });
    });

    test("setupSocketMiddleware calls nextEvent for custom events registered in socket.eventNames()", (done) => {
      clientSocket.emit(
        "dem_delta_sync",
        { payload: 123 },
        (res: ServerResponse<any>) => {
          // Before fix: res = { success: false, code: DEMErrorCode.UNKNOWN_EVENT, message: "Unknown event: dem_delta_sync..." }
          // After fix: res = { success: true, customData: "delta_synced" }
          expect(res.success).toBe(true);
          expect((res as any).customData).toBe("delta_synced");
          done();
        },
      );
    });
  });
});
