/**
 * HTML → plain Markdown-like text converter for the import pipeline.
 *
 * This is deliberately a minimal, security-conscious converter: it works on the
 * raw HTML string without executing scripts or rendering styles, extracts
 * structural text (headings, paragraphs, lists), and emits the Markdown subset
 * that `parseMarkdown` / `markdownToLexicalState` already understands.
 *
 * We avoid JSDOM or any external HTML library to keep the server bundle small
 * and to eliminate the attack surface of a full DOM engine processing untrusted
 * input. The tradeoff is that deeply nested or heavily styled HTML yields plain
 * text rather than rich formatting — which is fine for the "import as source for
 * visuals" use-case.
 *
 * Server-safe: no `document`, `window`, or DOM globals are used.
 */

/** Strips all HTML tags, decoding common entities in the remaining text. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripTagsPreserveLines(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function splitHtmlRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(stripTags(cellMatch[1]));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function tableHtmlToMarkdown(tableHtml: string): string {
  const captionMatch = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(tableHtml);
  const caption = captionMatch ? stripTags(captionMatch[1]) : "";
  const rows = splitHtmlRows(tableHtml);
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) =>
    Array.from({ length: width }, (_value, index) => row[index] ?? ""),
  );
  const [columns, ...bodyRows] = normalized;
  const tableLines = [
    `| ${(columns ?? []).join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...bodyRows.map((row) => `| ${row.join(" | ")} |`),
  ];
  return [caption, ...tableLines].filter(Boolean).join("\n");
}

/**
 * Converts an HTML string to the Markdown subset understood by the editor.
 *
 * Strategy:
 *  1. Strip `<head>`, `<script>`, `<style>` blocks entirely.
 *  2. Walk the body, extracting headings (h1–h3), unordered lists, ordered
 *     lists, paragraphs, and block-level elements as plain paragraphs.
 *  3. Inline markup (bold, italic, links, code) is stripped to plain text.
 *
 * The resulting string is suitable for passing to `normalizeImportedText`.
 */
export function htmlToMarkdown(html: string): string {
  // Remove head, script, style blocks.
  let body = html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Extract body content if present.
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(body);
  if (bodyMatch) {
    body = bodyMatch[1];
  }

  const lines: string[] = [];

  // Split by block-level tags to process each block.
  // We use a single-pass approach: replace block tags with newline markers,
  // then handle lists specially.
  let processed = body;

  processed = processed.replace(
    /<table[^>]*>([\s\S]*?)<\/table>/gi,
    (match) => {
      const table = tableHtmlToMarkdown(match);
      return table ? `\n${table}\n` : "";
    },
  );

  // Process headings.
  processed = processed.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, inner) => {
    const text = stripTags(inner);
    return text ? `\n# ${text}\n` : "";
  });
  processed = processed.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, inner) => {
    const text = stripTags(inner);
    return text ? `\n## ${text}\n` : "";
  });
  processed = processed.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, inner) => {
    const text = stripTags(inner);
    return text ? `\n### ${text}\n` : "";
  });
  processed = processed.replace(
    /<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi,
    (_, inner) => {
      const text = stripTags(inner);
      return text ? `\n### ${text}\n` : "";
    },
  );

  // Process unordered list items.
  processed = processed.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    const items: string[] = [];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    while ((match = liRe.exec(inner)) !== null) {
      const text = stripTags(match[1]);
      if (text) items.push(`- ${text}`);
    }
    return items.length ? `\n${items.join("\n")}\n` : "";
  });

  // Process ordered list items.
  processed = processed.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    const items: string[] = [];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    let n = 1;
    while ((match = liRe.exec(inner)) !== null) {
      const text = stripTags(match[1]);
      if (text) items.push(`- ${text}`); // normalize ordered → bullet
      n++;
    }
    void n;
    return items.length ? `\n${items.join("\n")}\n` : "";
  });

  // Treat block-level elements as paragraph breaks.
  processed = processed.replace(
    /<(p|div|section|article|blockquote|pre|address|footer|header|main|nav|aside)[^>]*>/gi,
    "\n",
  );
  processed = processed.replace(
    /<\/(p|div|section|article|blockquote|pre|address|footer|header|main|nav|aside)>/gi,
    "\n",
  );

  // Line breaks.
  processed = processed.replace(/<br\s*\/?>/gi, "\n");

  // Strip remaining tags (inline markup) while preserving block/table breaks.
  processed = stripTagsPreserveLines(processed);

  // Split into lines, trim each, drop blanks after collapsing.
  for (const rawLine of processed.split("\n")) {
    const line = rawLine.trim();
    lines.push(line);
  }

  return lines.join("\n");
}
