export async function extractPageContent() {
  try {
    const response = await Promise.race([
      new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "extractContent" },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error("Runtime error:", chrome.runtime.lastError);
              resolve({
                content: null,
                error: chrome.runtime.lastError.message,
              });
            } else {
              resolve(
                response || { content: null, error: "No response received" },
              );
            }
          },
        );
      }),
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({ content: null, error: "Content extraction timeout" });
        }, 5000);
      }),
    ]);

    if (response && response.content) {
      return response.content;
    } else {
      const errorMsg = response?.error || "Unknown extraction error";
      console.error("Content extraction failed:", errorMsg);
      if (errorMsg.includes("Receiving end does not exist")) {
        console.error("Content script not available on this page");
      }
      return null;
    }
  } catch (error) {
    console.error("Failed to extract content:", error);
    return null;
  }
}

export async function checkContentScriptAvailability() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) return { available: false, reason: "No active tab found" };

    const url = new URL(tab.url);
    const blockedProtocol =
      url.protocol === "chrome:" ||
      url.protocol === "chrome-extension:" ||
      url.protocol === "moz-extension:" ||
      url.protocol === "edge:" ||
      url.protocol === "about:" ||
      url.protocol === "data:" ||
      url.protocol === "view-source:";

    if (blockedProtocol) {
      return {
        available: false,
        reason: `Content scripts not allowed on ${url.protocol} pages`,
      };
    }

    // Ping first — already injected on most page loads
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "ping" });
      return { available: true };
    } catch (_) {
      // Not loaded yet — inject programmatically (handles post-install case)
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tab.id, { action: "ping" });
      return { available: true };
    } catch (injectError) {
      return { available: false, reason: injectError.message };
    }
  } catch (error) {
    return { available: false, reason: error.message };
  }
}
