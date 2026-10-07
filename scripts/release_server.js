import path from "path";
import { releasePackage, serverFiles } from "./release.js";

const serverDir = path.resolve("..", "server");

const args = process.argv.slice(2);
const releaseType = args.find((a) => ["patch", "minor", "major"].includes(a)) || "patch";
const syncOnly = args.includes("sync");
const dryRun = args.includes("--dry-run");

releasePackage(serverDir, serverFiles, "@prestizni-software/server-dem", releaseType, {
  syncOnly,
  dryRun,
});
