import { MODULE_ID, RESOURCE_KINDS } from "../constants.js";
import { ItemPilesIntegration } from "../integrations/item-piles.js?v=1.11.0";
import { PlayerDiaryService } from "../services/player-diary-service.js?v=1.11.0";
import { ResourceService } from "../services/resource-service.js?v=1.11.0";
import { getElementWindow } from "../compat/popout.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const KIND_ICONS = Object.freeze({
  party: "fa-users",
  person: "fa-user",
  place: "fa-location-dot",
  city: "fa-city",
  item: "fa-gem",
  encounter: "fa-skull-crossbones",
  faction: "fa-people-group",
  post: "fa-newspaper",
  commerce: "fa-store"
});

function normalizeSearch(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(game.i18n.lang).trim();
}

export class PlayerDiary extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.filterKind = "all";
    this.searchQuery = "";
    this.activeArticleId = "";
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-player-diary`,
    classes: [MODULE_ID, "player-diary"],
    tag: "section",
    window: {
      title: "DMJ.PlayerDiary.Title",
      icon: "fa-solid fa-compass",
      resizable: true
    },
    position: { width: 1040, height: 760 }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/player-diary.hbs` }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const status = ItemPilesIntegration.getStatus();
    const commerceFeatureActive = status.available;
    const articles = await Promise.all(PlayerDiaryService.getArticlePages().map(async (page) => {
      const data = PlayerDiaryService.getArticleData(page);
      const merchant = commerceFeatureActive && data.merchantUuid
        ? await ItemPilesIntegration.getMerchantSummary(data.merchantUuid)
        : { available: false };
      const fields = data.fields.map((field) => ({
        ...field,
        label: game.i18n.localize(`DMJ.Resource.Field.${data.kind}.${field.id}`)
      }));
      const isCommerce = Boolean(commerceFeatureActive && data.merchantUuid);
      return {
        ...data,
        fields,
        icon: KIND_ICONS[isCommerce ? "commerce" : data.kind] ?? "fa-bookmark",
        kindLabel: game.i18n.localize(`DMJ.Resource.Kind.${data.kind}`),
        image: data.image || merchant.image || "",
        isCommerce,
        commerceAvailable: isCommerce && merchant.available,
        commerceClosed: isCommerce && merchant.available && merchant.closed,
        commerceStatus: isCommerce
          ? game.i18n.localize(merchant.available
            ? merchant.closed ? "DMJ.PlayerDiary.Commerce.Closed" : "DMJ.PlayerDiary.Commerce.Open"
            : "DMJ.PlayerDiary.Commerce.Unavailable")
          : "",
        publishedLabel: data.publishedAt
          ? new Intl.DateTimeFormat(game.i18n.lang, { dateStyle: "medium" }).format(new Date(data.publishedAt))
          : "",
        filterValues: `${data.kind}${isCommerce ? " commerce" : ""}`,
        normalizedSearch: normalizeSearch(data.searchText)
      };
    }));
    if (commerceFeatureActive) {
      const publishedMerchants = new Set(articles.filter((article) => article.isCommerce).map((article) => article.merchantUuid));
      const providerMerchants = await Promise.all(ItemPilesIntegration.getMerchants()
        .filter((actor) => !publishedMerchants.has(actor.uuid))
        .map((actor) => ItemPilesIntegration.getMerchantSummary(actor.uuid)));
      for (const merchant of providerMerchants.filter((entry) => entry.available)) {
        const commerceStatus = game.i18n.localize(merchant.closed
          ? "DMJ.PlayerDiary.Commerce.Closed"
          : "DMJ.PlayerDiary.Commerce.Open");
        articles.push({
          id: `item-piles-${merchant.actor.id}`,
          name: merchant.name,
          fields: [],
          icon: KIND_ICONS.commerce,
          kind: "commerce",
          kindLabel: game.i18n.localize("DMJ.PlayerDiary.Commerce.Kind"),
          image: merchant.image,
          excerpt: commerceStatus,
          isCommerce: true,
          commerceAvailable: true,
          commerceClosed: merchant.closed,
          commerceStatus,
          merchantUuid: merchant.actor.uuid,
          publishedLabel: "",
          filterValues: "commerce",
          normalizedSearch: normalizeSearch(`${merchant.name} ${commerceStatus}`)
        });
      }
    }
    const categoryData = [
      {
        id: "party",
        icon: KIND_ICONS.party,
        label: game.i18n.localize("DMJ.PlayerDiary.Nav.Group"),
        heading: game.i18n.localize("DMJ.PlayerDiary.Nav.Group"),
        count: articles.filter((article) => article.kind === "party").length
      },
      {
        id: "all",
        icon: "fa-house",
        label: game.i18n.localize("DMJ.PlayerDiary.Nav.Feed"),
        heading: game.i18n.localize("DMJ.PlayerDiary.Feed.Title"),
        count: articles.length
      },
      ...RESOURCE_KINDS.filter((kind) => kind !== "party").map((kind) => ({
        id: kind,
        icon: KIND_ICONS[kind],
        label: game.i18n.localize(`DMJ.Resource.Kind.${kind}`),
        heading: game.i18n.localize(`DMJ.Resource.Kind.${kind}`),
        count: articles.filter((article) => article.kind === kind).length
      })),
      {
        id: "commerce",
        icon: KIND_ICONS.commerce,
        label: game.i18n.localize("DMJ.PlayerDiary.Commerce.Title"),
        heading: game.i18n.localize("DMJ.PlayerDiary.Commerce.Title"),
        count: articles.filter((article) => article.isCommerce).length
      }
    ].filter((category) => ["party", "all"].includes(category.id)
      || (category.id === "commerce" && commerceFeatureActive)
      || category.count > 0);
    if (!categoryData.some((category) => category.id === this.filterKind)) this.filterKind = "all";
    const categories = categoryData.map((category) => ({
      ...category,
      active: category.id === this.filterKind
    }));
    const activeArticle = articles.find((article) => article.id === this.activeArticleId) ?? null;
    if (this.activeArticleId && !activeArticle) this.activeArticleId = "";
    if (activeArticle?.isCommerce && activeArticle.commerceAvailable) {
      const catalog = await ItemPilesIntegration.getMerchantCatalog(activeArticle.merchantUuid);
      Object.assign(activeArticle, {
        commerceItems: catalog.items,
        commerceEmpty: catalog.items.length === 0,
        commerceCanPurchase: catalog.canPurchase,
        commerceBuyerName: catalog.buyerName,
        commerceNeedsCharacter: !catalog.buyer
      });
    }
    return {
      ...context,
      worldTitle: game.world.title,
      articles,
      categories,
      articleCount: articles.length,
      personCount: articles.filter((article) => ["party", "person"].includes(article.kind)).length,
      placeCount: articles.filter((article) => ["place", "city"].includes(article.kind)).length,
      searchQuery: this.searchQuery,
      activeArticle,
      showDetail: Boolean(activeArticle),
      empty: articles.length === 0,
      canManage: Boolean(game.user?.isGM),
      integrationConflict: status.conflict
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#bindListeners(this.element);
    this.#applyFilters();
  }

  onPopoutLoaded(node) {
    this.#bindListeners(node);
    this.#applyFilters(node);
  }

  #bindListeners(root) {
    this.listenerController?.abort();
    this.listenerController = new (getElementWindow(root).AbortController)();
    const signal = this.listenerController.signal;
    root.addEventListener("input", (event) => {
      if (!event.target.matches("[data-player-search]")) return;
      this.searchQuery = event.target.value;
      this.#applyFilters(root);
    }, { signal });
    root.addEventListener("change", (event) => {
      const selector = event.target.closest("[data-commerce-price]");
      if (!selector) return;
      const item = selector.closest("[data-commerce-item]");
      const quantity = item?.querySelector("[data-commerce-quantity]");
      const maximum = selector.selectedOptions[0]?.dataset.maximum ?? "";
      if (!quantity) return;
      quantity.max = maximum;
      if (maximum && Number(quantity.value) > Number(maximum)) quantity.value = maximum;
    }, { signal });
    root.addEventListener("click", (event) => {
      const filter = event.target.closest("[data-player-filter]");
      if (filter) {
        this.filterKind = filter.dataset.playerFilter;
        this.#applyFilters(root);
        return;
      }
      const article = event.target.closest("[data-action='open-player-article']");
      if (article) {
        this.activeArticleId = article.dataset.articleId;
        void this.render({ force: true });
        return;
      }
      if (event.target.closest("[data-action='close-player-article']")) {
        this.activeArticleId = "";
        void this.render({ force: true });
        return;
      }
      const purchase = event.target.closest("[data-action='purchase-commerce-item']");
      if (purchase) {
        void this.#purchaseCommerceItem(purchase);
        return;
      }
      const commerce = event.target.closest("[data-action='open-commerce']");
      if (!commerce) return;
      void ItemPilesIntegration.openMerchant(commerce.dataset.merchantUuid).catch((error) => {
        ui.notifications.warn(error?.message || game.i18n.localize("DMJ.ItemPiles.Error.Unavailable"));
      });
    }, { signal });
    root.addEventListener("dragover", (event) => this.#onDragOver(event, root), { signal });
    root.addEventListener("dragleave", (event) => this.#onDragLeave(event, root), { signal });
    root.addEventListener("drop", (event) => void this.#onDrop(event, root), { signal });
  }

  async #purchaseCommerceItem(button) {
    if (this.purchaseInProgress) return;
    const item = button.closest("[data-commerce-item]");
    const quantity = item?.querySelector("[data-commerce-quantity]")?.value ?? 1;
    const paymentIndex = item?.querySelector("[data-commerce-price]")?.value ?? 0;
    this.purchaseInProgress = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      const purchase = await ItemPilesIntegration.purchaseItem(button.dataset.merchantUuid, button.dataset.itemId, {
        quantity,
        paymentIndex
      });
      ui.notifications.info(game.i18n.format("DMJ.PlayerDiary.Commerce.Purchased", {
        quantity: purchase.quantity,
        item: purchase.item.name,
        character: purchase.buyer.name
      }));
      await this.render({ force: true });
    } catch (error) {
      ui.notifications.warn(error?.message || game.i18n.localize("DMJ.ItemPiles.Error.PurchaseFailed"));
    } finally {
      this.purchaseInProgress = false;
      if (button.isConnected) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    }
  }

  #dropTarget(root) {
    return root.querySelector?.(".dmj-player-social") ?? root;
  }

  #onDragOver(event, root) {
    if (!game.user?.isGM) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    this.#dropTarget(root).classList.add("dmj-drop-target");
  }

  #onDragLeave(event, root) {
    const target = this.#dropTarget(root);
    if (event.relatedTarget?.nodeType && target.contains(event.relatedTarget)) return;
    target.classList.remove("dmj-drop-target");
  }

  async #onDrop(event, root) {
    if (!game.user?.isGM || this.importingDocument) return;
    event.preventDefault();
    event.stopPropagation();
    this.#dropTarget(root).classList.remove("dmj-drop-target");
    this.importingDocument = true;
    try {
      const result = await ResourceService.createFromDropData(event.dataTransfer?.getData("text/plain") ?? "", {
        publish: true,
        preferredKind: ["party", "person"].includes(this.filterKind) ? this.filterKind : ""
      });
      const data = ResourceService.getData(result.page);
      this.filterKind = data.kind;
      this.activeArticleId = data.publication.publicPageId;
      const message = result.created ? "DMJ.PlayerDiary.DropWorldCreated" : "DMJ.PlayerDiary.DropWorldExisting";
      ui.notifications.info(game.i18n.format(message, { name: result.page.name }));
      await this.render({ force: true });
    } catch (error) {
      ui.notifications.warn(error?.message || game.i18n.localize("DMJ.Resource.DropWorldInvalid"));
    } finally {
      this.importingDocument = false;
    }
  }

  #applyFilters(root = this.element) {
    const query = normalizeSearch(this.searchQuery);
    for (const button of root.querySelectorAll("[data-player-filter]")) {
      const active = button.dataset.playerFilter === this.filterKind;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    const activeButton = root.querySelector(`[data-player-filter="${this.filterKind}"]`);
    const sectionTitle = root.querySelector("[data-player-section-title]");
    if (sectionTitle && activeButton?.dataset.playerFilterTitle) sectionTitle.textContent = activeButton.dataset.playerFilterTitle;
    let visible = 0;
    for (const card of root.querySelectorAll("[data-player-article]")) {
      const kinds = String(card.dataset.filterValues ?? "").split(/\s+/);
      const matchesKind = this.filterKind === "all" || kinds.includes(this.filterKind);
      const matchesSearch = !query || String(card.dataset.search ?? "").includes(query);
      card.hidden = !(matchesKind && matchesSearch);
      if (!card.hidden) visible += 1;
    }
    const empty = root.querySelector("[data-player-filter-empty]");
    if (empty) empty.hidden = visible > 0;
  }

  _onClose(options) {
    this.listenerController?.abort();
    super._onClose(options);
  }
}
