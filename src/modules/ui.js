export function showLoading(message = "Processing...") {
  const inputContainer = document.getElementById("input-container");
  const messageInput = document.getElementById("message-input");
  const sendButton = document.querySelector(".send-button");

  if (inputContainer) inputContainer.classList.add("loading");
  if (sendButton) {
    sendButton.classList.add("loading");
    sendButton.disabled = true;
  }
  if (messageInput) messageInput.disabled = true;
  showContextLoading(message);
}

export function hideLoading() {
  const inputContainer = document.getElementById("input-container");
  const messageInput = document.getElementById("message-input");
  const sendButton = document.querySelector(".send-button");

  if (inputContainer) inputContainer.classList.remove("loading");
  if (sendButton) {
    sendButton.classList.remove("loading");
    sendButton.disabled = false;
  }
  if (messageInput) {
    messageInput.disabled = false;
    messageInput.focus();
  }
  hideContextLoading();
}

export function showContextLoading(message) {
  const inputContainer = document.getElementById("input-container");
  const modelBadge = document.getElementById("model-badge");

  hideContextLoading();

  const contextLoading = document.createElement("div");
  contextLoading.className = "context-loading";
  contextLoading.textContent = message;

  if (modelBadge && modelBadge.isConnected) {
    modelBadge.before(contextLoading);
  } else if (inputContainer) {
    inputContainer.appendChild(contextLoading);
  }
}

export function hideContextLoading() {
  const contextLoading = document.querySelector(".context-loading");
  if (contextLoading) contextLoading.remove();
}

export function showTypingIndicator(model) {
  const modelBadge = document.getElementById("model-badge");
  const currentModelDisplay = document.getElementById("current-model-display");
  const messageInput = document.getElementById("message-input");
  const sendButton = document.querySelector(".send-button");

  if (currentModelDisplay) {
    currentModelDisplay.textContent = `${model} is thinking...`;
  }
  if (modelBadge) {
    modelBadge.style.animation = "typingPulse 2s ease-in-out infinite";
    modelBadge.style.position = "relative";
    modelBadge.style.zIndex = "1001";
  }
  if (messageInput) {
    messageInput.disabled = true;
    messageInput.classList.add("loading");
  }
  if (sendButton) sendButton.disabled = true;
}

export function hideTypingIndicator(modelLabel) {
  const modelBadge = document.getElementById("model-badge");
  const currentModelDisplay = document.getElementById("current-model-display");
  const messageInput = document.getElementById("message-input");
  const sendButton = document.querySelector(".send-button");

  if (currentModelDisplay) {
    currentModelDisplay.textContent = modelLabel || "Assistant";
  }
  if (modelBadge) {
    modelBadge.style.animation = "";
    modelBadge.style.position = "";
    modelBadge.style.zIndex = "";
  }
  if (messageInput) {
    messageInput.disabled = false;
    messageInput.classList.remove("loading");
    messageInput.focus();
  }
  if (sendButton) sendButton.disabled = false;
}
