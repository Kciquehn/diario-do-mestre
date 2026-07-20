import { DOCUMENT_TYPES, FLAGS, MODULE_ID, RESOURCE_KINDS } from "../constants.js";
import { plainTextToRichHTML, richTextToPlainText, sanitizeRichTextHTML } from "../utils/rich-text.js";

export const SESSION_FIELDS = Object.freeze([
  "goal",
  "recap",
  "opening",
  "scenes",
  "npcs",
  "locations",
  "encounters",
  "items",
  "clues",
  "improvisation",
  "notes"
]);

const BOARD_BLOCK_TYPES = Object.freeze(["text", "callout", "check", "test"]);
const DEFAULT_COLUMN_WIDTH = 300;
const MIN_COLUMN_WIDTH = 240;
const MAX_COLUMN_WIDTH = 900;
const MIN_COLUMN_HEIGHT = 140;
const MAX_COLUMN_HEIGHT = 1600;
const MAX_SCENE_LINKS = 100;
const DOCUMENT_UUID_PATTERN = /^[A-Za-z0-9._-]{1,500}$/;
const SCENE_LINK_DOCUMENT_NAMES = Object.freeze(["Actor", "Item", "JournalEntryPage"]);

function requireGameMaster() {
  if (!game.user?.isGM) throw new Error(game.i18n.localize("DMJ.Error.GMOnly"));
}

function cleanName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function normalizeColumnWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return DEFAULT_COLUMN_WIDTH;
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));
}

function normalizeColumnHeight(value) {
  const height = Number(value);
  if (!Number.isFinite(height) || height <= 0) return null;
  return Math.round(Math.min(MAX_COLUMN_HEIGHT, Math.max(MIN_COLUMN_HEIGHT, height)));
}

function normalizeSceneLink(link) {
  const uuid = String(link?.uuid ?? "").trim();
  if (!DOCUMENT_UUID_PATTERN.test(uuid)) return null;
  const documentName = SCENE_LINK_DOCUMENT_NAMES.includes(link?.documentName) ? link.documentName : "";
  const kind = RESOURCE_KINDS.includes(link?.kind) ? link.kind : "";
  return {
    id: String(link?.id || crypto.randomUUID()),
    uuid,
    name: cleanName(link?.name) || game.i18n.localize("DMJ.Board.SceneLinkMissingName"),
    documentName,
    kind,
    image: String(link?.image ?? "").trim().slice(0, 2000),
    note: String(link?.note ?? "").trim().replace(/\s+/g, " ").slice(0, 300)
  };
}

function normalizeSceneLinks(links) {
  const normalized = [];
  const seen = new Set();
  for (const rawLink of Array.isArray(links) ? links.slice(0, MAX_SCENE_LINKS) : []) {
    const link = normalizeSceneLink(rawLink);
    if (!link || seen.has(link.uuid)) continue;
    seen.add(link.uuid);
    normalized.push(link);
  }
  return normalized;
}

function normalizeRichBlockContent(block) {
  const html = sanitizeRichTextHTML(block.html ?? plainTextToRichHTML(block.text));
  const text = richTextToPlainText(html);
  if (text.length <= 20000) return { html, text };
  const limitedText = text.slice(0, 20000);
  return { html: plainTextToRichHTML(limitedText), text: limitedText };
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function textToHTML(value) {
  return escapeHTML(value).replaceAll("\n", "<br>");
}

function htmlToText(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return clone.textContent.trim();
}

function defaultTextBlock() {
  return {
    id: crypto.randomUUID(),
    type: "text",
    title: "",
    height: null,
    html: "",
    text: "",
    done: false,
    successHTML: "",
    successText: "",
    failureHTML: "",
    failureText: "",
    descriptionHTML: "",
    descriptionText: "",
    results: []
  };
}

function readCardBlocks(card) {
  const blocks = [...card.querySelectorAll(":scope > [data-dmj-block]")].map((block) => {
    const type = BOARD_BLOCK_TYPES.includes(block.dataset.type) ? block.dataset.type : "text";
    if (type === "test") {
      const success = block.querySelector(":scope > [data-dmj-test-success]");
      const failure = block.querySelector(":scope > [data-dmj-test-failure]");
      const description = block.querySelector(":scope > [data-dmj-test-description]");
      const successHTML = sanitizeRichTextHTML(success?.innerHTML);
      const failureHTML = sanitizeRichTextHTML(failure?.innerHTML);
      const descriptionHTML = sanitizeRichTextHTML(description?.innerHTML);
      const results = [...block.querySelectorAll(":scope > [data-dmj-test-result-entry]")].map((result) => {
        const html = sanitizeRichTextHTML(result.innerHTML);
        return {
          id: result.dataset.id || crypto.randomUUID(),
          value: String(result.dataset.value ?? "").trim().slice(0, 30),
          html,
          text: richTextToPlainText(html).trim()
        };
      }).filter((result) => result.value || result.text);
      return {
        id: block.dataset.id || crypto.randomUUID(),
        type,
        title: cleanName(block.dataset.title) || game.i18n.localize("DMJ.Board.Test"),
        height: null,
        html: "",
        text: "",
        done: false,
        successHTML,
        successText: richTextToPlainText(successHTML),
        failureHTML,
        failureText: richTextToPlainText(failureHTML),
        descriptionHTML,
        descriptionText: richTextToPlainText(descriptionHTML),
        results
      };
    }
    const content = type === "check" ? block.querySelector("span") ?? block : block.querySelector(":scope > p") ?? block;
    const html = sanitizeRichTextHTML(content.innerHTML);
    return {
      id: block.dataset.id || crypto.randomUUID(),
      type,
      title: type === "callout" ? cleanName(block.dataset.title) || game.i18n.localize("DMJ.Board.Callout") : "",
      height: null,
      html,
      text: richTextToPlainText(html),
      done: block.dataset.done === "true",
      successHTML: "",
      successText: "",
      failureHTML: "",
      failureText: "",
      descriptionHTML: "",
      descriptionText: "",
      results: []
    };
  });
  if (blocks.length) return blocks;

  const legacyTitle = card.querySelector(":scope > h5")?.textContent.trim() ?? "";
  const legacyDescription = card.querySelector("[data-dmj-task-description]");
  const text = [
    legacyTitle && legacyTitle !== game.i18n.localize("DMJ.Board.NewCard") ? legacyTitle : "",
    legacyDescription ? htmlToText(legacyDescription) : ""
  ].filter(Boolean).join("\n\n");
  const legacyChecks = [...card.querySelectorAll("[data-dmj-check]")].map((item) => ({
    id: item.dataset.id || crypto.randomUUID(),
    type: "check",
    text: item.querySelector("span")?.textContent.trim() ?? "",
    done: item.dataset.done === "true"
  })).filter((item) => item.text);
  const legacyBlocks = [...(text ? [{ id: crypto.randomUUID(), type: "text", text, done: false }] : []), ...legacyChecks];
  return legacyBlocks.length ? legacyBlocks : [defaultTextBlock()];
}

function normalizeCard(card) {
  const blocks = (card.blocks ?? []).slice(0, 200).map((block) => {
    const type = BOARD_BLOCK_TYPES.includes(block.type) ? block.type : "text";
    const content = type === "test" ? { html: "", text: "" } : normalizeRichBlockContent(block);
    const success = type === "test"
      ? normalizeRichBlockContent({ html: block.successHTML, text: block.successText })
      : { html: "", text: "" };
    const failure = type === "test"
      ? normalizeRichBlockContent({ html: block.failureHTML, text: block.failureText })
      : { html: "", text: "" };
    const description = type === "test"
      ? normalizeRichBlockContent({ html: block.descriptionHTML, text: block.descriptionText })
      : { html: "", text: "" };
    const results = type === "test"
      ? (Array.isArray(block.results) ? block.results : []).slice(0, 50).map((result) => {
        const content = normalizeRichBlockContent(result);
        return {
          id: String(result.id || crypto.randomUUID()),
          value: String(result.value ?? "").trim().slice(0, 30),
          html: content.html,
          text: content.text.trim()
        };
      }).filter((result) => result.value || result.text)
      : [];
    return {
      id: String(block.id || crypto.randomUUID()),
      type,
      title: type === "callout"
        ? cleanName(block.title) || game.i18n.localize("DMJ.Board.Callout")
        : type === "test"
          ? cleanName(block.title) || game.i18n.localize("DMJ.Board.Test")
          : "",
      height: null,
      html: content.html,
      text: content.text.trim(),
      done: type === "check" && Boolean(block.done),
      successHTML: success.html,
      successText: success.text.trim(),
      failureHTML: failure.html,
      failureText: failure.text.trim(),
      descriptionHTML: description.html,
      descriptionText: description.text.trim(),
      results
    };
  });
  return {
    id: String(card.id || crypto.randomUUID()),
    blocks: blocks.length ? blocks : [defaultTextBlock()]
  };
}

function boardContent(board = {}) {
  const scenes = (board.scenes ?? []).map((scene) => {
    const links = normalizeSceneLinks(scene.links).map((link) => {
      const note = link.note ? ` <span>${escapeHTML(link.note)}</span>` : "";
      return `<p data-dmj-scene-link data-id="${escapeHTML(link.id)}" data-uuid="${escapeHTML(link.uuid)}" data-name="${escapeHTML(link.name)}" data-document-name="${escapeHTML(link.documentName)}" data-kind="${escapeHTML(link.kind)}" data-image="${escapeHTML(link.image)}" data-note="${escapeHTML(link.note)}"><strong>${escapeHTML(link.name)}</strong>${note}</p>`;
    }).join("");
    const columns = (scene.columns ?? []).map((column) => {
      const cards = (column.cards ?? []).map((card) => {
        const blocks = (card.blocks ?? []).map((block) => {
          const title = block.type === "callout" || block.type === "test"
            ? ` data-title="${escapeHTML(block.title || game.i18n.localize(block.type === "test" ? "DMJ.Board.Test" : "DMJ.Board.Callout"))}"`
            : "";
          const attributes = `data-dmj-block data-id="${escapeHTML(block.id)}" data-type="${escapeHTML(block.type)}"${title}`;
          const content = sanitizeRichTextHTML(block.html ?? plainTextToRichHTML(block.text));
          if (block.type === "callout") return `<blockquote ${attributes}><p>${content}</p></blockquote>`;
          if (block.type === "check") return `<p ${attributes} data-done="${Boolean(block.done)}">${block.done ? "☑" : "☐"} <span>${content}</span></p>`;
          if (block.type === "test") {
            const success = sanitizeRichTextHTML(block.successHTML ?? plainTextToRichHTML(block.successText));
            const failure = sanitizeRichTextHTML(block.failureHTML ?? plainTextToRichHTML(block.failureText));
            const description = sanitizeRichTextHTML(block.descriptionHTML ?? plainTextToRichHTML(block.descriptionText));
            const successMarkup = richTextToPlainText(success).trim() ? `<p data-dmj-test-success>${success}</p>` : "";
            const failureMarkup = richTextToPlainText(failure).trim() ? `<p data-dmj-test-failure>${failure}</p>` : "";
            const resultMarkup = (Array.isArray(block.results) ? block.results : []).map((result) => {
              const html = sanitizeRichTextHTML(result.html ?? plainTextToRichHTML(result.text));
              const value = String(result.value ?? "").trim().slice(0, 30);
              if (!value && !richTextToPlainText(html).trim()) return "";
              return `<p data-dmj-test-result-entry data-id="${escapeHTML(result.id || crypto.randomUUID())}" data-value="${escapeHTML(value)}">${html}</p>`;
            }).join("");
            const descriptionMarkup = richTextToPlainText(description).trim()
              ? `<p data-dmj-test-description>${description}</p>`
              : "";
            return `<blockquote ${attributes}>${successMarkup}${failureMarkup}${resultMarkup}${descriptionMarkup}</blockquote>`;
          }
          return `<p ${attributes}>${content}</p>`;
        }).join("");
        return `<article data-dmj-task data-id="${escapeHTML(card.id)}">${blocks}</article>`;
      }).join("");
      const height = normalizeColumnHeight(column.height);
      const heightAttribute = height === null ? "" : ` data-height="${height}"`;
      return `<section data-dmj-column data-id="${escapeHTML(column.id)}" data-width="${normalizeColumnWidth(column.width)}"${heightAttribute}><h4>${textToHTML(column.title)}</h4>${cards}</section>`;
    }).join("\n");
    return `<article data-dmj-scene data-id="${escapeHTML(scene.id)}"><h3>${textToHTML(scene.title)}</h3><section data-dmj-scene-links>${links}</section>${columns}</article>`;
  }).join("\n");
  return `<section data-dmj-board data-active-scene="${escapeHTML(board.activeSceneId)}"><h2>${game.i18n.localize("DMJ.Board.Title")}</h2>${scenes}</section>`;
}

function sessionContent(data = {}, board = {}) {
  const sections = SESSION_FIELDS.map((field) => {
    const label = game.i18n.localize(`DMJ.Field.${field}`);
    return `<section data-dmj-section="${field}"><h2>${label}</h2><p>${textToHTML(data[field])}</p></section>`;
  }).join("\n");
  return `<div class="dmj-session-document"><h1>${game.i18n.localize("DMJ.Template.SessionPlan")}</h1>${sections}${boardContent(board)}</div>`;
}

export class DiaryService {
  static getDiary() {
    return game.journal.find(
      (entry) => entry.getFlag(MODULE_ID, FLAGS.TYPE) === DOCUMENT_TYPES.DIARY
    );
  }

  static getSessions(diary = this.getDiary()) {
    if (!diary) return [];
    return diary.pages
      .filter((page) => page.getFlag(MODULE_ID, FLAGS.TYPE) === DOCUMENT_TYPES.SESSION)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  }

  static getSessionData(page) {
    const data = Object.fromEntries(SESSION_FIELDS.map((field) => [field, ""]));
    if (!page) return data;

    const document = new DOMParser().parseFromString(page.text?.content ?? "", "text/html");
    for (const field of SESSION_FIELDS) {
      const section = document.querySelector(`[data-dmj-section="${field}"] p`);
      if (section) data[field] = htmlToText(section);
    }
    return data;
  }

  static getBoardData(page) {
    const board = { activeSceneId: "", scenes: [] };
    if (!page) return board;

    const document = new DOMParser().parseFromString(page.text?.content ?? "", "text/html");
    const element = document.querySelector("[data-dmj-board]");
    if (!element) return board;
    board.activeSceneId = element.dataset.activeScene ?? "";
    board.scenes = [...element.querySelectorAll(":scope > [data-dmj-scene]")].map((scene) => ({
      id: scene.dataset.id,
      title: scene.querySelector(":scope > h3")?.textContent.trim() || game.i18n.localize("DMJ.Board.NewScene"),
      links: normalizeSceneLinks([...scene.querySelectorAll(":scope > [data-dmj-scene-links] > [data-dmj-scene-link]")].map((link) => ({
        id: link.dataset.id,
        uuid: link.dataset.uuid,
        name: link.dataset.name || link.querySelector("strong")?.textContent,
        documentName: link.dataset.documentName,
        kind: link.dataset.kind,
        image: link.dataset.image,
        note: link.dataset.note
      }))),
      columns: [...scene.querySelectorAll(":scope > [data-dmj-column]")].map((column) => ({
        id: column.dataset.id,
        title: column.querySelector(":scope > h4")?.textContent.trim() || game.i18n.localize("DMJ.Board.NewColumn"),
        width: normalizeColumnWidth(column.dataset.width),
        height: normalizeColumnHeight(column.dataset.height),
        cards: [...column.querySelectorAll(":scope > [data-dmj-task]")].map((card) => ({
          id: card.dataset.id || crypto.randomUUID(),
          blocks: readCardBlocks(card)
        }))
      }))
    }));
    if (!board.scenes.length) {
      board.scenes = [...element.querySelectorAll(":scope > [data-dmj-card]")].map((card) => {
        const details = [...card.querySelectorAll("[data-dmj-card-field]")]
          .map((field) => `${field.querySelector("h4")?.textContent.trim() ?? ""}\n${field.querySelector("p") ? htmlToText(field.querySelector("p")) : ""}`)
          .filter((value) => value.trim())
          .join("\n\n");
        return {
          id: card.dataset.id || crypto.randomUUID(),
          title: card.querySelector(":scope > h3")?.textContent.trim() || game.i18n.localize("DMJ.Board.NewScene"),
          links: [],
          columns: [
            {
              id: crypto.randomUUID(),
              title: game.i18n.localize("DMJ.Board.Column.Todo"),
              width: DEFAULT_COLUMN_WIDTH,
              height: null,
              cards: details ? [{ id: crypto.randomUUID(), blocks: [{ id: crypto.randomUUID(), type: "text", text: details, done: false }] }] : []
            },
            { id: crypto.randomUUID(), title: game.i18n.localize("DMJ.Board.Column.Doing"), width: DEFAULT_COLUMN_WIDTH, height: null, cards: [] },
            { id: crypto.randomUUID(), title: game.i18n.localize("DMJ.Board.Column.Done"), width: DEFAULT_COLUMN_WIDTH, height: null, cards: [] }
          ]
        };
      });
    }
    if (!board.activeSceneId || !board.scenes.some((scene) => scene.id === board.activeSceneId)) {
      board.activeSceneId = board.scenes[0]?.id ?? "";
    }
    return board;
  }

  static async getOrCreateDiary() {
    requireGameMaster();
    const existing = this.getDiary();
    if (existing) return existing;

    return JournalEntry.implementation.create({
      name: game.i18n.format("DMJ.Diary.Name", { world: game.world.title }),
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      flags: { [MODULE_ID]: { [FLAGS.TYPE]: DOCUMENT_TYPES.DIARY } }
    });
  }

  static async addSession(rawName) {
    requireGameMaster();
    const name = cleanName(rawName);
    if (!name) throw new Error(game.i18n.localize("DMJ.Error.SessionName"));

    const diary = await this.getOrCreateDiary();
    const maxSort = Math.max(0, ...diary.pages.map((page) => page.sort ?? 0));
    const [page] = await diary.createEmbeddedDocuments("JournalEntryPage", [{
      name,
      type: "text",
      text: { content: sessionContent(), format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
      sort: maxSort + 100000,
      flags: { [MODULE_ID]: { [FLAGS.TYPE]: DOCUMENT_TYPES.SESSION } }
    }]);
    return page;
  }

  static async deleteSession(page) {
    requireGameMaster();
    const diary = this.getDiary();
    if (!diary || !page || page.parent?.id !== diary.id || !diary.pages.has(page.id) || page.getFlag(MODULE_ID, FLAGS.TYPE) !== DOCUMENT_TYPES.SESSION) {
      throw new Error(game.i18n.localize("DMJ.Error.InvalidSession"));
    }

    await diary.deleteEmbeddedDocuments("JournalEntryPage", [page.id]);
  }


  static async updateSession(page, formData) {
    requireGameMaster();
    if (!page || page.getFlag(MODULE_ID, FLAGS.TYPE) !== DOCUMENT_TYPES.SESSION) {
      throw new Error(game.i18n.localize("DMJ.Error.InvalidSession"));
    }

    const name = cleanName(formData.get("name"));
    if (!name) throw new Error(game.i18n.localize("DMJ.Error.SessionName"));
    const data = Object.fromEntries(SESSION_FIELDS.map((field) => [field, String(formData.get(field) ?? "").trim()]));
    const status = ["draft", "ready", "played"].includes(formData.get("status")) ? formData.get("status") : "draft";

    const board = this.getBoardData(page);
    await page.update({
      name,
      "text.content": sessionContent(data, board),
      [`flags.${MODULE_ID}.status`]: status,
      [`flags.${MODULE_ID}.date`]: String(formData.get("date") ?? "")
    });
    return page;
  }

  static async updateBoard(page, board) {
    requireGameMaster();
    if (!page || page.getFlag(MODULE_ID, FLAGS.TYPE) !== DOCUMENT_TYPES.SESSION) {
      throw new Error(game.i18n.localize("DMJ.Error.InvalidSession"));
    }

    const normalized = {
      activeSceneId: String(board.activeSceneId ?? ""),
      scenes: (board.scenes ?? []).slice(0, 50).map((scene) => ({
        id: String(scene.id || crypto.randomUUID()),
        title: cleanName(scene.title) || game.i18n.localize("DMJ.Board.NewScene"),
        links: normalizeSceneLinks(scene.links),
        columns: (scene.columns ?? []).slice(0, 20).map((column) => ({
          id: String(column.id || crypto.randomUUID()),
          title: cleanName(column.title) || game.i18n.localize("DMJ.Board.NewColumn"),
          width: normalizeColumnWidth(column.width),
          height: normalizeColumnHeight(column.height),
          cards: (column.cards ?? []).slice(0, 200).map(normalizeCard)
        }))
      }))
    };
    if (!normalized.scenes.some((scene) => scene.id === normalized.activeSceneId)) {
      normalized.activeSceneId = normalized.scenes[0]?.id ?? "";
    }
    await page.update({ "text.content": sessionContent(this.getSessionData(page), normalized) });
    return page;
  }
}
