import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const clientDir = path.resolve("..", "client");
const files = [
  "tsconfig.json",
  "AutoUpdateClientManagerClass.ts",
  "AutoUpdatedClientObjectClass.ts",
  "CommonTypes.ts",
  "AutoUpdateManagerClass.ts",
  "client.ts",
];

for (const file of files) {
  const src = path.resolve(file);
  const dest = path.join(clientDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

if (fs.existsSync(clientDir)) {
  execSync("npm run release", { cwd: clientDir, stdio: "inherit" });
}
