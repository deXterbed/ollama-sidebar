export async function extractPageContent() {
  try {
    const response = await Promise.race([
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "extractContent" }, (response) => {
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
        });
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

// Extract URLs from a text message
export function extractUrls(text) {
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches)];
}

// Fetch a URL and extract text content using DOMParser
export async function fetchUrlContent(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) {
      return {
        url,
        content: null,
        error: `HTTP ${response.status}`,
      };
    }
    const html = await response.text();
    if (!html || html.length < 100) {
      return { url, content: null, error: "Empty response" };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Remove script, style, nav, header, footer elements
    const elementsToRemove = doc.querySelectorAll(
      "script, style, noscript, iframe, embed, object, nav, header, footer, .nav, .header, .footer, .sidebar, .menu",
    );
    elementsToRemove.forEach((el) => el.remove());

    const contentSelectors = [
      "main",
      "article",
      '[role="main"]',
      ".content",
      ".main-content",
      "#content",
      "#main",
      ".post-content",
      ".entry-content",
      ".article-content",
      ".page-content",
      ".text-content",
      ".body-content",
    ];

    let content = "";
    let mainElement = null;
    for (const selector of contentSelectors) {
      const element = doc.querySelector(selector);
      if (element && element.textContent.trim().length > 100) {
        mainElement = element;
        break;
      }
    }
    if (!mainElement) {
      mainElement = doc.body;
    }

    content = mainElement.textContent || "";
    content = content
      .replace(/\s+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .trim();

    const maxLength = 6000;
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + "...";
    }

    const title = doc.title || "";
    const metadata = `Page: ${title}\nURL: ${url}\n\n`;
    const finalContent = metadata + content;

    if (finalContent.length < 100) {
      return { url, content: null, error: "Insufficient content extracted" };
    }
    return { url, content: finalContent, error: null };
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error);
    return { url, content: null, error: error.message };
  }
}
