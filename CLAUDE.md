# Ollama Sidebar — Chrome Extension

A Chrome extension that brings local Ollama models into the browser sidepanel for intelligent web browsing assistance — no API key, no cloud.

## Architecture Overview

```
src/                        # Source files
  manifest.json             # Manifest V3
  background.js             # Service worker (persists no state)
  content.js                # Content script injected into web pages
  sidepanel.html            # Side panel UI shell
  sidepanel.js              # Side panel logic (entry point)
  modules/
    api.js                  # Ollama API client (/api/chat, /api/tags), NDJSON streaming
    content.js              # Page content extraction helpers
    context.js              # Context mode cycling ("none" / "content")
    markdown.js             # Markdown → HTML renderer (with KaTeX math)
    storage.js              # chrome.storage.local persistence per tab
    ui.js                   # Loading/typing indicator helpers
  styles/                   # CSS files
    main.css
    conversation.css
    sidepanel.css
    icon.css
    katex.min.css
  icons/
    icon.svg                # Source icon
    icon-16/32/48/128.png   # Generated extension icons
    chrome.png              # Toolbar context-toggle icon
dist/                       # Build output (gitignored)
scripts/                    # Build utilities
  build.mjs                 # esbuild-based build script
  zip.mjs                   # Chrome Web Store packaging
```

## Key Architecture Details

### Message Flow

```
Sidepanel (sidepanel.js) ←→ Background (background.js) ←→ Content Script (content.js) ←→ Web Page
```

- **Sidepanel** is the main UI — sends messages, renders responses, manages conversation history
- **Background service worker** is stateless — relays messages, opens the side panel per tab
- **Content script** is injected into `<all_urls>` — extracts page text content on demand

### Per-Tab Side Panel

The side panel is opened **per tab**, not globally. Key constraints (learned the hard way):

- **No `side_panel` key in `manifest.json`.** A `side_panel.default_path` registers the panel *globally*, so it appears on every tab — `onActivated`/`enabled:false` toggling cannot reliably override it. Omit the manifest key entirely.
- The panel path is set only per tab in `background.js` on `chrome.action.onClicked`: `setOptions({ tabId, path: "sidepanel.html", enabled: true })` then `open({ tabId })`. With no global default, tabs you never opened it on simply show no panel, and Chrome remembers the per-tab enabled state so it reappears when you return.
- **`setOptions()` and `open()` must run synchronously** in the click handler — no `await` before `open()`, or Chrome rejects it with "`sidePanel.open()` may only be called in response to a user gesture." Use `.catch()` for error handling, not `try/await`.

### Context Modes

The sidepanel has 2 context modes, cycled by clicking the context button:

| Mode | Behavior |
|---|---|
| `none` | No page context sent |
| `content` | Extracts page text content and prepends to messages |

The model is user-selectable in Settings, populated dynamically from `GET /api/tags` on the configured Ollama host. The selection is persisted to `chrome.storage.local` (`selectedModel`).

### Ollama API

- Host: user-configurable, default `http://localhost:11434`, persisted to `chrome.storage.local` (`ollamaHost`)
- Endpoints: `POST /api/chat` for chat completions, `GET /api/tags` for the local model list
- Streaming: Ollama streams newline-delimited JSON objects (`{"message":{"content":"..."},"done":false}`), not SSE — parsed line by line in `readStream()` in `api.js`
- No authentication — Ollama has no API key concept
- **Tool calling**: Supported via the native `tools` array on `/api/chat`. Some models (Qwen 2.5, Mistral, Llama 3.1+) support it, others don't. The extension uses a two-step approach: non-streaming request with tools to detect tool calls, execute them, then streaming request with results.
- **Tool call arguments format**: `tool_calls[].function.arguments` may be a pre-parsed JSON object *or* a JSON string depending on the model and Ollama version. Always check `typeof args === "string"` before parsing.
- **Fallback for non-tool models**: When a model doesn't return `tool_calls`, the extension falls back to eagerly extracting URLs from the message, fetching them via `fetchUrlContent`, and prepending the content to the prompt.
- **CORS gotcha**: Ollama validates the `Origin` header against an allowlist. `chrome-extension://<id>` isn't allowed by default, so requests fail with `403 Forbidden` unless the user sets `OLLAMA_ORIGINS=chrome-extension://*` (or the specific extension ID) and restarts Ollama. `api.js` detects this and surfaces a clear in-UI message rather than a generic failure.
- **Connection-refused gotcha**: if Ollama isn't running, `fetch()` throws a `TypeError`, not an HTTP error — `describeFetchError()` in `api.js` catches this specifically and tells the user to run `ollama serve`.

### Conversation Storage

- Keyed by tab ID: `conversationHistory_{tabId}`
- Max ~50 messages per tab, ~20 tabs stored
- Cleaned up when tabs are closed

### Content Extraction (content.js)

1. Clones `document.body`
2. Removes script/style/nav/header/footer/sidebar elements
3. Tries to find main content area via selectors (`main`, `article`, `[role="main"]`, `.content`, etc.)
4. Strips HTML tags, trims whitespace, truncates to 8000 chars
5. Prepends page title + URL metadata

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+Shift+C / Cmd+Shift+C | Extract page content and send to the model |

## Development

### Build pipeline (esbuild)

```bash
npm install
npm run dev      # Watch mode
npm run build    # Production build → dist/
npm run zip      # Package for Chrome Web Store
npm run clean    # Remove dist/
```

- esbuild bundles all 3 JS files as **IIFE** (Chrome content scripts can't use ES modules)
- Minified in production, sourcemaps in dev
- Target: Chrome 110+
- KaTeX is bundled into sidepanel.js via esbuild

**Always run `npm run build` after making changes** — Chrome loads from `dist/`, not `src/`, so source edits don't take effect until rebuilt. This also surfaces syntax/bundling errors.

### Loading in Chrome

1. Go to `chrome://extensions/`, enable Developer mode
2. "Load unpacked" → select `dist/`

### Adding dependencies

Import npm packages normally in JS files; esbuild bundles them automatically.

### Releasing

Releases are fully automated via `.github/workflows/release.yml`. Go to GitHub → Actions → Release → Run workflow → pick `patch/minor/major`. The action bumps `package.json` and `src/manifest.json` in sync, commits, tags, builds, and attaches the zip to a GitHub Release automatically. No local steps needed.

`scripts/zip.mjs` names the output file using the version from `package.json` (e.g. `ollama-sidebar-v0.1.0.zip`). Version lives in **two** files that must be kept in sync: `package.json` and `src/manifest.json` — the release action handles this automatically.

## Commands

| Script | Description |
|---|---|
| `npm run dev` | Watch mode rebuild |
| `npm run build` | Production build |
| `npm run zip` | Package dist/ for Chrome Web Store |
| `npm run clean` | Delete dist/ |

## Key Dependencies

- **esbuild** (devDependency) — bundler
- **katex** — LaTeX math rendering in chat responses

## Important Constraints

- Content scripts can't use ES modules → all JS bundles are IIFE
- `type="module"` stripped from HTML during build
- `host_permissions` uses `<all_urls>` for content script injection and to allow fetches to whatever Ollama host the user configures (the host is user-editable, so it can't be pinned to a fixed origin in the manifest)
- Content script uses a `window.__ollamaSidebarContentScriptLoaded` guard to prevent duplicate listener registration when injected programmatically
- `modules/api.js` has no `chrome.*` dependencies — it's plain `fetch`-based and can be smoke-tested directly in Node against a running Ollama instance

## CSS / Rendering Gotchas

- `src/styles/sidepanel.css` styles `message-content table { display: block; overflow-x: auto; }`. Table cells used `white-space: nowrap`, which causes inline code snippets to get truncated/clipped in the narrow side panel. Use `white-space: normal` + `word-wrap: break-word` for table `th`/`td` so code and text wrap properly.
- The toolbar model dropdown (`#model-select-toolbar`) is a real `<select>` styled to look like a pill badge. To make it look clickable, it needs `background-color`, `border`, and a custom SVG arrow via `background-image`. The default browser `<select>` styling on a dark background makes the arrow invisible without a custom image.

## Chrome Web Store Submission

- **Reviewers flag unused permissions.** Before submitting, verify every permission declared in `manifest.json` is actually referenced in the code. We once shipped `"windows"` in `permissions` but never used `chrome.windows.*` anywhere — this would be rejected. Use `grep` to double-check: `grep -r "chrome\.windows" src/`.
- **Remote code:** The extension does not use remote code (no `eval`, `new Function`, dynamic `<script>` tags, or external module loading). Select **No** on the Web Store form. `fetch()` calls are only to the user-configured local Ollama API and to URLs the user explicitly asks about via the built-in `web_fetch` tool.
- **Host permission justification:** `<all_urls>` is needed because (1) the content script is injected into any page the user browses, and (2) the Ollama host URL is user-configurable and unknown at build time.

## Build Gotchas

- `node_modules` may be missing in a fresh checkout. If `npm run build` fails with `Could not resolve "katex"`, run `npm install` first.
