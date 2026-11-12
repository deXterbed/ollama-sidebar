// Enhanced markdown parser for rendering model responses
import katex from "katex";

export function parseMarkdown(text) {
  if (!text) return "";

  // Pull fenced blocks and inline code out of the way before math extraction:
  // a "$x$" inside code is code, not LaTeX, and used to render as KaTeX
  // inside the <code>/<pre> element. Restored right after math extraction,
  // before HTML escaping, so the rest of the pipeline sees the raw code.
  const codeSegments = [];
  // The last alternative is a fence that has no closing ``` yet (normal while
  // a reply is still streaming); it runs to the end of the text so its math
  // isn't extracted either.
  text = text.replace(/```[\s\S]*?```|```[\s\S]*$|`[^`\n]*`/g, (match) => {
    codeSegments.push(match);
    return `%%CODESEG_${codeSegments.length - 1}%%`;
  });

  // Extract math blocks before HTML escaping so LaTeX isn't mangled
  const displayMathBlocks = [];
  const inlineMathBlocks = [];
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
    displayMathBlocks.push(math.trim());
    return `%%DISPLAYMATH_${displayMathBlocks.length - 1}%%`;
  });
  // Inline math: delimiters must hug the content, and the match can't cross
  // another "$" or a line break, and a closing "$" followed by a digit means
  // currency ("$5–$10", "between $5 and $10") — not math. The old naive
  // /\$(.+?)\$/ made "$5–$10" math out of "5–", corrupting the answer and
  // making KaTeX log "Unrecognized Unicode character" for the en dash.
  text = text.replace(
    /\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g,
    (match, math) => {
      inlineMathBlocks.push(math);
      return `%%INLINEMATH_${inlineMathBlocks.length - 1}%%`;
    },
  );
  text = text.replace(
    /%%CODESEG_(\d+)%%/g,
    (match, index) => codeSegments[parseInt(index)] ?? match,
  );

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

  function flushCodeBlock() {
    const codeContent = codeBlockContent.join("\n");
    const languageClass = codeBlockLanguage
      ? ` class="language-${codeBlockLanguage}"`
      : "";
    processedLines.push(`<pre><code${languageClass}>${codeContent}</code></pre>`);
    inCodeBlock = false;
    codeBlockContent = [];
    codeBlockLanguage = "";
  }

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
        flushCodeBlock();
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

  // A fence still open at the end (normal mid-stream) must still render,
  // otherwise everything after the opening ``` disappears from the reply
  // until the closing fence arrives.
  if (inCodeBlock) flushCodeBlock();

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
        // Answers come from a model, not an authored paper — unknown Unicode
        // inside math (e.g. "–") is common and only produces console noise.
        strict: false,
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
        strict: false,
      });
    } catch {
      return `<span class="math-error">${math}</span>`;
    }
  });

  return html;
}
