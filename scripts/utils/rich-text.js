const BLOCK_TAGS = new Set(["DIV", "P"]);
const DOCUMENT_UUID_PATTERN = /^[A-Za-z0-9._-]{1,500}$/;

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function serializeNode(node) {
  if (node.nodeType === 3) return escapeHTML(node.nodeValue.replaceAll("\u200b", ""));
  if (node.nodeType !== 1) return "";

  const tag = node.tagName.toUpperCase();
  if (tag === "BR") return "<br>";
  if (tag === "SPAN" && node.hasAttribute("data-dmj-mention")) {
    const uuid = String(node.dataset.uuid ?? "").trim();
    const rawLabel = String(node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 121);
    const label = rawLabel.startsWith("@") ? rawLabel : `@${rawLabel}`;
    if (!DOCUMENT_UUID_PATTERN.test(uuid) || label === "@") return escapeHTML(rawLabel);
    return `<span class="dmj-inline-mention" contenteditable="false" tabindex="0" role="link" data-dmj-mention="" data-uuid="${escapeHTML(uuid)}">${escapeHTML(label)}</span>`;
  }
  if (tag === "SPAN" && node.hasAttribute("data-dmj-resource-callout")) {
    const content = [...node.childNodes].map(serializeNode).join("");
    return content ? `<span class="dmj-resource-callout" data-dmj-resource-callout="">${content}</span>` : "";
  }
  if (tag === "SPAN" && node.hasAttribute("data-dmj-resource-callout-text")) {
    const content = [...node.childNodes].map(serializeNode).join("");
    return `<span data-dmj-resource-callout-text="">${content}</span>`;
  }
  if (tag === "SPAN" && node.hasAttribute("data-dmj-resource-check")) {
    const checked = node.dataset.checked === "true";
    const textElement = [...node.children].find((child) => child.hasAttribute("data-dmj-resource-check-text"));
    const content = textElement ? [...textElement.childNodes].map(serializeNode).join("") : "";
    return `<span class="dmj-resource-check" data-dmj-resource-check="" data-checked="${checked}"><span class="dmj-resource-check-toggle" contenteditable="false" tabindex="0" role="checkbox" aria-checked="${checked}" data-dmj-resource-check-toggle="">${checked ? "☑" : "☐"}</span><span data-dmj-resource-check-text="">${content}</span></span>`;
  }
  if (tag === "SPAN" && node.hasAttribute("data-dmj-resource-test")) {
    const content = [...node.childNodes].map(serializeNode).join("");
    return content ? `<span class="dmj-resource-test" data-dmj-resource-test="">${content}</span>` : "";
  }
  for (const attribute of ["title", "success", "failure"]) {
    const name = `data-dmj-resource-test-${attribute}`;
    if (tag === "SPAN" && node.hasAttribute(name)) {
      const content = [...node.childNodes].map(serializeNode).join("");
      return `<span ${name}="">${content}</span>`;
    }
  }
  const content = [...node.childNodes].map(serializeNode).join("");
  if (tag === "STRONG" || tag === "B") return content ? `<strong>${content}</strong>` : "";
  if (tag === "EM" || tag === "I") return content ? `<em>${content}</em>` : "";
  if (BLOCK_TAGS.has(tag)) return `${content}<br>`;
  return content;
}

export function plainTextToRichHTML(value) {
  return escapeHTML(value).replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\n", "<br>");
}

export function sanitizeRichTextHTML(value) {
  const document = new DOMParser().parseFromString(`<body>${String(value ?? "").slice(0, 50000)}</body>`, "text/html");
  return [...document.body.childNodes]
    .map(serializeNode)
    .join("");
}

export function richTextToPlainText(value) {
  const document = new DOMParser().parseFromString(`<body>${sanitizeRichTextHTML(value)}</body>`, "text/html");
  document.body.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return document.body.textContent.replaceAll("\u200b", "");
}
