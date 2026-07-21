import { MODULE_ID, RESOURCE_KINDS, SETTINGS } from "../constants.js";
import { DiaryService } from "../services/diary-service.js";
import { ResourceService } from "../services/resource-service.js?v=1.4.7";
import { ResourceEditor } from "./resource-editor.js?v=1.4.7";
import { SessionBoard } from "./session-board.js";
import { getElementDocument, getElementWindow, isPopoutAvailable, popoutApplication } from "../compat/popout.js";

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;

const DASHBOARD_TABS = Object.freeze(["sessions", "library"]);
const SESSION_VIEW_MODES = Object.freeze(["cards", "list"]);
const KIND_ICONS = Object.freeze({
  person: "fa-user",
  place: "fa-location-dot",
  city: "fa-city",
  item: "fa-gem",
  encounter: "fa-skull-crossbones",
  faction: "fa-people-group"
});

function normalizeSearch(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(game.i18n.lang).trim();
}

export class SessionDashboard extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.workspaceViews = new Map();
    this.activeView = "sessions";
    this.lastBaseTab = "sessions";
    this.sessionViewMode = null;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-dashboard`,
    classes: [MODULE_ID, "session-dashboard"],
    tag: "section",
    window: {
      title: "DMJ.App.Title",
      icon: "fa-solid fa-book-journal-whills",
      resizable: true
    },
    position: { width: 860, height: 700 }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/dashboard.hbs` }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.activeTab = DASHBOARD_TABS.includes(this.activeTab) ? this.activeTab : "sessions";
    if (!this.activeView) this.activeView = this.activeTab;
    this.sessionQuery = String(this.sessionQuery ?? "");
    const savedSessionViewMode = this.sessionViewMode ?? game.settings.get(MODULE_ID, SETTINGS.SESSION_VIEW);
    this.sessionViewMode = SESSION_VIEW_MODES.includes(savedSessionViewMode) ? savedSessionViewMode : "cards";
    this.filterKind = ["all", ...RESOURCE_KINDS].includes(this.filterKind) ? this.filterKind : "all";
    this.filterQuery = String(this.filterQuery ?? "");
    const diary = DiaryService.getDiary();
    const sessions = DiaryService.getSessions(diary).map((page) => {
      const rawStatus = page.getFlag(MODULE_ID, "status");
      const status = ["draft", "ready", "played"].includes(rawStatus) ? rawStatus : "draft";
      return {
        id: page.id,
        name: page.name,
        date: page.getFlag(MODULE_ID, "date") ?? "",
        image: DiaryService.getSessionImage(page),
        statusLabel: game.i18n.localize(`DMJ.Status.${status[0].toUpperCase()}${status.slice(1)}`),
        status
      };
    });
    const resources = await Promise.all(ResourceService.getResources(diary).map(async (page) => {
      const data = ResourceService.getData(page);
      const resourceImage = data.image || data.cityMap?.image || "";
      const linked = resourceImage ? null : await ResourceService.getLinkedDocument(page);
      return {
        id: page.id,
        name: page.name,
        kind: data.kind,
        kindLabel: game.i18n.localize(`DMJ.Resource.Kind.${data.kind}`),
        icon: KIND_ICONS[data.kind],
        image: resourceImage || linked?.img || "",
        imagePositionX: data.imagePositionX,
        imagePositionY: data.imagePositionY
      };
    }));
    const resourceKinds = [
      { value: "all", label: game.i18n.localize("DMJ.Resource.FilterAll"), selected: this.filterKind === "all" },
      ...RESOURCE_KINDS.map((kind) => ({
        value: kind,
        label: game.i18n.localize(`DMJ.Resource.Kind.${kind}`),
        selected: this.filterKind === kind
      }))
    ];
    return {
      ...context,
      worldTitle: game.world.title,
      diaryId: diary?.id,
      hasDiary: Boolean(diary),
      sessions,
      sessionCount: sessions.length,
      sessionCountLabel: game.i18n.localize(sessions.length === 1 ? "DMJ.Session.CountOne" : "DMJ.Session.CountMany"),
      sessionEmpty: sessions.length === 0,
      sessionQuery: this.sessionQuery,
      sessionViewMode: this.sessionViewMode,
      sessionCardsView: this.sessionViewMode === "cards",
      sessionListView: this.sessionViewMode === "list",
      resources,
      resourceKinds,
      filterQuery: this.filterQuery,
      resourceEmpty: resources.length === 0,
      sessionsTabActive: this.activeView === "sessions",
      libraryTabActive: this.activeView === "library"
    };
  }

  async _preRender(context, options) {
    for (const view of this.workspaceViews.values()) await view.controller.captureForHostRender?.();
    await super._preRender(context, options);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#bindRootListeners(this.element);
    this.#applySessionFilters();
    this.#applySessionViewMode();
    this.#applyResourceFilters();
    await this.#restoreWorkspaceViews();
    this.#applyActiveTab();
  }

  #bindRootListeners(root) {
    this.#closeContextMenu();
    this.listenerController?.abort();
    this.listenerController = new (getElementWindow(root).AbortController)();
    const listenerOptions = { signal: this.listenerController.signal };
    root.addEventListener("click", this.#onClick.bind(this), listenerOptions);
    root.addEventListener("input", this.#onFilterChange.bind(this), listenerOptions);
    root.addEventListener("change", this.#onFilterChange.bind(this), listenerOptions);
    root.addEventListener("contextmenu", this.#onContextMenu.bind(this), listenerOptions);
  }

  onPopoutLoaded(node) {
    this.#bindRootListeners(node);
    this.#applySessionFilters();
    this.#applySessionViewMode();
    this.#applyResourceFilters();
    for (const view of this.workspaceViews.values()) view.controller.onPopoutLoaded?.(view.controller.embeddedRoot);
    this.#applyActiveTab();
  }

  _onDetach(from, to) {
    super._onDetach?.(from, to);
    this.onPopoutLoaded(this.element);
  }

  _onAttach(from, to) {
    super._onAttach?.(from, to);
    this.onPopoutLoaded(this.element);
  }

  async _preClose(options) {
    for (const view of this.workspaceViews.values()) await view.controller.unmount?.();
    await super._preClose(options);
  }

  _onClose(options) {
    this.#closeContextMenu();
    this.workspaceViews.clear();
    this.listenerController?.abort();
    super._onClose(options);
  }

  #document() {
    return getElementDocument(this.element);
  }

  #window() {
    return getElementWindow(this.element);
  }

  activateTab(tab) {
    this.activeTab = DASHBOARD_TABS.includes(tab) ? tab : "sessions";
    this.activeView = this.activeTab;
    this.lastBaseTab = this.activeTab;
    if (this.rendered) this.#applyActiveTab();
    return this;
  }

  async openSession(page) {
    return this.openBoard(page);
  }

  async openBoard(page, options = {}) {
    const label = `${game.i18n.localize("DMJ.Board.Title")}: ${page.name}`;
    const board = await this.#openWorkspaceView("board", page, () => new SessionBoard(page), "fa-route", label);
    if (options.focusBlockId) await board?.focusBlock(options.focusBlockId);
    return board;
  }

  async openResource(page) {
    const kind = ResourceService.getData(page).kind;
    return this.#openWorkspaceView("resource", page, () => new ResourceEditor(page), KIND_ICONS[kind] ?? "fa-address-card");
  }

  updateWorkspaceLabel(type, pageId, label) {
    const view = this.workspaceViews.get(`${type}:${pageId}`);
    if (!view) return;
    view.label = label;
    const tab = [...this.element.querySelectorAll("[data-workspace-key]")].find((entry) => entry.dataset.workspaceKey === view.key);
    const text = tab?.querySelector("[data-workspace-label]");
    if (text) text.textContent = label;
  }

  async refreshSessionTile(page) {
    if (!this.rendered || !page) return null;
    const tile = [...this.element.querySelectorAll("[data-action='open-session']")].find((entry) => entry.dataset.pageId === page.id);
    if (!tile) return null;
    const rawStatus = page.getFlag(MODULE_ID, "status");
    const status = ["draft", "ready", "played"].includes(rawStatus) ? rawStatus : "draft";
    tile.querySelector(".dmj-session-name").textContent = page.name;
    const statusElement = tile.querySelector(".dmj-session-status");
    statusElement.className = `dmj-session-status ${status}`;
    statusElement.textContent = game.i18n.localize(`DMJ.Status.${status[0].toUpperCase()}${status.slice(1)}`);
    this.#updateSessionTileImage(tile, DiaryService.getSessionImage(page));
    const date = page.getFlag(MODULE_ID, "date") ?? "";
    let time = tile.querySelector("time");
    if (date) {
      time ??= this.#document().createElement("time");
      time.dateTime = date;
      time.textContent = date;
      if (!time.isConnected) (tile.querySelector(".dmj-session-summary") ?? tile).append(time);
    } else time?.remove();
    this.#applySessionFilters();
    return tile;
  }

  #updateSessionTileImage(tile, image) {
    const cover = tile.querySelector("[data-session-cover]");
    if (!cover) return;
    const visual = this.#document().createElement(image ? "img" : "i");
    if (image) {
      visual.src = image;
      visual.alt = "";
    } else {
      visual.className = "fa-solid fa-book-open";
      visual.setAttribute("aria-hidden", "true");
    }
    cover.replaceChildren(visual);
  }

  async refreshResourceTile(page) {
    if (!this.rendered || !page) return null;
    const tile = [...this.element.querySelectorAll(".dmj-resource-tile")]
      .find((entry) => entry.dataset.pageId === page.id);
    if (!tile) return null;

    const data = ResourceService.getData(page);
    const resourceImage = data.image || data.cityMap?.image || "";
    const linked = resourceImage ? null : await ResourceService.getLinkedDocument(page);
    const image = resourceImage || linked?.img || "";
    const currentVisual = tile.firstElementChild;
    if (image) {
      const preview = currentVisual?.tagName === "IMG" ? currentVisual : this.#document().createElement("img");
      preview.src = image;
      preview.alt = "";
      preview.style.objectPosition = `${data.imagePositionX}% ${data.imagePositionY}%`;
      if (preview !== currentVisual) {
        if (currentVisual) currentVisual.replaceWith(preview);
        else tile.prepend(preview);
      }
    } else {
      const icon = currentVisual?.tagName === "I" ? currentVisual : this.#document().createElement("i");
      icon.className = `fa-solid ${KIND_ICONS[data.kind] ?? "fa-book-open"}`;
      icon.setAttribute("aria-hidden", "true");
      if (icon !== currentVisual) {
        if (currentVisual) currentVisual.replaceWith(icon);
        else tile.prepend(icon);
      }
    }

    tile.dataset.resourceKind = data.kind;
    tile.querySelector("strong").textContent = page.name;
    tile.querySelector("small").textContent = game.i18n.localize(`DMJ.Resource.Kind.${data.kind}`);
    this.#applyResourceFilters();
    return tile;
  }

  async addResourceTile(page) {
    if (!this.rendered || !page) return null;
    const existing = [...this.element.querySelectorAll(".dmj-resource-tile")]
      .find((entry) => entry.dataset.pageId === page.id);
    if (existing) return this.refreshResourceTile(page);
    const grid = this.element.querySelector(".dmj-resource-grid");
    if (!grid) return null;

    const data = ResourceService.getData(page);
    const resourceImage = data.image || data.cityMap?.image || "";
    const linked = resourceImage ? null : await ResourceService.getLinkedDocument(page);
    const image = resourceImage || linked?.img || "";
    const tile = this.#document().createElement("button");
    tile.type = "button";
    tile.className = "dmj-resource-tile";
    tile.dataset.action = "open-resource";
    tile.dataset.pageId = page.id;
    tile.dataset.resourceKind = data.kind;
    tile.title = game.i18n.localize("DMJ.Resource.ContextHint");
    const visual = this.#document().createElement(image ? "img" : "i");
    if (image) {
      visual.src = image;
      visual.alt = "";
      visual.style.objectPosition = `${data.imagePositionX}% ${data.imagePositionY}%`;
    } else {
      visual.className = `fa-solid ${KIND_ICONS[data.kind] ?? "fa-book-open"}`;
      visual.setAttribute("aria-hidden", "true");
    }
    const text = this.#document().createElement("span");
    const name = this.#document().createElement("strong");
    name.textContent = page.name;
    const kind = this.#document().createElement("small");
    kind.textContent = game.i18n.localize(`DMJ.Resource.Kind.${data.kind}`);
    text.append(name, kind);
    tile.append(visual, text);
    grid.querySelector(".dmj-resource-empty:not([data-resource-filter-empty])")?.remove();
    if (!grid.querySelector("[data-resource-filter-empty]")) {
      const emptyResult = this.#document().createElement("div");
      emptyResult.className = "dmj-resource-empty";
      emptyResult.dataset.resourceFilterEmpty = "";
      emptyResult.hidden = true;
      const emptyIcon = this.#document().createElement("i");
      emptyIcon.className = "fa-solid fa-magnifying-glass";
      emptyIcon.setAttribute("aria-hidden", "true");
      const emptyTitle = this.#document().createElement("h2");
      emptyTitle.textContent = game.i18n.localize("DMJ.Resource.FilterEmpty");
      emptyResult.append(emptyIcon, emptyTitle);
      grid.append(emptyResult);
    }
    grid.append(tile);
    this.#applyResourceFilters();
    return tile;
  }

  async #openWorkspaceView(type, page, createController, icon, label = page?.name) {
    if (!page) return null;
    const key = `${type}:${page.id}`;
    let view = this.workspaceViews.get(key);
    if (!view) {
      view = { key, type, page, label, icon, controller: createController() };
      this.workspaceViews.set(key, view);
      if (this.rendered) await this.#appendWorkspaceView(view);
    } else {
      view.page = page;
      this.updateWorkspaceLabel(type, page.id, label);
    }
    this.activeView = key;
    this.#applyActiveTab();
    return view.controller;
  }

  async #restoreWorkspaceViews() {
    for (const view of this.workspaceViews.values()) await this.#appendWorkspaceView(view);
  }

  async #appendWorkspaceView(view) {
    const navigation = this.element.querySelector(".dmj-dashboard-tabs");
    const shell = this.element.querySelector(".dmj-shell");
    if (!navigation || !shell) return;

    const tab = this.#document().createElement("div");
    tab.className = "dmj-workspace-tab";
    tab.dataset.workspaceKey = view.key;
    tab.setAttribute("role", "presentation");
    const panelId = `dmj-workspace-panel-${view.type}-${view.page.id}`;
    const select = this.#document().createElement("button");
    select.type = "button";
    select.dataset.action = "select-workspace";
    select.dataset.workspaceKey = view.key;
    select.setAttribute("role", "tab");
    select.setAttribute("aria-controls", panelId);
    const icon = this.#document().createElement("i");
    icon.className = `fa-solid ${view.icon}`;
    icon.setAttribute("aria-hidden", "true");
    const label = this.#document().createElement("span");
    label.dataset.workspaceLabel = "";
    label.textContent = view.label;
    select.append(icon, label);
    const close = this.#document().createElement("button");
    close.type = "button";
    close.className = "dmj-workspace-tab-close";
    close.dataset.action = "close-workspace";
    close.dataset.workspaceKey = view.key;
    close.setAttribute("aria-label", game.i18n.localize("DMJ.Workspace.Close"));
    const closeIcon = this.#document().createElement("i");
    closeIcon.className = "fa-solid fa-xmark";
    closeIcon.setAttribute("aria-hidden", "true");
    close.append(closeIcon);
    tab.append(select, close);
    navigation.append(tab);

    const panel = this.#document().createElement("section");
    panel.className = "dmj-dashboard-panel dmj-workspace-panel";
    panel.id = panelId;
    panel.setAttribute("role", "tabpanel");
    panel.dataset.workspacePanel = view.key;
    panel.hidden = true;
    shell.append(panel);
    await view.controller.mount(panel, this);
  }

  async #closeWorkspace(key) {
    const view = this.workspaceViews.get(key);
    if (!view) return;
    await view.controller.unmount?.();
    this.workspaceViews.delete(key);
    [...this.element.querySelectorAll("[data-workspace-key]")].find((entry) => entry.dataset.workspaceKey === key)?.remove();
    [...this.element.querySelectorAll("[data-workspace-panel]")].find((entry) => entry.dataset.workspacePanel === key)?.remove();
    if (this.activeView === key) this.activeView = this.lastBaseTab;
    this.#applyActiveTab();
  }

  async #detachWorkspace(key) {
    this.#closeContextMenu();
    const view = this.workspaceViews.get(key);
    if (!view) return;

    try {
      await view.controller.unmount?.();
      this.workspaceViews.delete(key);
      [...this.element.querySelectorAll("[data-workspace-key]")]
        .find((entry) => entry.dataset.workspaceKey === key)?.remove();
      [...this.element.querySelectorAll("[data-workspace-panel]")]
        .find((entry) => entry.dataset.workspacePanel === key)?.remove();
      if (this.activeView === key) this.activeView = this.lastBaseTab;
      this.#applyActiveTab();
      await view.controller.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error.message);
    }
  }

  #applyActiveTab() {
    for (const tab of this.element.querySelectorAll("[data-dashboard-tab]")) {
      const active = tab.dataset.dashboardTab === this.activeView;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of this.element.querySelectorAll("[data-dashboard-panel]")) {
      panel.hidden = panel.dataset.dashboardPanel !== this.activeView;
    }
    for (const tab of this.element.querySelectorAll("[data-action='select-workspace']")) {
      const active = tab.dataset.workspaceKey === this.activeView;
      tab.classList.toggle("active", active);
      tab.closest(".dmj-workspace-tab")?.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of this.element.querySelectorAll("[data-workspace-panel]")) {
      panel.hidden = panel.dataset.workspacePanel !== this.activeView;
    }
  }

  #onContextMenu(event) {
    const workspaceTab = event.target.closest(".dmj-workspace-tab");
    if (workspaceTab) {
      const view = this.workspaceViews.get(workspaceTab.dataset.workspaceKey);
      if (!view) return;
      event.preventDefault();
      event.stopPropagation();
      this.#openWorkspaceContextMenu(event, view);
      return;
    }

    const button = event.target.closest("[data-action='open-session'], [data-action='open-resource']");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();

    const diary = DiaryService.getDiary();
    const targetType = button.dataset.action === "open-resource" ? "resource" : "session";
    const page = targetType === "resource"
      ? ResourceService.getResources(diary).find((entry) => entry.id === button.dataset.pageId)
      : diary?.pages.get(button.dataset.pageId);
    if (!page) return;
    this.#openContextMenu(event, page, targetType);
  }

  #openContextMenu(event, page, targetType) {
    this.#closeContextMenu();
    this.contextMenuController = new (this.#window().AbortController)();
    const listenerOptions = { signal: this.contextMenuController.signal };
    const menu = this.#document().createElement("div");
    menu.className = `${MODULE_ID} dmj-dashboard-context-menu`;
    menu.setAttribute("role", "menu");

    const deleteButton = this.#document().createElement("button");
    deleteButton.type = "button";
    deleteButton.setAttribute("role", "menuitem");
    const icon = this.#document().createElement("i");
    icon.className = "fa-solid fa-trash-can";
    icon.setAttribute("aria-hidden", "true");
    const label = this.#document().createElement("span");
    const resourceTarget = targetType === "resource";
    label.textContent = game.i18n.localize(resourceTarget ? "DMJ.Resource.Delete" : "DMJ.Session.Delete");
    deleteButton.append(icon, label);
    deleteButton.addEventListener("click", () => {
      if (resourceTarget) void this.#deleteResource(page);
      else void this.#deleteSession(page);
    }, listenerOptions);
    menu.append(deleteButton);
    this.#document().body.append(menu);

    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(event.clientX, this.#window().innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, this.#window().innerHeight - bounds.height - 8))}px`;
    this.#document().addEventListener("pointerdown", (pointerEvent) => {
      if (!menu.contains(pointerEvent.target)) this.#closeContextMenu();
    }, listenerOptions);
    this.#document().addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Escape") this.#closeContextMenu();
    }, listenerOptions);
    this.contextMenu = menu;
    deleteButton.focus();
  }

  #openWorkspaceContextMenu(event, view) {
    this.#closeContextMenu();
    this.contextMenuController = new (this.#window().AbortController)();
    const listenerOptions = { signal: this.contextMenuController.signal };
    const menu = this.#document().createElement("div");
    menu.className = `${MODULE_ID} dmj-dashboard-context-menu`;
    menu.setAttribute("role", "menu");

    const openButton = this.#document().createElement("button");
    openButton.type = "button";
    openButton.setAttribute("role", "menuitem");
    const icon = this.#document().createElement("i");
    icon.className = "fa-solid fa-up-right-from-square";
    icon.setAttribute("aria-hidden", "true");
    const label = this.#document().createElement("span");
    label.textContent = game.i18n.localize("DMJ.Workspace.OpenSeparate");
    openButton.append(icon, label);
    openButton.addEventListener("click", () => void this.#detachWorkspace(view.key), listenerOptions);
    menu.append(openButton);
    if (isPopoutAvailable(this)) {
      const popoutButton = this.#document().createElement("button");
      popoutButton.type = "button";
      popoutButton.setAttribute("role", "menuitem");
      const popoutIcon = this.#document().createElement("i");
      popoutIcon.className = "fa-solid fa-display";
      popoutIcon.setAttribute("aria-hidden", "true");
      const popoutLabel = this.#document().createElement("span");
      popoutLabel.textContent = game.i18n.localize("DMJ.Popout.OpenWorkspace");
      popoutButton.append(popoutIcon, popoutLabel);
      popoutButton.addEventListener("click", () => {
        this.#closeContextMenu();
        void popoutApplication(this);
      }, listenerOptions);
      menu.append(popoutButton);
    }
    this.#document().body.append(menu);

    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(event.clientX, this.#window().innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, this.#window().innerHeight - bounds.height - 8))}px`;
    this.#document().addEventListener("pointerdown", (pointerEvent) => {
      if (!menu.contains(pointerEvent.target)) this.#closeContextMenu();
    }, listenerOptions);
    this.#document().addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Escape") this.#closeContextMenu();
    }, listenerOptions);
    this.contextMenu = menu;
    openButton.focus();
  }

  #closeContextMenu() {
    this.contextMenuController?.abort();
    this.contextMenuController = null;
    this.contextMenu?.remove();
    this.contextMenu = null;
  }

  async #deleteSession(page) {
    this.#closeContextMenu();
    const content = this.#document().createElement("div");
    const message = this.#document().createElement("p");
    message.textContent = game.i18n.format("DMJ.Session.DeleteConfirm", { name: page.name });
    content.append(message);

    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize("DMJ.Session.DeleteTitle") },
      content,
      modal: true,
      rejectClose: false,
      yes: { label: game.i18n.localize("DMJ.Session.Delete") },
      no: { label: game.i18n.localize("DMJ.Session.CancelDelete") }
    });
    if (!confirmed) return;

    try {
      await this.#closeWorkspace(`session:${page.id}`);
      await this.#closeWorkspace(`board:${page.id}`);
      await DiaryService.deleteSession(page);
      ui.notifications.info(game.i18n.localize("DMJ.Session.Deleted"));
      await this.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error.message);
    }
  }

  async #deleteResource(page) {
    this.#closeContextMenu();
    const content = this.#document().createElement("div");
    const message = this.#document().createElement("p");
    message.textContent = game.i18n.format("DMJ.Resource.DeleteConfirm", { name: page.name });
    content.append(message);

    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize("DMJ.Resource.DeleteTitle") },
      content,
      modal: true,
      rejectClose: false,
      yes: { label: game.i18n.localize("DMJ.Resource.Delete") },
      no: { label: game.i18n.localize("DMJ.Resource.CancelDelete") }
    });
    if (!confirmed) return;

    try {
      await this.#closeWorkspace(`resource:${page.id}`);
      await ResourceService.deleteResource(page);
      ui.notifications.info(game.i18n.localize("DMJ.Resource.Deleted"));
      await this.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error.message);
    }
  }

  #onFilterChange(event) {
    if (event.target.matches("[data-session-search]")) {
      this.sessionQuery = event.target.value;
      this.#applySessionFilters();
      return;
    }
    if (!event.target.matches("[data-resource-kind-filter], [data-resource-search]")) return;
    const selectedKind = this.element.querySelector("[data-resource-kind-filter]")?.value;
    this.filterKind = ["all", ...RESOURCE_KINDS].includes(selectedKind) ? selectedKind : "all";
    this.filterQuery = this.element.querySelector("[data-resource-search]")?.value ?? "";
    this.#applyResourceFilters();
  }

  #applySessionFilters() {
    const query = normalizeSearch(this.sessionQuery);
    let visibleSessions = 0;
    for (const session of this.element.querySelectorAll(".dmj-session-list [data-action='open-session']")) {
      session.hidden = Boolean(query) && !normalizeSearch(session.textContent).includes(query);
      if (!session.hidden) visibleSessions += 1;
    }
    const emptyResult = this.element.querySelector("[data-session-filter-empty]");
    if (emptyResult) emptyResult.hidden = visibleSessions > 0;
  }

  async #setSessionViewMode(mode) {
    if (!SESSION_VIEW_MODES.includes(mode) || mode === this.sessionViewMode) return;
    await game.settings.set(MODULE_ID, SETTINGS.SESSION_VIEW, mode);
    this.sessionViewMode = mode;
    this.#applySessionViewMode();
  }

  #applySessionViewMode() {
    const mode = SESSION_VIEW_MODES.includes(this.sessionViewMode) ? this.sessionViewMode : "cards";
    const list = this.element.querySelector(".dmj-session-list");
    for (const viewMode of SESSION_VIEW_MODES) list?.classList.toggle(viewMode, viewMode === mode);
    for (const button of this.element.querySelectorAll("[data-action='set-session-view']")) {
      const active = button.dataset.viewMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  #applyResourceFilters() {
    const kind = ["all", ...RESOURCE_KINDS].includes(this.filterKind) ? this.filterKind : "all";
    const query = normalizeSearch(this.filterQuery);
    let visibleResources = 0;
    for (const tile of this.element.querySelectorAll(".dmj-resource-tile")) {
      const matchesKind = kind === "all" || tile.dataset.resourceKind === kind;
      const matchesQuery = !query || normalizeSearch(tile.textContent).includes(query);
      tile.hidden = !(matchesKind && matchesQuery);
      if (!tile.hidden) visibleResources += 1;
    }
    const emptyResult = this.element.querySelector("[data-resource-filter-empty]");
    if (emptyResult) emptyResult.hidden = visibleResources > 0;
  }

  #createResourceDialogContent() {
    const content = this.#document().createElement("div");
    const fields = this.#document().createElement("div");
    fields.className = "dmj-resource-create-dialog";

    const kindLabel = this.#document().createElement("label");
    const kindText = this.#document().createElement("span");
    kindText.textContent = game.i18n.localize("DMJ.Resource.CreateKind");
    const kindSelect = this.#document().createElement("select");
    kindSelect.name = "kind";
    kindSelect.required = true;
    for (const kind of RESOURCE_KINDS) {
      const option = this.#document().createElement("option");
      option.value = kind;
      option.textContent = game.i18n.localize(`DMJ.Resource.Kind.${kind}`);
      option.selected = this.filterKind === kind;
      kindSelect.append(option);
    }
    kindLabel.append(kindText, kindSelect);

    const nameLabel = this.#document().createElement("label");
    const nameText = this.#document().createElement("span");
    nameText.textContent = game.i18n.localize("DMJ.Resource.Name");
    const nameInput = this.#document().createElement("input");
    nameInput.name = "name";
    nameInput.type = "text";
    nameInput.maxLength = 120;
    nameInput.required = true;
    nameInput.autofocus = true;
    nameInput.placeholder = game.i18n.localize("DMJ.Resource.NamePlaceholder");
    nameLabel.append(nameText, nameInput);
    fields.append(kindLabel, nameLabel);
    content.append(fields);
    return content;
  }

  async #createResource(button) {
    if (this.creatingResource) return;
    this.creatingResource = true;
    button.disabled = true;
    try {
      const data = await DialogV2.input({
        window: { title: game.i18n.localize("DMJ.Resource.CreateDialogTitle") },
        content: this.#createResourceDialogContent(),
        modal: true,
        rejectClose: false,
        ok: {
          label: game.i18n.localize("DMJ.Resource.Create"),
          callback: (_event, dialogButton) => ({
            kind: dialogButton.form.elements.kind.value,
            name: dialogButton.form.elements.name.value
          })
        }
      });
      if (!data) return;
      const page = await ResourceService.createResource(data.kind, data.name);
      this.activeTab = "library";
      this.activeView = "library";
      this.lastBaseTab = "library";
      this.filterKind = data.kind;
      this.filterQuery = "";
      await this.render({ force: true });
      await this.openResource(page);
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error.message);
    } finally {
      this.creatingResource = false;
      if (button.isConnected) button.disabled = false;
    }
  }

  async #createSession(button) {
    if (this.creatingSession) return;
    this.creatingSession = true;
    button.disabled = true;
    try {
      const page = await DiaryService.addSession(game.i18n.localize("DMJ.Session.DefaultName"));
      this.activeTab = "sessions";
      this.activeView = "sessions";
      this.lastBaseTab = "sessions";
      this.sessionQuery = "";
      await this.render({ force: true });
      await this.openSession(page);
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error.message);
    } finally {
      this.creatingSession = false;
      if (button.isConnected) button.disabled = false;
    }
  }

  async #onClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const diary = DiaryService.getDiary();

    try {
      if (button.dataset.action === "select-dashboard-tab") {
        this.activateTab(button.dataset.tab);
      } else if (button.dataset.action === "select-workspace") {
        this.activeView = button.dataset.workspaceKey;
        this.#applyActiveTab();
      } else if (button.dataset.action === "close-workspace") {
        await this.#closeWorkspace(button.dataset.workspaceKey);
      } else if (button.dataset.action === "create-session") {
        await this.#createSession(button);
      } else if (button.dataset.action === "set-session-view") {
        await this.#setSessionViewMode(button.dataset.viewMode);
      } else if (button.dataset.action === "create-resource") {
        await this.#createResource(button);
      } else if (button.dataset.action === "open-resource") {
        const page = ResourceService.getResources(diary).find((entry) => entry.id === button.dataset.pageId);
        if (page) await this.openResource(page);
      } else if (button.dataset.action === "open-session") {
        const page = diary?.pages.get(button.dataset.pageId);
        if (page) await this.openSession(page);
      }
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error.message);
    }
  }

}
