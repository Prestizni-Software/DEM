import { jest } from '@jest/globals';
import "reflect-metadata";
import { Subordinate } from "./testData/ClientClasses/index.js";
import { EventEmitter } from "eventemitter3";

describe("AutoUpdatedClientObjectClass Client-Side Population Bypass Tests", () => {
  let mockSocket: any;
  let mockManager: any;
  let mockEmitter: any;
  let mockCallback: any;
  let loggers: any;

  beforeEach(() => {
    mockSocket = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    };
    mockManager = {
      managers: {},
      cache: { references: {} },
      deleteObject: jest.fn().mockResolvedValue({ success: true }),
      isLoaded: true
    };
    mockEmitter = new EventEmitter();
    mockCallback = {
      update: jest.fn(),
      delete: jest.fn(),
      new: jest.fn(),
      progress: jest.fn()
    };
    loggers = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
  });

  test("Client object loadReferencesAsync bypasses loadForceReferences", async () => {
    const data = { _id: "id1" };
    const obj = new (Subordinate as any)(
      Subordinate, mockSocket, data, loggers, "Subordinate", mockManager, mockCallback, mockEmitter
    );

    // Spy on loadForceReferences
    const loadForceRefSpy = jest.spyOn(obj as any, "loadForceReferences");

    await (obj as any).loadReferencesAsync();
    
    // Expect loadForceReferences to NOT have been called on the client
    expect(loadForceRefSpy).not.toHaveBeenCalled();
    expect((obj as any).isLoadingReferences).toBe(false);
  });

  test("Client object loadMissingReferences returns immediately", async () => {
    const data = { _id: "id1" };
    const obj = new (Subordinate as any)(
      Subordinate, mockSocket, data, loggers, "Subordinate", mockManager, mockCallback, mockEmitter
    );

    // Spy on checkForMissingRefs
    const checkForMissingRefsSpy = jest.spyOn(obj as any, "checkForMissingRefs");

    await obj.loadMissingReferences();

    // Expect checkForMissingRefs to NOT have been called on the client
    expect(checkForMissingRefsSpy).not.toHaveBeenCalled();
  });

  test("Client object contactChildren returns immediately", async () => {
    const data = { _id: "id1" };
    const obj = new (Subordinate as any)(
      Subordinate, mockSocket, data, loggers, "Subordinate", mockManager, mockCallback, mockEmitter
    );

    // Spy on getValue (used inside contactChildren loop)
    const getValueSpy = jest.spyOn(obj as any, "getValue");

    await obj.contactChildren();

    // Expect contactChildren to return immediately without scanning properties
    expect(getValueSpy).not.toHaveBeenCalled();
  });

  test("Client object setValue does not trigger findAndLoadReferences or contactChildren", async () => {
    const data = { _id: "id1", name: "OldName" };
    const obj = new (Subordinate as any)(
      Subordinate, mockSocket, data, loggers, "Subordinate", mockManager, mockCallback, mockEmitter
    );

    const findAndLoadRefsSpy = jest.spyOn(obj as any, "findAndLoadReferences");
    const contactChildrenSpy = jest.spyOn(obj as any, "contactChildren");

    mockSocket.emit.mockImplementation((event: string, data: any, ack: any) => {
      if (ack) ack({ success: true, data: "NewName" });
    });

    await obj.setValue("name", "NewName");

    // On client, setting a value should not call population-related loading methods
    expect(findAndLoadRefsSpy).not.toHaveBeenCalled();
    expect(contactChildrenSpy).not.toHaveBeenCalled();
  });
});
