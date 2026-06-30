import { build, context } from "esbuild";
import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const distDir = resolve(root, "dist");
const srcDir = resolve(root, "src");

const isWatch = process.argv.includes("--watch");
const isProd = !isWatch;

// ── Clean ──────────────────────────────────────────────────────────
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}
mkdirSync(distDir, { recursive: true });

// ── esbuild config ──────────────────────────────────────────────────
// All extension scripts are built as IIFE — Chrome content scripts
// can't use ES modules, and IIFE is the safest format for all contexts.
const esbuildConfig = {
  entryPoints: [
    resolve(srcDir, "background.js"),
    resolve(srcDir, "content.js"),
    resolve(srcDir, "sidepanel.js"),
  ],
  bundle: true,
  outdir: distDir,
  format: "iife",
  minify: isProd,
  sourcemap: !isProd,
  target: "chrome110",
  logLevel: "info",
};

if (isWatch) {
  // ── Watch mode ────────────────────────────────────────────────────
  const ctx = await context(esbuildConfig);
  await ctx.watch();
  console.log("⚡ Watching for changes... (Ctrl+C to stop)");

  // Keep process alive
  process.on("SIGINT", async () => {
    await ctx.dispose();
    process.exit(0);
  });
} else {
  // ── One-shot build ────────────────────────────────────────────────
  await build(esbuildConfig);
}

// ── Copy HTML files ─────────────────────────────────────────────────
// Remove type="module" from script tags — esbuild outputs IIFE, not modules.
for (const htmlFile of ["sidepanel.html"]) {
  const src = resolve(srcDir, htmlFile);
  const dest = resolve(distDir, htmlFile);
  if (existsSync(src)) {
    let content = readFileSync(src, "utf-8");
    content = content.replace(/\btype="module"\s+/g, "");
    writeFileSync(dest, content);
  }
}

// ── Copy static assets ─────────────────────────────────────────────
cpSync(resolve(srcDir, "manifest.json"), resolve(distDir, "manifest.json"));

const iconsDir = resolve(srcDir, "icons");
if (existsSync(iconsDir)) {
  mkdirSync(resolve(distDir, "icons"), { recursive: true });
  cpSync(iconsDir, resolve(distDir, "icons"), { recursive: true });
}

const stylesDir = resolve(srcDir, "styles");
if (existsSync(stylesDir)) {
  mkdirSync(resolve(distDir, "styles"), { recursive: true });
  cpSync(stylesDir, resolve(distDir, "styles"), { recursive: true });
}

// ── Copy KaTeX CSS ──────────────────────────────────────────────────
const katexCssSrc = resolve(root, "node_modules/katex/dist/katex.min.css");
if (existsSync(katexCssSrc)) {
  const katexCssDest = resolve(distDir, "styles/katex.min.css");
  cpSync(katexCssSrc, katexCssDest);
}

console.log(`\n✅ Built to dist/ (${isProd ? "production" : "development"})`);
