import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({
  gfm: true,
  breaks: true,
});

// Standard HTML element names that should be left alone when they appear in
// markdown source. Anything outside this set is treated as a user-defined
// semantic tag (e.g. `<bug>`, `<spec>`, `<context>`) and rewritten so the tags
// remain visible after DOMPurify sanitization (which would otherwise strip
// unknown elements and leave only their inner text behind).
const KNOWN_HTML_TAGS = new Set<string>([
  "a", "abbr", "address", "area", "article", "aside", "audio",
  "b", "base", "bdi", "bdo", "blockquote", "body", "br", "button",
  "canvas", "caption", "cite", "code", "col", "colgroup",
  "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt",
  "em", "embed",
  "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html",
  "i", "iframe", "img", "input", "ins",
  "kbd",
  "label", "legend", "li", "link",
  "main", "map", "mark", "menu", "meta", "meter",
  "nav", "noscript",
  "object", "ol", "optgroup", "option", "output",
  "p", "param", "picture", "pre", "progress",
  "q",
  "rp", "rt", "ruby",
  "s", "samp", "script", "section", "select", "slot", "small", "source", "span", "strong", "style", "sub", "summary", "sup", "svg",
  "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "time", "title", "tr", "track",
  "u", "ul",
  "var", "video",
  "wbr",
]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Walks the markdown text and rewrites any open/close tags whose name is not
// a known HTML element into an inline `<code class="md-xml">&lt;tag&gt;</code>`
// span. This keeps user-defined semantic tags (e.g. `<bug>`, `<spec>`) visible
// after DOMPurify strips unknown elements while also giving them a small
// stylistic hook. Tags inside fenced code blocks (``` ... ```) or inline code
// spans (`...`) are left untouched so authored examples keep their literal
// form.
function preserveCustomXmlTags(src: string): string {
  if (!src) return src;
  const lines = src.split("\n");
  let inFence = false;
  let fenceMarker = "";

  const tagRe = /<(\/?)([A-Za-z][A-Za-z0-9_-]*)((?:\s[^>]*)?)(\/?)>/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker[0].repeat(marker.length);
      } else if (line.trim().startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;

    // Split the line on inline code spans so we don't touch tags inside them.
    const parts = line.split(/(`+[^`]*`+)/g);
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      if (!part || part.startsWith("`")) continue;
      parts[p] = part.replace(tagRe, (match, slash: string, name: string, attrs: string, selfClose: string) => {
        if (KNOWN_HTML_TAGS.has(name.toLowerCase())) return match;
        const inner = `<${slash}${name}${attrs || ""}${selfClose || ""}>`;
        return `<code class="md-xml">${escapeHtml(inner)}</code>`;
      });
    }
    lines[i] = parts.join("");
  }
  return lines.join("\n");
}

export function renderMarkdown(input: string): string {
  if (!input) return "";
  const pre = preserveCustomXmlTags(input);
  const raw = marked.parse(pre, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      "a", "b", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6",
      "hr", "i", "img", "li", "ol", "p", "pre", "s", "span", "strong", "table", "tbody", "td",
      "tfoot", "th", "thead", "tr", "ul", "input", "div"
    ],
    ALLOWED_ATTR: ["href", "title", "alt", "src", "class", "type", "checked", "disabled"],
    ALLOW_DATA_ATTR: false,
  });
}

// Detect user-defined XML-like tags in a free-form composer string. Returns a
// de-duplicated list of opening tag names (lowercased) that are not standard
// HTML elements. Used by the composer UI to surface a small badge listing the
// semantic tags the user is currently typing.
export function detectXmlTags(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /<([A-Za-z][A-Za-z0-9_-]*)(?:\s[^>]*)?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].toLowerCase();
    if (KNOWN_HTML_TAGS.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

// Escape helper exposed for tests / future callers.
export { escapeHtml };
