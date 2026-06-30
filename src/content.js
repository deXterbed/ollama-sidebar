// Function to extract relevant webpage content
function extractPageContent() {
  try {
    // Create a clone of the document body to avoid modifying the original page
    const bodyClone = document.body.cloneNode(true);

    // Remove script and style elements from the clone only
    const elementsToRemove = bodyClone.querySelectorAll(
      "script, style, noscript, iframe, embed, object, nav, header, footer, .nav, .header, .footer, .sidebar, .menu",
    );
    elementsToRemove.forEach((el) => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });

    // Get the main content areas from the clone
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

    // Try to find main content area in the clone
    for (const selector of contentSelectors) {
      const element = bodyClone.querySelector(selector);
      if (element && element.textContent.trim().length > 100) {
        mainElement = element;
        break;
      }
    }

    // If no main content found, use body clone but filter out navigation and other non-content elements
    if (!mainElement) {
      mainElement = bodyClone;
    }

    // Extract text content from the clone
    content = mainElement.textContent || mainElement.innerText || "";

    // Clean up the content
    content = content
      .replace(/\s+/g, " ") // Replace multiple whitespace with single space
      .replace(/\n\s*\n/g, "\n") // Replace multiple newlines with single newline
      .replace(/^\s+|\s+$/g, "") // Trim whitespace
      .trim();

    // Limit content length to avoid token limits
    const maxLength = 8000; // Conservative limit
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + "...";
    }

    // Add page metadata
    const title = document.title || "";
    const url = window.location.href;
    const metadata = `Page: ${title}\nURL: ${url}\n\n`;

    const finalContent = metadata + content;

    // Ensure we have meaningful content
    if (finalContent.length < 100) {
      return null;
    }

    return finalContent;
  } catch (error) {
    console.error("Error in content extraction:", error);
    return `Error extracting content: ${error.message}`;
  }
}

// Guard against duplicate listener registration when script is injected programmatically
if (!window.__ollamaSidebarContentScriptLoaded) {
  window.__ollamaSidebarContentScriptLoaded = true;

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener(
    async (request, sender, sendResponse) => {
      // console.log("Content script received message:", request.action);

      if (request.action === "extractContent") {
        try {
          // Check if we're on a valid page
          if (!document.body) {
            console.warn("Document body not available");
            sendResponse({
              content: null,
              error: "Document body not available",
            });
            return true;
          }

          const content = extractPageContent();

          if (!content || content.length < 50) {
            console.warn(
              "Content extraction returned insufficient content, length:",
              content ? content.length : 0,
            );
            sendResponse({
              content: null,
              error: "Insufficient content extracted",
            });
            return true;
          }

          sendResponse({ content: content });
        } catch (error) {
          console.error("Content extraction error:", error);
          sendResponse({ content: null, error: error.message });
        }
        return true; // Keep the message channel open for async response
      }

      // Broadcast functionality removed - no longer needed

      if (request.action === "ping") {
        // Simple ping to check if content script is available
        sendResponse({ status: "ok" });
        return true;
      }
    },
  );
} // end __ollamaSidebarContentScriptLoaded guard
