export const MODULE_ID = "diario-do-mestre";
export const FLAGS = Object.freeze({
  TYPE: "type",
  CITY_MAP: "cityMap",
  COMMERCE: "commerce",
  PUBLICATION: "publication",
  MERCHANT_UUID: "merchantUuid",
  ITEM_PILES_PROVIDER: "itemPilesProvider",
  PLAYER_KIND: "playerKind",
  PUBLISHED_AT: "publishedAt",
  SOURCE_RESOURCE_ID: "sourceResourceId",
  LINKED_DOCUMENT_UUID: "linkedDocumentUuid"
});

export const SETTINGS = Object.freeze({
  SESSION_VIEW: "sessionView"
});

export const DOCUMENT_TYPES = Object.freeze({
  DIARY: "diary",
  SESSION: "session",
  RESOURCE: "resource",
  PLAYER_DIARY: "playerDiary",
  PLAYER_COMMERCE: "playerCommerce",
  PLAYER_ARTICLE: "playerArticle"
});

export const RESOURCE_KINDS = Object.freeze(["party", "person", "place", "city", "item", "encounter", "faction", "post"]);
