import { jest } from "@jest/globals";
import "reflect-metadata";
import { EventEmitter } from "eventemitter3";
import { AUCManagerFactory, AutoUpdateClientManager } from "../AutoUpdateClientManagerClass.js";
import { setupClassAccessors } from "../AutoUpdatedClientObjectClass.js";
import * as ClientClasses from "./testData/ClientClasses/index.js";
import {
  DEM_PROTOCOL_VERSION,
  DEM_VERSION,
  globalCache,
  LoggersType,
  configureNetworkSimulation,
  resetNetworkSimulation,
  getNetworkSimulationConfig,
} from "../CommonTypes.js";
import {
  ClientStateReconciler,
  MemoryStorageAdapter,
} from "../sync/index.js";

/**
 * Writes network performance benchmark metrics directly to standard output.
 * Bypasses Jest console suppression in `--silent` mode.
 *
 * @param label - Benchmark scenario label.
 * @param detail - Additional detail such as simulated latency or object count.
 * @param durationMs - Measured wall-clock duration in milliseconds.
 */
function reportNetworkBenchmark(
  label: string,
  detail: string,
  durationMs: number,
): void {
  const formattedDuration = durationMs.toFixed(2).padStart(8);
  process.stdout.write(
    `  [NET BENCHMARK] ${label.padEnd(48)} | ${detail.padStart(18)} | ${formattedDuration} ms\n`,
  );
}

describe("Network Slowness & Jitter Performance Benchmarks", () => {
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

  afterEach(() => {
    resetNetworkSimulation();
  });

  test("1. Configures and resets global network simulation state cleanly", () => {
    const updated = configureNetworkSimulation({
      enabled: true,
      minLatencyMs: 25,
      jitterMs: 10,
      seed: 42,
    });
    expect(updated.enabled).toBe(true);
    expect(updated.minLatencyMs).toBe(25);
    expect(updated.jitterMs).toBe(10);

    const current = getNetworkSimulationConfig();
    expect(current.enabled).toBe(true);

    resetNetworkSimulation();
    const afterReset = getNetworkSimulationConfig();
    expect(afterReset.minLatencyMs).toBeGreaterThanOrEqual(0);
  });

  test("2. Multi-manager cold startup across simulated 0ms, 30ms (Wi-Fi), and 120ms (Slow 3G) network RTT", async () => {
    const itemsPerManager = 300;
    const defs: Record<string, any> = {
      Company: ClientClasses.Company,
      Construction: ClientClasses.Construction,
      Subordinate: ClientClasses.Subordinate,
    };

    const payloads: Record<string, { ids: string[]; objects: any[]; properties: string[] }> = {};
    for (const [name, Cls] of Object.entries(defs)) {
      const meta = setupClassAccessors(Cls);
      const ids: string[] = [];
      const objects: any[] = [];
      for (let i = 0; i < itemsPerManager; i++) {
        const id = `${name}_${i}`;
        ids.push(id);
        objects.push({
          _id: id,
          name: `${name} Item ${i}`,
          fullName: `${name} Full ${i}`,
          abbr: `C${i}`,
          login: `user_${i}`,
        });
      }
      payloads[name] = { ids, objects, properties: meta.properties };
    }

    const runColdStartup = async (minLatencyMs: number, jitterMs: number) => {
      globalCache.objects = {};
      configureNetworkSimulation({
        enabled: minLatencyMs > 0 || jitterMs > 0,
        minLatencyMs,
        jitterMs,
        seed: 101,
      });

      const mockSocket: any = {
        on: jest.fn(),
        off: jest.fn(),
        onAny: jest.fn(),
        emit: jest.fn((event: string, _data: any, ack: any) => {
          const match = event.match(/^startup(\w+)$/);
          if (match && ack) {
            const mgrName = match[1];
            ack({
              success: true,
              data: {
                ...payloads[mgrName],
                version: DEM_VERSION,
                protocolVersion: DEM_PROTOCOL_VERSION,
              },
            });
          }
        }),
      };

      const t0 = performance.now();
      const managers = await AUCManagerFactory(
        defs as any,
        loggers,
        mockSocket,
        false,
        new EventEmitter(),
        {},
      );
      const elapsed = performance.now() - t0;
      expect(managers.Subordinate.objectsAsArray.length).toBe(itemsPerManager);
      return elapsed;
    };

    // Warm up JIT and metadata caches before benchmarking 0ms cold startup
    await runColdStartup(0, 0);

    const fastMs = await runColdStartup(0, 0);
    reportNetworkBenchmark("Cold Startup (900 objects, 3 managers)", "0 ms latency", fastMs);

    const wifiMs = await runColdStartup(15, 10);
    reportNetworkBenchmark("Cold Startup (900 objects, 3 managers)", "30-50 ms RTT", wifiMs);

    const slow3gMs = await runColdStartup(60, 20);
    reportNetworkBenchmark("Cold Startup (900 objects, 3 managers)", "120-160 ms RTT", slow3gMs);

    expect(slow3gMs).toBeGreaterThanOrEqual(115);
    expect(slow3gMs).toBeGreaterThan(wifiMs);
    expect(slow3gMs).toBeGreaterThan(fastMs);
  });

  test("3. Stale-while-revalidate snapshot restore vs blocking network delta sync under 150ms slow network", async () => {
    const count = 500;
    const storage = new MemoryStorageAdapter();
    const ids = Array.from({ length: count }, (_, i) => `sub_${i}`);
    const objects = ids.map((id, i) => ({
      _id: id,
      name: `Worker ${i}`,
      login: `w_${i}`,
    }));

    await storage.saveManagerState("Subordinate", {
      className: "Subordinate",
      revision: 10,
      ids,
      objects,
      properties: ["_id", "name", "login"],
      savedAt: Date.now(),
    });

    const deltaChanges = Array.from({ length: 200 }, (_, i) => ({
      revision: 11 + i,
      type: "update" as const,
      id: `sub_${i % 20}`,
      data: { name: `Updated Worker ${i}` },
      timestamp: Date.now(),
      estimatedBytes: 40,
    }));

    // Scenario A: Blocking loadFromServer with 75ms one-way (150ms RTT) network slowness
    configureNetworkSimulation({
      enabled: true,
      minLatencyMs: 75,
      jitterMs: 15,
      seed: 777,
    });

    const blockingSocket: any = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn((event: string, _payload: any, ack: any) => {
        if (event === "startupSubordinate") {
          ack?.({
            success: true,
            data: {
              status: "delta",
              revision: 210,
              version: DEM_VERSION,
              protocolVersion: DEM_PROTOCOL_VERSION,
              changes: deltaChanges,
              ids: [],
              properties: ["_id", "name", "login"],
            },
          });
        }
      }),
    };

    const blockingManager = new AutoUpdateClientManager(
      ClientClasses.Subordinate as any,
      "Subordinate",
      blockingSocket,
      loggers,
      {},
      new EventEmitter(),
      { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
      undefined,
      { storage, batchCallbacks: true },
    );

    const tBlock0 = performance.now();
    await blockingManager.loadFromServer();
    const blockingReadyMs = performance.now() - tBlock0;
    reportNetworkBenchmark(
      "Blocking loadFromServer (waits for slow RTT)",
      "150 ms RTT",
      blockingReadyMs,
    );

    // Scenario B: Stale-while-revalidate (restoreAndRevalidate) under the same 150ms RTT
    const swrManager = new AutoUpdateClientManager(
      ClientClasses.Subordinate as any,
      "Subordinate",
      blockingSocket,
      loggers,
      {},
      new EventEmitter(),
      { new: jest.fn(), update: jest.fn(), delete: jest.fn(), progress: jest.fn() },
      undefined,
      { storage, batchCallbacks: true },
    );

    const tSwr0 = performance.now();
    const swrResult = await ClientStateReconciler.restoreAndRevalidate(
      swrManager as any,
      storage,
      async (_rev) =>
        new Promise((resolve) => {
          blockingSocket.emit("startupSubordinate", { lastRevision: _rev }, (res: any) => {
            resolve(res.data);
          });
        }),
    );
    const swrUiReadyMs = performance.now() - tSwr0;
    reportNetworkBenchmark(
      "SWR restoreAndRevalidate (UI ready immediately)",
      "150 ms RTT",
      swrUiReadyMs,
    );

    // UI is ready with 500 objects before the slow network delta finishes
    expect(swrResult.restored).toBe(true);
    expect(swrResult.count).toBe(count);
    expect(swrUiReadyMs).toBeLessThan(50);
    expect(blockingReadyMs).toBeGreaterThan(130);

    const revalOutcome = await swrResult.revalidation;
    const swrTotalWithBgMs = performance.now() - tSwr0;
    reportNetworkBenchmark(
      "SWR background revalidation completed",
      "200 updates",
      swrTotalWithBgMs,
    );
    expect(revalOutcome.reconciled).toBe(true);
    expect(revalOutcome.revision).toBe(210);
  });

  test("4. Sequential vs concurrent entity property mutations under simulated network jitter", async () => {
    configureNetworkSimulation({
      enabled: true,
      minLatencyMs: 12,
      jitterMs: 8,
      seed: 99,
    });

    const mockSocket: any = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn((_event: string, data: any, ack: any) => {
        ack?.({ success: true, data: data?.value });
      }),
    };

    const manager: any = {
      managers: {},
      cache: { references: {} },
      isLoaded: true,
    };

    const entities = Array.from({ length: 8 }, (_, i) => {
      return new (ClientClasses.Subordinate as any)(
        ClientClasses.Subordinate,
        mockSocket,
        { _id: `s_${i}`, name: `Init_${i}` },
        loggers,
        "Subordinate",
        manager,
        { update: jest.fn(), new: jest.fn(), delete: jest.fn(), progress: jest.fn() },
        new EventEmitter(),
      );
    });
    await Promise.resolve();

    // Sequential mutations across 8 entities (8 * ~30ms RTT)
    const tSeq0 = performance.now();
    for (let i = 0; i < entities.length; i++) {
      await entities[i].setValue("name", `Seq_${i}`);
    }
    const seqMs = performance.now() - tSeq0;
    reportNetworkBenchmark("8 Entity Mutations (Sequential awaits)", "24-40 ms RTT", seqMs);

    // Concurrent mutations across 8 entities (1 parallel ~30ms RTT window)
    const tConc0 = performance.now();
    await Promise.all(
      entities.map((ent, i) => ent.setValue("name", `Conc_${i}`)),
    );
    const concMs = performance.now() - tConc0;
    reportNetworkBenchmark("8 Entity Mutations (Parallel Promise.all)", "24-40 ms RTT", concMs);

    expect(concMs).toBeLessThan(seqMs);
    expect(entities[7].name).toBe("Conc_7");
  });
});
