import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const rootDir = path.resolve(".");
const clientDir = path.resolve("..", "client");
const serverDir = path.resolve("..", "server");

const clientFiles = [
  "tsconfig.json",
  "AutoUpdateClientManagerClass.ts",
  "AutoUpdatedClientObjectClass.ts",
  "CommonTypes.ts",
  "AutoUpdateManagerClass.ts",
  "client.ts",
];

const serverFiles = [
  "tsconfig.json",
  "AutoUpdatedClientObjectClass.ts",
  "AutoUpdateManagerClass.ts",
  "server.ts",
  "CommonTypes.ts",
  "CommonTypes_server.ts",
  "AutoUpdateServerManagerClass.ts",
  "AutoUpdatedServerObjectClass.ts",
];

function log(msg, symbol = "ℹ") {
  console.log(`\x1b[36m[DEM RELEASE]\x1b[0m ${symbol} ${msg}`);
}

function logSuccess(msg) {
  console.log(`\x1b[32m[DEM RELEASE]\x1b[0m ✔ ${msg}`);
}

function logError(msg) {
  console.error(`\x1b[31m[DEM RELEASE]\x1b[0m ✖ ${msg}`);
}

function runCommand(cmd, cwd = rootDir) {
  log(`Executing: ${cmd} (in ${path.basename(cwd)})`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

function syncPackage(targetDir, files, packageName) {
  log(`Syncing files to ${packageName} (${targetDir})...`);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Target directory ${targetDir} does not exist.`);
  }

  for (const file of files) {
    const src = path.join(rootDir, file);
    const dest = path.join(targetDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    } else {
      logError(`Source file ${file} does not exist in src!`);
    }
  }
  logSuccess(`Synced ${files.length} files to ${packageName}`);
}

export function releasePackage(targetDir, files, packageName, releaseType = "patch", options = {}) {
  const { syncOnly = false, dryRun = false, skipTests = false } = options;

  log(`\n========================================`);
  log(`Starting release workflow for ${packageName}`);
  log(`Release Type: ${releaseType} | Mode: ${syncOnly ? "SYNC ONLY" : "FULL RELEASE"}`);
  log(`========================================\n`);

  // Step 1: Pre-flight checks in src
  if (!skipTests) {
    log("Running TypeScript compilation in src...");
    runCommand("npx tsc", rootDir);
    log("Running automated regression test suite (test_for_AI)...");
    runCommand("npm run test_for_AI", rootDir);
    logSuccess("All tests and type checks passed!");
  }

  // Step 2: Sync files to target package
  syncPackage(targetDir, files, packageName);

  if (syncOnly) {
    logSuccess(`Sync complete for ${packageName}. Skipping release.`);
    return;
  }

  // Step 3: Build target package
  log(`Building ${packageName} (tsc)...`);
  runCommand("npx tsc", targetDir);
  logSuccess(`Built dist/ for ${packageName}`);

  if (dryRun) {
    logSuccess(`[DRY RUN] Build completed for ${packageName}. Skipping version bump and publish.`);
    return;
  }

  // Step 4: Version bump & publish
  const bumpCmd = `npx standard-version --release-as ${releaseType}`;
  log(`Bumping version and generating changelog with standard-version...`);
  runCommand(bumpCmd, targetDir);

  log(`Pushing git tags to origin...`);
  runCommand("git push --follow-tags", targetDir);

  log(`Publishing ${packageName} to npm...`);
  runCommand("npm publish --access public", targetDir);

  logSuccess(`Successfully released and published ${packageName}!`);
}

// CLI entry point
const args = process.argv.slice(2);
const target = args[0] || "all"; // all | client | server
const releaseType = args.find((a) => ["patch", "minor", "major"].includes(a)) || "patch";
const syncOnly = args.includes("sync");
const dryRun = args.includes("--dry-run");

if (target === "client" || target === "all") {
  releasePackage(clientDir, clientFiles, "@prestizni-software/client-dem", releaseType, {
    syncOnly,
    dryRun,
    skipTests: target === "all" && target !== "client",
  });
}

if (target === "server" || target === "all") {
  releasePackage(serverDir, serverFiles, "@prestizni-software/server-dem", releaseType, {
    syncOnly,
    dryRun,
    skipTests: target === "all",
  });
}
