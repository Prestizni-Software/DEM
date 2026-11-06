import { spawn } from "node:child_process";

/**
 * Executes the Jest test suite with global network noise (`DEM_NETWORK_NOISE=1`) enabled.
 * Forwards any extra CLI arguments directly to Jest.
 */
function runTestsWithNetworkNoise() {
  const extraArgs = process.argv.slice(2);
  const hasExplicitTestTargets = extraArgs.some((arg) => !arg.startsWith("-"));
  const defaultArgs = [
    "--no-warnings",
    "--experimental-vm-modules",
    "node_modules/jest/bin/jest.js",
    ...(hasExplicitTestTargets ? [] : ["tests/"]),
    "--testPathIgnorePatterns=tests/issue_regression.test.ts",
    "--setupFilesAfterEnv=<rootDir>/tests/setup_network_noise.ts",
    "--detectOpenHandles",
    "--forceExit",
    ...extraArgs,
  ];

  const env = {
    ...process.env,
    DEM_NETWORK_NOISE: process.env.DEM_NETWORK_NOISE ?? "1",
    DEM_NETWORK_LATENCY_MS: process.env.DEM_NETWORK_LATENCY_MS ?? "1",
    DEM_NETWORK_JITTER_MS: process.env.DEM_NETWORK_JITTER_MS ?? "3",
  };

  process.stdout.write(
    `[DEM NETWORK SIMULATION] Running test suite with DEM_NETWORK_NOISE=${env.DEM_NETWORK_NOISE} (minLatency=${env.DEM_NETWORK_LATENCY_MS}ms, jitter=${env.DEM_NETWORK_JITTER_MS}ms)\n`,
  );

  const child = spawn(process.execPath, defaultArgs, {
    stdio: "inherit",
    env,
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

runTestsWithNetworkNoise();
