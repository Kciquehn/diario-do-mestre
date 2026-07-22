import { DOCUMENT_TYPES, FLAGS, MODULE_ID, RESOURCE_KINDS } from "../constants.js?v=1.12.2";
import { sanitizeRichTextHTML } from "../utils/rich-text.js";

const IMAGE_PATTERN = /^(?!\s*(?:javascript|data):).{0,2000}$/i;
const PUBLIC_FIELDS = Object.freeze({
  party: ["role", "biography", "history", "personality", "goals", "relationships"],
  person: ["role", "appearance", "personality"],
  place: ["region", "atmosphere", "features", "inhabitants"],
  city: ["overview", "districts", "government", "population"],
  item: ["category", "appearance", "effect", "location"],
  encounter: ["setup", "participants"],
  faction: ["objective", "resources", "allies"],
  post: ["summary", "content"]
});
const PUBLIC_PLACE_FACTION_FIELDS = Object.freeze(["leadership", "members", "goals", "influence", "relations"]);

function requireGameMaster() {
  if (!game.user?.isGM) throw new Error(game.i18n.localize("DMJ.Error.GMOnly"));
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeImage(value) {
  const image = String(value ?? "").trim();
  return IMAGE_PATTERN.test(image) ? image : "";
}

function publicArticleContent(data) {
  const fields = data.kind === "place" && data.placeType === "faction"
    ? PUBLIC_PLACE_FACTION_FIELDS
    : PUBLIC_FIELDS[data.kind] ?? [];
  const sections = fields.map((field) => {
    const html = sanitizeRichTextHTML(data[`${field}HTML`] ?? "");
    return html ? `<section data-dmj-public-field="${field}">${html}</section>` : "";
  }).join("");
  return `<article data-dmj-public-article data-kind="${escapeHTML(data.kind)}" data-place-type="${escapeHTML(data.placeType ?? "")}" data-image="${escapeHTML(safeImage(data.image))}"><h1>${escapeHTML(data.name)}</h1>${sections}</article>`;
}

function pageType(page) {
  return page?.getFlag(MODULE_ID, FLAGS.TYPE);
}

export class PlayerDiaryService {
  static getDiary() {
    return game.journal.find((entry) => entry.getFlag(MODULE_ID, FLAGS.TYPE) === DOCUMENT_TYPES.PLAYER_DIARY);
  }

  static getArticlePages(diary = this.getDiary()) {
    if (!diary) return [];
    return diary.pages
      .filter((page) => [DOCUMENT_TYPES.PLAYER_ARTICLE, DOCUMENT_TYPES.PLAYER_COMMERCE].includes(pageType(page)))
      .sort((a, b) => Number(b.getFlag(MODULE_ID, FLAGS.PUBLISHED_AT) ?? b.sort ?? 0) - Number(a.getFlag(MODULE_ID, FLAGS.PUBLISHED_AT) ?? a.sort ?? 0));
  }

  static getArticleData(page) {
    const document = new DOMParser().parseFromString(page?.text?.content ?? "", "text/html");
    const root = document.querySelector("[data-dmj-public-article], [data-dmj-public-commerce]");
    const legacyCommerce = root?.hasAttribute("data-dmj-public-commerce");
    const requestedKind = String(page?.getFlag(MODULE_ID, FLAGS.PLAYER_KIND) || root?.dataset.kind || "");
    const kind = RESOURCE_KINDS.includes(requestedKind) ? requestedKind : legacyCommerce ? "place" : "post";
    const fields = [...(root?.querySelectorAll("[data-dmj-public-field]") ?? [])].map((element) => ({
      id: String(element.dataset.dmjPublicField ?? ""),
      html: sanitizeRichTextHTML(element.innerHTML),
      text: String(element.textContent ?? "").replace(/\s+/g, " ").trim()
    })).filter((field) => field.id && field.html);
    const excerpt = fields.map((field) => field.text).find(Boolean) ?? "";
    return {
      id: page?.id ?? "",
      name: page?.name ?? "",
      kind,
      image: safeImage(root?.dataset.image),
      merchantUuid: String(page?.getFlag(MODULE_ID, FLAGS.MERCHANT_UUID) ?? ""),
      providerId: String(page?.getFlag(MODULE_ID, FLAGS.ITEM_PILES_PROVIDER) ?? ""),
      publishedAt: Number(page?.getFlag(MODULE_ID, FLAGS.PUBLISHED_AT) ?? 0),
      excerpt: excerpt.slice(0, 260),
      searchText: `${page?.name ?? ""} ${kind} ${fields.map((field) => field.text).join(" ")}`,
      fields
    };
  }

  static async getOrCreateDiary() {
    requireGameMaster();
    const existing = this.getDiary();
    if (existing) return existing;
    return JournalEntry.implementation.create({
      name: game.i18n.format("DMJ.PlayerDiary.Name", { world: game.world.title }),
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
      flags: { [MODULE_ID]: { [FLAGS.TYPE]: DOCUMENT_TYPES.PLAYER_DIARY } }
    });
  }

  static async syncResource(page, data, providerId = "") {
    requireGameMaster();
    const publication = data.publication ?? {};
    const publicPageId = String(publication.publicPageId ?? "");
    const existingDiary = this.getDiary();
    const sourcePage = existingDiary?.pages.find((entry) => entry.getFlag(MODULE_ID, FLAGS.SOURCE_RESOURCE_ID) === page.id);
    const existingPage = (publicPageId ? existingDiary?.pages.get(publicPageId) : null) ?? sourcePage;

    if (!publication.published) {
      if (existingPage) await existingDiary.deleteEmbeddedDocuments("JournalEntryPage", [existingPage.id]);
      return "";
    }

    const diary = existingDiary ?? await this.getOrCreateDiary();
    const target = publicPageId ? diary.pages.get(publicPageId) : null;
    const publishedAt = Number(target?.getFlag(MODULE_ID, FLAGS.PUBLISHED_AT) ?? Date.now());
    const merchantUuid = data.kind === "place" && data.placeType === "shop" ? String(data.commerce?.merchantUuid ?? "") : "";
    const content = publicArticleContent(data);
    const flags = {
      [MODULE_ID]: {
        [FLAGS.TYPE]: DOCUMENT_TYPES.PLAYER_ARTICLE,
        [FLAGS.PLAYER_KIND]: data.kind,
        [FLAGS.PUBLISHED_AT]: publishedAt,
        [FLAGS.SOURCE_RESOURCE_ID]: page.id,
        [FLAGS.MERCHANT_UUID]: merchantUuid,
        [FLAGS.ITEM_PILES_PROVIDER]: merchantUuid ? providerId : ""
      }
    };
    if (target) {
      await target.update({ name: data.name, "text.content": content, flags });
      return target.id;
    }

    const maxSort = Math.max(0, ...diary.pages.map((entry) => entry.sort ?? 0));
    const [created] = await diary.createEmbeddedDocuments("JournalEntryPage", [{
      name: data.name,
      type: "text",
      text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
      sort: maxSort + 100000,
      flags
    }]);
    return created.id;
  }

  static async unpublishResource(page) {
    requireGameMaster();
    const publicationPageId = String(page?.getFlag(MODULE_ID, FLAGS.PUBLICATION)?.publicPageId ?? "");
    const legacyPageId = String(page?.getFlag(MODULE_ID, FLAGS.COMMERCE)?.publicPageId ?? "");
    const publicPageId = publicationPageId || legacyPageId;
    const diary = this.getDiary();
    const target = (publicPageId ? diary?.pages.get(publicPageId) : null)
      ?? diary?.pages.find((entry) => entry.getFlag(MODULE_ID, FLAGS.SOURCE_RESOURCE_ID) === page?.id);
    if (target) await diary.deleteEmbeddedDocuments("JournalEntryPage", [target.id]);
  }
}
