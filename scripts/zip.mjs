import { execSync } from "child_process";
import { existsSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const zipFile = resolve(root, "grok-everywhere.zip");

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
  // Use PowerShell on Windows for reliable zip creation
  execSync(
    `powershell -Command "Compress-Archive -Path '${resolve(root, "dist", "*")}' -DestinationPath '${zipFile}' -Force"`,
    { stdio: "inherit", cwd: root }
  );
} catch {
  // Fallback: try zip command (Git Bash / WSL)
  try {
    execSync(`cd dist && zip -r ../grok-everywhere.zip . -x "*.DS_Store"`, {
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
