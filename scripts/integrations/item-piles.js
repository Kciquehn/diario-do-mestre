import { MODULE_ID } from "../constants.js";

const PROVIDERS = Object.freeze([
  { id: "item-piles", readyHook: "item-piles-ready" },
  { id: "item-piles-symbaroum", readyHook: "item-piles-symbaroum-ready" }
]);
const MERCHANT_FOLDER_FLAG = "merchantActorFolder";

const REQUIRED_API_METHODS = Object.freeze([
  "createItemPile",
  "getActorItems",
  "isItemPileMerchant",
  "getActorFlagData",
  "getItemQuantity",
  "getPricesForItem",
  "tradeItems",
  "renderItemPileInterface"
]);

function positiveInteger(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : fallback;
}

function purchaseUnitsAvailable(api, actorData, item, itemData) {
  const infiniteQuantity = {
    default: Boolean(actorData.infiniteQuantity),
    yes: true,
    no: false
  }[String(itemData.infiniteQuantity ?? "default")] ?? Boolean(actorData.infiniteQuantity);
  if (infiniteQuantity) return Infinity;
  const quantity = Math.max(0, Number(api.getItemQuantity(item)) || 0);
  const quantityPath = String(api.QUANTITY_FOR_PRICE_ATTRIBUTE ?? "");
  const quantityForPrice = quantityPath
    ? positiveInteger(foundry.utils.getProperty(item, quantityPath))
    : 1;
  return Math.ceil(quantity / quantityForPrice);
}

function normalizeMaximum(value, fallback = Infinity) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function activeProviders() {
  return PROVIDERS.filter(({ id }) => game.modules.get(id)?.active);
}

function currentNamespaceProvider() {
  return String(game.itempiles?.CONSTANTS?.MODULE_NAME ?? "");
}

function hasCompatibleAPI(api) {
  return Boolean(api) && REQUIRED_API_METHODS.every((method) => typeof api[method] === "function");
}

function providerLabel(id) {
  return game.modules.get(id)?.title ?? id;
}

async function getOrCreateMerchantFolder() {
  const folderName = game.i18n.localize("DMJ.ItemPiles.MerchantFolder");
  const existing = game.folders.find((folder) => folder.type === "Actor" && (
    folder.getFlag(MODULE_ID, MERCHANT_FOLDER_FLAG) === true
    || (!folder.folder && folder.name === folderName)
  ));
  if (existing) return existing;
  return foundry.documents.Folder.implementation.create({
    name: folderName,
    type: "Actor",
    flags: { [MODULE_ID]: { [MERCHANT_FOLDER_FLAG]: true } }
  });
}

export class ItemPilesIntegration {
  static get providerDefinitions() {
    return PROVIDERS;
  }

  static getStatus() {
    const active = activeProviders();
    if (active.length > 1) {
      return {
        available: false,
        conflict: true,
        providerId: "",
        providerLabel: "",
        reason: "conflict"
      };
    }
    if (!active.length) {
      return {
        available: false,
        conflict: false,
        providerId: "",
        providerLabel: "",
        reason: "inactive"
      };
    }

    const provider = active[0];
    const namespaceProvider = currentNamespaceProvider();
    const api = game.itempiles?.API;
    if (namespaceProvider !== provider.id || !hasCompatibleAPI(api)) {
      return {
        available: false,
        conflict: false,
        providerId: provider.id,
        providerLabel: providerLabel(provider.id),
        reason: "loading"
      };
    }

    return {
      available: true,
      conflict: false,
      providerId: provider.id,
      providerLabel: providerLabel(provider.id),
      reason: "ready",
      api
    };
  }

  static getMerchants() {
    const status = this.getStatus();
    if (!status.available) return [];
    return game.actors
      .filter((actor) => {
        try {
          return status.api.isItemPileMerchant(actor);
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  }

  static async createMerchantActor(name) {
    const status = this.getStatus();
    if (!status.available) {
      const key = status.conflict ? "DMJ.ItemPiles.Error.Conflict" : "DMJ.ItemPiles.Error.Unavailable";
      throw new Error(game.i18n.localize(key));
    }
    const folder = await getOrCreateMerchantFolder();
    if (!folder?.id) throw new Error(game.i18n.localize("DMJ.ItemPiles.Error.MerchantCreate"));
    const result = await status.api.createItemPile({
      sceneId: String(game.user?.viewedScene ?? ""),
      actor: String(name ?? "").trim(),
      createActor: true,
      itemPileFlags: { type: "merchant" }
    });
    const uuid = String(result?.actorUuid ?? "");
    const actor = uuid ? await fromUuid(uuid) : null;
    let isMerchant = false;
    if (actor?.documentName === "Actor") {
      try {
        isMerchant = Boolean(status.api.isItemPileMerchant(actor));
      } catch {
        isMerchant = false;
      }
    }
    if (!actor || actor.documentName !== "Actor" || !isMerchant) {
      if (actor?.documentName === "Actor") {
        try {
          await actor.delete();
        } catch (error) {
          console.warn("Diário do Mestre | Não foi possível remover o Actor incompleto do Item Piles.", error);
        }
      }
      throw new Error(game.i18n.localize("DMJ.ItemPiles.Error.MerchantCreate"));
    }
    try {
      await actor.update({ folder: folder.id });
    } catch (error) {
      try {
        await actor.delete();
      } catch (rollbackError) {
        console.warn("Diário do Mestre | Não foi possível remover o comerciante após a falha ao organizá-lo.", rollbackError);
      }
      throw error;
    }
    return { actor, providerId: status.providerId };
  }

  static async getMerchant(uuid) {
    const status = this.getStatus();
    if (!status.available || !uuid) return null;
    try {
      const document = await fromUuid(uuid);
      const actor = document?.documentName === "Token" ? document.actor : document;
      if (actor?.documentName !== "Actor" || !status.api.isItemPileMerchant(actor)) return null;
      return actor;
    } catch {
      return null;
    }
  }

  static async getMerchantSummary(uuid) {
    const status = this.getStatus();
    const actor = await this.getMerchant(uuid);
    if (!status.available || !actor) return { available: false, status };
    let data = {};
    try {
      data = status.api.getActorFlagData(actor) ?? {};
    } catch {
      data = {};
    }
    let closed = false;
    try {
      closed = typeof status.api.isItemPileClosed === "function"
        ? Boolean(status.api.isItemPileClosed(actor, data))
        : Boolean(data.closed);
    } catch {
      closed = Boolean(data.closed);
    }
    return {
      available: true,
      actor,
      name: actor.name,
      image: String(data.merchantImage || actor.img || ""),
      closed,
      status
    };
  }

  static async getMerchantCatalog(uuid, buyer = game.user?.character ?? null) {
    const summary = await this.getMerchantSummary(uuid);
    if (!summary.available) return { ...summary, buyer: null, items: [] };
    const { actor, status } = summary;
    const validBuyer = buyer?.documentName === "Actor" && (game.user?.isGM || buyer.isOwner)
      ? buyer
      : null;
    const actorData = status.api.getActorFlagData(actor) ?? {};
    const actorItems = status.api.getActorItems(actor) ?? [];
    const items = [];

    for (const item of actorItems) {
      const itemData = item.getFlag(status.providerId, "item") ?? {};
      if (itemData.hidden) continue;
      const stock = purchaseUnitsAvailable(status.api, actorData, item, itemData);
      if (stock <= 0) continue;
      let priceData = [];
      try {
        priceData = status.api.getPricesForItem(item, {
          seller: actor,
          buyer: validBuyer || false,
          quantity: 1
        }) ?? [];
      } catch (error) {
        console.warn(`Diário do Mestre | Não foi possível calcular o preço de "${item.name}".`, error);
      }
      const prices = priceData.map((price, paymentIndex) => {
        const affordable = validBuyer
          ? normalizeMaximum(price.maxQuantity, Infinity)
          : Infinity;
        const maxQuantity = Math.min(stock, affordable);
        return {
          paymentIndex,
          label: price.free
            ? game.i18n.localize("DMJ.PlayerDiary.Commerce.Free")
            : String(price.basePriceString || price.priceString || "").trim(),
          maxQuantity,
          maximum: Number.isFinite(maxQuantity) ? maxQuantity : "",
          purchasable: Boolean(validBuyer && maxQuantity > 0)
        };
      });
      const firstPurchasable = prices.find((price) => price.purchasable) ?? prices[0] ?? null;
      if (firstPurchasable) firstPurchasable.selected = true;
      const maxPurchase = firstPurchasable?.maxQuantity ?? 0;
      items.push({
        id: item.id,
        name: item.name,
        image: String(item.img || "icons/svg/item-bag.svg"),
        type: item.type,
        stock: Number.isFinite(stock) ? stock : "",
        showStock: Number.isFinite(stock),
        prices,
        hasMultiplePrices: prices.length > 1,
        priceLabel: firstPurchasable?.label || game.i18n.localize("DMJ.PlayerDiary.Commerce.PriceUnavailable"),
        canBuy: Boolean(!summary.closed && firstPurchasable?.purchasable),
        maximum: Number.isFinite(maxPurchase) ? maxPurchase : ""
      });
    }

    items.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    return {
      ...summary,
      buyer: validBuyer,
      buyerName: validBuyer?.name ?? "",
      canPurchase: Boolean(validBuyer && !summary.closed),
      items
    };
  }

  static async purchaseItem(uuid, itemId, { quantity = 1, paymentIndex = 0 } = {}) {
    const status = this.getStatus();
    if (!status.available) {
      const key = status.conflict ? "DMJ.ItemPiles.Error.Conflict" : "DMJ.ItemPiles.Error.Unavailable";
      throw new Error(game.i18n.localize(key));
    }
    const actor = await this.getMerchant(uuid);
    if (!actor) throw new Error(game.i18n.localize("DMJ.ItemPiles.Error.MerchantMissing"));
    const buyer = game.user?.character;
    if (buyer?.documentName !== "Actor" || (!game.user?.isGM && !buyer.isOwner)) {
      throw new Error(game.i18n.localize("DMJ.ItemPiles.Error.CharacterRequired"));
    }
    const actorData = status.api.getActorFlagData(actor) ?? {};
    const closed = typeof status.api.isItemPileClosed === "function"
      ? Boolean(status.api.isItemPileClosed(actor, actorData))
      : Boolean(actorData.closed);
    if (closed) throw new Error(game.i18n.localize("DMJ.ItemPiles.Error.MerchantClosed"));
    const item = actor.items.get(String(itemId ?? ""));
    const itemData = item?.getFlag(status.providerId, "item") ?? {};
    if (!item || itemData.hidden || !status.api.getActorItems(actor).some((candidate) => candidate.id === item.id)) {
      throw new Error(game.i18n.localize("DMJ.ItemPiles.Error.ItemMissing"));
    }
    const requestedQuantity = positiveInteger(quantity);
    const requestedPayment = Math.max(0, Math.floor(Number(paymentIndex) || 0));
    const stock = purchaseUnitsAvailable(status.api, actorData, item, itemData);
    const prices = status.api.getPricesForItem(item, { seller: actor, buyer, quantity: 1 }) ?? [];
    const selectedPrice = prices[requestedPayment];
    const affordable = selectedPrice ? normalizeMaximum(selectedPrice.maxQuantity, Infinity) : 0;
    if (!selectedPrice || requestedQuantity > Math.min(stock, affordable)) {
      throw new Error(game.i18n.localize("DMJ.ItemPiles.Error.CannotBuy"));
    }
    const result = await status.api.tradeItems(actor, buyer, [{
      item,
      quantity: requestedQuantity,
      paymentIndex: requestedPayment
    }]);
    if (!result) throw new Error(game.i18n.localize("DMJ.ItemPiles.Error.PurchaseFailed"));
    return { result, actor, buyer, item, quantity: requestedQuantity };
  }

  static async openMerchant(uuid) {
    const status = this.getStatus();
    if (!status.available) {
      const key = status.conflict ? "DMJ.ItemPiles.Error.Conflict" : "DMJ.ItemPiles.Error.Unavailable";
      throw new Error(game.i18n.localize(key));
    }
    const actor = await this.getMerchant(uuid);
    if (!actor) throw new Error(game.i18n.localize("DMJ.ItemPiles.Error.MerchantMissing"));
    if (!game.user.isGM && !game.user.character) {
      throw new Error(game.i18n.localize("DMJ.ItemPiles.Error.CharacterRequired"));
    }
    return status.api.renderItemPileInterface(actor, { useDefaultCharacter: true });
  }
}
