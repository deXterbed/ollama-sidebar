import { showContextLoading, hideContextLoading } from "./ui.js";
import { checkContentScriptAvailability } from "./content.js";

export function createContext({
  imageButton,
  messageInput,
  getContextMode,
  setContextMode,
  clearShortcutState,
  getModelLabel,
}) {
  function updateContextModeUI() {
    const contextMode = getContextMode();
    imageButton.classList.remove("active", "content-mode");

    const currentModelDisplay = document.getElementById(
      "current-model-display",
    );
    const existingRefreshButton = document.querySelector(".refresh-button");
    if (existingRefreshButton) existingRefreshButton.remove();

    switch (contextMode) {
      case "none":
        messageInput.placeholder = "Ask anything";
        break;
      case "content":
        imageButton.classList.add("active", "content-mode");
        messageInput.placeholder = "Ask about this page...";
        break;
    }
    if (currentModelDisplay) currentModelDisplay.textContent = getModelLabel();

    if (contextMode === "content") {
      checkContentScriptAvailability().then((availability) => {
        if (!availability.available) {
          if (currentModelDisplay) {
            currentModelDisplay.textContent = `${getModelLabel()} (Content unavailable)`;
            currentModelDisplay.style.color = "#ff6b6b";
          }
          addRefreshButton();
        } else if (currentModelDisplay) {
          currentModelDisplay.style.color = "";
        }
      });
    } else if (currentModelDisplay) {
      currentModelDisplay.style.color = "";
    }
  }

  function addRefreshButton() {
    const modelBadge = document.getElementById("model-badge");
    if (!modelBadge || !modelBadge.isConnected) return;

    const refreshButton = document.createElement("button");
    refreshButton.className = "refresh-button";
    refreshButton.textContent = "Refresh Page";

    refreshButton.addEventListener("click", async () => {
      try {
        showContextLoading("Refreshing page...");
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab) {
          await chrome.tabs.reload(tab.id);
          setTimeout(async () => {
            const availability = await checkContentScriptAvailability();
            if (availability.available) {
              showContextLoading("Content now available");
              setTimeout(() => {
                hideContextLoading();
                updateContextModeUI();
              }, 1000);
            } else {
              showContextLoading("Content still unavailable");
              setTimeout(() => hideContextLoading(), 1000);
            }
          }, 2000);
        }
      } catch (error) {
        console.error("Error refreshing page:", error);
        hideContextLoading();
      }
    });

    modelBadge.after(refreshButton);
  }

  function cycleContextMode() {
    const modes = ["none", "content"];
    const currentIndex = modes.indexOf(getContextMode());
    const nextIndex = (currentIndex + 1) % modes.length;
    setContextMode(modes[nextIndex]);
    updateContextModeUI();
  }

  function clearShortcutMode() {
    clearShortcutState();
  }

  return { updateContextModeUI, cycleContextMode, clearShortcutMode };
}
