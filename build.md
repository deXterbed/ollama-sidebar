# Build Pipeline

## Prerequisites

- Node.js 18+
- npm 9+

## Setup

```bash
npm install
```

## Development

Watch mode — rebuilds JS on file changes:

```bash
npm run dev
```

Load the `dist/` directory as an unpacked extension in Chrome for development.
After code changes, go to `chrome://extensions` and click the refresh button.

## Production Build

```bash
npm run build
```

Build output goes to `dist/`. JS files are minified (~60% size reduction).

## Chrome Web Store Package

```bash
npm run zip
```

Creates `ollama-sidebar.zip` from the built `dist/` directory.

## Clean

```bash
npm run clean
```

Removes the `dist/` directory.

## Project Structure

```
src/                    # Source files (edit these)
  manifest.json         # Extension manifest (MV3)
  background.js         # Service worker
  content.js            # Content script (injected into pages)
  sidepanel.html        # Side panel UI (inline CSS + markup)
  sidepanel.js          # Side panel logic
  modules/              # Sidepanel logic modules (api, content, context, markdown, storage, ui)
  icons/                # Extension icons
  styles/               # Content script CSS
dist/                   # Build output (gitignored, auto-generated)
scripts/                # Build utilities
  build.mjs             # esbuild-based build script
  zip.mjs               # Chrome Web Store packaging script
package.json            # Dependencies and scripts
```

## How the Build Works

1. **esbuild** builds all 3 JS files as IIFE bundles
   - `background.js`, `content.js`, `sidepanel.js`
   - IIFE format is used because Chrome content scripts can't use ES modules
   - Minified in production, sourcemaps in dev
   - Target: Chrome 110+
2. **HTML files** are copied from `src/` to `dist/`
   - `type="module"` attributes are stripped (esbuild outputs IIFE, not modules)
   - Inline CSS stays inline (no extraction needed)
3. **Static assets** are copied: `manifest.json`, `icons/`, `styles/`

## Adding npm Dependencies

When you add npm packages to the project, import them in your JS files
and esbuild will bundle them automatically. No extra configuration needed.