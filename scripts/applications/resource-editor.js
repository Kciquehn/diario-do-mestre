import { MODULE_ID } from "../constants.js";
import { PLACE_LAYOUTS, PLACE_TYPES, ResourceService, RESOURCE_FIELDS } from "../services/resource-service.js?v=1.4.10";
import { plainTextToRichHTML, richTextToPlainText, sanitizeRichTextHTML } from "../utils/rich-text.js";
import { getElementDocument, getElementWindow } from "../compat/popout.js";
import { CityMapController } from "./city-map-controller.js?v=1.4.10";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { ImagePopout } = foundry.applications.apps;
const AUTOSAVE_DELAY_MS = 750;
const TEMPLATE = `modules/${MODULE_ID}/templates/resource-editor-v13.hbs`;
const CITY_MAP_TEMPLATE = `modules/${MODULE_ID}/templates/city-map-panel-v1.hbs`;
const RESOURCE_MENTION_ICONS = Object.freeze({
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

export class ResourceEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(page, options = {}) {
    super({ id: `${MODULE_ID}-resource-${page.id}`, ...options });
    this.page = page;
    this.autosaveTimer = null;
    this.autosaveRevision = 0;
    this.savedRevision = 0;
    this.autosaveState = "saved";
    this.savePromise = null;
    this.saveErrorNotified = false;
    this.slashState = null;
    this.mentionState = null;
    this.embeddedRoot = null;
    this.workspaceHost = null;
    this.cityMapController = null;
  }

  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "resource-editor"],
    tag: "section",
    window: { title: "DMJ.Resource.Editor", icon: "fa-solid fa-address-card", resizable: true },
    position: { width: 780, height: 720 }
  };

  static PARTS = {
    main: { template: TEMPLATE }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return { ...context, ...await this.#prepareViewContext() };
  }

  async #prepareViewContext() {
    const data = ResourceService.getData(this.page);
    const linked = data.isCity || data.isPlace ? null : await ResourceService.getLinkedDocument(this.page);
    const linkedLabel = linked ? `${linked.name} (${linked.documentName})` : game.i18n.localize("DMJ.Resource.Drop");
    const cityMapImage = data.isCity ? data.cityMap.image : "";
    return {
      ...data,
      kindLabel: game.i18n.localize(`DMJ.Resource.Kind.${data.kind}`),
      placeTypes: data.isPlace ? PLACE_TYPES.map((id) => ({
        id,
        label: game.i18n.localize(`DMJ.Resource.PlaceType.${id}`),
        selected: id === data.placeType
      })) : [],
      placeLayouts: data.isPlace ? PLACE_LAYOUTS.map((id) => ({
        id,
        icon: id === "panorama" ? "fa-image" : id === "compact" ? "fa-table-cells" : id === "sidebar" ? "fa-table-columns" : "fa-newspaper",
        label: game.i18n.localize(`DMJ.Resource.Layout.${id}`),
        hint: game.i18n.localize(`DMJ.Resource.Layout.${id}Hint`),
        selected: id === data.layout
      })) : [],
      fields: RESOURCE_FIELDS[data.kind].map((field) => ({
        id: field,
        label: game.i18n.localize(`DMJ.Resource.Field.${data.kind}.${field}`),
        editorHTML: sanitizeRichTextHTML(data[`${field}HTML`] ?? plainTextToRichHTML(data[field]))
      })),
      notesHTML: sanitizeRichTextHTML(data.notesHTML ?? plainTextToRichHTML(data.notes)),
      preview: data.image || cityMapImage || linked?.img || "icons/svg/mystery-man.svg",
      fallbackPreview: cityMapImage || linked?.img || "icons/svg/mystery-man.svg",
      imageZoomScale: data.imageZoom / 100,
      cityMapJSON: JSON.stringify(data.cityMap),
      cityMapZoomLabel: game.i18n.format("DMJ.CityMap.Zoom", { zoom: Math.round(data.cityMap.zoom * 100) }),
      linkedName: linked?.name,
      linkedType: linked?.documentName,
      linkedLabel,
      hasLinked: Boolean(linked)
    };
  }

  async mount(container, host) {
    this.embeddedRoot = container;
    this.workspaceHost = host;
    container.classList.add(MODULE_ID, "resource-editor", "dmj-workspace-view");
    const context = await this.#prepareViewContext();
    container.innerHTML = await foundry.applications.handlebars.renderTemplate(TEMPLATE, context);
    await this.#insertCityMap(container, context);
    this.#activate(container);
    return this;
  }

  async captureForHostRender() {
    this.#clearAutosaveTimer();
    this.#syncAllRichEditors();
    await this.#saveResource();
  }

  async unmount() {
    await this.captureForHostRender();
    this.#tearDownView();
    this.embeddedRoot = null;
    this.workspaceHost = null;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    await this.#insertCityMap(this.element, context);
    this.#activate(this.element);
  }

  async #insertCityMap(root, context = null) {
    if (root.querySelector("[data-city-map]")) return;
    const viewContext = context?.isCity === true ? context : await this.#prepareViewContext();
    if (!viewContext.isCity) return;
    const fields = root.querySelector(".dmj-resource-fields");
    if (!fields) throw new Error("Diário do Mestre | Área de campos da Cidade não encontrada.");
    const markup = await foundry.applications.handlebars.renderTemplate(CITY_MAP_TEMPLATE, viewContext);
    const fragment = getElementDocument(root).createRange().createContextualFragment(markup);
    fields.style.overflowAnchor = "none";
    fields.prepend(fragment);
    fields.scrollTop = 0;
    getElementWindow(root).requestAnimationFrame(() => {
      fields.scrollTop = 0;
      fields.style.removeProperty("overflow-anchor");
    });
  }

  #activate(root) {
    this.cityMapController?.destroy();
    this.cityMapController = null;
    this.#closeImageContextMenu();
    this.#closeSlashMenu();
    this.#closeMentionMenu();
    this.listenerController?.abort();
    this.listenerController = new (getElementWindow(root).AbortController)();
    const listenerOptions = { signal: this.listenerController.signal };
    const rootDocument = getElementDocument(root);
    const form = root.querySelector("form[data-form='resource-editor']");
    form.addEventListener("submit", this.#onSubmit.bind(this), listenerOptions);
    form.addEventListener("input", this.#onFormInput.bind(this), listenerOptions);
    form.addEventListener("keydown", this.#onEditorKeyDown.bind(this), listenerOptions);
    form.addEventListener("paste", this.#onEditorPaste.bind(this), listenerOptions);
    form.addEventListener("click", this.#onEditorClick.bind(this), listenerOptions);
    rootDocument.addEventListener("pointerdown", (event) => {
      if (this.slashState && !this.slashState.menu.contains(event.target) && !this.slashState.editor.contains(event.target)) this.#closeSlashMenu();
      if (this.mentionState && !this.mentionState.menu.contains(event.target) && !this.mentionState.editor.contains(event.target)) this.#closeMentionMenu();
    }, listenerOptions);
    const dropZone = form.querySelector(".dmj-resource-link");
    dropZone?.addEventListener("dragover", (event) => event.preventDefault(), listenerOptions);
    dropZone?.addEventListener("drop", this.#onDrop.bind(this), listenerOptions);
    form.querySelector("[data-action='open-linked']")?.addEventListener("click", () => this.#openLinked(), listenerOptions);
    form.querySelector("[data-action='toggle-place-header']")?.addEventListener("click", () => this.#togglePlaceHeader(form), listenerOptions);
    const portrait = form.querySelector("[data-action='view-image']");
    portrait?.addEventListener("click", (event) => {
      event.preventDefault();
      void this.#openImage(form);
    }, listenerOptions);
    portrait?.addEventListener("contextmenu", (event) => this.#openImageContextMenu(event, portrait), listenerOptions);
    form.elements.image?.addEventListener("input", () => this.#updateImagePreview(form), listenerOptions);
    for (const input of form.querySelectorAll("[data-image-framing-input]")) {
      input.addEventListener("input", () => this.#applyImageFraming(form), listenerOptions);
    }
    form.querySelector("[data-action='close-image-framing']")?.addEventListener("click", () => this.#closeImageFramingControls(form), listenerOptions);
    form.querySelector("[data-action='reset-image-framing']")?.addEventListener("click", () => this.#resetImageFraming(form), listenerOptions);
    this.#applyImageFraming(form);
    const resourceData = ResourceService.getData(this.page);
    const cityMapRoot = resourceData.kind === "city" ? form.querySelector("[data-city-map]") : null;
    if (cityMapRoot) {
      this.cityMapController = new CityMapController({
        root: cityMapRoot,
        page: this.page,
        onChange: () => this.#scheduleAutosave(),
        openResource: (page) => this.workspaceHost?.openResource?.(page) ?? game.modules.get(MODULE_ID)?.api?.openResource?.(page),
        onResourceCreated: (page) => this.workspaceHost?.addResourceTile?.(page) ?? game.modules.get(MODULE_ID)?.api?.addResource?.(page)
      });
      this.cityMapController.activate();
    }
    this.#setAutosaveStatus(this.autosaveState);
  }

  async _preClose(options) {
    await super._preClose(options);
    await this.captureForHostRender();
  }

  _onClose(options) {
    this.#tearDownView();
    super._onClose(options);
  }

  onPopoutLoaded(node) {
    this.#activate(this.embeddedRoot ?? node);
  }

  _onDetach(from, to) {
    super._onDetach?.(from, to);
    this.onPopoutLoaded(this.element);
  }

  _onAttach(from, to) {
    super._onAttach?.(from, to);
    this.onPopoutLoaded(this.element);
  }

  #tearDownView() {
    this.#clearAutosaveTimer();
    this.#closeImageContextMenu();
    this.#closeSlashMenu();
    this.#closeMentionMenu();
    this.cityMapController?.destroy();
    this.cityMapController = null;
    this.listenerController?.abort();
  }

  #root() {
    return this.embeddedRoot ?? this.element;
  }

  #document() {
    return getElementDocument(this.#root());
  }

  #window() {
    return getElementWindow(this.#root());
  }

  async #openImage(form) {
    const preview = form.querySelector(".dmj-resource-portrait img");
    const src = form.elements.image.value.trim() || preview.dataset.fallback;
    if (!src) return;
    try {
      const uuid = form.elements.linkedUuid?.value?.trim() || this.page.uuid;
      const title = form.elements.name.value.trim() || this.page.name;
      await new ImagePopout({ src, uuid, window: { title } }).render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error.message);
    }
  }

  #openImageContextMenu(event, portrait) {
    event.preventDefault();
    event.stopPropagation();
    this.#closeImageContextMenu();
    this.imageContextMenuController = new (this.#window().AbortController)();
    const listenerOptions = { signal: this.imageContextMenuController.signal };
    const menu = this.#document().createElement("div");
    menu.className = `${MODULE_ID} dmj-resource-image-context-menu`;
    menu.setAttribute("role", "menu");

    const changeButton = this.#document().createElement("button");
    changeButton.type = "button";
    changeButton.setAttribute("role", "menuitem");
    const icon = this.#document().createElement("i");
    icon.className = "fa-solid fa-image";
    icon.setAttribute("aria-hidden", "true");
    const label = this.#document().createElement("span");
    label.textContent = game.i18n.localize("DMJ.Resource.ChangeImage");
    changeButton.append(icon, label);
    changeButton.addEventListener("click", (clickEvent) => {
      clickEvent.preventDefault();
      this.#closeImageContextMenu();
      void this.#selectImage(portrait);
    }, listenerOptions);

    const adjustButton = this.#document().createElement("button");
    adjustButton.type = "button";
    adjustButton.setAttribute("role", "menuitem");
    const adjustIcon = this.#document().createElement("i");
    adjustIcon.className = "fa-solid fa-crop-simple";
    adjustIcon.setAttribute("aria-hidden", "true");
    const adjustLabel = this.#document().createElement("span");
    adjustLabel.textContent = game.i18n.localize("DMJ.Resource.AdjustImage");
    adjustButton.append(adjustIcon, adjustLabel);
    adjustButton.addEventListener("click", (clickEvent) => {
      clickEvent.preventDefault();
      this.#closeImageContextMenu();
      this.#openImageFramingControls(portrait.closest("form"));
    }, listenerOptions);
    menu.append(changeButton, adjustButton);
    this.#document().body.append(menu);

    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(event.clientX, this.#window().innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, this.#window().innerHeight - bounds.height - 8))}px`;
    this.#document().addEventListener("pointerdown", (pointerEvent) => {
      if (!menu.contains(pointerEvent.target)) this.#closeImageContextMenu();
    }, listenerOptions);
    this.#document().addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Escape") this.#closeImageContextMenu();
    }, listenerOptions);
    this.imageContextMenu = menu;
    changeButton.focus();
  }

  #closeImageContextMenu() {
    this.imageContextMenuController?.abort();
    this.imageContextMenuController = null;
    this.imageContextMenu?.remove();
    this.imageContextMenu = null;
  }

  async #selectImage(button) {
    try {
      const FilePickerClass = foundry.applications.apps.FilePicker.implementation;
      const picker = FilePickerClass.fromButton(button);
      picker.callback = (path) => {
        const form = this.#root().querySelector("form[data-form='resource-editor']");
        if (!form) return;
        form.elements.image.value = path;
        this.#updateImagePreview(form);
        this.#scheduleAutosave();
      };
      await picker.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error.message);
    }
  }

  #updateImagePreview(form) {
    const preview = form.querySelector(".dmj-resource-portrait img");
    if (!preview) return;
    const selectedPath = form.elements.image.value.trim();
    preview.src = selectedPath || preview.dataset.fallback;
  }

  #openImageFramingControls(form) {
    const controls = form?.querySelector("[data-image-framing-controls]");
    if (!controls) return;
    controls.hidden = false;
    controls.querySelector("[data-image-framing-input]")?.focus();
  }

  #closeImageFramingControls(form) {
    const controls = form?.querySelector("[data-image-framing-controls]");
    if (controls) controls.hidden = true;
  }

  #applyImageFraming(form) {
    const preview = form?.querySelector(".dmj-resource-portrait img");
    if (!preview) return;
    const positionX = Number(form.elements.imagePositionX?.value ?? 50);
    const positionY = Number(form.elements.imagePositionY?.value ?? 50);
    const zoom = Number(form.elements.imageZoom?.value ?? 100);
    preview.style.setProperty("--dmj-image-position-x", `${positionX}%`);
    preview.style.setProperty("--dmj-image-position-y", `${positionY}%`);
    preview.style.setProperty("--dmj-image-zoom", String(zoom / 100));
    for (const [name, value] of [["imagePositionX", positionX], ["imagePositionY", positionY], ["imageZoom", zoom]]) {
      const output = form.querySelector(`[data-image-framing-output="${name}"]`);
      if (output) output.textContent = `${value}%`;
    }
  }

  #resetImageFraming(form) {
    form.elements.imagePositionX.value = "50";
    form.elements.imagePositionY.value = "50";
    form.elements.imageZoom.value = "100";
    this.#applyImageFraming(form);
    this.#scheduleAutosave();
  }

  #togglePlaceHeader(form) {
    const collapsed = form.dataset.headerCollapsed === "true";
    const nextCollapsed = !collapsed;
    form.dataset.headerCollapsed = String(nextCollapsed);
    if (form.elements.headerCollapsed) form.elements.headerCollapsed.value = String(nextCollapsed);
    const button = form.querySelector("[data-action='toggle-place-header']");
    const label = game.i18n.localize(nextCollapsed ? "DMJ.Resource.ShowHeader" : "DMJ.Resource.HideHeader");
    button?.setAttribute("aria-expanded", String(!nextCollapsed));
    button?.setAttribute("aria-label", label);
    if (button) button.title = label;
    const icon = button?.querySelector("i");
    if (icon) icon.className = `fa-solid ${nextCollapsed ? "fa-chevron-down" : "fa-chevron-up"}`;
    this.#scheduleAutosave();
  }

  async #onSubmit(event) {
    event.preventDefault();
    this.#scheduleAutosave();
    await this.#saveResource();
  }

  async #onDrop(event) {
    event.preventDefault();
    try {
      const data = JSON.parse(event.dataTransfer.getData("text/plain"));
      const uuid = data.uuid ?? (data.type && data.id ? `${data.type}.${data.id}` : "");
      const document = uuid ? await fromUuid(uuid) : null;
      if (!document || !["Actor", "Item"].includes(document.documentName)) {
        throw new Error(game.i18n.localize("DMJ.Resource.Error.Drop"));
      }
      const form = this.#root().querySelector("form[data-form='resource-editor']");
      form.elements.linkedUuid.value = document.uuid;
      const linkedLabel = `${document.name} (${document.documentName})`;
      const linkedButton = form.querySelector("[data-action='open-linked']");
      const linkedName = linkedButton?.querySelector("[data-linked-name]");
      if (linkedName) linkedName.textContent = linkedLabel;
      if (linkedButton) {
        linkedButton.disabled = false;
        linkedButton.title = linkedLabel;
        linkedButton.setAttribute("aria-label", `${game.i18n.localize("DMJ.Resource.OpenLinked")}: ${linkedLabel}`);
      }
      linkedButton?.closest(".dmj-resource-link")?.classList.add("has-linked");
      const preview = form.querySelector(".dmj-resource-portrait img");
      if (!form.elements.image.value && document.img) preview.src = document.img;
      this.#scheduleAutosave();
    } catch (error) {
      ui.notifications.warn(error.message || game.i18n.localize("DMJ.Resource.Error.Drop"));
    }
  }

  #commands() {
    return [
      {
        type: "callout",
        icon: "fa-comment-dots",
        label: game.i18n.localize("DMJ.Board.Command.Callout"),
        hint: game.i18n.localize("DMJ.Board.Command.CalloutHint"),
        aliases: ["dialogo", "caixa de dialogo", "callout"]
      },
      {
        type: "check",
        icon: "fa-square-check",
        label: game.i18n.localize("DMJ.Board.Command.Check"),
        hint: game.i18n.localize("DMJ.Board.Command.CheckHint"),
        aliases: ["selecao", "caixa de selecao", "checkbox", "check"]
      },
      {
        type: "test",
        icon: "fa-dice-d20",
        label: game.i18n.localize("DMJ.Board.Command.Test"),
        hint: game.i18n.localize("DMJ.Board.Command.TestHint"),
        aliases: ["teste", "test", "rolagem", "prova"]
      }
    ];
  }

  #matchingCommands(rawQuery) {
    const typed = String(rawQuery ?? "").trim();
    const query = normalizeSearch(typed);
    return this.#commands().flatMap((command) => {
      if (!query) return [{ ...command, argument: "" }];
      const terms = [command.label, ...command.aliases].map(normalizeSearch).sort((a, b) => b.length - a.length);
      const searchable = terms.join(" ");
      if (searchable.includes(query)) return [{ ...command, argument: "" }];
      const prefix = terms.find((term) => query.startsWith(`${term} `));
      if (!prefix) return [];
      const argument = typed.split(/\s+/).slice(prefix.split(/\s+/).length).join(" ").slice(0, 120);
      return [{ ...command, argument }];
    });
  }

  #onFormInput(event) {
    if (event.target.matches?.("input[name='layout']")) {
      event.target.form.dataset.placeLayout = event.target.value;
    }
    const editor = event.target.closest?.("[data-resource-rich-editor]");
    if (editor) this.#handleEditorMutation(editor);
    this.#scheduleAutosave();
  }

  #onEditorPaste(event) {
    const editor = event.target.closest?.("[data-resource-rich-editor]");
    if (!editor) return;
    event.preventDefault();
    this.#insertPlainText(editor, event.clipboardData?.getData("text/plain") ?? "");
    this.#handleEditorMutation(editor);
    this.#scheduleAutosave();
  }

  #onEditorKeyDown(event) {
    const checkToggle = event.target.closest?.("[data-dmj-resource-check-toggle]");
    if (checkToggle && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      this.#toggleCheck(checkToggle);
      return;
    }

    const mention = event.target.closest?.("[data-dmj-mention]");
    if (mention && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      void this.#openMention(mention.dataset.uuid);
      return;
    }

    const editor = event.target.closest?.("[data-resource-rich-editor]");
    if (!editor) return;
    const formatKey = event.key.toLocaleLowerCase(game.i18n.lang);
    if ((event.ctrlKey || event.metaKey) && !event.altKey && ["b", "i"].includes(formatKey)) {
      event.preventDefault();
      this.#applyInlineFormat(editor, formatKey === "b" ? "strong" : "em");
      this.#handleEditorMutation(editor);
      this.#scheduleAutosave();
      return;
    }

    if (this.mentionState && editor === this.mentionState.editor && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const length = this.mentionState.resources.length;
      this.mentionState.activeIndex = (this.mentionState.activeIndex + direction + length) % length;
      this.#highlightMention();
      return;
    }
    if (this.mentionState && editor === this.mentionState.editor && event.key === "Enter") {
      event.preventDefault();
      this.#insertResourceMention(this.mentionState.resources[this.mentionState.activeIndex]);
      return;
    }
    if (this.mentionState && editor === this.mentionState.editor && event.key === "Escape") {
      event.preventDefault();
      this.#closeMentionMenu();
      return;
    }
    if (this.mentionState && editor === this.mentionState.editor && event.key === "Tab") this.#closeMentionMenu();

    if (this.slashState && editor === this.slashState.editor && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const length = this.slashState.commands.length;
      this.slashState.activeIndex = (this.slashState.activeIndex + direction + length) % length;
      this.#highlightSlashCommand();
      return;
    }
    if (this.slashState && editor === this.slashState.editor && event.key === "Enter") {
      event.preventDefault();
      this.#insertSlashBlock(this.slashState.commands[this.slashState.activeIndex].type);
      return;
    }
    if (this.slashState && editor === this.slashState.editor && event.key === "Escape") {
      event.preventDefault();
      this.#closeSlashMenu();
      return;
    }
    if (this.slashState && editor === this.slashState.editor && event.key === "Tab") this.#closeSlashMenu();
  }

  #onEditorClick(event) {
    const checkToggle = event.target.closest?.("[data-dmj-resource-check-toggle]");
    if (checkToggle) {
      event.preventDefault();
      this.#toggleCheck(checkToggle);
      return;
    }
    const mention = event.target.closest?.("[data-dmj-mention]");
    if (!mention) return;
    event.preventDefault();
    void this.#openMention(mention.dataset.uuid);
  }

  #toggleCheck(toggle) {
    const block = toggle.closest("[data-dmj-resource-check]");
    const editor = toggle.closest("[data-resource-rich-editor]");
    if (!block || !editor) return;
    const checked = block.dataset.checked !== "true";
    block.dataset.checked = String(checked);
    toggle.setAttribute("aria-checked", String(checked));
    toggle.textContent = checked ? "☑" : "☐";
    this.#handleEditorMutation(editor);
    this.#scheduleAutosave();
  }

  #handleEditorMutation(editor) {
    const text = richTextToPlainText(editor.innerHTML);
    if (text.length > 20000) {
      editor.innerHTML = plainTextToRichHTML(text.slice(0, 20000));
      this.#placeCaretAtEnd(editor);
    }
    this.#syncRichEditor(editor);
    this.#updateSlashMenu(editor);
    this.#updateMentionMenu(editor);
  }

  #syncRichEditor(editor) {
    const form = editor.closest("form[data-form='resource-editor']");
    const field = editor.dataset.fieldName;
    const value = field ? form?.elements?.[field] : null;
    if (value) value.value = sanitizeRichTextHTML(editor.innerHTML);
  }

  #syncAllRichEditors(form = this.#root()?.querySelector?.("form[data-form='resource-editor']")) {
    form?.querySelectorAll("[data-resource-rich-editor]").forEach((editor) => this.#syncRichEditor(editor));
  }

  #getEditorRange(editor) {
    const selection = editor.ownerDocument.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return editor.contains(range.commonAncestorContainer) ? range : null;
  }

  #applyInlineFormat(editor, tagName) {
    const range = this.#getEditorRange(editor);
    if (!range) return;
    const command = tagName === "strong" ? "bold" : "italic";
    if (typeof editor.ownerDocument.execCommand === "function") {
      try {
        if (editor.ownerDocument.execCommand(command, false, null)) return;
      } catch (error) {
        console.debug(`${MODULE_ID} | O comando nativo de formatação não está disponível.`, error);
      }
    }

    const selection = editor.ownerDocument.getSelection();
    const wrapper = editor.ownerDocument.createElement(tagName);
    if (!range.collapsed) {
      wrapper.append(range.extractContents());
      range.insertNode(wrapper);
      range.selectNodeContents(wrapper);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    const activeFormat = this.#findFormatAncestor(range.startContainer, editor, tagName);
    if (activeFormat) {
      range.setStartAfter(activeFormat);
      range.collapse(true);
    } else {
      const marker = editor.ownerDocument.createTextNode("\u200b");
      wrapper.append(marker);
      range.insertNode(wrapper);
      range.setStart(marker, marker.length);
      range.collapse(true);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  #findFormatAncestor(node, editor, tagName) {
    const acceptedTags = tagName === "strong" ? new Set(["STRONG", "B"]) : new Set(["EM", "I"]);
    let current = node.nodeType === 1 ? node : node.parentElement;
    while (current && current !== editor) {
      if (acceptedTags.has(current.tagName)) return current;
      current = current.parentElement;
    }
    return null;
  }

  #insertPlainText(editor, value) {
    const range = this.#getEditorRange(editor);
    if (!range) return;
    range.deleteContents();
    const fragment = editor.ownerDocument.createDocumentFragment();
    const lines = String(value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
    let lastNode = null;
    lines.forEach((line, index) => {
      if (index > 0) {
        lastNode = editor.ownerDocument.createElement("br");
        fragment.append(lastNode);
      }
      if (line) {
        lastNode = editor.ownerDocument.createTextNode(line);
        fragment.append(lastNode);
      }
    });
    if (!lastNode) return;
    range.insertNode(fragment);
    range.setStartAfter(lastNode);
    range.collapse(true);
    const selection = editor.ownerDocument.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  #placeCaretAtEnd(editor) {
    const range = editor.ownerDocument.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = editor.ownerDocument.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  #getEditorTextState(editor) {
    const range = this.#getEditorRange(editor);
    const text = richTextToPlainText(editor.innerHTML);
    if (!range) return { text, cursor: text.length };
    const prefix = range.cloneRange();
    prefix.selectNodeContents(editor);
    prefix.setEnd(range.endContainer, range.endOffset);
    const container = editor.ownerDocument.createElement("div");
    container.append(prefix.cloneContents());
    return { text, cursor: richTextToPlainText(container.innerHTML).length };
  }

  #getEditorDOMPoint(editor, requestedOffset) {
    const targetOffset = Math.max(0, requestedOffset);
    const view = editor.ownerDocument.defaultView;
    const walker = editor.ownerDocument.createTreeWalker(
      editor,
      view.NodeFilter.SHOW_TEXT | view.NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          if (node.nodeType === view.Node.TEXT_NODE || node.tagName === "BR") return view.NodeFilter.FILTER_ACCEPT;
          return view.NodeFilter.FILTER_SKIP;
        }
      }
    );
    let consumed = 0;
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === view.Node.TEXT_NODE) {
        const value = node.nodeValue ?? "";
        const visibleLength = value.replaceAll("\u200b", "").length;
        if (targetOffset <= consumed + visibleLength) {
          const visibleTarget = targetOffset - consumed;
          let rawOffset = 0;
          let visibleOffset = 0;
          while (rawOffset < value.length && visibleOffset < visibleTarget) {
            if (value[rawOffset] !== "\u200b") visibleOffset += 1;
            rawOffset += 1;
          }
          return { node, offset: rawOffset };
        }
        consumed += visibleLength;
        continue;
      }

      const childIndex = [...node.parentNode.childNodes].indexOf(node);
      if (targetOffset <= consumed) return { node: node.parentNode, offset: childIndex };
      consumed += 1;
      if (targetOffset <= consumed) return { node: node.parentNode, offset: childIndex + 1 };
    }
    return { node: editor, offset: editor.childNodes.length };
  }

  #createEditorRange(editor, startOffset, endOffset) {
    const start = this.#getEditorDOMPoint(editor, startOffset);
    const end = this.#getEditorDOMPoint(editor, endOffset);
    const range = editor.ownerDocument.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return range;
    } catch (error) {
      console.warn(`${MODULE_ID} | Não foi possível mapear o trecho do editor.`, error);
      return null;
    }
  }

  #getEditorOffsetPosition(editor, index) {
    const range = this.#createEditorRange(editor, Math.max(0, index - 1), index);
    const rectangles = range ? [...range.getClientRects()] : [];
    const rectangle = rectangles.at(-1);
    const bounds = editor.getBoundingClientRect();
    return rectangle ? { left: rectangle.right, bottom: rectangle.bottom } : { left: bounds.left + 6, bottom: bounds.top + 24 };
  }

  #updateMentionMenu(editor) {
    const { text, cursor } = this.#getEditorTextState(editor);
    const lineStart = text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
    const textBeforeCursor = text.slice(lineStart, cursor);
    const match = textBeforeCursor.match(/(?:^|\s)@([^@\n]*)$/);
    if (!match) {
      this.#closeMentionMenu();
      return;
    }

    const mentionStart = lineStart + match.index + match[0].lastIndexOf("@");
    const startPoint = this.#getEditorDOMPoint(editor, Math.min(cursor, mentionStart + 1));
    const startElement = startPoint.node.nodeType === 1 ? startPoint.node : startPoint.node.parentElement;
    if (startElement?.closest?.("[data-dmj-mention]")) {
      this.#closeMentionMenu();
      return;
    }

    const query = normalizeSearch(match[1]);
    const resources = ResourceService.getResources()
      .map((page) => {
        const kind = ResourceService.getData(page).kind;
        return {
          uuid: page.uuid,
          name: page.name,
          kindLabel: game.i18n.localize(`DMJ.Resource.Kind.${kind}`),
          icon: RESOURCE_MENTION_ICONS[kind] ?? "fa-book-open"
        };
      })
      .filter((resource) => !query || normalizeSearch(`${resource.name} ${resource.kindLabel}`).includes(query))
      .slice(0, 20);
    if (!resources.length) {
      this.#closeMentionMenu();
      return;
    }
    this.#showMentionMenu({ editor, mentionStart, mentionEnd: cursor, resources });
  }

  #showMentionMenu({ editor, mentionStart, mentionEnd, resources }) {
    this.#closeMentionMenu();
    this.#closeSlashMenu();
    const ownerDocument = getElementDocument(editor);
    const menu = ownerDocument.createElement("div");
    menu.className = "dmj-mention-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", game.i18n.localize("DMJ.Board.MentionMenu"));
    for (const resource of resources) {
      const button = ownerDocument.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      const icon = ownerDocument.createElement("i");
      icon.className = `fa-solid ${resource.icon}`;
      icon.setAttribute("aria-hidden", "true");
      const text = ownerDocument.createElement("span");
      const title = ownerDocument.createElement("strong");
      title.textContent = resource.name;
      const kind = ownerDocument.createElement("small");
      kind.textContent = resource.kindLabel;
      text.append(title, kind);
      button.append(icon, text);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.#insertResourceMention(resource);
      });
      menu.append(button);
    }
    ownerDocument.body.append(menu);
    this.#positionMenu(menu, editor, mentionStart + 1);
    this.mentionState = { editor, mentionStart, mentionEnd, resources, activeIndex: 0, menu };
    this.#highlightMention();
  }

  #highlightMention() {
    this.mentionState?.menu.querySelectorAll("button").forEach((button, index) => {
      button.classList.toggle("active", index === this.mentionState.activeIndex);
      button.setAttribute("aria-selected", String(index === this.mentionState.activeIndex));
    });
  }

  #closeMentionMenu() {
    this.mentionState?.menu.remove();
    this.mentionState = null;
  }

  #insertResourceMention(resource) {
    if (!this.mentionState || !resource) return;
    const { editor, mentionStart, mentionEnd } = this.mentionState;
    const range = this.#createEditorRange(editor, mentionStart, mentionEnd);
    if (!range) return;
    range.deleteContents();
    const mention = editor.ownerDocument.createElement("span");
    mention.className = "dmj-inline-mention";
    mention.contentEditable = "false";
    mention.tabIndex = 0;
    mention.setAttribute("role", "link");
    mention.dataset.dmjMention = "";
    mention.dataset.uuid = resource.uuid;
    mention.textContent = `@${resource.name}`;
    const separator = editor.ownerDocument.createTextNode(" ");
    const fragment = editor.ownerDocument.createDocumentFragment();
    fragment.append(mention, separator);
    range.insertNode(fragment);
    range.setStartAfter(separator);
    range.collapse(true);
    const selection = editor.ownerDocument.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    this.#closeMentionMenu();
    this.#handleEditorMutation(editor);
    this.#scheduleAutosave();
  }

  async #openMention(uuid) {
    try {
      const resource = ResourceService.getResources().find((page) => page.uuid === uuid);
      if (resource) {
        if (this.workspaceHost) await this.workspaceHost.openResource(resource);
        else await game.modules.get(MODULE_ID).api.openResource(resource);
        return;
      }
      const document = uuid ? await fromUuid(uuid) : null;
      if (!document || !["Actor", "Item"].includes(document.documentName)) throw new Error(game.i18n.localize("DMJ.Board.MentionMissing"));
      await document.sheet.render({ force: true });
    } catch (error) {
      ui.notifications.warn(error.message || game.i18n.localize("DMJ.Board.MentionMissing"));
    }
  }

  #updateSlashMenu(editor) {
    const { text, cursor } = this.#getEditorTextState(editor);
    const lineStart = text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
    const textBeforeCursor = text.slice(lineStart, cursor);
    const match = textBeforeCursor.match(/(?:^|\s)\/([^/\n]*)$/);
    if (!match) {
      this.#closeSlashMenu();
      return;
    }
    const commands = this.#matchingCommands(match[1]);
    if (!commands.length) {
      this.#closeSlashMenu();
      return;
    }
    const commandStart = lineStart + match.index + match[0].lastIndexOf("/");
    this.#showSlashMenu({ editor, commandStart, commandEnd: cursor, commands });
  }

  #showSlashMenu({ editor, commandStart, commandEnd, commands }) {
    this.#closeSlashMenu();
    this.#closeMentionMenu();
    const ownerDocument = getElementDocument(editor);
    const menu = ownerDocument.createElement("div");
    menu.className = "dmj-slash-menu";
    menu.setAttribute("role", "listbox");
    for (const command of commands) {
      const button = ownerDocument.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      const icon = ownerDocument.createElement("i");
      icon.className = `fa-solid ${command.icon}`;
      icon.setAttribute("aria-hidden", "true");
      const text = ownerDocument.createElement("span");
      const title = ownerDocument.createElement("strong");
      title.textContent = command.label;
      const hint = ownerDocument.createElement("small");
      hint.textContent = command.hint;
      text.append(title, hint);
      button.append(icon, text);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.#insertSlashBlock(command.type);
      });
      menu.append(button);
    }
    ownerDocument.body.append(menu);
    this.#positionMenu(menu, editor, commandStart + 1);
    this.slashState = { editor, commandStart, commandEnd, commands, activeIndex: 0, menu };
    this.#highlightSlashCommand();
  }

  #positionMenu(menu, editor, index) {
    const anchor = this.#getEditorOffsetPosition(editor, index);
    const ownerWindow = getElementWindow(editor);
    const viewportPadding = 8;
    const availableWidth = Math.max(160, ownerWindow.innerWidth - (viewportPadding * 2));
    const menuWidth = Math.min(340, Math.max(280, editor.getBoundingClientRect().width), availableWidth);
    const left = Math.max(viewportPadding, Math.min(anchor.left, ownerWindow.innerWidth - menuWidth - viewportPadding));
    const top = Math.max(viewportPadding, anchor.bottom + 4);
    menu.style.width = `${menuWidth}px`;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.maxHeight = `${Math.max(72, ownerWindow.innerHeight - top - viewportPadding)}px`;
  }

  #highlightSlashCommand() {
    this.slashState?.menu.querySelectorAll("button").forEach((button, index) => {
      button.classList.toggle("active", index === this.slashState.activeIndex);
      button.setAttribute("aria-selected", String(index === this.slashState.activeIndex));
    });
  }

  #closeSlashMenu() {
    this.slashState?.menu.remove();
    this.slashState = null;
  }

  #insertSlashBlock(type) {
    if (!this.slashState || !["callout", "check", "test"].includes(type)) return;
    const { editor, commandStart, commandEnd } = this.slashState;
    const command = this.slashState.commands.find((entry) => entry.type === type);
    const range = this.#createEditorRange(editor, commandStart, commandEnd);
    if (!range) return;
    range.deleteContents();
    const block = editor.ownerDocument.createElement("span");
    let marker;
    if (type === "callout") {
      block.className = "dmj-resource-callout";
      block.dataset.dmjResourceCallout = "";
      const title = editor.ownerDocument.createElement("strong");
      title.textContent = `${game.i18n.localize("DMJ.Board.Command.Callout")}: `;
      const content = editor.ownerDocument.createElement("span");
      content.dataset.dmjResourceCalloutText = "";
      marker = editor.ownerDocument.createTextNode("\u200b");
      content.append(marker);
      block.append(title, content);
    } else if (type === "check") {
      block.className = "dmj-resource-check";
      block.dataset.dmjResourceCheck = "";
      block.dataset.checked = "false";
      const toggle = editor.ownerDocument.createElement("span");
      toggle.className = "dmj-resource-check-toggle";
      toggle.contentEditable = "false";
      toggle.tabIndex = 0;
      toggle.setAttribute("role", "checkbox");
      toggle.setAttribute("aria-checked", "false");
      toggle.dataset.dmjResourceCheckToggle = "";
      toggle.textContent = "☐";
      const content = editor.ownerDocument.createElement("span");
      content.dataset.dmjResourceCheckText = "";
      marker = editor.ownerDocument.createTextNode("\u200b");
      content.append(marker);
      block.append(toggle, content);
    } else {
      block.className = "dmj-resource-test";
      block.dataset.dmjResourceTest = "";
      const title = editor.ownerDocument.createElement("span");
      title.dataset.dmjResourceTestTitle = "";
      const titleLabel = editor.ownerDocument.createElement("strong");
      titleLabel.textContent = `${game.i18n.localize("DMJ.Board.Command.Test")}: `;
      title.append(titleLabel);
      if (command?.argument) title.append(editor.ownerDocument.createTextNode(command.argument));

      const success = editor.ownerDocument.createElement("span");
      success.dataset.dmjResourceTestSuccess = "";
      const successLabel = editor.ownerDocument.createElement("strong");
      successLabel.textContent = `${game.i18n.localize("DMJ.Board.TestSuccess")}: `;
      marker = editor.ownerDocument.createTextNode("\u200b");
      success.append(successLabel, marker);

      const failure = editor.ownerDocument.createElement("span");
      failure.dataset.dmjResourceTestFailure = "";
      const failureLabel = editor.ownerDocument.createElement("strong");
      failureLabel.textContent = `${game.i18n.localize("DMJ.Board.TestFailure")}: `;
      failure.append(failureLabel, editor.ownerDocument.createTextNode("\u200b"));

      if (!command?.argument) {
        marker.remove();
        marker = editor.ownerDocument.createTextNode("\u200b");
        title.append(marker);
        success.append(editor.ownerDocument.createTextNode("\u200b"));
      }
      block.append(title, success, failure);
    }
    range.insertNode(block);
    range.setStart(marker, marker.length);
    range.collapse(true);
    const selection = editor.ownerDocument.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    this.#closeSlashMenu();
    this.#handleEditorMutation(editor);
    this.#scheduleAutosave();
  }

  #scheduleAutosave() {
    this.autosaveRevision += 1;
    this.#clearAutosaveTimer();
    this.#setAutosaveStatus("pending");
    this.autosaveTimer = window.setTimeout(() => {
      this.autosaveTimer = null;
      void this.#saveResource();
    }, AUTOSAVE_DELAY_MS);
  }

  #clearAutosaveTimer() {
    if (this.autosaveTimer === null) return;
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  async #saveResource() {
    if (this.savePromise) return this.savePromise;
    if (this.autosaveRevision === this.savedRevision) {
      this.#setAutosaveStatus("saved");
      return true;
    }

    const saveTask = (async () => {
      while (this.savedRevision !== this.autosaveRevision) {
        this.#clearAutosaveTimer();
        const form = this.#root()?.querySelector?.("form[data-form='resource-editor']");
        if (!form) return false;
        this.#syncAllRichEditors(form);
        const revision = this.autosaveRevision;
        this.#setAutosaveStatus("saving");
        try {
          await ResourceService.updateResource(this.page, new (getElementWindow(form).FormData)(form));
          this.savedRevision = revision;
          this.saveErrorNotified = false;
        } catch (error) {
          console.error(`${MODULE_ID} |`, error);
          this.#setAutosaveStatus("error");
          if (!this.saveErrorNotified) {
            ui.notifications.error(error.message || game.i18n.localize("DMJ.Resource.AutosaveError"));
            this.saveErrorNotified = true;
          }
          return false;
        }

        try {
          if (this.workspaceHost) {
            await this.workspaceHost.refreshResourceTile(this.page);
            this.workspaceHost.updateWorkspaceLabel("resource", this.page.id, this.page.name);
          } else {
            await game.modules.get(MODULE_ID)?.api?.refreshResource?.(this.page);
          }
        } catch (error) {
          console.warn(`${MODULE_ID} | Não foi possível atualizar o painel da biblioteca.`, error);
        }
      }
      this.#setAutosaveStatus("saved");
      return true;
    })();

    this.savePromise = saveTask;
    try {
      return await saveTask;
    } finally {
      if (this.savePromise === saveTask) this.savePromise = null;
    }
  }

  #setAutosaveStatus(state) {
    const statuses = {
      pending: { icon: "fa-clock", label: "DMJ.Resource.AutosavePending" },
      saving: { icon: "fa-spinner fa-spin", label: "DMJ.Resource.AutosaveSaving" },
      saved: { icon: "fa-check", label: "DMJ.Resource.AutosaveSaved" },
      error: { icon: "fa-triangle-exclamation", label: "DMJ.Resource.AutosaveError" }
    };
    const status = statuses[state] ?? statuses.saved;
    this.autosaveState = state in statuses ? state : "saved";
    const indicator = this.#root()?.querySelector?.("[data-resource-autosave-status]");
    if (!indicator) return;
    indicator.dataset.state = this.autosaveState;
    indicator.querySelector("i").className = `fa-solid ${status.icon}`;
    indicator.querySelector("span").textContent = game.i18n.localize(status.label);
  }

  async #openLinked() {
    try {
      const form = this.#root()?.querySelector?.("form[data-form='resource-editor']");
      const uuid = form?.elements?.linkedUuid?.value?.trim();
      const document = uuid ? await fromUuid(uuid) : null;
      if (!document || !["Actor", "Item"].includes(document.documentName)) throw new Error(game.i18n.localize("DMJ.Resource.LinkedMissing"));
      await document.sheet.render({ force: true });
    } catch (error) {
      ui.notifications.warn(error.message || game.i18n.localize("DMJ.Resource.LinkedMissing"));
    }
  }
}
