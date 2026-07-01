# Ollama Sidebar

A Chrome extension that brings your local Ollama models directly into your browser for intelligent, private web browsing assistance — no API key, no cloud, no data leaving your machine.

## ✨ Features

- **🤖 Local AI Conversations**: Chat with any model you've pulled into Ollama, directly in your browser
- **🔀 Model Selection**: Pick your model from the toolbar dropdown or in Settings — the list is populated live from your local Ollama instance
- **🌐 Web Fetch Tool Calling**: Ask about any URL and the model can fetch and read the page content (via Ollama's native tool calling or eager URL fetching for non-tool models)
- **📄 Page Content Analysis**: Ask questions about any webpage content
- **⚡ Quick Actions**: One-click buttons to summarize the page or suggest questions
- **🔄 Real-time Streaming**: See responses being generated in real-time
- **💬 Tab-Specific Conversations**: Each tab maintains its own conversation history
- **🪟 Per-Tab Side Panel**: The panel opens only on the tab you click it on and stays closed on others
- **🎯 Context-Aware**: Automatically extracts and analyzes page content
- **🎨 Theme Support**: Dark and light themes for comfortable use
- **⌨️ Keyboard Shortcuts**: Quick access with customizable shortcuts

## 🎯 How It Works

1. **Install Ollama**: Get it from [ollama.com](https://ollama.com) and pull at least one model (e.g. `ollama pull qwen2.5`)
2. **Allow the extension origin**: Set `OLLAMA_ORIGINS=chrome-extension://*` in your environment and restart Ollama (see [Requirements](#-requirements))
3. **Install the Extension**: Load it unpacked from `dist/` (see [Development](#️-development))
4. **Choose a Model**: Use the toolbar dropdown to select from your locally installed models
5. **Choose Context Mode** (click the toolbar icon to cycle):
   - **No Context** — General conversations with your selected model
   - **Content Mode** — Analyzes webpage text and prepends it to your question
6. **Ask Questions**: Get responses based on the current page, or paste any URL to ask about it
   - Tool-capable models (Qwen 2.5, Mistral, Llama 3.1+) can use the `web_fetch` tool to read pages on demand
   - Other models get URLs fetched eagerly and prepended to the prompt automatically

## 🎨 Perfect For

- **Privacy-conscious users**: Nothing leaves your machine
- **Researchers**: Analyze web content and get summaries offline
- **Students**: Get help understanding complex web pages
- **Professionals**: Quick insights from technical documentation without sending data to a third party
- **Anyone running Ollama**: A sidebar UI for the models you've already pulled

## 🔒 Privacy & Security

- **No API Key**: Nothing to enter, nothing to leak
- **No Server Data**: All requests go to your local Ollama instance — nothing is sent anywhere else
- **Tab-Specific**: Conversations are stored per tab and cleared when tabs are closed
- **Fully Local**: Works without an internet connection once models are pulled

## 📋 Requirements

- **[Ollama](https://ollama.com) installed and running** (`ollama serve`), with at least one model pulled
- **`OLLAMA_ORIGINS` configured** to allow the extension to connect:
  ```bash
  # macOS/Linux
  OLLAMA_ORIGINS=chrome-extension://* ollama serve

  # Windows (PowerShell), then restart Ollama
  [System.Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "chrome-extension://*", "User")
  ```
- **Chrome browser**

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| **Ctrl+Shift+C** (Mac: **Cmd+Shift+C**) | Extract page content and send to the model |

## 🛠️ Development

### Prerequisites

- Node.js 18+
- Chrome browser
- Ollama running locally

### Setup

```bash
git clone https://github.com/deXterbed/ollama-sidebar.git
cd ollama-sidebar
npm install
```

### Build Commands

| Command | Description |
|---|---|
| `npm run dev` | Watch mode — rebuilds on file changes |
| `npm run build` | Production build → `dist/` |
| `npm run zip` | Package `dist/` for Chrome Web Store |
| `npm run clean` | Delete the `dist/` directory |

### Architecture

The extension has three main parts:
- **Sidepanel** (`sidepanel.js`) — the chat UI you interact with
- **Background worker** (`background.js`) — relays messages, opens the side panel per tab
- **Content script** (`content.js`) — injected into web pages to extract text content

Messages flow: `Sidepanel ↔ Background ↔ Content Script ↔ Web Page`

### Web Fetch Tool Calling

For models that support Ollama's native tool calling (Qwen 2.5, Mistral, Llama 3.1+):

1. User sends a message containing a URL
2. Extension sends a non-streaming `tools` request to the model
3. Model may call the `web_fetch` tool with the URL
4. Extension fetches the page, parses HTML, extracts clean text, and feeds it back as a `tool` message
5. Extension streams the final response with the fetched content included

For models that don't support tool calling, URLs are detected eagerly via regex and fetched before the streaming request begins.

### Loading in Chrome

1. Go to `chrome://extensions/` and enable Developer mode
2. Click "Load unpacked" and select the `dist/` folder
3. After code changes, click the refresh button on the extension card

### Adding Dependencies

Import npm packages normally in JS files. The esbuild bundler includes them automatically.

## 🚀 Releasing

Releases are automated via GitHub Actions. Go to **Actions → Release → Run workflow**, choose a bump type, and the workflow handles the rest.

| Bump | Behavior |
|---|---|
| `patch / minor / major` | Bumps version in `package.json` + `src/manifest.json`, commits, tags, builds, and publishes a GitHub Release |
| `none` | Skips the version bump — tags and releases the current version as-is |

If the tag already exists on the remote, it is deleted and recreated (re-release in place).

Download the zip from the [Releases](../../releases) page and upload it to the Chrome Web Store manually.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support, feature requests, or bug reports, open an issue on GitHub.

---

**Note**: This extension requires [Ollama](https://ollama.com) running locally to function. It does not work with any cloud AI provider.
