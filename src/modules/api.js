function describeFetchError(error, ollamaHost) {
  if (error instanceof TypeError) {
    return new Error(
      `Can't reach Ollama at ${ollamaHost}. Make sure Ollama is running (\`ollama serve\`) and the host is correct in Settings.`,
    );
  }
  return error;
}

async function ollamaFetch(ollamaHost, path, options) {
  let response;
  try {
    response = await fetch(`${ollamaHost}${path}`, options);
  } catch (error) {
    throw describeFetchError(error, ollamaHost);
  }
  if (response.status === 403) {
    throw new Error(
      `Ollama rejected the request (403 Forbidden). This usually means its origin allowlist doesn't include this extension. Set the OLLAMA_ORIGINS environment variable to "chrome-extension://*" and restart Ollama.`,
    );
  }
  if (!response.ok) {
    const errorData = await response.text();
    let errorMessage;
    try {
      const errorJson = JSON.parse(errorData);
      errorMessage = errorJson.error || "Ollama request failed";
    } catch {
      errorMessage =
        errorData || `Ollama request failed with status ${response.status}`;
    }
    throw new Error(errorMessage);
  }
  return response;
}

function buildMessages({ message, content, conversationHistory }) {
  const messages = [
    {
      role: "system",
      content:
        "You are a helpful AI assistant running locally via Ollama. You may be provided with webpage content from the user's current tab or from linked pages in their message. Use this context to answer questions. If you don't have content for a specific page, say so clearly. You can also use the `web_fetch` tool to fetch additional pages if needed.",
    },
  ];

  conversationHistory.forEach((msg) => {
    messages.push({
      role: msg.isUser ? "user" : "assistant",
      content: msg.content,
    });
  });

  if (content) {
    messages.push({
      role: "user",
      content: `Here is the content from my current webpage:\n\n${content}\n\nPlease use this context to help answer my question.`,
    });
  }

  messages.push({ role: "user", content: message });
  return messages;
}

export async function fetchModels(ollamaHost) {
  const response = await ollamaFetch(ollamaHost, "/api/tags", {
    method: "GET",
  });
  const data = await response.json();
  return (data.models || []).map((m) => ({ id: m.name, label: m.name }));
}

async function readStream(response, streamingMessageId, onStream) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const piece = parsed.message?.content;
          if (piece) {
            fullContent += piece;
            onStream(streamingMessageId, fullContent);
          }
        } catch {
          // ignore partial JSON chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullContent;
}

export async function fetchToolCalls({
  message,
  content,
  model,
  ollamaHost,
  conversationHistory,
  tools,
}) {
  const messages = buildMessages({ message, content, conversationHistory });

  const response = await ollamaFetch(ollamaHost, "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, tools }),
  });

  const data = await response.json();
  if (data.message?.tool_calls?.length > 0) {
    return {
      toolCalls: data.message.tool_calls,
      assistantMessage: data.message,
      messages,
    };
  }
  return null;
}

export async function fetchStreamingReply({
  streamingMessageId,
  model,
  ollamaHost,
  onStream,
  messages,
  message,
  content,
  conversationHistory,
}) {
  const finalMessages =
    messages || buildMessages({ message, content, conversationHistory });

  const response = await ollamaFetch(ollamaHost, "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: finalMessages, stream: true }),
  });

  return readStream(response, streamingMessageId, onStream);
}
