// @ts-check
const testMatch = process.env.STRYKER_TEST_MATCH
  ? process.env.STRYKER_TEST_MATCH.split(",")
  : undefined;

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: "npm",
  reporters: ["html", "clear-text", "progress", "json"],
  testRunner: "jest",
  testRunnerNodeArgs: ["--no-warnings", "--experimental-vm-modules"],
  coverageAnalysis: "perTest",
  ignoreStatic: true,
  incremental: true,
  concurrency: 1,
  maxTestRunnerReuse: 40,
  timeoutMS: 15000,
  mutate: [
    "AutoUpdateClientManagerClass.ts",
    "AutoUpdatedClientObjectClass.ts",
    "AutoUpdatedServerObjectClass.ts",
    "AutoUpdateManagerClass.ts",
    "AutoUpdateServerManagerClass.ts",
    "CommonTypes.ts",
    "DEMErrors.ts",
    "sync/**/*.ts",
    "!sync/**/index.ts",
    "!sync/types.ts",
    "!sync/storage/IClientStorageAdapter.ts",
  ],
  ignorePatterns: [
    "dist",
    "coverage",
    "reports",
    "docs",
    "investigation",
    ".codegraph",
    "*.txt",
    "types_test.ts",
    "inspect_type.ts",
  ],
  jest: {
    projectType: "custom",
    configFile: "jest.config.ts",
    enableFindRelatedTests: !testMatch,
    config: {
      ...(testMatch ? { testMatch } : {}),
      testPathIgnorePatterns: [
        "node_modules/",
        "issue_regression\\.test\\.ts",
        "performance\\.test\\.ts",
        "stress\\.test\\.ts",
      ],
    },
  },
};
export default config;
