// Enhanced markdown parser for rendering model responses
import katex from "katex";

export function parseMarkdown(text) {
  if (!text) return "";

  // Extract math blocks before HTML escaping so LaTeX isn't mangled
  const displayMathBlocks = [];
  const inlineMathBlocks = [];
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
    displayMathBlocks.push(math.trim());
    return `%%DISPLAYMATH_${displayMathBlocks.length - 1}%%`;
  });
  text = text.replace(/\$(.+?)\$/g, (match, math) => {
    inlineMathBlocks.push(math);
    return `%%INLINEMATH_${inlineMathBlocks.length - 1}%%`;
  });

  // Escape HTML first to prevent XSS
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Split into lines for better processing
  const lines = html.split("\n");
  const processedLines = [];
  let inCodeBlock = false;
  let codeBlockContent = [];
  let codeBlockLanguage = "";
  let inTable = false;
  let tableRows = [];

  function flushTable() {
    if (!tableRows.length) return;
    const parsed = tableRows.map((r) =>
      r
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );
    const isSep = (row) => row.every((c) => /^[\-:]+$/.test(c));
    const headers = parsed[0];
    const body = parsed.slice(1).filter((r) => !isSep(r));
    const thead = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
    const tbody = `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
    processedLines.push(`<table>${thead}${tbody}</table>`);
    tableRows = [];
    inTable = false;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle code blocks
    if (line.trim().startsWith("```")) {
      flushTable();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLanguage = line.trim().substring(3).trim();
        codeBlockContent = [];
      } else {
        inCodeBlock = false;
        const codeContent = codeBlockContent.join("\n");
        const languageClass = codeBlockLanguage
          ? ` class="language-${codeBlockLanguage}"`
          : "";
        processedLines.push(
          `<pre><code${languageClass}>${codeContent}</code></pre>`,
        );
        codeBlockContent = [];
        codeBlockLanguage = "";
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Handle markdown tables (lines starting with |)
    if (line.trim().startsWith("|")) {
      inTable = true;
      tableRows.push(line.trim());
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Process non-code block lines
    let processedLine = line;

    // Headers (must be at start of line)
    if (line.match(/^#{1,6}\s/)) {
      const headerMatch = line.match(/^(#{1,6})\s(.+)$/);
      if (headerMatch) {
        const level = headerMatch[1].length;
        const text = headerMatch[2];
        processedLine = `<h${level}>${text}</h${level}>`;
      }
    }
    // Blockquotes
    else if (line.match(/^>\s/)) {
      const quoteText = line.substring(2);
      processedLine = `<blockquote>${quoteText}</blockquote>`;
    }
    // Lists
    else if (line.match(/^[\*\-\+]\s/)) {
      const listText = line.substring(2);
      processedLine = `<li>${listText}</li>`;
    } else if (line.match(/^\d+\.\s/)) {
      const listText = line.replace(/^\d+\.\s/, "");
      processedLine = `<li>${listText}</li>`;
    }
    // Regular paragraphs
    else if (line.trim()) {
      processedLine = `<p>${line}</p>`;
    }
    // Empty lines
    else {
      processedLine = "";
    }

    processedLines.push(processedLine);
  }

  // Flush any trailing table
  flushTable();

  // Join processed lines
  html = processedLines.join("\n");

  // Protect code blocks from inline processing by stashing them in placeholders
  const codeBlocks = [];
  html = html.replace(/<pre><code[^>]*>[\s\S]*?<\/code><\/pre>/g, (match) => {
    codeBlocks.push(match);
    return `%%CODEBLOCK_${codeBlocks.length - 1}%%`;
  });

  // Process inline elements
  // Bold and italic
  html = html.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Inline code (not inside code blocks — they're stashed)
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links (only allow safe protocols)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    const safeProtocols = /^(https?:\/\/|mailto:|ftp:\/\/|\/)/i;
    if (safeProtocols.test(url.trim())) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
    // Strip unsafe URLs, keep the text only
    return text;
  });

  // Wrap consecutive list items in ul
  html = html.replace(/(<li>.*?<\/li>)(\s*<li>.*?<\/li>)*/gs, function (match) {
    const items = match.match(/<li>.*?<\/li>/g);
    if (items && items.length > 0) {
      return "<ul>" + items.join("") + "</ul>";
    }
    return match;
  });

  // Restore stashed code blocks
  html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (match, index) => {
    return codeBlocks[parseInt(index)] || match;
  });

  // Render math blocks
  html = html.replace(/%%DISPLAYMATH_(\d+)%%/g, (match, index) => {
    const math = displayMathBlocks[parseInt(index)];
    if (!math) return match;
    try {
      return katex.renderToString(math, {
        displayMode: true,
        throwOnError: false,
      });
    } catch {
      return `<div class="math-error">${math}</div>`;
    }
  });
  html = html.replace(/%%INLINEMATH_(\d+)%%/g, (match, index) => {
    const math = inlineMathBlocks[parseInt(index)];
    if (!math) return match;
    try {
      return katex.renderToString(math, {
        displayMode: false,
        throwOnError: false,
      });
    } catch {
      return `<span class="math-error">${math}</span>`;
    }
  });

  return html;
}
