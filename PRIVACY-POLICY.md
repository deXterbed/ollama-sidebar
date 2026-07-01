# Privacy Policy for Ollama Sidebar

**Effective date:** July 1, 2026

## 1. Overview

Ollama Sidebar is a browser extension that lets you chat with a local Ollama AI instance from a sidepanel. This privacy policy explains what data the extension collects and how it is used.

## 2. Data We Collect

The extension collects only the data needed to provide its core functionality:

- **Chat messages** — Messages you send and responses you receive are stored temporarily in your browser's local storage (`chrome.storage.local`) so conversations survive tab switches.
- **Active webpage content** — Only when you explicitly enable "page content" mode or press the keyboard shortcut (Ctrl+Shift+C / Cmd+Shift+C), the extension extracts the text of the currently active webpage to include it as context for the AI conversation.
- **Page metadata** — The title, URL, and favicon of the active tab are read to display context information in the sidepanel header.

## 3. How Data Is Used

- Chat messages are sent to the **local Ollama instance** you have running on your own machine (default: `http://localhost:11434`). No data is sent to any cloud service or third-party API.
- Webpage content is only extracted when you explicitly request it (by cycling the context mode or using the keyboard shortcut).
- Conversation history is stored locally in your browser and is automatically cleared when a tab is closed.

## 4. Data Retention

- Per-tab conversations are limited to approximately 50 messages and are automatically deleted when the tab is closed.
- The extension stores your selected model and Ollama host URL in `chrome.storage.local` for convenience. These settings remain until you uninstall the extension or clear browser storage.

## 5. Data Sharing

We do **not** sell, transfer, or share your data with any third parties. All AI processing happens on your local machine via your own Ollama instance.

## 6. Contact

For questions about this privacy policy, open an issue on the GitHub repository: https://github.com/deXterbed/ollama-sidebar

## 7. Changes

We may update this privacy policy from time to time. Changes will be posted to the GitHub repository.
