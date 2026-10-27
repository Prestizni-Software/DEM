import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const rootDir = path.resolve(".");

/**
 * Logs an informative message to stdout.
 *
 * @param msg - Informational message string.
 * @param symbol - Prefix symbol.
 */
function log(msg, symbol = "ℹ") {
  console.log(`\x1b[36m[DEM RELEASE]\x1b[0m ${symbol} ${msg}`);
}

/**
 * Logs a success message to stdout.
 *
 * @param msg - Success message string.
 */
function logSuccess(msg) {
  console.log(`\x1b[32m[DEM RELEASE]\x1b[0m ✔ ${msg}`);
}

/**
 * Logs an error message to stderr.
 *
 * @param msg - Error message string.
 */
function logError(msg) {
  console.error(`\x1b[31m[DEM RELEASE]\x1b[0m ✖ ${msg}`);
}

/**
 * Executes a shell command synchronously in the given directory.
 *
 * @param cmd - Shell command string.
 * @param cwd - Working directory for the command.
 */
function runCommand(cmd, cwd = rootDir) {
  log(`Executing: ${cmd} (in ${path.basename(cwd)})`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

/**
 * Reads versions from src/version.ts.
 *
 * @returns Object with client and server versions.
 */
export function readVersions() {
  const versionFile = path.join(rootDir, "version.ts");
  const content = fs.readFileSync(versionFile, "utf-8");
  const clientMatch = content.match(/DEM_CLIENT_VERSION\s*=\s*"([^"]+)"/);
  const serverMatch = content.match(/DEM_SERVER_VERSION\s*=\s*"([^"]+)"/);
  return {
    client: clientMatch ? clientMatch[1] : "0.7.5",
    server: serverMatch ? serverMatch[1] : "0.7.4",
  };
}

/**
 * Updates versions in src/version.ts.
 *
 * @param newClientVersion - New client version string.
 * @param newServerVersion - New server version string.
 * @param minCompatibleClientVersion - Optional lowest compatible client version.
 */
export function writeVersions(newClientVersion, newServerVersion, minCompatibleClientVersion) {
  const versionFile = path.join(rootDir, "version.ts");
  const contentBefore = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, "utf-8") : "";
  const existingMinMatch = contentBefore.match(/DEM_MIN_COMPATIBLE_CLIENT_VERSION\s*=\s*"([^"]+)"/);
  
  const clientParts = newClientVersion.split(".");
  const defaultMin = `${clientParts[0]}.${clientParts[1]}.0`;
  let minClient = minCompatibleClientVersion;
  if (!minClient) {
    if (existingMinMatch) {
      const existingMinParts = existingMinMatch[1].split(".");
      if (existingMinParts[0] === clientParts[0] && existingMinParts[1] === clientParts[1]) {
        minClient = existingMinMatch[1];
      } else {
        minClient = defaultMin;
      }
    } else {
      minClient = defaultMin;
    }
  }

  const content = `/**
 * Current version of @prestizni-software/client-dem.
 */
export const DEM_CLIENT_VERSION = "${newClientVersion}";

/**
 * Current version of @prestizni-software/server-dem.
 */
export const DEM_SERVER_VERSION = "${newServerVersion}";

/**
 * Lowest client version that the server is compatible with.
 * Server patches do not increment this value unless breaking compatibility.
 */
export const DEM_MIN_COMPATIBLE_CLIENT_VERSION = "${minClient}";

/**
 * Global DEM version constant indicating minimum compatible client version.
 */
export const DEM_VERSION = DEM_MIN_COMPATIBLE_CLIENT_VERSION;

/**
 * Socket protocol version for DEM communications.
 */
export const DEM_PROTOCOL_VERSION = "1.0.0";
`;
  fs.writeFileSync(versionFile, content, "utf-8");
}

/**
 * Increments semver version string based on release type.
 *
 * @param currentVersion - Current semver string.
 * @param releaseType - 'patch' | 'minor' | 'major'.
 * @returns Incremented semver string.
 */
export function bumpSemVer(currentVersion, releaseType) {
  const parts = currentVersion.split(".").map((n) => parseInt(n, 10));
  let [major = 0, minor = 0, patch = 0] = parts;

  if (releaseType === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (releaseType === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

/**
 * Checks if the user is authenticated with npm.
 * Executes 'npm login' when the user is not authenticated.
 */
function ensureNpmLogin() {
  log("Checking npm authentication status (npm whoami)...");
  try {
    const user = execSync("npm whoami", { stdio: ["pipe", "pipe", "ignore"], encoding: "utf-8" }).trim();
    logSuccess(`Authenticated to npm as: ${user}`);
  } catch (error) {
    log("User not logged in to npm. Executing: npm login");
    execSync("npm login", { stdio: "inherit" });
    const user = execSync("npm whoami", { stdio: ["pipe", "pipe", "ignore"], encoding: "utf-8" }).trim();
    logSuccess(`Authenticated to npm as: ${user}`);
  }
}

/**
 * Creates distribution package directories and manifests for client and server.
 *
 * @param clientVersion - Version for client package.
 * @param serverVersion - Version for server package.
 */
function preparePackageDist(clientVersion, serverVersion) {
  const distDir = path.join(rootDir, "dist");
  const distClientDir = path.join(distDir, "packages", "client");
  const distServerDir = path.join(distDir, "packages", "server");

  fs.mkdirSync(distClientDir, { recursive: true });
  fs.mkdirSync(distServerDir, { recursive: true });

  // Client package.json
  const clientPkg = {
    name: "@prestizni-software/client-dem",
    version: clientVersion,
    description: "Real-time client synchronization library for DEM",
    type: "module",
    main: "./client.js",
    types: "./client.d.ts",
    publishConfig: {
      access: "public",
      registry: "https://registry.npmjs.org/",
    },
    dependencies: {
      bson: "^7.3.3",
      eventemitter3: "^5.0.4",
      lodash: "^4.18.1",
      "reflect-metadata": "^0.2.2",
      "socket.io-client": "^4.8.4",
      "string-similarity-js": "^2.1.4",
    },
  };

  // Server package.json
  const serverPkg = {
    name: "@prestizni-software/server-dem",
    version: serverVersion,
    description: "Real-time server synchronization library for DEM",
    type: "module",
    main: "./server.js",
    types: "./server.d.ts",
    publishConfig: {
      access: "public",
      registry: "https://registry.npmjs.org/",
    },
    dependencies: {
      "@typegoose/typegoose": "^13.5.0",
      bson: "^7.3.3",
      eventemitter3: "^5.0.4",
      lodash: "^4.18.1",
      "node-machine-id": "^1.1.12",
      "reflect-metadata": "^0.2.2",
      "socket.io": "^4.8.4",
      "socket.io-client": "^4.8.4",
      "string-similarity-js": "^2.1.4",
    },
  };

  // Clean packages directory first to avoid stale artifacts
  fs.rmSync(distClientDir, { recursive: true, force: true });
  fs.rmSync(distServerDir, { recursive: true, force: true });
  fs.mkdirSync(distClientDir, { recursive: true });
  fs.mkdirSync(distServerDir, { recursive: true });

  fs.writeFileSync(
    path.join(distClientDir, "package.json"),
    JSON.stringify(clientPkg, null, 2),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(distServerDir, "package.json"),
    JSON.stringify(serverPkg, null, 2),
    "utf-8",
  );

  // Client-allowed file prefixes / names
  const clientAllowed = [
    "client",
    "AutoUpdateClientManagerClass",
    "AutoUpdatedClientObjectClass",
    "AutoUpdateManagerClass",
    "CommonTypes",
    "DEMErrors",
    "version",
    "sync",
  ];

  // Excluded from both packages (tests, build caches, test utilities)
  const excludedItems = new Set([
    "packages",
    "tests",
    "test_lib",
    "test_client",
    "test_server",
    "types_test",
    "TestTypes",
    "repro_any",
    "repro_paths",
    "repro_paths_2",
    "repro_paths_3",
    "repro_paths_4",
    "inspect_type",
    "old_file",
    "socket_test",
    "test",
    "jest.config",
    "tsconfig.tsbuildinfo",
  ]);

  const items = fs.readdirSync(distDir);
  for (const item of items) {
    if (excludedItems.has(item) || item.startsWith("test")) continue;
    const baseName = item.split(".")[0];
    if (excludedItems.has(baseName)) continue;

    const srcPath = path.join(distDir, item);
    const destServerPath = path.join(distServerDir, item);
    const stat = fs.statSync(srcPath);

    // Copy to server package
    if (stat.isDirectory()) {
      fs.cpSync(srcPath, destServerPath, { recursive: true });
    } else {
      fs.copyFileSync(srcPath, destServerPath);
    }

    // Copy to client package only if allowed
    const isClientAllowed = clientAllowed.some((prefix) => item === prefix || item.startsWith(`${prefix}.`));
    if (isClientAllowed) {
      const destClientPath = path.join(distClientDir, item);
      if (stat.isDirectory()) {
        fs.cpSync(srcPath, destClientPath, { recursive: true });
      } else {
        fs.copyFileSync(srcPath, destClientPath);
      }
    }
  }

  // Copy README.md to distribution packages
  const readmeSrc = path.join(rootDir, "README.md");
  if (fs.existsSync(readmeSrc)) {
    fs.copyFileSync(readmeSrc, path.join(distClientDir, "README.md"));
    fs.copyFileSync(readmeSrc, path.join(distServerDir, "README.md"));
  }

  logSuccess(`Prepared distribution packages for client (v${clientVersion}) and server (v${serverVersion})`);
}

/**
 * Executes unified release workflow for client and/or server packages.
 *
 * @param target - 'both' | 'client' | 'server'.
 * @param releaseType - 'patch' | 'minor' | 'major' | semver string.
 * @param options - Release execution options.
 */
export function release(target = "both", releaseType = "patch", options = {}) {
  const {
    description = "",
    dryRun = false,
    skipTests = false,
    skipPublish = false,
    push = true,
  } = options;

  const currentVersions = readVersions();
  let nextClientVersion = currentVersions.client;
  let nextServerVersion = currentVersions.server;

  if (target === "client" || target === "both" || target === "all") {
    nextClientVersion = /^\d+\.\d+\.\d+/.test(releaseType)
      ? releaseType
      : bumpSemVer(currentVersions.client, releaseType);
  }

  if (target === "server" || target === "both" || target === "all") {
    nextServerVersion = /^\d+\.\d+\.\d+/.test(releaseType)
      ? releaseType
      : bumpSemVer(currentVersions.server, releaseType);
  }

  log(`\n========================================`);
  log(`Starting release workflow for DEM`);
  log(`Target: ${target}`);
  log(`Release Type: ${releaseType}`);
  log(`Client Version: ${currentVersions.client} -> ${nextClientVersion}`);
  log(`Server Version: ${currentVersions.server} -> ${nextServerVersion}`);
  if (description) {
    log(`Description: ${description}`);
  }
  log(`========================================\n`);

  // Step 1: Verify npm login status
  if (!skipPublish && !dryRun) {
    ensureNpmLogin();
  }

  // Step 2: Verification protocol (tests & compilation)
  if (!skipTests) {
    log("Running TypeScript compilation check (npx tsc --noEmit)...");
    runCommand("npx tsc --noEmit", rootDir);
    log("Running automated regression test suite (npm run test_for_AI)...");
    runCommand("npm run test_for_AI", rootDir);
    logSuccess("All tests and verification checks passed!");
  }

  // Step 3: Update version.ts
  writeVersions(nextClientVersion, nextServerVersion);

  // Step 4: Build distribution files
  log("Building distribution files (dist/)...");
  runCommand("npx tsc", rootDir);
  logSuccess("Built dist/ successfully");

  // Step 5: Prepare standalone client and server packages in dist/packages/
  preparePackageDist(nextClientVersion, nextServerVersion);

  if (dryRun) {
    logSuccess("[DRY RUN] Build and packaging completed. Skipping commit and publish.");
    // Revert version.ts in dry run
    writeVersions(currentVersions.client, currentVersions.server);
    return;
  }

  // Step 6: Stage version.ts and package.json
  runCommand("git add version.ts package.json", rootDir);

  // Step 7: Construct release commit message
  const commitTitle = description
    ? `Release client v${nextClientVersion}, server v${nextServerVersion}: ${description}`
    : `Release client v${nextClientVersion}, server v${nextServerVersion}`;
  const commitMessage = `${commitTitle}\n\nClient version: ${nextClientVersion}\nServer version: ${nextServerVersion}`;

  log(`Creating release commit: "${commitTitle}"...`);
  const tempMsgFile = path.join(rootDir, ".release-commit-msg.tmp");
  try {
    fs.writeFileSync(tempMsgFile, commitMessage, "utf-8");
    runCommand(`git commit -F "${tempMsgFile}"`, rootDir);
  } finally {
    if (fs.existsSync(tempMsgFile)) {
      fs.unlinkSync(tempMsgFile);
    }
  }

  // Step 8: Create git tags
  if (target === "client" || target === "both" || target === "all") {
    const clientTag = `client-v${nextClientVersion}`;
    log(`Tagging release as ${clientTag}...`);
    runCommand(`git tag -a "${clientTag}" -m "Release @prestizni-software/client-dem v${nextClientVersion}"`, rootDir);
  }
  if (target === "server" || target === "both" || target === "all") {
    const serverTag = `server-v${nextServerVersion}`;
    log(`Tagging release as ${serverTag}...`);
    runCommand(`git tag -a "${serverTag}" -m "Release @prestizni-software/server-dem v${nextServerVersion}"`, rootDir);
  }

  // Step 9: Push commit and tags if enabled
  if (push) {
    try {
      log("Pushing commit and tags to origin...");
      runCommand("git push origin main --follow-tags", rootDir);
      logSuccess("Pushed release commit and tags to origin");
    } catch (pushErr) {
      logError("git push failed. Push manually using: git push origin main --follow-tags");
    }
  }

  // Step 10: Publish to npm
  if (skipPublish) {
    logSuccess("Skipping npm publish as requested.");
    return;
  }

  const distPackagesDir = path.join(rootDir, "dist", "packages");
  if (target === "client" || target === "both" || target === "all") {
    log("Publishing @prestizni-software/client-dem to npm...");
    try {
      runCommand("npm publish --access public", path.join(distPackagesDir, "client"));
      logSuccess(`Successfully published @prestizni-software/client-dem v${nextClientVersion}!`);
    } catch (err) {
      logError("Client publish failed. Check npm credentials.");
    }
  }

  if (target === "server" || target === "both" || target === "all") {
    log("Publishing @prestizni-software/server-dem to npm...");
    try {
      runCommand("npm publish --access public", path.join(distPackagesDir, "server"));
      logSuccess(`Successfully published @prestizni-software/server-dem v${nextServerVersion}!`);
    } catch (err) {
      logError("Server publish failed. Check npm credentials.");
    }
  }
}

// CLI entry point
const args = process.argv.slice(2);
const isMainModule = process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`;
if (isMainModule) {
  let target = "both";
  if (args.includes("client")) {
    target = "client";
  } else if (args.includes("server")) {
    target = "server";
  }

  const releaseTypeArg = args.find((a) =>
    ["patch", "minor", "major"].includes(a) || /^\d+\.\d+\.\d+/.test(a),
  ) || "patch";

  const dryRun = args.includes("--dry-run");
  const skipTests =
    args.includes("--skip-tests") ||
    args.includes("--no-tests") ||
    args.includes("-n") ||
    args.includes("--quick");
  const skipPublish = args.includes("--no-publish") || args.includes("--skip-publish");
  const noPush = args.includes("--no-push");

  let description = "";
  const descIdx = args.findIndex((a) => a === "--desc" || a === "-m" || a === "--description");
  if (descIdx !== -1 && args[descIdx + 1]) {
    description = args[descIdx + 1];
  } else {
    const freeArgs = args.filter(
      (a) =>
        !a.startsWith("-") &&
        !["patch", "minor", "major", "client", "server", "both", "all"].includes(a) &&
        !/^\d+\.\d+\.\d+/.test(a),
    );
    if (freeArgs.length > 0) {
      description = freeArgs.join(" ");
    }
  }

  release(target, releaseTypeArg, {
    description,
    dryRun,
    skipTests,
    skipPublish,
    push: !noPush,
  });
}
