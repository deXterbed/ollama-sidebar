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
      `Ollama rejected the request (403 Forbidden). This usually means its origin allowlist doesn't include this extension. Reload the extension so its Origin-stripping rule is installed, or set OLLAMA_ORIGINS to "chrome-extension://*" and restart Ollama.`,
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

// The page extract is context, not the scope of the answer. Without this,
// models treat it as a closed corpus and reply "the page doesn't say" instead
// of answering, which reads as the extension failed to read the tab.
function contentRule(searchOn) {
  return searchOn
    ? "The webpage content is context, not a limit on what you may answer. If it does not fully answer the user's question, you MUST call web_search and answer from the results, citing the source URLs — never reply that the page/blog doesn't say or doesn't mention it, and never substitute that statement for an answer. Only after actually searching may you say something isn't available. Use web_search for recent events and current facts too."
    : "The webpage content is context, not a limit on what you may answer. If it does not fully answer the user's question, answer from your own knowledge — never reply that the page/blog doesn't say or doesn't mention it, and never substitute that statement for an answer.";
}

function buildMessages({ message, content, conversationHistory, searchOn }) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const messages = [
    {
      role: "system",
      content:
        `You are a helpful AI assistant running locally via Ollama. Today's date is ${today}. You will be provided context from the user's current webpage to help answer their questions more effectively. Focus on the main content, articles, text, and meaningful information from the webpage. ${contentRule(searchOn)} You have a web_fetch tool that reads the live content of any webpage — you are not limited to prior knowledge or a training cutoff for this. Whenever the user's message contains or references a specific URL, always call web_fetch to read it before answering; never claim you can't browse or access the internet.` +
        (searchOn
          ? " You also have a web_search tool that queries the live web, and you can chain it with web_fetch (e.g., search, then read a result link)."
          : ""),
    },
  ];

  // The current turn was already pushed to conversationHistory by sendMessage,
  // so iterate only earlier turns or the message is sent twice.
  conversationHistory.slice(0, -1).forEach((msg) => {
    messages.push({
      role: msg.isUser ? "user" : "assistant",
      content: msg.content,
    });
  });

  if (content) {
    messages.push({
      role: "user",
      content: `Here is the content from my current webpage:\n\n${content}\n\nPlease use this context to help answer my question. If I ask for a summary, summarize the main content from this webpage. This extract is truncated, so if it does not answer my question, do not assume the answer isn't on the page. ${searchOn ? "Call web_search and answer from the results instead of telling me the page doesn't cover it." : "Answer from your own knowledge instead of telling me the page doesn't cover it."}`,
    });
  }

  messages.push({ role: "user", content: message });
  return messages;
}

// Ollama's hosted web search returns long snippets, and tool output competes
// with the reply for the model's context, so cap both per result and overall.
const MAX_SNIPPET_CHARS = 1000;
const MAX_RESULTS_CHARS = 8000;

export function formatSearchResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return "No results found.";
  }
  const formatted = results
    .map(
      (r, i) =>
        `${i + 1}. ${r.title || "Untitled"} — ${r.url}\n${(r.content || "").slice(0, MAX_SNIPPET_CHARS)}`,
    )
    .join("\n\n");
  return formatted.slice(0, MAX_RESULTS_CHARS);
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
  const meta = { doneReason: "", thinkingChars: 0, toolCalls: [] };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // ignore partial JSON chunks
        }
        // Ollama reports generation failures in-band on a 200 response, so a
        // dropped error object would look like an empty reply.
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        if (parsed.done) meta.doneReason = parsed.done_reason || "";
        if (parsed.message?.tool_calls?.length) {
          meta.toolCalls.push(...parsed.message.tool_calls);
        }
        if (parsed.message?.thinking) {
          meta.thinkingChars += parsed.message.thinking.length;
        }
        const piece = parsed.message?.content;
        if (piece) {
          fullContent += piece;
          onStream(streamingMessageId, fullContent);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { content: fullContent, ...meta };
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
  tools,
  searchOn,
}) {
  const finalMessages =
    messages ||
    buildMessages({ message, content, conversationHistory, searchOn });

  const response = await ollamaFetch(ollamaHost, "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: finalMessages,
      stream: true,
      tools,
    }),
  });

  const result = await readStream(response, streamingMessageId, onStream);
  return { ...result, messages: finalMessages };
}
