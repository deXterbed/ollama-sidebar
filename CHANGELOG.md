# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-06-30

### Added
- **Local Ollama Integration**: Chat with any model pulled into your local Ollama instance — no API key required
- **Dynamic Model List**: Model dropdown is populated live from `GET /api/tags`
- **Configurable Ollama Host**: Settings panel lets you point at a non-default host/port
- **Connection Error Handling**: Clear in-UI messaging when Ollama isn't running, or when `OLLAMA_ORIGINS` isn't configured to allow the extension (403)
- **Page Content Analysis**: Ask questions about the current webpage's content
- **Quick Actions**: "Summarize this page" and "Suggest questions..." one-click prompts
- **Real-time Streaming**: Responses stream in as the model generates them
- **Tab-Specific Conversations**: Each tab maintains its own conversation history
- **Per-Tab Side Panel**: The panel opens only on the tab you click it on
- **Theme Support**: Dark and light themes
