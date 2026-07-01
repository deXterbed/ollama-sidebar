import { execSync } from "child_process";
import { existsSync, rmSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const { name, version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const zipFile = resolve(root, `${name}-v${version}.zip`);

// Ensure a fresh build first
console.log("Building extension...");
execSync("npm run build", { stdio: "inherit", cwd: root });

// Remove existing zip
if (existsSync(zipFile)) {
  rmSync(zipFile);
}

// Create zip from dist/ contents
console.log("Creating zip package...");
try {
  execSync(
    `powershell -Command "Compress-Archive -Path '${resolve(root, "dist", "*")}' -DestinationPath '${zipFile}' -Force"`,
    { stdio: "inherit", cwd: root }
  );
} catch {
  try {
    execSync(`cd dist && zip -r "../${name}-v${version}.zip" . -x "*.DS_Store"`, {
      stdio: "inherit",
      cwd: root,
    });
  } catch {
    console.error(
      "Error: Could not create zip. Install zip utility or use PowerShell."
    );
    process.exit(1);
  }
}

console.log(`\nDone! Package: ${zipFile}`);
