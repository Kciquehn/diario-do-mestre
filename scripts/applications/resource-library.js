import { MODULE_ID, RESOURCE_KINDS } from "../constants.js";
import { ResourceService } from "../services/resource-service.js";
import { getElementDocument, getElementWindow } from "../compat/popout.js";

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;

const KIND_ICONS = Object.freeze({
  person: "fa-user",
  place: "fa-location-dot",
  item: "fa-gem",
  encounter: "fa-skull-crossbones",
  faction: "fa-people-group"
});

function normalizeSearch(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(game.i18n.lang).trim();
}

export class ResourceLibrary extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-resource-library`,
    classes: [MODULE_ID, "resource-library"],
    tag: "section",
    window: { title: "DMJ.Resource.Library", icon: "fa-solid fa-book-open", resizable: true },
    position: { width: 860, height: 700 }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/resource-library.hbs` }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.filterKind = ["all", ...RESOURCE_KINDS].includes(this.filterKind) ? this.filterKind : "all";
    this.filterQuery = String(this.filterQuery ?? "");
    const resources = await Promise.all(ResourceService.getResources().map(async (page) => {
      const data = ResourceService.getData(page);
      const linked = data.image ? null : await ResourceService.getLinkedDocument(page);
      return {
        id: page.id,
        name: page.name,
        kind: data.kind,
        kindLabel: game.i18n.localize(`DMJ.Resource.Kind.${data.kind}`),
        icon: KIND_ICONS[data.kind],
        image: data.image || linked?.img || ""
      };
    }));
    const kinds = [
      { value: "all", label: game.i18n.localize("DMJ.Resource.FilterAll"), selected: this.filterKind === "all" },
      ...RESOURCE_KINDS.map((kind) => ({
        value: kind,
        label: game.i18n.localize(`DMJ.Resource.Kind.${kind}`),
        selected: this.filterKind === kind
      }))
    ];
    return { ...context, resources, kinds, filterQuery: this.filterQuery, empty: resources.length === 0 };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#activate(this.element);
  }

  #activate(root) {
    this.#closeContextMenu();
    this.listenerController?.abort();
    this.listenerController = new (getElementWindow(root).AbortController)();
    const listenerOptions = { signal: this.listenerController.signal };
    root.addEventListener("click", this.#onClick.bind(this), listenerOptions);
    root.addEventListener("input", this.#onFilterChange.bind(this), listenerOptions);
    root.addEventListener("change", this.#onFilterChange.bind(this), listenerOptions);
    root.addEventListener("contextmenu", this.#onContextMenu.bind(this), listenerOptions);
    this.#applyFilters();
  }

  onPopoutLoaded(node) {
    this.#activate(node);
  }

  _onClose(options) {
    this.#closeContextMenu();
    this.listenerController?.abort();
    super._onClose(options);
  }

  #document() {
    return getElementDocument(this.element);
  }

  #window() {
    return getElementWindow(this.element);
  }

  #onContextMenu(event) {
    const button = event.target.closest("[data-action='open-resource']");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();

    const page = ResourceService.getResources().find((entry) => entry.id === button.dataset.pageId);
    if (!page) return;
    this.#openContextMenu(event, page);
  }

  #openContextMenu(event, page) {
    this.#closeContextMenu();
    this.contextMenuController = new (this.#window().AbortController)();
    const listenerOptions = { signal: this.contextMenuController.signal };
    const menu = this.#document().createElement("div");
    menu.className = `${MODULE_ID} dmj-resource-context-menu`;
    menu.setAttribute("role", "menu");

    const deleteButton = this.#document().createElement("button");
    deleteButton.type = "button";
    deleteButton.setAttribute("role", "menuitem");
    const icon = this.#document().createElement("i");
    icon.className = "fa-solid fa-trash-can";
    icon.setAttribute("aria-hidden", "true");
    const label = this.#document().createElement("span");
    label.textContent = game.i18n.localize("DMJ.Resource.Delete");
    deleteButton.append(icon, label);
    deleteButton.addEventListener("click", () => this.#deleteResource(page), listenerOptions);
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

  #closeContextMenu() {
    this.contextMenuController?.abort();
    this.contextMenuController = null;
    this.contextMenu?.remove();
    this.contextMenu = null;
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
      await ResourceService.deleteResource(page);
      ui.notifications.info(game.i18n.localize("DMJ.Resource.Deleted"));
      await this.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error.message);
    }
  }

  #onFilterChange(event) {
    if (!event.target.matches("[data-resource-kind-filter], [data-resource-search]")) return;
    const selectedKind = this.element.querySelector("[data-resource-kind-filter]")?.value;
    this.filterKind = ["all", ...RESOURCE_KINDS].includes(selectedKind) ? selectedKind : "all";
    this.filterQuery = this.element.querySelector("[data-resource-search]")?.value ?? "";
    this.#applyFilters();
  }

  #applyFilters() {
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

  #createDialogContent() {
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
        content: this.#createDialogContent(),
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
      this.filterKind = data.kind;
      this.filterQuery = "";
      await this.render({ force: true });
      await game.modules.get(MODULE_ID).api.openResource(page);
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error.message);
    } finally {
      this.creatingResource = false;
      if (button.isConnected) button.disabled = false;
    }
  }

  async #onClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "create-resource") {
      await this.#createResource(button);
      return;
    }
    if (button.dataset.action !== "open-resource") return;
    const page = ResourceService.getResources().find((entry) => entry.id === button.dataset.pageId);
    if (page) await game.modules.get(MODULE_ID).api.openResource(page);
  }
}
