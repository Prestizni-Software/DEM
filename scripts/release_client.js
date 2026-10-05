import path from "path";
import { releasePackage } from "./release.js";

const clientDir = path.resolve("..", "client");
const clientFiles = [
  "tsconfig.json",
  "AutoUpdateClientManagerClass.ts",
  "AutoUpdatedClientObjectClass.ts",
  "CommonTypes.ts",
  "AutoUpdateManagerClass.ts",
  "client.ts",
];

const args = process.argv.slice(2);
const releaseType = args.find((a) => ["patch", "minor", "major"].includes(a)) || "patch";
const syncOnly = args.includes("sync");
const dryRun = args.includes("--dry-run");

releasePackage(clientDir, clientFiles, "@prestizni-software/client-dem", releaseType, {
  syncOnly,
  dryRun,
});
