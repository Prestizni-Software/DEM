/**
 * Configuration options for simulated network latency and jitter.
 */
export interface NetworkSimulationConfig {
  /**
   * Enables or disables network delay simulation.
   */
  enabled: boolean;

  /**
   * Minimum one-way network delay in milliseconds.
   */
  minLatencyMs: number;

  /**
   * Maximum additional random jitter in milliseconds added to `minLatencyMs`.
   */
  jitterMs: number;

  /**
   * Optional deterministic seed for reproducible jitter generation.
   */
  seed?: number;

  /**
   * Whether to also delay pure `jest.fn()` unit-test spy mocks.
   * Defaults to true when `configureNetworkSimulation` is called explicitly,
   * and false when only environment background noise (`DEM_NETWORK_NOISE=1`) is active.
   */
  includeJestMocks?: boolean;
}

const SYMBOL_NETWORK_WRAPPED = Symbol.for("dem.network.simulation.wrapped");

/**
 * Parses global network simulation defaults from `process.env`.
 *
 * @returns Initial network simulation configuration.
 */
function loadInitialConfigFromEnv(): NetworkSimulationConfig {
  const env = typeof process !== "undefined" && process.env ? process.env : {};
  const rawToggle = String(env.DEM_NETWORK_NOISE ?? "").toLowerCase();
  const enabled = rawToggle === "1" || rawToggle === "true" || rawToggle === "yes";
  const minLatencyMs = Number.isFinite(Number(env.DEM_NETWORK_LATENCY_MS))
    ? Math.max(0, Number(env.DEM_NETWORK_LATENCY_MS))
    : 1;
  const jitterMs = Number.isFinite(Number(env.DEM_NETWORK_JITTER_MS))
    ? Math.max(0, Number(env.DEM_NETWORK_JITTER_MS))
    : 2;
  return {
    enabled,
    minLatencyMs,
    jitterMs,
    includeJestMocks: false,
  };
}

let globalNetworkConfig: NetworkSimulationConfig = loadInitialConfigFromEnv();
let prngState = 0x12345678;

/**
 * Generates a uniform pseudo-random number in [0, 1).
 *
 * @param useSeed - Whether to use deterministic xorshift32 state instead of Math.random().
 * @returns Random float in [0, 1).
 */
function nextRandom(useSeed: boolean): number {
  if (!useSeed) return Math.random();
  let x = prngState || 0x12345678;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  prngState = x;
  return (x >>> 0) / 0x100000000;
}

/**
 * Sets or updates the global network simulation configuration.
 *
 * @param options - Partial network simulation configuration to apply.
 * @returns The updated active network simulation configuration.
 */
export function configureNetworkSimulation(
  options: Partial<NetworkSimulationConfig>,
): NetworkSimulationConfig {
  globalNetworkConfig = {
    ...globalNetworkConfig,
    includeJestMocks: options.includeJestMocks ?? true,
    ...options,
  };
  if (typeof options.seed === "number") {
    prngState = options.seed || 0x12345678;
  }
  return { ...globalNetworkConfig };
}

/**
 * Resets global network simulation configuration back to environment defaults.
 *
 * @returns The restored network simulation configuration.
 */
export function resetNetworkSimulation(): NetworkSimulationConfig {
  globalNetworkConfig = loadInitialConfigFromEnv();
  return { ...globalNetworkConfig };
}

/**
 * Returns a copy of the current global network simulation configuration.
 *
 * @returns Active network simulation configuration.
 */
export function getNetworkSimulationConfig(): NetworkSimulationConfig {
  return { ...globalNetworkConfig };
}

/**
 * Computes a single simulated one-way delay in milliseconds from the given or global config.
 *
 * @param config - Optional configuration override.
 * @returns Simulated delay in milliseconds.
 */
export function computeSimulatedDelayMs(
  config: Partial<NetworkSimulationConfig> = globalNetworkConfig,
): number {
  const enabled = config.enabled ?? globalNetworkConfig.enabled;
  if (!enabled) return 0;
  const min = Math.max(0, config.minLatencyMs ?? globalNetworkConfig.minLatencyMs);
  const jitter = Math.max(0, config.jitterMs ?? globalNetworkConfig.jitterMs);
  if (jitter === 0) return min;
  const hasSeed = typeof (config.seed ?? globalNetworkConfig.seed) === "number";
  return min + Math.floor(nextRandom(hasSeed) * (jitter + 1));
}

/**
 * FIFO stream state to preserve strict TCP/WebSocket ordering when jitter varies across packets.
 */
interface FifoStreamState {
  lastScheduledAt: number;
}

/**
 * Delays execution by at least `ms` milliseconds while preserving strict FIFO ordering
 * relative to earlier packets on the same stream.
 *
 * @param ms - Desired delay duration in milliseconds.
 * @param fifo - Stream FIFO state tracker.
 * @param fn - Callback to invoke after the delay.
 */
function scheduleFifoUnrefDelay(
  ms: number,
  fifo: FifoStreamState,
  fn: () => void,
): void {
  const now = Date.now();
  if (ms <= 0 && fifo.lastScheduledAt <= now) {
    fn();
    return;
  }
  const targetAt = Math.max(now + Math.max(0, ms), fifo.lastScheduledAt);
  fifo.lastScheduledAt = targetAt;
  const waitMs = Math.max(1, targetAt - now);
  const timer = setTimeout(fn, waitMs);
  if (timer && typeof (timer as any).unref === "function") {
    (timer as any).unref();
  }
}

/**
 * Wraps a socket acknowledgement callback to simulate inbound network return delay
 * while preserving FIFO ordering on the inbound stream.
 *
 * @param ack - Original acknowledgement callback function.
 * @param inboundFifo - Inbound stream FIFO state.
 * @param configOverride - Optional per-socket simulation configuration override.
 * @returns Wrapped acknowledgement callback that delays execution when simulation is active.
 */
function wrapAckWithNetworkSimulation(
  ack: (...ackArgs: unknown[]) => unknown,
  inboundFifo: FifoStreamState,
  configOverride?: Partial<NetworkSimulationConfig>,
): (...ackArgs: unknown[]) => void {
  return (...ackArgs: unknown[]) => {
    const active = configOverride?.enabled ?? globalNetworkConfig.enabled;
    if (!active) {
      ack(...ackArgs);
      return;
    }
    const inboundDelay = computeSimulatedDelayMs(configOverride);
    scheduleFifoUnrefDelay(inboundDelay, inboundFifo, () => {
      ack(...ackArgs);
    });
  };
}

/**
 * Instruments a socket-like object so that acknowledgements and outbound emits
 * experience configurable network latency and jitter with strict FIFO stream ordering.
 * Preserves Jest mock metadata (`mock.calls`, `mockImplementation`, `mockClear`) when wrapping `jest.fn()`.
 *
 * @param socket - Socket or mock socket object to instrument.
 * @param configOverride - Optional per-socket simulation configuration override.
 * @returns The instrumented socket instance.
 */
export function applyNetworkSimulationToSocket<T>(
  socket: T,
  configOverride?: Partial<NetworkSimulationConfig>,
): T {
  if (!socket || typeof socket !== "object") return socket;
  const target = socket as Record<string | symbol, any>;
  if (target[SYMBOL_NETWORK_WRAPPED]) return socket;

  const origEmit = target.emit;
  if (typeof origEmit !== "function") return socket;

  target[SYMBOL_NETWORK_WRAPPED] = true;
  const outboundFifo: FifoStreamState = { lastScheduledAt: 0 };
  const inboundFifo: FifoStreamState = { lastScheduledAt: 0 };

  // If target.emit is a Jest mock, intercept its implementation or wrap acks without losing .mock
  if (origEmit._isMockFunction && typeof origEmit.getMockImplementation === "function") {
    const installMockWrapper = (impl?: (...args: any[]) => any) => {
      return function (this: unknown, ...args: unknown[]) {
        const active = configOverride?.enabled ?? globalNetworkConfig.enabled;
        const includeMocks =
          configOverride?.includeJestMocks ??
          globalNetworkConfig.includeJestMocks ??
          false;
        if (!active || !includeMocks) {
          return impl ? impl.apply(this, args) : undefined;
        }
        const wrappedArgs = [...args];
        const lastIdx = wrappedArgs.length - 1;
        if (lastIdx >= 0 && typeof wrappedArgs[lastIdx] === "function") {
          const origAck = wrappedArgs[lastIdx] as (...a: unknown[]) => unknown;
          const totalDelay =
            computeSimulatedDelayMs(configOverride) +
            computeSimulatedDelayMs(configOverride);
          wrappedArgs[lastIdx] = (...ackArgs: unknown[]) => {
            scheduleFifoUnrefDelay(totalDelay, inboundFifo, () => {
              origAck(...ackArgs);
            });
          };
        }
        return impl ? impl.apply(this, wrappedArgs) : undefined;
      };
    };

    const currentImpl = origEmit.getMockImplementation();
    origEmit.mockImplementation(installMockWrapper(currentImpl));

    const origMockImpl = origEmit.mockImplementation.bind(origEmit);
    origEmit.mockImplementation = (newImpl: (...args: any[]) => any) => {
      return origMockImpl(installMockWrapper(newImpl));
    };
    return socket;
  }

  // Real Socket.IO client or custom mock socket
  const wrappedEmit = function (this: unknown, ...args: unknown[]) {
    const active = configOverride?.enabled ?? globalNetworkConfig.enabled;
    if (!active) {
      return origEmit.apply(this ?? target, args);
    }
    const wrappedArgs = [...args];
    const lastIdx = wrappedArgs.length - 1;
    if (lastIdx >= 0 && typeof wrappedArgs[lastIdx] === "function") {
      wrappedArgs[lastIdx] = wrapAckWithNetworkSimulation(
        wrappedArgs[lastIdx] as (...a: unknown[]) => unknown,
        inboundFifo,
        configOverride,
      );
    }
    const outboundDelay = computeSimulatedDelayMs(configOverride);
    if (outboundDelay > 0) {
      scheduleFifoUnrefDelay(outboundDelay, outboundFifo, () => {
        origEmit.apply(this ?? target, wrappedArgs);
      });
      return target;
    }
    return origEmit.apply(this ?? target, wrappedArgs);
  };

  try {
    target.emit = wrappedEmit;
  } catch {
    // Ignore read-only emit property
  }

  return socket;
}
