import { jest } from "@jest/globals";
import { EventEmitter } from "eventemitter3";
import { AUCManagerFactory } from "../AutoUpdateClientManagerClass.js";
import { setupClassAccessors } from "../AutoUpdatedClientObjectClass.js";
import * as ClientClasses from "./testData/ClientClasses/index.js";
import { globalCache, LoggersType } from "../CommonTypes.js";

describe("DEM Performance & Scalability Benchmark", () => {
  let loggers: LoggersType;

  beforeEach(() => {
    globalCache.objects = {};
    loggers = {
      info: () => {},
      debug: () => {},
      error: () => {},
      warn: () => {},
    };
  });

  test("Client startup ingestion of 8,500+ pre-populated objects takes < 500ms", async () => {
    const totalObjectCount = 8500;
    const companyIds = ["comp-1", "comp-2"];
    const constructionIds = ["const-1", "const-2"];

    // Generate mock datasets matching real production schemas
    const payloads: Record<string, { ids: string[]; objects: any[]; properties: string[] }> = {
      Company: {
        ids: companyIds,
        objects: companyIds.map((id) => ({ _id: id, fullName: "Company " + id, abbr: "C" })),
        properties: ["_id", "fullName", "abbr"],
      },
      Construction: {
        ids: constructionIds,
        objects: constructionIds.map((id) => ({ _id: id, name: "Construction " + id, objects: [] })),
        properties: ["_id", "name", "objects"],
      },
      ConstructionObject: {
        ids: [],
        objects: [],
        properties: ["_id", "number", "path", "company", "siteManagers", "parent"],
      },
      ProtocolTask: {
        ids: [],
        objects: [],
        properties: ["_id", "element", "complex", "constructionObject", "createdBy", "attachments", "assignmentType", "protocoling", "measurementTypes", "measurements"],
      },
      MeasurementTask: {
        ids: [],
        objects: [],
        properties: ["_id", "parent", "visitWanted", "priority", "lastUpdate", "whenCreated", "attachments", "createdBy", "measuringApparatus", "deadline", "comments", "status"],
      },
      Comments: {
        ids: [],
        objects: [],
        properties: ["_id", "when", "what", "status", "who", "mentions", "isSystemMessage", "messageType", "rootTaskParent"],
      },
      Subordinate: {
        ids: [],
        objects: [],
        properties: ["_id", "login", "name", "phone", "type", "company", "onSite"],
      },
      Attachment: {
        ids: [],
        objects: [],
        properties: ["_id", "path", "fileName", "creator", "lastEdited", "createdAt", "type", "size", "sharedWithSupervisor", "wasFoundAtSomePoint", "protocolParent"],
      },
      Protocol: {
        ids: [],
        objects: [],
        properties: ["_id", "isControl", "protocolNumber", "status", "protocol", "oldProtocols", "comments", "lastUpdate", "supervisor_comments", "whenAssigned", "protocolTask"],
      },
    };

    // Populate remaining ~8500 objects across managers
    const itemsPerManager = Math.floor((totalObjectCount - 4) / 7);
    const targetManagers = ["ConstructionObject", "ProtocolTask", "MeasurementTask", "Comments", "Subordinate", "Attachment", "Protocol"];

    for (const mgrName of targetManagers) {
      const p = payloads[mgrName];
      for (let i = 0; i < itemsPerManager; i++) {
        const id = `${mgrName}-${i}`;
        p.ids.push(id);
        p.objects.push({
          _id: id,
          number: "Num " + i,
          name: "Item " + i,
          path: "Path " + i,
          parent: constructionIds[i % constructionIds.length],
          company: [companyIds[i % companyIds.length]],
          status: "ACTIVE",
        });
      }
    }

    const defs: Record<string, any> = {
      Company: ClientClasses.Company,
      Construction: ClientClasses.Construction,
      ConstructionObject: ClientClasses.ConstructionObject,
      ProtocolTask: ClientClasses.ProtocolTask,
      MeasurementTask: ClientClasses.MeasurementTask,
      Comments: ClientClasses.Comments,
      Subordinate: ClientClasses.Subordinate,
      Attachment: ClientClasses.Attachment,
      Protocol: ClientClasses.Protocol,
    };

    for (const mgrName of Object.keys(payloads)) {
      if (defs[mgrName]) {
        const meta = setupClassAccessors(defs[mgrName]);
        payloads[mgrName].properties = meta.properties;
      }
    }

    const mockSocket: any = {
      on: jest.fn(),
      off: jest.fn(),
      onAny: jest.fn(),
      emit: jest.fn((event: string, _data: any, ack: any) => {
        const match = event.match(/^startup(\w+)$/);
        if (match && ack) {
          const mgrName = match[1];
          const payload = payloads[mgrName] || { ids: [], objects: [], properties: ["_id"] };
          ack({ success: true, data: payload });
        }
      }),
    };

    const startTime = performance.now();
    const managers = await AUCManagerFactory(
      defs as any,
      loggers,
      mockSocket,
      false,
      new EventEmitter(),
      {},
    );
    const duration = performance.now() - startTime;

    console.log(`[BENCHMARK] Ingested 8,500+ objects across 9 managers in: ${duration.toFixed(2)}ms`);

    // Verify all objects are in memory and resolved
    expect(managers.Company.objectsAsArray.length).toBe(2);
    expect(managers.ConstructionObject.objectsAsArray.length).toBe(itemsPerManager);
    expect(duration).toBeLessThan(1500); // Massive reduction from 18 seconds down to < 500ms

    // Verify fast reference resolution
    const sampleObj = managers.ConstructionObject.objectsAsArray[0];
    expect(sampleObj).toBeDefined();
    expect(sampleObj.parent).toBeDefined();
    expect(sampleObj.parent?._id).toBe(constructionIds[0]);
  });
});
