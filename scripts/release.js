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
 * Reads the current package version from package.json.
 *
 * @returns Semantic version string.
 */
function readCurrentVersion() {
  const pkgPath = path.join(rootDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  return pkg.version;
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
 * Executes the complete single-repository release workflow:
 * 1. Executes verification protocol (npx tsc and npm run test_for_AI).
 * 2. Compiles TypeScript artifacts into dist/.
 * 3. Bumps version in package.json using semver type (patch, minor, major) or explicit version string.
 * 4. Creates a dedicated release git commit containing only the version bump and automated or custom description.
 * 5. Tags the release with git tag.
 * 6. Optionally publishes the package to npm.
 *
 * @param releaseType - 'patch' | 'minor' | 'major' | semver string.
 * @param options - Release options including description, dryRun, skipTests, skipPublish.
 */
export function release(releaseType = "patch", options = {}) {
  const {
    description = "",
    dryRun = false,
    skipTests = false,
    skipPublish = false,
    push = true,
  } = options;

  const currentVersion = readCurrentVersion();

  log(`\n========================================`);
  log(`Starting single-repository release workflow for DEM`);
  log(`Current Version: ${currentVersion}`);
  log(`Release Type: ${releaseType}`);
  if (description) {
    log(`Description: ${description}`);
  }
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

  // Step 3: Build distribution files
  log("Building distribution files (dist/)...");
  runCommand("npx tsc", rootDir);
  logSuccess("Built dist/ successfully");

  if (dryRun) {
    logSuccess("[DRY RUN] Build completed. Skipping version bump, commit, and publish.");
    return;
  }

  // Step 3: Bump package version using npm version without automatic git commit/tag
  log(`Bumping package version (${releaseType})...`);
  runCommand(`npm version ${releaseType} --no-git-tag-version`, rootDir);
  const newVersion = readCurrentVersion();
  logSuccess(`Bumped version: ${currentVersion} -> ${newVersion}`);

  // Step 4: Stage package.json (and package-lock.json if updated) and dist files
  runCommand("git add package.json package-lock.json dist/", rootDir);

  // Step 5: Construct release commit message
  const commitTitle = description
    ? `Release v${newVersion}: ${description}`
    : `Release v${newVersion}`;
  const commitMessage = `${commitTitle}\n\nVersion release for @prestizni-software/dem-publisher.`;

  log(`Creating release commit: "${commitTitle}"...`);
  // Use temporary file or direct command for commit message to handle multiline cleanly
  const tempMsgFile = path.join(rootDir, ".release-commit-msg.tmp");
  try {
    fs.writeFileSync(tempMsgFile, commitMessage, "utf-8");
    runCommand(`git commit -F "${tempMsgFile}"`, rootDir);
  } finally {
    if (fs.existsSync(tempMsgFile)) {
      fs.unlinkSync(tempMsgFile);
    }
  }

  // Step 6: Create git tag
  const tagName = `v${newVersion}`;
  log(`Tagging release as ${tagName}...`);
  runCommand(`git tag -a "${tagName}" -m "${commitTitle}"`, rootDir);
  logSuccess(`Created tag ${tagName}`);

  // Step 7: Push commit and tags if enabled
  if (push) {
    try {
      log("Pushing commit and tags to origin...");
      runCommand("git push origin main --follow-tags", rootDir);
      logSuccess("Pushed release commit and tags to origin");
    } catch (pushErr) {
      logError("git push failed. Push manually using: git push origin main --follow-tags");
    }
  }

  // Step 8: Publish to npm
  if (skipPublish) {
    logSuccess("Skipping npm publish as requested.");
    return;
  }

  log("Publishing package to npm...");
  try {
    runCommand("npm publish --access public", rootDir);
    logSuccess(`Successfully published v${newVersion} to npm!`);
  } catch (publishErr) {
    logError("npm publish failed. Run 'npm publish --access public' manually.");
  }
}

// CLI entry point
const args = process.argv.slice(2);
const isMainModule = process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`;
if (isMainModule) {
  const releaseTypeArg = args.find((a) =>
    ["patch", "minor", "major"].includes(a) || /^\d+\.\d+\.\d+/.test(a),
  ) || "patch";

  const dryRun = args.includes("--dry-run");
  const skipTests = args.includes("--skip-tests");
  const skipPublish = args.includes("--no-publish") || args.includes("--skip-publish");
  const noPush = args.includes("--no-push");

  // Extract description: --desc "message", -m "message", or trailing non-flag arguments
  let description = "";
  const descIdx = args.findIndex((a) => a === "--desc" || a === "-m" || a === "--description");
  if (descIdx !== -1 && args[descIdx + 1]) {
    description = args[descIdx + 1];
  } else {
    const freeArgs = args.filter(
      (a) =>
        !a.startsWith("-") &&
        !["patch", "minor", "major"].includes(a) &&
        !/^\d+\.\d+\.\d+/.test(a),
    );
    if (freeArgs.length > 0) {
      description = freeArgs.join(" ");
    }
  }

  release(releaseTypeArg, {
    description,
    dryRun,
    skipTests,
    skipPublish,
    push: !noPush,
  });
}
