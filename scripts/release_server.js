import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const serverDir = path.resolve("..", "server");
const files = [
  "tsconfig.json",
  "AutoUpdatedClientObjectClass.ts",
  "AutoUpdateManagerClass.ts",
  "server.ts",
  "CommonTypes.ts",
  "CommonTypes_server.ts",
  "AutoUpdateServerManagerClass.ts",
  "AutoUpdatedServerObjectClass.ts",
];

for (const file of files) {
  const src = path.resolve(file);
  const dest = path.join(serverDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

if (fs.existsSync(serverDir)) {
  execSync("npm run release", { cwd: serverDir, stdio: "inherit" });
}
