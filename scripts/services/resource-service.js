import { DOCUMENT_TYPES, FLAGS, MODULE_ID, RESOURCE_KINDS } from "../constants.js";
import { DiaryService } from "./diary-service.js";
import { plainTextToRichHTML, richTextToPlainText, sanitizeRichTextHTML } from "../utils/rich-text.js";

const DOCUMENT_UUID_PATTERN = /^[A-Za-z0-9._-]{1,500}$/;
const IMAGE_FRAMING_DEFAULTS = Object.freeze({ imagePositionX: 50, imagePositionY: 50, imageZoom: 100 });

export const RESOURCE_FIELDS = Object.freeze({
  person: ["role", "appearance", "personality", "motivation", "secrets"],
  place: ["region", "atmosphere", "features", "inhabitants", "secrets"],
  item: ["category", "appearance", "effect", "location", "secrets"],
  encounter: ["setup", "participants", "challenge", "rewards", "consequences"],
  faction: ["objective", "resources", "allies", "enemies", "secrets"]
});

function requireGameMaster() {
  if (!game.user?.isGM) throw new Error(game.i18n.localize("DMJ.Error.GMOnly"));
}

function cleanName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fieldHTML(data, field) {
  return sanitizeRichTextHTML(data[`${field}HTML`] ?? plainTextToRichHTML(data[field]));
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function imageFraming(data = {}) {
  return {
    imagePositionX: boundedNumber(data.imagePositionX, 0, 100, IMAGE_FRAMING_DEFAULTS.imagePositionX),
    imagePositionY: boundedNumber(data.imagePositionY, 0, 100, IMAGE_FRAMING_DEFAULTS.imagePositionY),
    imageZoom: boundedNumber(data.imageZoom, 100, 300, IMAGE_FRAMING_DEFAULTS.imageZoom)
  };
}

function resourceContent(kind, data) {
  const framing = imageFraming(data);
  const fields = RESOURCE_FIELDS[kind].map((field) => `<section data-dmj-resource-field="${field}"><h2>${game.i18n.localize(`DMJ.Resource.Field.${kind}.${field}`)}</h2><p>${fieldHTML(data, field)}</p></section>`).join("\n");
  return `<article data-dmj-resource data-kind="${kind}" data-image="${escapeHTML(data.image)}" data-image-position-x="${framing.imagePositionX}" data-image-position-y="${framing.imagePositionY}" data-image-zoom="${framing.imageZoom}" data-linked-uuid="${escapeHTML(data.linkedUuid)}"><h1>${escapeHTML(data.name)}</h1>${fields}<section data-dmj-resource-field="notes"><h2>${game.i18n.localize("DMJ.Resource.Notes")}</h2><p>${fieldHTML(data, "notes")}</p></section></article>`;
}

export class ResourceService {
  static getResources(diary = DiaryService.getDiary()) {
    if (!diary) return [];
    return diary.pages
      .filter((page) => page.getFlag(MODULE_ID, FLAGS.TYPE) === DOCUMENT_TYPES.RESOURCE)
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  }

  static getData(page) {
    const kind = RESOURCE_KINDS.includes(page?.getFlag(MODULE_ID, "kind")) ? page.getFlag(MODULE_ID, "kind") : "person";
    const data = {
      name: page?.name ?? "",
      kind,
      image: "",
      ...IMAGE_FRAMING_DEFAULTS,
      linkedUuid: "",
      notes: "",
      notesHTML: "",
      ...Object.fromEntries(RESOURCE_FIELDS[kind].flatMap((field) => [[field, ""], [`${field}HTML`, ""]]))
    };
    if (!page) return data;

    const document = new DOMParser().parseFromString(page.text?.content ?? "", "text/html");
    const root = document.querySelector("[data-dmj-resource]");
    if (!root) return data;
    data.image = root.dataset.image ?? "";
    Object.assign(data, imageFraming({
      imagePositionX: root.dataset.imagePositionX,
      imagePositionY: root.dataset.imagePositionY,
      imageZoom: root.dataset.imageZoom
    }));
    data.linkedUuid = root.dataset.linkedUuid ?? "";
    for (const field of [...RESOURCE_FIELDS[kind], "notes"]) {
      const content = root.querySelector(`[data-dmj-resource-field="${field}"] p`);
      if (!content) continue;
      const html = sanitizeRichTextHTML(content.innerHTML);
      data[`${field}HTML`] = html;
      data[field] = richTextToPlainText(html).trim();
    }
    return data;
  }

  static async createResource(kind, rawName) {
    requireGameMaster();
    if (!RESOURCE_KINDS.includes(kind)) throw new Error(game.i18n.localize("DMJ.Resource.Error.Kind"));
    const name = cleanName(rawName);
    if (!name) throw new Error(game.i18n.localize("DMJ.Resource.Error.Name"));
    const diary = await DiaryService.getOrCreateDiary();
    const data = { name, image: "", ...IMAGE_FRAMING_DEFAULTS, linkedUuid: "", notes: "", notesHTML: "", ...Object.fromEntries(RESOURCE_FIELDS[kind].flatMap((field) => [[field, ""], [`${field}HTML`, ""]])) };
    const maxSort = Math.max(0, ...diary.pages.map((page) => page.sort ?? 0));
    const [page] = await diary.createEmbeddedDocuments("JournalEntryPage", [{
      name,
      type: "text",
      text: { content: resourceContent(kind, data), format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
      sort: maxSort + 100000,
      flags: { [MODULE_ID]: { [FLAGS.TYPE]: DOCUMENT_TYPES.RESOURCE, kind } }
    }]);
    return page;
  }

  static async deleteResource(page) {
    requireGameMaster();
    const diary = DiaryService.getDiary();
    if (!diary || !page || page.parent?.id !== diary.id || !diary.pages.has(page.id) || page.getFlag(MODULE_ID, FLAGS.TYPE) !== DOCUMENT_TYPES.RESOURCE) {
      throw new Error(game.i18n.localize("DMJ.Resource.Error.Invalid"));
    }

    await diary.deleteEmbeddedDocuments("JournalEntryPage", [page.id]);
  }

  static async updateResource(page, formData) {
    requireGameMaster();
    const diary = DiaryService.getDiary();
    if (!diary || !page || page.parent?.id !== diary.id || !diary.pages.has(page.id) || page.getFlag(MODULE_ID, FLAGS.TYPE) !== DOCUMENT_TYPES.RESOURCE) {
      throw new Error(game.i18n.localize("DMJ.Resource.Error.Invalid"));
    }
    const rawKind = page.getFlag(MODULE_ID, "kind");
    const kind = RESOURCE_KINDS.includes(rawKind) ? rawKind : "person";
    const name = cleanName(formData.get("name"));
    if (!name) throw new Error(game.i18n.localize("DMJ.Resource.Error.Name"));
    const richFields = Object.fromEntries([...RESOURCE_FIELDS[kind], "notes"].flatMap((field) => {
      const html = sanitizeRichTextHTML(formData.get(field));
      return [[field, richTextToPlainText(html).trim()], [`${field}HTML`, html]];
    }));
    const data = {
      name,
      image: String(formData.get("image") ?? "").trim().slice(0, 2000),
      ...imageFraming({
        imagePositionX: formData.get("imagePositionX"),
        imagePositionY: formData.get("imagePositionY"),
        imageZoom: formData.get("imageZoom")
      }),
      linkedUuid: DOCUMENT_UUID_PATTERN.test(String(formData.get("linkedUuid") ?? "").trim())
        ? String(formData.get("linkedUuid") ?? "").trim()
        : "",
      ...richFields
    };
    await page.update({ name, "text.content": resourceContent(kind, data) });
    return page;
  }

  static async getLinkedDocument(page) {
    const uuid = this.getData(page).linkedUuid;
    if (!uuid) return null;
    try {
      return await fromUuid(uuid);
    } catch {
      return null;
    }
  }
}
