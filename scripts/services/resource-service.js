import { DOCUMENT_TYPES, FLAGS, MODULE_ID, RESOURCE_KINDS } from "../constants.js?v=1.12.2";
import { ItemPilesIntegration } from "../integrations/item-piles.js?v=1.12.2";
import { DiaryService } from "./diary-service.js";
import { PlayerDiaryService } from "./player-diary-service.js?v=1.12.2";
import { plainTextToRichHTML, richTextToPlainText, sanitizeRichTextHTML } from "../utils/rich-text.js";

const DOCUMENT_UUID_PATTERN = /^[A-Za-z0-9._-]{1,500}$/;
const IMAGE_FRAMING_DEFAULTS = Object.freeze({ imagePositionX: 50, imagePositionY: 50, imageZoom: 100 });
const CITY_MAP_DEFAULTS = Object.freeze({ image: "", zoom: 1, panX: 0, panY: 0, locations: [] });
const CITY_MAP_LOCATION_LIMIT = 250;
const CITY_MAP_LOCATION_SIZE_MIN = 0.6;
const CITY_MAP_LOCATION_SIZE_MAX = 2;
const documentImportPromises = new Map();

const KNOWN_PLACE_TYPES = Object.freeze([
  "generic",
  "shop",
  "building",
  "wilderness",
  "region",
  "district",
  "route",
  "ruin",
  "landmark",
  "faction"
]);
export const PLACE_TYPES = Object.freeze(["faction"]);

export const PLACE_LAYOUTS = Object.freeze([
  "editorial",
  "panorama",
  "compact",
  "sidebar"
]);

const PLACE_STANDARD_FIELDS = Object.freeze(["region", "atmosphere", "features", "inhabitants", "secrets"]);
const PLACE_FACTION_FIELDS = Object.freeze(["leadership", "members", "goals", "influence", "relations", "factionSecrets"]);

export const RESOURCE_FIELDS = Object.freeze({
  party: ["role", "biography", "history", "personality", "goals", "relationships"],
  person: ["role", "appearance", "personality", "motivation", "secrets"],
  place: [...PLACE_STANDARD_FIELDS, ...PLACE_FACTION_FIELDS],
  city: ["overview", "districts", "government", "population", "secrets"],
  item: ["category", "appearance", "effect", "location", "secrets"],
  encounter: ["setup", "participants", "challenge", "rewards", "consequences"],
  faction: ["objective", "resources", "allies", "enemies", "secrets"],
  post: ["summary", "content"]
});

export function getResourceFields(kind, placeType = "") {
  if (kind !== "place") return RESOURCE_FIELDS[kind] ?? [];
  return normalizePlaceType(placeType) === "faction" ? PLACE_FACTION_FIELDS : PLACE_STANDARD_FIELDS;
}

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

export function normalizePlaceType(value) {
  const placeType = String(value ?? "").trim();
  return KNOWN_PLACE_TYPES.includes(placeType) ? placeType : "faction";
}

export function normalizePlaceLayout(value) {
  const layout = String(value ?? "").trim();
  return PLACE_LAYOUTS.includes(layout) ? layout : "editorial";
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

function booleanValue(value) {
  return value === true || String(value ?? "").trim() === "true";
}

function normalizeDroppedDocument(document) {
  if (document?.documentName === "Token" && document.actor) return document.actor;
  return document;
}

function kindForDocument(document, preferredKind = "") {
  if (document.documentName === "Item") return "item";
  if (["party", "person"].includes(preferredKind)) return preferredKind;
  const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  if (Number(document.ownership?.default) >= ownerLevel) return "party";
  const hasPlayerOwner = Object.entries(document.ownership ?? {}).some(([userId, level]) => {
    if (userId === "default" || Number(level) < ownerLevel) return false;
    const user = game.users.get(userId);
    return Boolean(user && !user.isGM);
  });
  return hasPlayerOwner ? "party" : "person";
}

function normalizeCommerce(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const merchantUuid = String(source.merchantUuid ?? "").trim();
  return {
    merchantUuid: DOCUMENT_UUID_PATTERN.test(merchantUuid) ? merchantUuid : "",
    published: booleanValue(source.published),
    publicPageId: String(source.publicPageId ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64),
    providerId: ["item-piles", "item-piles-symbaroum"].includes(source.providerId) ? source.providerId : ""
  };
}

function normalizePublication(value = {}, legacyCommerce = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const legacy = legacyCommerce && typeof legacyCommerce === "object" && !Array.isArray(legacyCommerce) ? legacyCommerce : {};
  const published = Object.prototype.hasOwnProperty.call(source, "published") ? source.published : legacy.published;
  return {
    published: booleanValue(published),
    publicPageId: String(source.publicPageId || legacy.publicPageId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)
  };
}

function boundedFloat(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number * 1000) / 1000));
}

export function normalizeCityMap(value = {}) {
  let source = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      source = {};
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) source = {};
  const locations = Array.isArray(source.locations) ? source.locations : [];
  return {
    image: String(source.image ?? "").trim().slice(0, 2000),
    zoom: boundedFloat(source.zoom, 0.5, 3, CITY_MAP_DEFAULTS.zoom),
    panX: boundedFloat(source.panX, -5000, 5000, CITY_MAP_DEFAULTS.panX),
    panY: boundedFloat(source.panY, -5000, 5000, CITY_MAP_DEFAULTS.panY),
    locations: locations.slice(0, CITY_MAP_LOCATION_LIMIT).map((location, index) => {
      const rawId = String(location?.id ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
      const rawUuid = String(location?.uuid ?? "").trim();
      return {
        id: rawId || `location-${index + 1}`,
        uuid: DOCUMENT_UUID_PATTERN.test(rawUuid) ? rawUuid : "",
        name: cleanName(location?.name) || game.i18n.localize("DMJ.CityMap.UnnamedLocation"),
        x: boundedFloat(location?.x, 0, 100, 50),
        y: boundedFloat(location?.y, 0, 100, 50),
        size: boundedFloat(location?.size, CITY_MAP_LOCATION_SIZE_MIN, CITY_MAP_LOCATION_SIZE_MAX, 1),
        locked: booleanValue(location?.locked)
      };
    })
  };
}

function resourceContent(kind, data) {
  const framing = imageFraming(data);
  const placeType = kind === "place" ? normalizePlaceType(data.placeType) : "";
  const placeLayout = kind === "place" ? normalizePlaceLayout(data.layout) : "";
  const headerCollapsed = kind === "place" && booleanValue(data.headerCollapsed);
  const fields = RESOURCE_FIELDS[kind].map((field) => `<section data-dmj-resource-field="${field}"><h2>${game.i18n.localize(`DMJ.Resource.Field.${kind}.${field}`)}</h2><p>${fieldHTML(data, field)}</p></section>`).join("\n");
  return `<article data-dmj-resource data-kind="${kind}" data-place-type="${placeType}" data-place-layout="${placeLayout}" data-header-collapsed="${headerCollapsed}" data-image="${escapeHTML(data.image)}" data-image-position-x="${framing.imagePositionX}" data-image-position-y="${framing.imagePositionY}" data-image-zoom="${framing.imageZoom}" data-linked-uuid="${escapeHTML(data.linkedUuid)}"><h1>${escapeHTML(data.name)}</h1>${fields}<section data-dmj-resource-field="notes"><h2>${game.i18n.localize("DMJ.Resource.Notes")}</h2><p>${fieldHTML(data, "notes")}</p></section></article>`;
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
    const commerce = normalizeCommerce(kind === "place" ? page?.getFlag(MODULE_ID, FLAGS.COMMERCE) : {});
    const data = {
      name: page?.name ?? "",
      kind,
      image: "",
      ...IMAGE_FRAMING_DEFAULTS,
      linkedUuid: !["city", "place"].includes(kind) && DOCUMENT_UUID_PATTERN.test(String(page?.getFlag(MODULE_ID, FLAGS.LINKED_DOCUMENT_UUID) ?? ""))
        ? String(page.getFlag(MODULE_ID, FLAGS.LINKED_DOCUMENT_UUID))
        : "",
      isCity: kind === "city",
      isPlace: kind === "place",
      placeType: kind === "place" ? "faction" : "",
      layout: kind === "place" ? "editorial" : "",
      headerCollapsed: false,
      commerce,
      publication: normalizePublication(page?.getFlag(MODULE_ID, FLAGS.PUBLICATION), commerce),
      cityMap: normalizeCityMap(kind === "city" ? page?.getFlag(MODULE_ID, FLAGS.CITY_MAP) : {}),
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
    data.linkedUuid = ["city", "place"].includes(kind) ? "" : root.dataset.linkedUuid || data.linkedUuid;
    data.placeType = kind === "place" ? normalizePlaceType(root.dataset.placeType) : "";
    data.layout = kind === "place" ? normalizePlaceLayout(root.dataset.placeLayout) : "";
    data.headerCollapsed = kind === "place" && booleanValue(root.dataset.headerCollapsed);
    for (const field of [...RESOURCE_FIELDS[kind], "notes"]) {
      const content = root.querySelector(`[data-dmj-resource-field="${field}"] p`);
      if (!content) continue;
      const html = sanitizeRichTextHTML(content.innerHTML);
      data[`${field}HTML`] = html;
      data[field] = richTextToPlainText(html).trim();
    }
    return data;
  }

  static async createResource(kind, rawName, options = {}) {
    requireGameMaster();
    if (!RESOURCE_KINDS.includes(kind)) throw new Error(game.i18n.localize("DMJ.Resource.Error.Kind"));
    const name = cleanName(rawName);
    if (!name) throw new Error(game.i18n.localize("DMJ.Resource.Error.Name"));
    const diary = await DiaryService.getOrCreateDiary();
    const linkedUuid = DOCUMENT_UUID_PATTERN.test(String(options.linkedUuid ?? "").trim()) ? String(options.linkedUuid).trim() : "";
    const commerce = normalizeCommerce(kind === "place" ? options.commerce : {});
    const publication = normalizePublication(options.publication, commerce);
    const data = { name, image: String(options.image ?? "").trim().slice(0, 2000), ...IMAGE_FRAMING_DEFAULTS, linkedUuid, placeType: kind === "place" ? normalizePlaceType(options.placeType ?? "faction") : "", layout: kind === "place" ? normalizePlaceLayout(options.layout) : "", headerCollapsed: false, commerce, publication, notes: "", notesHTML: "", ...Object.fromEntries(RESOURCE_FIELDS[kind].flatMap((field) => [[field, ""], [`${field}HTML`, ""]])) };
    const maxSort = Math.max(0, ...diary.pages.map((page) => page.sort ?? 0));
    const moduleFlags = { [FLAGS.TYPE]: DOCUMENT_TYPES.RESOURCE, kind };
    if (kind === "city") moduleFlags[FLAGS.CITY_MAP] = normalizeCityMap();
    if (kind === "place") moduleFlags[FLAGS.COMMERCE] = commerce;
    if (linkedUuid) moduleFlags[FLAGS.LINKED_DOCUMENT_UUID] = linkedUuid;
    moduleFlags[FLAGS.PUBLICATION] = publication;
    const [page] = await diary.createEmbeddedDocuments("JournalEntryPage", [{
      name,
      type: "text",
      text: { content: resourceContent(kind, data), format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
      sort: maxSort + 100000,
      flags: { [MODULE_ID]: moduleFlags }
    }]);
    return page;
  }

  static async createMerchantResource(rawName) {
    requireGameMaster();
    const name = cleanName(rawName);
    if (!name) throw new Error(game.i18n.localize("DMJ.Resource.Error.Name"));
    const { actor, providerId } = await ItemPilesIntegration.createMerchantActor(name);
    try {
      return await this.createResource("place", name, {
        image: actor.img,
        placeType: "shop",
        commerce: { merchantUuid: actor.uuid, providerId }
      });
    } catch (error) {
      try {
        await actor.delete();
      } catch (rollbackError) {
        console.warn(`${MODULE_ID} | Não foi possível desfazer a criação do comerciante.`, rollbackError);
      }
      throw error;
    }
  }

  static async resolveDroppedDocument(rawData) {
    let data = rawData;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        throw new Error(game.i18n.localize("DMJ.Resource.DropWorldInvalid"));
      }
    }
    const uuid = String(data?.uuid ?? (data?.type && data?.id ? `${data.type}.${data.id}` : "")).trim();
    if (!DOCUMENT_UUID_PATTERN.test(uuid)) throw new Error(game.i18n.localize("DMJ.Resource.DropWorldInvalid"));
    let document;
    try {
      document = normalizeDroppedDocument(await fromUuid(uuid));
    } catch {
      document = null;
    }
    if (!document || !["Actor", "Item"].includes(document.documentName)) {
      throw new Error(game.i18n.localize("DMJ.Resource.DropWorldInvalid"));
    }
    return document;
  }

  static async setPublished(page, published) {
    requireGameMaster();
    const data = this.getData(page);
    data.publication.published = Boolean(published);
    const publicPageId = await PlayerDiaryService.syncResource(page, data, data.commerce.providerId);
    data.publication.publicPageId = publicPageId;
    const patch = { [`flags.${MODULE_ID}.${FLAGS.PUBLICATION}`]: data.publication };
    if (data.kind === "place") {
      data.commerce.published = data.publication.published;
      data.commerce.publicPageId = publicPageId;
      patch[`flags.${MODULE_ID}.${FLAGS.COMMERCE}`] = data.commerce;
    }
    await page.update(patch);
    return page;
  }

  static async createFromDocument(rawDocument, { publish = false, preferredKind = "" } = {}) {
    requireGameMaster();
    const document = normalizeDroppedDocument(rawDocument);
    if (!document || !["Actor", "Item"].includes(document.documentName) || !DOCUMENT_UUID_PATTERN.test(String(document.uuid ?? ""))) {
      throw new Error(game.i18n.localize("DMJ.Resource.DropWorldInvalid"));
    }
    const pending = documentImportPromises.get(document.uuid);
    if (pending) {
      const result = await pending;
      if (publish) await this.setPublished(result.page, true);
      return { page: result.page, created: false };
    }

    const importTask = (async () => {
      const existing = this.getResources().find((page) => page.getFlag(MODULE_ID, FLAGS.LINKED_DOCUMENT_UUID) === document.uuid || this.getData(page).linkedUuid === document.uuid);
      if (existing) {
        if (publish) await this.setPublished(existing, true);
        return { page: existing, created: false };
      }

      const kind = kindForDocument(document, preferredKind);
      const page = await this.createResource(kind, document.name, {
        image: document.img,
        linkedUuid: document.uuid
      });
      if (publish) await this.setPublished(page, true);
      return { page, created: true };
    })();
    documentImportPromises.set(document.uuid, importTask);
    try {
      return await importTask;
    } finally {
      if (documentImportPromises.get(document.uuid) === importTask) documentImportPromises.delete(document.uuid);
    }
  }

  static async createFromDropData(rawData, options = {}) {
    const document = await this.resolveDroppedDocument(rawData);
    return this.createFromDocument(document, options);
  }

  static async deleteResource(page) {
    requireGameMaster();
    const diary = DiaryService.getDiary();
    if (!diary || !page || page.parent?.id !== diary.id || !diary.pages.has(page.id) || page.getFlag(MODULE_ID, FLAGS.TYPE) !== DOCUMENT_TYPES.RESOURCE) {
      throw new Error(game.i18n.localize("DMJ.Resource.Error.Invalid"));
    }

    await PlayerDiaryService.unpublishResource(page);
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
    const currentData = this.getData(page);
    const richFields = Object.fromEntries([...RESOURCE_FIELDS[kind], "notes"].flatMap((field) => {
      const html = formData.has(field)
        ? sanitizeRichTextHTML(formData.get(field))
        : sanitizeRichTextHTML(currentData[`${field}HTML`] ?? plainTextToRichHTML(currentData[field]));
      return [[field, richTextToPlainText(html).trim()], [`${field}HTML`, html]];
    }));
    const currentCommerce = normalizeCommerce(page.getFlag(MODULE_ID, FLAGS.COMMERCE));
    const currentPublication = normalizePublication(page.getFlag(MODULE_ID, FLAGS.PUBLICATION), currentCommerce);
    const providerStatus = ItemPilesIntegration.getStatus();
    const data = {
      name,
      image: String(formData.get("image") ?? "").trim().slice(0, 2000),
      ...imageFraming({
        imagePositionX: formData.get("imagePositionX"),
        imagePositionY: formData.get("imagePositionY"),
        imageZoom: formData.get("imageZoom")
      }),
      linkedUuid: !["city", "place"].includes(kind) && DOCUMENT_UUID_PATTERN.test(String(formData.get("linkedUuid") ?? "").trim())
        ? String(formData.get("linkedUuid") ?? "").trim()
        : "",
      placeType: kind === "place" ? normalizePlaceType(formData.get("placeType")) : "",
      layout: kind === "place" ? normalizePlaceLayout(formData.get("layout")) : "",
      headerCollapsed: kind === "place" && booleanValue(formData.get("headerCollapsed")),
      commerce: kind === "place" ? normalizeCommerce({
        merchantUuid: formData.has("commerceMerchantUuid") ? formData.get("commerceMerchantUuid") : currentCommerce.merchantUuid,
        published: formData.has("publicationPublished"),
        publicPageId: currentCommerce.publicPageId,
        providerId: providerStatus.available ? providerStatus.providerId : currentCommerce.providerId
      }) : normalizeCommerce(),
      publication: normalizePublication({
        published: formData.has("publicationPublished"),
        publicPageId: currentPublication.publicPageId
      }),
      ...richFields
    };
    const patch = { name, "text.content": resourceContent(kind, data) };
    if (kind === "city") {
      patch[`flags.${MODULE_ID}.${FLAGS.CITY_MAP}`] = normalizeCityMap(formData.has("cityMap") ? formData.get("cityMap") : page.getFlag(MODULE_ID, FLAGS.CITY_MAP));
    }
    if (kind === "place") patch[`flags.${MODULE_ID}.${FLAGS.COMMERCE}`] = data.commerce;
    patch[`flags.${MODULE_ID}.${FLAGS.LINKED_DOCUMENT_UUID}`] = data.linkedUuid;
    patch[`flags.${MODULE_ID}.${FLAGS.PUBLICATION}`] = data.publication;
    await page.update(patch);
    const publicPageId = await PlayerDiaryService.syncResource(page, data, data.commerce.providerId);
    if (publicPageId !== data.publication.publicPageId) {
      data.publication.publicPageId = publicPageId;
      const publicationPatch = { [`flags.${MODULE_ID}.${FLAGS.PUBLICATION}`]: data.publication };
      if (kind === "place") {
        data.commerce.publicPageId = publicPageId;
        data.commerce.published = data.publication.published;
        publicationPatch[`flags.${MODULE_ID}.${FLAGS.COMMERCE}`] = data.commerce;
      }
      await page.update(publicationPatch);
    }
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
