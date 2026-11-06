import { Socket } from "socket.io-client";
import { applyNetworkSimulationToSocket } from "./NetworkSimulation.js";

/**
 * Global test hook that instruments client sockets when DEM_NETWORK_NOISE=1.
 * Ensures the DEM library remains completely free of test simulation code.
 */
const rawToggle = String(process.env.DEM_NETWORK_NOISE ?? "").toLowerCase();
const isNoiseEnabled = rawToggle === "1" || rawToggle === "true" || rawToggle === "yes";

if (isNoiseEnabled) {
  const origEmit = Socket.prototype.emit;
  Socket.prototype.emit = function (this: any, ev: string | symbol, ...args: any[]) {
    if (!this[Symbol.for("dem.network.simulation.wrapped")]) {
      applyNetworkSimulationToSocket(this);
      return this.emit(ev, ...args);
    }
    return origEmit.call(this, ev, ...args);
  };
}
