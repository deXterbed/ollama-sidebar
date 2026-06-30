import { parseMarkdown } from "./modules/markdown.js";
import {
  extractPageContent,
  checkContentScriptAvailability,
  fetchUrlContent,
  extractUrls,
} from "./modules/content.js";
import { createStorage } from "./modules/storage.js";
import {
  fetchStreamingReply,
  fetchModels,
  fetchToolCalls,
} from "./modules/api.js";
import {
  showLoading,
  hideLoading,
  showContextLoading,
  hideContextLoading,
  showTypingIndicator,
  hideTypingIndicator,
} from "./modules/ui.js";
import { createContext } from "./modules/context.js";

const DEFAULT_OLLAMA_HOST = "http://localhost:11434";

const WEB_FETCH_TOOL = {
  type: "function",
  function: {
    name: "web_fetch",
    description:
      "Fetch and extract text content from a webpage. Use this when the user asks about a specific URL, link, or webpage that you don't already have context for. The extracted text will be provided back to you so you can answer questions about it.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full URL to fetch, including https://",
        },
      },
      required: ["url"],
    },
  },
};

document.addEventListener("DOMContentLoaded", async () => {
  const messageInput = document.getElementById("message-input");
  const chatContainer = document.getElementById("chat-container");
  // Header is always visible; set consistent top offset
  chatContainer.style.marginTop = "50px";
  const imageButton = document.querySelector(".image-button");
  const clearHistoryButton = document.getElementById("clear-history-button");
  const quickActionsEl = document.getElementById("quick-actions");
  let ollamaHost = DEFAULT_OLLAMA_HOST;
  let ollamaConnected = false;
  let currentContent = null;
  let contextMode = "content"; // 'none', 'content'
  let isShortcutMode = false;

  let isUserAtBottom = true; // Track if user is at bottom of chat
  let userScrolledUp = false; // Track if user manually scrolled up

  // ── Model definitions ──────────────────────────────────────────────
  // Populated dynamically from the local Ollama instance via /api/tags
  let MODELS = [];
  let selectedModel = "";

  const modelSelectEl = document.getElementById("model-select");
  const modelSelectToolbarEl = document.getElementById("model-select-toolbar");

  function populateModelSelect(selectEl, models, currentId) {
    selectEl.innerHTML = "";
    models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      if (m.id === currentId) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  function populateAllModelSelects(models, currentId) {
    populateModelSelect(modelSelectEl, models, currentId);
    populateModelSelect(modelSelectToolbarEl, models, currentId);
  }

  function getModelLabel() {
    const m = MODELS.find((m) => m.id === selectedModel);
    return m ? m.label : selectedModel || "Assistant";
  }

  // Function to check if user is at the bottom of the chat
  function isAtBottom() {
    const threshold = 50; // pixels from bottom to consider "at bottom"
    return (
      chatContainer.scrollTop + chatContainer.clientHeight >=
      chatContainer.scrollHeight - threshold
    );
  }

  // Function to scroll to bottom only if user is at bottom
  function scrollToBottomIfNeeded() {
    if (isUserAtBottom && !userScrolledUp) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  // Function to force scroll to bottom (for new messages)
  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
    isUserAtBottom = true;
    userScrolledUp = false;
  }

  // Auto-resize textarea to match content, like standard chat UIs
  function autoResizeTextarea() {
    messageInput.style.height = "0";
    const scrollH = messageInput.scrollHeight;
    const newHeight = Math.min(scrollH, 160);
    messageInput.style.height = newHeight + "px";
    messageInput.style.overflowY = scrollH > 160 ? "auto" : "hidden";
  }

  // Show clear-history only when connected and there's conversation history
  function updateClearHistoryVisibility() {
    if (ollamaConnected && chatContainer.querySelector(".message-wrapper")) {
      clearHistoryButton.style.display = "flex";
    } else {
      clearHistoryButton.style.display = "none";
    }
  }

  // Restore quick actions after clearing the chat container
  function restoreEmptyState() {
    if (quickActionsEl && !chatContainer.querySelector("#quick-actions")) {
      chatContainer.appendChild(quickActionsEl);
    }
  }

  // Switch header to page-context view and update with current tab info
  function showPageContext() {
    const ollamaStatusSection = document.getElementById(
      "ollama-status-section",
    );
    const pageContext = document.getElementById("page-context");
    if (ollamaStatusSection) ollamaStatusSection.style.display = "none";
    if (pageContext) pageContext.style.display = "flex";
    document.getElementById("chat-container").style.marginTop = "50px";
    updatePageContext();
  }

  // Switch header to Ollama connection status view
  function showOllamaStatusSection(message) {
    const ollamaStatusSection = document.getElementById(
      "ollama-status-section",
    );
    const pageContext = document.getElementById("page-context");
    const statusMessage = document.getElementById("ollama-status-message");
    if (statusMessage) statusMessage.textContent = message;
    if (ollamaStatusSection) ollamaStatusSection.style.display = "flex";
    if (pageContext) pageContext.style.display = "none";
    document.getElementById("chat-container").style.marginTop = "50px";
  }

  // Fetch and display current tab title + URL in the header
  async function updatePageContext() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab) return;
      const titleEl = document.getElementById("page-title-text");
      const urlEl = document.getElementById("page-url-text");
      const faviconEl = document.getElementById("page-favicon");
      if (titleEl) titleEl.textContent = tab.title || "Untitled page";
      if (urlEl) {
        try {
          const u = new URL(tab.url);
          urlEl.textContent = u.hostname + u.pathname;
        } catch {
          urlEl.textContent = tab.url || "";
        }
      }
      if (faviconEl && tab.favIconUrl) {
        faviconEl.src = tab.favIconUrl;
        faviconEl.onerror = () => {
          faviconEl.src = "icons/chrome.png";
        };
      }
    } catch (e) {
      // ignore
    }
  }

  // Add scroll event listener to track user scroll position
  chatContainer.addEventListener("scroll", () => {
    const wasAtBottom = isUserAtBottom;
    isUserAtBottom = isAtBottom();

    // If user scrolled up from bottom, mark as user-initiated scroll
    if (wasAtBottom && !isUserAtBottom) {
      userScrolledUp = true;
    }

    // If user scrolled back to bottom, reset the flag
    if (isUserAtBottom) {
      userScrolledUp = false;
    }
  });

  // Attempt to connect to Ollama, fetch the model list, and update the UI accordingly
  async function connectToOllama() {
    showOllamaStatusSection("Connecting to Ollama...");
    try {
      MODELS = await fetchModels(ollamaHost);
      ollamaConnected = true;
      if (MODELS.length === 0) {
        showOllamaStatusSection(
          "Connected to Ollama, but no models are installed. Run `ollama pull <model>` to get started.",
        );
        messageInput.disabled = true;
        return;
      }
      if (!selectedModel || !MODELS.some((m) => m.id === selectedModel)) {
        selectedModel = MODELS[0].id;
        await chrome.storage.local.set({ selectedModel });
      }
      populateAllModelSelects(MODELS, selectedModel);
      messageInput.disabled = false;
      showPageContext();
      updateClearHistoryVisibility();
      updateContextModeUI();
    } catch (error) {
      ollamaConnected = false;
      messageInput.disabled = true;
      showOllamaStatusSection(error.message);
    }
  }

  // Load theme and settings
  const result = await chrome.storage.local.get([
    "theme",
    "ollamaHost",
    "selectedModel",
  ]);
  const savedTheme = result.theme || "dark";
  document.documentElement.dataset.theme = savedTheme;
  if (result.ollamaHost) ollamaHost = result.ollamaHost;
  if (result.selectedModel) selectedModel = result.selectedModel;

  document
    .getElementById("ollama-retry-button")
    .addEventListener("click", connectToOllama);

  // Create context mode management (needs to be before updateContextModeUI call)
  const { updateContextModeUI, cycleContextMode, clearShortcutMode } =
    createContext({
      imageButton,
      messageInput,
      getContextMode: () => contextMode,
      setContextMode: (val) => {
        contextMode = val;
      },
      clearShortcutState: () => {
        isShortcutMode = false;
        currentContent = null;
      },
      getModelLabel,
    });

  await connectToOllama();

  // Set initial context mode and update UI
  updateContextModeUI();

  // No port connections needed - extension works independently

  // Initialize current tab ID and load conversation
  async function initializeCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab) {
        await switchToTab(tab.id);
      }
    } catch (error) {
      console.error("Error initializing current tab:", error);
    }
  }

  // Switch to a specific tab and load its conversation
  async function switchToTab(tabId) {
    try {
      // Only switch if it's actually a different tab
      if (currentTabId === tabId) {
        return;
      }

      // Save current conversation before switching
      if (currentTabId && conversationHistory.length > 0) {
        await saveConversationHistory();
      }

      // Update current tab ID
      currentTabId = tabId;

      // Load conversation for the new tab
      const result = await chrome.storage.local.get([
        `conversationHistory_${tabId}`,
      ]);

      // Clear current conversation display
      chatContainer.innerHTML = "";
      restoreEmptyState();
      conversationHistory = [];
      // Reset scroll position when switching tabs
      isUserAtBottom = true;
      userScrolledUp = false;

      if (result[`conversationHistory_${tabId}`]) {
        conversationHistory = limitMessageHistory(
          result[`conversationHistory_${tabId}`],
        );
        // Restore the conversation UI
        conversationHistory.forEach((msg) => {
          addMessage(msg.content, msg.isUser, msg.model);
        });
      }
      updateClearHistoryVisibility();
      if (ollamaConnected) updatePageContext();

      // Clear any existing context when switching tabs
      currentContent = null;
      isShortcutMode = false;

      // Tab switching completed

      console.log(
        `Switched to tab ${tabId}, loaded ${conversationHistory.length} messages`,
      );
    } catch (error) {
      // Handle cases where tab doesn't exist or other errors
      if (error.message && error.message.includes("No tab with id")) {
        console.log(
          `Tab ${tabId} no longer exists, resetting to current active tab`,
        );
        // Reset to the currently active tab
        try {
          const [activeTab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (activeTab && activeTab.id !== currentTabId) {
            await switchToTab(activeTab.id);
          }
        } catch (resetError) {
          console.error("Error resetting to active tab:", resetError);
        }
      } else {
        console.error("Error switching to tab:", error);
      }
    }
  }

  // Tab indicator functionality removed - no visual tab names shown

  // Check current tab periodically and switch if needed
  async function checkCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (tab && tab.id !== currentTabId) {
        await switchToTab(tab.id);
      }
    } catch (error) {
      console.error("Error checking current tab:", error);
    }
  }

  // Initialize on load
  initializeCurrentTab();

  // Check for tab changes every 2 seconds
  setInterval(checkCurrentTab, 2000);

  // Also check when the sidepanel window gains focus (more responsive)
  window.addEventListener("focus", checkCurrentTab);
  window.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      checkCurrentTab();
    }
  });

  // Keep track of conversation history per tab
  let conversationHistory = [];
  let currentTabId = null;

  // Configuration for chat history management
  const MAX_MESSAGES_PER_TAB = 50;
  const MAX_TABS_TO_STORE = 20;

  const {
    cleanupOldConversations,
    limitMessageHistory,
    saveConversationHistory,
  } = createStorage({
    currentTabId: () => currentTabId,
    conversationHistory: () => conversationHistory,
    MAX_MESSAGES_PER_TAB,
    MAX_TABS_TO_STORE,
  });

  function clearConversation() {
    conversationHistory = [];
    if (currentTabId) {
      chrome.storage.local.remove([`conversationHistory_${currentTabId}`]);
    }
    chatContainer.innerHTML = "";
    restoreEmptyState();
    messageInput.value = "";
    autoResizeTextarea();
    messageInput.focus();
    isUserAtBottom = true;
    userScrolledUp = false;
    updateClearHistoryVisibility();
  }

  // Image button toggle functionality - cycles through context modes
  imageButton.addEventListener("click", () => {
    cycleContextMode();
  });

  // Function to handle message sending
  async function handleMessageSend() {
    if (!messageInput.value.trim() || !ollamaConnected) {
      return;
    }

    const message = messageInput.value.trim();
    messageInput.value = "";
    autoResizeTextarea();

    let contentToSend = null;
    let wasShortcutMode = isShortcutMode;

    try {
      // Show initial loading state
      showLoading("Preparing message...");

      if (contextMode === "content") {
        if (isShortcutMode && currentContent) {
          // Shortcut mode: use existing content once
          contentToSend = currentContent;
          clearShortcutMode();
        } else {
          // Auto mode: extract new content
          showContextLoading("Checking page accessibility...");

          // First check if content script is available
          const availability = await checkContentScriptAvailability();
          if (!availability.available) {
            hideLoading();
            hideTypingIndicator(getModelLabel());
            addMessage(
              `[!] Content extraction not available: ${availability.reason}.`,
              false,
            );
            return;
          }

          showContextLoading("Extracting page content...");
          contentToSend = await extractPageContent();

          // Fallback: if content extraction failed, try again
          if (!contentToSend || contentToSend.length < 50) {
            showContextLoading("Retrying content extraction...");
            contentToSend = await extractPageContent();
          }

          // If content extraction still failed, show error to user
          if (!contentToSend || contentToSend.length < 50) {
            hideLoading();
            hideTypingIndicator(getModelLabel());
            addMessage(
              "⚠ Content extraction failed. The page might be protected, not fully loaded, or the content script isn't available. Try refreshing the page or using a different context mode.",
              false,
            );
            return;
          }
        }
      } else {
        // No context mode - no content
      }

      // Hide loading and show typing indicator
      hideLoading();
      showTypingIndicator(getModelLabel());

      await sendMessage(message, contentToSend);
    } catch (error) {
      // If sending fails and we were in shortcut mode, restore the context
      if (wasShortcutMode && contentToSend) {
        currentContent = contentToSend;
        isShortcutMode = true;
      }
      hideLoading();
      hideTypingIndicator(getModelLabel());
      throw error;
    }
  }

  // Handle Enter key press
  messageInput.addEventListener("keypress", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await handleMessageSend();
    }
  });

  // Auto-resize textarea as user types
  messageInput.addEventListener("input", autoResizeTextarea);

  // Handle send button click
  const sendButton = document.querySelector(".send-button");
  sendButton.addEventListener("click", handleMessageSend);

  // Quick action buttons
  document.querySelectorAll(".quick-action-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const prompt = btn.dataset.prompt;
      if (!prompt || !ollamaConnected) return;
      if (contextMode === "none") {
        contextMode = "content";
        updateContextModeUI();
      }
      messageInput.value = prompt;
      await handleMessageSend();
    });
  });

  // Settings panel
  const settingsView = document.getElementById("settings-view");
  const settingsHostInput = document.getElementById("settings-host-input");
  const settingsHostSave = document.getElementById("settings-host-save");

  function openSettings() {
    settingsHostInput.value = ollamaHost;
    settingsHostSave.textContent = "Save";
    settingsHostSave.classList.remove("saved");
    // Sync select value to current state before opening
    if (selectedModel) modelSelectEl.value = selectedModel;
    updateThemeButtons();
    settingsView.style.display = "flex";
    chatContainer.style.display = "none";
    if (inputContainer) inputContainer.style.display = "none";
  }

  function closeSettings() {
    settingsView.style.display = "none";
    chatContainer.style.display = "block";
    if (inputContainer) inputContainer.style.display = "flex";
  }

  function updateThemeButtons() {
    const current = document.documentElement.dataset.theme || "dark";
    document.querySelectorAll(".theme-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.theme === current);
    });
  }

  const settingsButton = document.getElementById("settings-button");
  const inputContainer = document.getElementById("input-container");
  if (settingsButton) {
    settingsButton.addEventListener("click", openSettings);
  }

  document
    .getElementById("settings-close")
    .addEventListener("click", closeSettings);

  settingsHostSave.addEventListener("click", async () => {
    const newHost = settingsHostInput.value.trim().replace(/\/+$/, "");
    if (!newHost) return;
    ollamaHost = newHost;
    await chrome.storage.local.set({ ollamaHost });
    settingsHostSave.textContent = "Saved";
    settingsHostSave.classList.add("saved");
    setTimeout(() => {
      settingsHostSave.textContent = "Save";
      settingsHostSave.classList.remove("saved");
    }, 2000);
    await connectToOllama();
  });

  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const theme = btn.dataset.theme;
      document.documentElement.dataset.theme = theme;
      await chrome.storage.local.set({ theme });
      updateThemeButtons();
    });
  });

  // Model selection change handler (settings)
  modelSelectEl.addEventListener("change", async () => {
    selectedModel = modelSelectEl.value;
    modelSelectToolbarEl.value = selectedModel;
    await chrome.storage.local.set({ selectedModel });
    updateContextModeUI();
  });

  // Model selection change handler (toolbar)
  modelSelectToolbarEl.addEventListener("change", async () => {
    selectedModel = modelSelectToolbarEl.value;
    modelSelectEl.value = selectedModel;
    await chrome.storage.local.set({ selectedModel });
    updateContextModeUI();
  });

  // Handle clear history button click
  const confirmDialog = document.getElementById("confirm-dialog");
  const confirmCancel = document.getElementById("confirm-cancel");
  const confirmClear = document.getElementById("confirm-clear");

  clearHistoryButton.addEventListener("click", () => {
    confirmDialog.style.display = "block";
  });

  confirmCancel.addEventListener("click", () => {
    confirmDialog.style.display = "none";
  });

  confirmClear.addEventListener("click", () => {
    confirmDialog.style.display = "none";
    clearConversation();
  });

  // Listen for context messages (from shortcut)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "addContentContext") {
      if (contextMode === "content") {
        showContextLoading("Processing page content...");
        clearShortcutMode();
        currentContent = request.content;
        isShortcutMode = true;
        setTimeout(() => {
          hideContextLoading();
        }, 1000);
      }
      messageInput.focus();
    }
  });

  async function sendMessage(message, content) {
    const model = selectedModel;

    // Add message to UI first
    addMessage(message, true, model);

    // Add to conversation history
    conversationHistory.push({
      content: message,
      isUser: true,
      model: model,
    });

    // Limit message history
    conversationHistory = limitMessageHistory(conversationHistory);

    // Save conversation for current tab
    if (currentTabId) {
      await saveConversationHistory();
      // Clean up old conversations periodically
      cleanupOldConversations();
    }

    try {
      // Create a placeholder message for the streaming response
      const streamingMessageId = Date.now().toString();
      const streamingMessageElement = addStreamingMessage(streamingMessageId);

      let messages = null;

      // Step 1: Check if model wants to call tools (non-streaming)
      try {
        const toolResult = await fetchToolCalls({
          message,
          content,
          model,
          ollamaHost,
          conversationHistory,
          tools: [WEB_FETCH_TOOL],
        });

        if (toolResult) {
          // Execute tool calls
          messages = toolResult.messages;
          messages.push(toolResult.assistantMessage);

          for (const toolCall of toolResult.toolCalls) {
            if (toolCall.function?.name === "web_fetch") {
              let args = toolCall.function.arguments;
              if (typeof args === "string") {
                try {
                  args = JSON.parse(args);
                } catch {
                  args = {};
                }
              }
              showContextLoading(`Fetching ${args.url}...`);
              const result = await fetchUrlContent(args.url || "");
              hideContextLoading();
              messages.push({
                role: "tool",
                content:
                  result.content ||
                  `Error: ${result.error || "Failed to fetch page"}`,
                name: toolCall.function.name,
              });
            }
          }
        }
      } catch (toolError) {
        // Tool calling not supported by model or failed — fall back to normal streaming
        console.warn("Tool call failed, falling back:", toolError);
      }

      // Fallback: if model didn't use tools, eagerly fetch URLs ourselves
      if (!messages) {
        const urls = extractUrls(message);
        if (urls.length > 0) {
          const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          const currentTabUrl = tab?.url || "";
          const externalUrls = urls.filter((u) => u !== currentTabUrl);
          if (externalUrls.length > 0) {
            showContextLoading(
              `Fetching ${externalUrls.length} linked page(s)...`,
            );
            const results = await Promise.allSettled(
              externalUrls.map((u) => fetchUrlContent(u)),
            );
            for (const result of results) {
              if (result.status === "fulfilled" && result.value.content) {
                content = content
                  ? content +
                    `\n\n--- Content from ${result.value.url} ---\n\n${result.value.content}`
                  : `--- Content from ${result.value.url} ---\n\n${result.value.content}`;
              } else if (result.status === "rejected") {
                console.error("Failed to fetch URL:", result.reason);
              }
            }
            hideContextLoading();
          }
        }
      }

      // Step 2: Stream the final response (with tool results if any)
      const reply = await fetchStreamingReply({
        streamingMessageId,
        model,
        ollamaHost,
        onStream: updateStreamingContent,
        messages,
        message,
        content,
        conversationHistory,
      });

      // Hide typing indicator
      hideTypingIndicator(getModelLabel());

      // Add reply to conversation history
      conversationHistory.push({
        content: reply,
        isUser: false,
        model: model,
      });

      // Limit message history
      conversationHistory = limitMessageHistory(conversationHistory);

      // Save conversation for current tab
      if (currentTabId) {
        await saveConversationHistory();
        // Clean up old conversations periodically
        cleanupOldConversations();
      }

      // Update the streaming message with final content
      updateStreamingMessage(streamingMessageId, reply, model);
    } catch (error) {
      // Hide typing indicator on error
      hideTypingIndicator(getModelLabel());
      throw error;
    }
  }

  function addStreamingMessage(messageId) {
    const wrapperDiv = document.createElement("div");
    wrapperDiv.className = "message-wrapper";
    wrapperDiv.id = `streaming-${messageId}`;

    const messageDiv = document.createElement("div");
    messageDiv.className = "message";

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    // Create text content with cursor
    const textSpan = document.createElement("span");
    textSpan.textContent = "";
    contentDiv.appendChild(textSpan);

    // Add streaming cursor
    const cursor = document.createElement("span");
    cursor.className = "streaming-cursor";
    cursor.textContent = "|";
    cursor.style.cssText = `
      animation: blink 1s infinite;
      color: var(--text-primary);
    `;
    contentDiv.appendChild(cursor);

    messageDiv.appendChild(contentDiv);
    wrapperDiv.appendChild(messageDiv);
    chatContainer.appendChild(wrapperDiv);

    // Scroll to bottom for new streaming messages
    setTimeout(() => {
      scrollToBottom();
    }, 10);

    return textSpan;
  }

  function updateStreamingMessage(messageId, content, model = null) {
    const wrapperDiv = document.getElementById(`streaming-${messageId}`);
    if (!wrapperDiv) return;

    const contentDiv = wrapperDiv.querySelector(".message-content");
    if (!contentDiv) return;

    // Remove the cursor
    const cursor = contentDiv.querySelector(".streaming-cursor");
    if (cursor) {
      cursor.remove();
    }

    // Update the text content with markdown rendering
    const textSpan = contentDiv.querySelector("span");
    if (textSpan) {
      // For assistant messages, render markdown; for user messages, keep as plain text
      if (model) {
        textSpan.innerHTML = parseMarkdown(content);
      } else {
        textSpan.textContent = content;
      }
    }

    // Add model indicator for assistant messages
    if (model) {
      const modelIndicator = document.createElement("div");
      modelIndicator.style.fontSize = "0.7em";
      modelIndicator.style.color = "#666";
      modelIndicator.style.marginTop = "4px";
      modelIndicator.style.fontStyle = "italic";

      const def = MODELS.find((m) => m.id === model);
      modelIndicator.textContent = `Using ${def ? def.label : model}`;
      contentDiv.appendChild(modelIndicator);
    }

    // Remove the streaming ID
    wrapperDiv.removeAttribute("id");
  }

  function updateStreamingContent(messageId, content) {
    const wrapperDiv = document.getElementById(`streaming-${messageId}`);
    if (!wrapperDiv) return;

    const textSpan = wrapperDiv.querySelector(".message-content span");
    if (textSpan) {
      // For streaming content, render markdown as it comes in
      textSpan.innerHTML = parseMarkdown(content);
    }

    // Scroll to bottom during streaming only if user is at bottom
    setTimeout(() => {
      scrollToBottomIfNeeded();
    }, 10);
  }

  function addMessage(content, isUser, model = null) {
    const wrapperDiv = document.createElement("div");
    wrapperDiv.className = `message-wrapper${isUser ? " user" : ""}`;

    const messageDiv = document.createElement("div");
    messageDiv.className = "message";

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    // Create text content
    const textSpan = document.createElement("span");
    // For assistant messages, render markdown; for user messages, keep as plain text
    if (!isUser) {
      textSpan.innerHTML = parseMarkdown(content);
    } else {
      textSpan.textContent = content;
    }
    contentDiv.appendChild(textSpan);

    // Add model indicator for assistant messages
    if (!isUser && model) {
      const modelIndicator = document.createElement("div");
      modelIndicator.style.fontSize = "0.7em";
      modelIndicator.style.color = "#666";
      modelIndicator.style.marginTop = "4px";
      modelIndicator.style.fontStyle = "italic";

      const def = MODELS.find((m) => m.id === model);
      modelIndicator.textContent = `Using ${def ? def.label : model}`;
      contentDiv.appendChild(modelIndicator);
    }

    messageDiv.appendChild(contentDiv);
    wrapperDiv.appendChild(messageDiv);
    chatContainer.appendChild(wrapperDiv);
    updateClearHistoryVisibility();

    // Ensure the message is visible
    setTimeout(() => {
      // If this is the first message, scroll to top to make sure it's visible
      if (chatContainer.children.length === 1) {
        chatContainer.scrollTop = 0;
        isUserAtBottom = false;
        userScrolledUp = true;
      } else {
        // Otherwise scroll to bottom for new messages
        scrollToBottom();
      }
    }, 10);
  }
});
