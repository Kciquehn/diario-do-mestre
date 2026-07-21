import { MODULE_ID } from "../constants.js";
import { DiaryService, SESSION_FIELDS } from "../services/diary-service.js";
import { CLUE_DRAG_TYPE } from "../services/clue-service.js";
import { ResourceService } from "../services/resource-service.js";
import { plainTextToRichHTML, richTextToPlainText, sanitizeRichTextHTML } from "../utils/rich-text.js";
import { getElementDocument, getElementWindow, isPopoutAvailable, popoutApplication } from "../compat/popout.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const BLOCK_TYPES = Object.freeze(["text", "callout", "check", "test", "clue"]);
const AUTOSAVE_DELAY_MS = 750;
const DEFAULT_COLUMN_WIDTH = 300;
const MIN_COLUMN_WIDTH = 240;
const MAX_COLUMN_WIDTH = 900;
const MIN_COLUMN_HEIGHT = 140;
const MAX_COLUMN_HEIGHT = 1600;
const COLUMN_KEYBOARD_STEP = 20;
const MAX_SCENE_LINKS = 100;
const TEMPLATE = `modules/${MODULE_ID}/templates/session-board.hbs`;
const RESOURCE_MENTION_ICONS = Object.freeze({
  person: "fa-user",
  place: "fa-location-dot",
  item: "fa-gem",
  encounter: "fa-skull-crossbones",
  faction: "fa-people-group"
});
const SESSION_FIELD_PRESENTATION = Object.freeze({
  goal: { icon: "fa-bullseye", rows: 3, placeholder: "DMJ.Placeholder.goal" },
  recap: { icon: "fa-clock-rotate-left", rows: 4 },
  opening: { icon: "fa-door-open", rows: 4 },
  scenes: { icon: "fa-clapperboard", rows: 5, placeholder: "DMJ.Placeholder.scenes" },
  npcs: { icon: "fa-users", rows: 4 },
  locations: { icon: "fa-map-location-dot", rows: 4 },
  encounters: { icon: "fa-skull", rows: 4 },
  items: { icon: "fa-gem", rows: 4 },
  clues: { icon: "fa-magnifying-glass", rows: 4 },
  improvisation: { icon: "fa-wand-magic-sparkles", rows: 4 },
  notes: { icon: "fa-pen-to-square", rows: 4 }
});
const AUTOSAVE_ACTIONS = Object.freeze([
  "remove-block",
  "add-scene",
  "select-scene",
  "remove-scene",
  "add-column",
  "remove-column",
  "add-card",
  "remove-card",
  "remove-test-outcome"
]);

function newTestResult() {
  return {
    id: crypto.randomUUID(),
    value: "",
    html: "",
    text: ""
  };
}

function newBlock(type = "text", text = "", requestedTitle = "") {
  const title = type === "callout"
    ? game.i18n.localize("DMJ.Board.Callout")
    : type === "test"
      ? String(requestedTitle).trim().slice(0, 120) || game.i18n.localize("DMJ.Board.Test")
      : type === "clue"
        ? String(requestedTitle).trim().slice(0, 120) || game.i18n.localize("DMJ.Board.Clue")
      : "";
  return {
    id: crypto.randomUUID(),
    type,
    title,
    height: null,
    html: plainTextToRichHTML(text),
    text,
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

function newCard() {
  return { id: crypto.randomUUID(), completed: false, blocks: [newBlock()] };
}

function newColumn(title = game.i18n.localize("DMJ.Board.NewColumn")) {
  return { id: crypto.randomUUID(), title, width: DEFAULT_COLUMN_WIDTH, height: null, cards: [] };
}

function newScene(number) {
  return {
    id: crypto.randomUUID(),
    title: game.i18n.format("DMJ.Board.SceneNumber", { number }),
    links: [],
    columns: []
  };
}

function normalizeSearch(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(game.i18n.lang).trim();
}

function normalizeTextareaHeight(value) {
  const height = Number(value);
  return Number.isFinite(height) && height > 0 ? Math.round(Math.min(1600, Math.max(36, height))) : null;
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

export class SessionBoard extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(page, options = {}) {
    super({ id: `${MODULE_ID}-board-${page.id}`, ...options });
    this.page = page;
    this.board = null;
    this.draggedCard = null;
    this.listenerController = null;
    this.slashState = null;
    this.mentionState = null;
    this.sceneLinkMenu = null;
    this.focusAfterRender = null;
    this.autosaveTimer = null;
    this.autosaveRevision = 0;
    this.savedRevision = 0;
    this.autosaveState = "saved";
    this.savePromise = null;
    this.saveErrorNotified = false;
    this.editorResizeState = null;
    this.columnResizeState = null;
    this.embeddedRoot = null;
    this.workspaceHost = null;
    this.sessionDetails = null;
    this.detailsCollapsed = false;
  }

  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "session-board"],
    tag: "section",
    window: { title: "DMJ.Board.Title", icon: "fa-solid fa-list-check", resizable: true },
    position: { width: 1150, height: 800 }
  };

  static PARTS = {
    main: { template: TEMPLATE }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return { ...context, ...await this.#prepareViewContext() };
  }

  async #prepareViewContext() {
    this.board ??= DiaryService.getBoardData(this.page);
    this.sessionDetails ??= this.#sessionDetailsFromPage();
    const currentStatus = this.sessionDetails.status;
    const detailFields = SESSION_FIELDS.map((field) => {
      const presentation = SESSION_FIELD_PRESENTATION[field];
      return {
        id: field,
        icon: presentation.icon,
        rows: presentation.rows,
        label: game.i18n.localize(`DMJ.Field.${field}`),
        placeholder: presentation.placeholder ? game.i18n.localize(presentation.placeholder) : "",
        value: this.sessionDetails[field] ?? ""
      };
    });
    const scenes = this.board.scenes.map((scene) => ({ ...scene, active: scene.id === this.board.activeSceneId }));
    const sourceScene = this.board.scenes.find((scene) => scene.id === this.board.activeSceneId);
    const resourcePages = new Map(ResourceService.getResources().map((page) => [page.uuid, page]));
    const links = sourceScene
      ? await Promise.all((sourceScene.links ?? []).map((link) => this.#prepareSceneLink(link, resourcePages)))
      : [];
    const activeScene = sourceScene ? {
      ...sourceScene,
      links,
      linkCount: links.length,
      hasLinks: links.length > 0,
      columns: sourceScene.columns.map((column) => ({
        ...column,
        height: normalizeColumnHeight(column.height),
        resizeHeight: normalizeColumnHeight(column.height) ?? MIN_COLUMN_HEIGHT,
        cards: column.cards.map((card) => ({
          ...card,
          blocks: card.blocks.map((block) => ({
            ...block,
            editorHTML: sanitizeRichTextHTML(block.html ?? plainTextToRichHTML(block.text)),
            successEditorHTML: sanitizeRichTextHTML(block.successHTML ?? plainTextToRichHTML(block.successText)),
            hasSuccess: Boolean(richTextToPlainText(block.successHTML ?? plainTextToRichHTML(block.successText)).trim()),
            failureEditorHTML: sanitizeRichTextHTML(block.failureHTML ?? plainTextToRichHTML(block.failureText)),
            hasFailure: Boolean(richTextToPlainText(block.failureHTML ?? plainTextToRichHTML(block.failureText)).trim()),
            descriptionEditorHTML: sanitizeRichTextHTML(block.descriptionHTML ?? plainTextToRichHTML(block.descriptionText)),
            hasDescription: Boolean(richTextToPlainText(block.descriptionHTML ?? plainTextToRichHTML(block.descriptionText)).trim()),
            results: (Array.isArray(block.results) ? block.results : []).map((result) => ({
              ...result,
              editorHTML: sanitizeRichTextHTML(result.html ?? plainTextToRichHTML(result.text))
            })),
            canAddResult: (Array.isArray(block.results) ? block.results.length : 0) < 50,
            isText: block.type === "text",
            isCallout: block.type === "callout",
            isCheck: block.type === "check",
            isTest: block.type === "test",
            isClue: block.type === "clue"
          }))
        }))
      }))
    } : null;
    return {
      sessionName: this.sessionDetails.name || this.page.name,
      sessionDetails: {
        ...this.sessionDetails,
        statusDraft: currentStatus === "draft",
        statusReady: currentStatus === "ready",
        statusPlayed: currentStatus === "played"
      },
      detailFields,
      detailsCollapsed: this.detailsCollapsed,
      formIdSuffix: this.page.id,
      scenes,
      activeScene,
      hasScenes: Boolean(activeScene),
      popoutAvailable: isPopoutAvailable(this.workspaceHost ?? this),
      boardHelpId: `dmj-board-help-${this.page.id}`
    };
  }

  #sessionDetailsFromPage() {
    const rawStatus = this.page.getFlag(MODULE_ID, "status");
    return {
      ...DiaryService.getSessionData(this.page),
      name: this.page.name,
      date: this.page.getFlag(MODULE_ID, "date") ?? "",
      image: DiaryService.getSessionImage(this.page),
      status: ["draft", "ready", "played"].includes(rawStatus) ? rawStatus : "draft"
    };
  }

  async #prepareSceneLink(link, resourcePages) {
    const resourcePage = resourcePages.get(link.uuid);
    let linkedDocument = resourcePage ?? null;
    if (!linkedDocument) {
      try {
        linkedDocument = await fromUuid(link.uuid);
      } catch {
        linkedDocument = null;
      }
    }

    const supportedDocument = resourcePage || ["Actor", "Item"].includes(linkedDocument?.documentName);
    if (!linkedDocument || !supportedDocument) {
      return {
        ...link,
        missing: true,
        icon: "fa-link-slash",
        kindLabel: game.i18n.localize("DMJ.Board.SceneLinkMissing")
      };
    }

    if (resourcePage) {
      const data = ResourceService.getData(resourcePage);
      const linked = data.image ? null : await ResourceService.getLinkedDocument(resourcePage);
      return {
        ...link,
        name: resourcePage.name,
        documentName: "JournalEntryPage",
        kind: data.kind,
        image: data.image || linked?.img || link.image || "",
        missing: false,
        icon: RESOURCE_MENTION_ICONS[data.kind] ?? "fa-bookmark",
        kindLabel: game.i18n.localize(`DMJ.Resource.Kind.${data.kind}`)
      };
    }

    return {
      ...link,
      name: linkedDocument.name || link.name,
      documentName: linkedDocument.documentName,
      kind: "",
      image: linkedDocument.img || link.image || "",
      missing: false,
      icon: linkedDocument.documentName === "Actor" ? "fa-user" : "fa-gem",
      kindLabel: game.i18n.localize(`DMJ.Board.SceneLinkKind.${linkedDocument.documentName}`)
    };
  }

  async mount(container, host) {
    this.embeddedRoot = container;
    this.workspaceHost = host;
    container.classList.add(MODULE_ID, "session-board", "dmj-workspace-view");
    container.innerHTML = await foundry.applications.handlebars.renderTemplate(TEMPLATE, await this.#prepareViewContext());
    this.#activate(container);
    return this;
  }

  async focusBlock(rawBlockId) {
    const blockId = String(rawBlockId ?? "").trim();
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(blockId)) return false;
    this.board ??= DiaryService.getBoardData(this.page);
    if (this.#root()) this.#syncActiveScene();
    const scene = this.board.scenes.find((candidate) => candidate.columns.some((column) => (
      column.cards.some((card) => card.blocks.some((block) => block.id === blockId))
    )));
    if (!scene) return false;

    this.board.activeSceneId = scene.id;
    await this.#refreshView();
    const block = this.#root()?.querySelector(`[data-block-id="${blockId}"]`);
    if (!block) return false;
    block.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    block.classList.add("dmj-clue-focus");
    this.#window().setTimeout(() => block.classList.remove("dmj-clue-focus"), 2400);
    this.#scheduleAutosave();
    return true;
  }

  async captureForHostRender() {
    this.#clearAutosaveTimer();
    this.#closeSlashMenu();
    this.#closeMentionMenu();
    this.#closeSceneLinkMenu();
    this.#syncSessionDetails();
    this.#syncActiveScene();
    await this.#saveBoard();
  }

  async unmount() {
    await this.captureForHostRender();
    this.#tearDownView();
    this.embeddedRoot = null;
    this.workspaceHost = null;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#activate(this.element);
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

  #activate(root) {
    this.#closeSlashMenu();
    this.#closeMentionMenu();
    this.#closeSceneLinkMenu();
    this.listenerController?.abort();
    this.listenerController = new (getElementWindow(root).AbortController)();
    const listenerOptions = { signal: this.listenerController.signal };
    const rootDocument = getElementDocument(root);

    root.addEventListener("click", this.#onClick.bind(this), listenerOptions);
    root.addEventListener("dblclick", this.#onDoubleClick.bind(this), listenerOptions);
    root.addEventListener("submit", (event) => {
      if (event.target.matches("[data-form='board-details']")) event.preventDefault();
    }, listenerOptions);
    root.addEventListener("input", this.#onInput.bind(this), listenerOptions);
    root.addEventListener("change", this.#onChange.bind(this), listenerOptions);
    root.addEventListener("keydown", this.#onKeyDown.bind(this), listenerOptions);
    root.addEventListener("paste", this.#onPaste.bind(this), listenerOptions);
    root.addEventListener("focusout", this.#onFocusOut.bind(this), listenerOptions);
    root.addEventListener("pointerdown", this.#onPointerDown.bind(this), listenerOptions);
    rootDocument.addEventListener("pointermove", this.#onPointerMove.bind(this), listenerOptions);
    rootDocument.addEventListener("pointerup", this.#onPointerUp.bind(this), listenerOptions);
    rootDocument.addEventListener("pointercancel", this.#onPointerUp.bind(this), listenerOptions);
    rootDocument.addEventListener("pointerdown", (event) => {
      if (this.slashState && !this.slashState.menu.contains(event.target) && !this.slashState.editor.contains(event.target)) this.#closeSlashMenu();
      if (this.mentionState && !this.mentionState.menu.contains(event.target) && !this.mentionState.editor.contains(event.target)) this.#closeMentionMenu();
      if (this.sceneLinkMenu && !this.sceneLinkMenu.contains(event.target)) this.#closeSceneLinkMenu();
    }, listenerOptions);
    root.addEventListener("dragstart", (event) => {
      const clueHandle = event.target.closest("[data-clue-drag-handle]");
      if (clueHandle) {
        const clueBlock = clueHandle.closest(".dmj-clue-block");
        const title = clueBlock?.querySelector("[data-block-title]")?.value.trim().slice(0, 120);
        const editor = clueBlock?.querySelector("[data-block-text]");
        if (!clueBlock || !editor || !event.dataTransfer) return;
        this.#syncActiveScene();
        this.#scheduleAutosave();
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", JSON.stringify({
          type: CLUE_DRAG_TYPE,
          sourceSessionPageId: this.page.id,
          sourceBlockId: clueBlock.dataset.blockId,
          title: title || game.i18n.localize("DMJ.Board.Clue")
        }));
        clueBlock.classList.add("dragging-to-scene");
        return;
      }
      const handle = event.target.closest("[data-card-drag-handle]");
      this.draggedCard = handle?.closest(".dmj-task-card") ?? null;
      if (this.draggedCard) {
        this.#closeSlashMenu();
        this.#closeMentionMenu();
        this.draggedCard.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", this.draggedCard.dataset.cardId);
      }
    }, listenerOptions);
    root.addEventListener("dragend", () => {
      root.querySelectorAll(".dmj-clue-block.dragging-to-scene").forEach((block) => block.classList.remove("dragging-to-scene"));
      this.draggedCard?.classList.remove("dragging");
      this.#clearDropTargets();
      this.draggedCard = null;
    }, listenerOptions);
    root.addEventListener("dragleave", (event) => {
      const linkZone = event.target.closest?.("[data-scene-links-drop]");
      if (linkZone && !linkZone.contains(event.relatedTarget)) linkZone.classList.remove("drag-target");
      const editor = event.target.closest?.("[data-block-text]");
      if (editor && !editor.contains(event.relatedTarget)) editor.classList.remove("dmj-mention-drop-target");
    }, listenerOptions);
    root.addEventListener("dragover", (event) => {
      const linkZone = event.target.closest?.("[data-scene-links-drop]");
      if (linkZone && !this.draggedCard) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        this.#clearDropTargets();
        linkZone.classList.add("drag-target");
        return;
      }
      const editor = event.target.closest?.("[data-block-text]");
      if (editor && !this.draggedCard) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        this.#clearDropTargets();
        editor.classList.add("dmj-mention-drop-target");
        return;
      }
      const list = event.target.closest(".dmj-task-list");
      if (!list || !this.draggedCard) {
        this.#clearDropTargets();
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      this.#clearDropTargets();
      list.classList.add("drag-target");
    }, listenerOptions);
    root.addEventListener("drop", (event) => {
      const linkZone = event.target.closest?.("[data-scene-links-drop]");
      if (linkZone && !this.draggedCard) {
        event.preventDefault();
        const rawData = event.dataTransfer.getData("text/plain");
        this.#clearDropTargets();
        void this.#insertDroppedSceneLink(rawData);
        return;
      }
      const editor = event.target.closest?.("[data-block-text]");
      if (editor && !this.draggedCard) {
        event.preventDefault();
        const drop = {
          clientX: event.clientX,
          clientY: event.clientY,
          rawData: event.dataTransfer.getData("text/plain")
        };
        this.#clearDropTargets();
        void this.#insertDroppedDocument(editor, drop);
        return;
      }
      const list = event.target.closest(".dmj-task-list");
      if (!list || !this.draggedCard) {
        this.#clearDropTargets();
        return;
      }
      event.preventDefault();
      const before = [...list.querySelectorAll(".dmj-task-card:not(.dragging)")].find((card) => {
        const bounds = card.getBoundingClientRect();
        return event.clientY < bounds.top + (bounds.height / 2);
      });
      list.insertBefore(this.draggedCard, before ?? null);
      this.#clearDropTargets();
      this.#updateCounts();
      this.#scheduleAutosave();
    }, listenerOptions);

    this.#updateCounts();
    this.#initializeEditorSizing(root);
    this.#setAutosaveStatus(this.autosaveState);
    this.#applyDetailsState();
    if (this.focusAfterRender) {
      root.querySelector(`[data-card-id="${this.focusAfterRender}"] [data-block-text]`)?.focus();
      this.focusAfterRender = null;
    }
  }

  async _preClose(options) {
    await super._preClose(options);
    await this.captureForHostRender();
  }

  _onClose(options) {
    this.#tearDownView();
    super._onClose(options);
  }

  #tearDownView() {
    this.#closeSlashMenu();
    this.#closeMentionMenu();
    this.#closeSceneLinkMenu();
    this.#clearAutosaveTimer();
    this.editorResizeState = null;
    this.columnResizeState = null;
    this.#root()?.classList.remove("dmj-resizing-column-width", "dmj-resizing-column-height");
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

  async #refreshView() {
    this.#syncSessionDetails();
    if (this.embeddedRoot) return this.mount(this.embeddedRoot, this.workspaceHost);
    return this.render({ force: true });
  }

  #syncSessionDetails() {
    const form = this.#root()?.querySelector?.("[data-form='board-details']");
    if (!form) return;
    const values = Object.fromEntries(new (getElementWindow(form).FormData)(form));
    const rawStatus = values.status;
    this.sessionDetails = {
      ...this.sessionDetails,
      ...Object.fromEntries(SESSION_FIELDS.map((field) => [field, String(values[field] ?? "")])),
      name: String(values.name ?? ""),
      date: String(values.date ?? ""),
      image: String(values.image ?? ""),
      status: ["draft", "ready", "played"].includes(rawStatus) ? rawStatus : "draft"
    };
  }

  #applyDetailsState() {
    const root = this.#root();
    root?.querySelector(".dmj-board-shell")?.classList.toggle("details-collapsed", this.detailsCollapsed);
    for (const button of root?.querySelectorAll("[data-action='toggle-details']") ?? []) {
      button.setAttribute("aria-expanded", String(!this.detailsCollapsed));
    }
  }

  async #selectAdventureImage(button) {
    try {
      const FilePickerClass = foundry.applications.apps.FilePicker.implementation;
      const picker = FilePickerClass.fromButton(button);
      picker.callback = (path) => {
        const form = this.#root()?.querySelector("[data-form='board-details']");
        if (!form) return;
        form.elements.image.value = path;
        const preview = form.querySelector("[data-adventure-image-preview]");
        const placeholder = form.querySelector("[data-adventure-image-placeholder]");
        if (preview) {
          preview.src = path;
          preview.hidden = !path;
        }
        if (placeholder) placeholder.hidden = Boolean(path);
        this.#syncSessionDetails();
        this.#scheduleAutosave();
      };
      await picker.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error.message);
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
      },
      {
        type: "clue",
        icon: "fa-magnifying-glass",
        label: game.i18n.localize("DMJ.Board.Command.Clue"),
        hint: game.i18n.localize("DMJ.Board.Command.ClueHint"),
        aliases: ["pista", "clue", "indicio"]
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

  #onInput(event) {
    if (event.target.matches("[data-session-detail]")) {
      this.#syncSessionDetails();
      if (event.target.name === "name") {
        const heading = this.#root()?.querySelector("[data-board-session-name]");
        if (heading) heading.textContent = event.target.value.trim() || this.page.name;
      }
      this.#scheduleAutosave();
      return;
    }
    const editor = event.target.closest?.("[data-block-text]");
    if (editor?.closest(".dmj-check-block") && event.inputType?.startsWith("delete") && !richTextToPlainText(editor.innerHTML).trim()) {
      this.#removeEmptyCheckBlock(editor);
      return;
    }
    if (editor) this.#handleEditorMutation(editor);
    if (!event.target.matches("[data-block-done]")) this.#scheduleAutosave();
  }

  #onChange(event) {
    if (event.target.matches("[data-session-detail]")) {
      this.#syncSessionDetails();
      this.#scheduleAutosave();
      return;
    }
    if (event.target.matches("[data-block-done]")) this.#scheduleAutosave();
  }

  #onFocusOut(event) {
    const editor = event.target.closest?.("[data-block-text]");
    if (["success", "failure"].includes(editor?.dataset.testResult) && !richTextToPlainText(editor.innerHTML).trim()) {
      const block = editor.closest(".dmj-test-block");
      editor.closest("[data-test-outcome]")?.remove();
      this.#refreshTestAddControl(block);
      this.#scheduleAutosave();
      return;
    }
    if (editor?.dataset.testResult === "description" && !richTextToPlainText(editor.innerHTML).trim()) {
      const block = editor.closest(".dmj-test-block");
      editor.closest(".dmj-test-description")?.replaceChildren();
      this.#refreshTestAddControl(block);
      this.#scheduleAutosave();
      return;
    }
    if (!editor?.dataset.manualHeight) return;
    delete editor.dataset.manualHeight;
    delete editor.closest(".dmj-content-block").dataset.blockHeight;
    this.#autoSizeEditor(editor);
    this.#scheduleAutosave();
  }

  #onPaste(event) {
    const editor = event.target.closest?.("[data-block-text]");
    if (!editor) return;
    event.preventDefault();
    this.#insertPlainText(editor, event.clipboardData?.getData("text/plain") ?? "");
    this.#handleEditorMutation(editor);
    this.#scheduleAutosave();
  }

  async #insertDroppedDocument(editor, { clientX, clientY, rawData }) {
    try {
      const data = JSON.parse(rawData);
      const uuid = data.uuid ?? (data.type && data.id ? `${data.type}.${data.id}` : "");
      const document = uuid ? await fromUuid(uuid) : null;
      if (!document || !["Actor", "Item"].includes(document.documentName)) {
        throw new Error(game.i18n.localize("DMJ.Board.MentionDropError"));
      }

      this.#placeCaretFromPoint(editor, clientX, clientY);
      this.#insertMention(editor, { uuid: document.uuid, name: document.name });
    } catch (error) {
      ui.notifications.warn(error.message || game.i18n.localize("DMJ.Board.MentionDropError"));
    }
  }

  async #insertDroppedSceneLink(rawData) {
    try {
      const data = JSON.parse(rawData);
      const uuid = data.uuid ?? (data.type && data.id ? `${data.type}.${data.id}` : "");
      const linkedDocument = uuid ? await fromUuid(uuid) : null;
      const isLibraryResource = linkedDocument?.documentName === "JournalEntryPage"
        && ResourceService.getResources().some((page) => page.uuid === linkedDocument.uuid);
      if (!linkedDocument || (!isLibraryResource && !["Actor", "Item"].includes(linkedDocument.documentName))) {
        throw new Error(game.i18n.localize("DMJ.Board.SceneLinkDropError"));
      }
      await this.#addSceneLinkDocument(linkedDocument);
    } catch (error) {
      ui.notifications.warn(error.message || game.i18n.localize("DMJ.Board.SceneLinkDropError"));
    }
  }

  async #addSceneLinkDocument(linkedDocument) {
    this.#syncActiveScene();
    const scene = this.#activeScene();
    if (!scene || !linkedDocument?.uuid) return;
    scene.links ??= [];
    if (scene.links.some((link) => link.uuid === linkedDocument.uuid)) {
      ui.notifications.warn(game.i18n.localize("DMJ.Board.SceneLinkDuplicate"));
      return;
    }
    if (scene.links.length >= MAX_SCENE_LINKS) {
      ui.notifications.warn(game.i18n.localize("DMJ.Board.SceneLinkLimit"));
      return;
    }

    const resourcePage = ResourceService.getResources().find((page) => page.uuid === linkedDocument.uuid);
    if (!resourcePage && !["Actor", "Item"].includes(linkedDocument.documentName)) {
      ui.notifications.warn(game.i18n.localize("DMJ.Board.SceneLinkDropError"));
      return;
    }
    const resourceData = resourcePage ? ResourceService.getData(resourcePage) : null;
    const linkedResourceDocument = resourcePage && !resourceData.image
      ? await ResourceService.getLinkedDocument(resourcePage)
      : null;
    scene.links.push({
      id: crypto.randomUUID(),
      uuid: linkedDocument.uuid,
      name: linkedDocument.name,
      documentName: linkedDocument.documentName,
      kind: resourceData?.kind ?? "",
      image: resourceData?.image || linkedResourceDocument?.img || linkedDocument.img || "",
      note: ""
    });
    this.#closeSceneLinkMenu();
    await this.#refreshView();
    this.#scheduleAutosave();
  }

  #showSceneLinkMenu(anchor) {
    this.#closeSceneLinkMenu();
    const resources = ResourceService.getResources();
    if (!resources.length) {
      ui.notifications.info(game.i18n.localize("DMJ.Board.SceneLinkLibraryEmpty"));
      return;
    }

    const ownerDocument = getElementDocument(anchor);
    const ownerWindow = getElementWindow(anchor);
    const menu = ownerDocument.createElement("div");
    menu.className = `${MODULE_ID} dmj-scene-link-menu`;
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", game.i18n.localize("DMJ.Board.SceneLinkPicker"));
    const search = ownerDocument.createElement("input");
    search.type = "search";
    search.placeholder = game.i18n.localize("DMJ.Board.SceneLinkSearch");
    search.setAttribute("aria-label", game.i18n.localize("DMJ.Board.SceneLinkSearch"));
    const list = ownerDocument.createElement("div");
    list.className = "dmj-scene-link-menu-list";

    for (const resource of resources) {
      const data = ResourceService.getData(resource);
      const button = ownerDocument.createElement("button");
      button.type = "button";
      button.dataset.search = normalizeSearch(`${resource.name} ${game.i18n.localize(`DMJ.Resource.Kind.${data.kind}`)}`);
      const icon = ownerDocument.createElement("i");
      icon.className = `fa-solid ${RESOURCE_MENTION_ICONS[data.kind] ?? "fa-bookmark"}`;
      icon.setAttribute("aria-hidden", "true");
      const text = ownerDocument.createElement("span");
      const name = ownerDocument.createElement("strong");
      name.textContent = resource.name;
      const kind = ownerDocument.createElement("small");
      kind.textContent = game.i18n.localize(`DMJ.Resource.Kind.${data.kind}`);
      text.append(name, kind);
      button.append(icon, text);
      button.addEventListener("click", () => void this.#addSceneLinkDocument(resource));
      list.append(button);
    }

    search.addEventListener("input", () => {
      const query = normalizeSearch(search.value);
      for (const button of list.querySelectorAll("button")) button.hidden = Boolean(query) && !button.dataset.search.includes(query);
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.#closeSceneLinkMenu();
        anchor.focus();
      }
    });
    menu.append(search, list);
    ownerDocument.body.append(menu);
    this.sceneLinkMenu = menu;

    const anchorBounds = anchor.getBoundingClientRect();
    const menuBounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchorBounds.right - menuBounds.width, ownerWindow.innerWidth - menuBounds.width - 8))}px`;
    const below = anchorBounds.bottom + 6;
    menu.style.top = `${below + menuBounds.height <= ownerWindow.innerHeight - 8 ? below : Math.max(8, anchorBounds.top - menuBounds.height - 6)}px`;
    search.focus();
  }

  #closeSceneLinkMenu() {
    this.sceneLinkMenu?.remove();
    this.sceneLinkMenu = null;
  }

  #placeCaretFromPoint(editor, clientX, clientY) {
    const document = editor.ownerDocument;
    editor.focus();
    let range = null;
    if (typeof document.caretRangeFromPoint === "function") {
      range = document.caretRangeFromPoint(clientX, clientY);
    } else if (typeof document.caretPositionFromPoint === "function") {
      const position = document.caretPositionFromPoint(clientX, clientY);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
      }
    }

    if (!range || !editor.contains(range.startContainer)) {
      this.#placeCaretAtEnd(editor);
      return;
    }
    const existingMention = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest?.("[data-dmj-mention]");
    if (existingMention) range.setStartAfter(existingMention);
    range.collapse(true);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  #onPointerDown(event) {
    const resizeHandle = event.target.closest?.("[data-column-resize-handle]");
    if (resizeHandle && event.button === 0) {
      const column = resizeHandle.closest(".dmj-kanban-column");
      if (!column) return;
      event.preventDefault();
      const axis = resizeHandle.dataset.resizeAxis === "height" ? "height" : "width";
      const bounds = column.getBoundingClientRect();
      const startValue = axis === "height"
        ? normalizeColumnHeight(bounds.height)
        : normalizeColumnWidth(bounds.width);
      this.columnResizeState = {
        column,
        axis,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startValue,
        value: startValue
      };
      this.#root().classList.add(`dmj-resizing-column-${axis}`);
      return;
    }

    const editor = event.target.closest?.("[data-block-text]");
    if (!editor) return;
    this.editorResizeState = {
      editor,
      startHeight: editor.getBoundingClientRect().height
    };
  }

  #onPointerMove(event) {
    const state = this.columnResizeState;
    if (!state?.column.isConnected || event.pointerId !== state.pointerId) return;
    event.preventDefault();
    state.value = state.axis === "height"
      ? this.#applyColumnHeight(state.column, state.startValue + event.clientY - state.startY)
      : this.#applyColumnWidth(state.column, state.startValue + event.clientX - state.startX);
  }

  #onPointerUp(event) {
    const columnState = this.columnResizeState;
    if (columnState && (event.pointerId === undefined || event.pointerId === columnState.pointerId)) {
      this.columnResizeState = null;
      this.#root()?.classList.remove("dmj-resizing-column-width", "dmj-resizing-column-height");
      if (columnState.column.isConnected && Math.abs(columnState.value - columnState.startValue) >= 1) this.#scheduleAutosave();
    }

    const state = this.editorResizeState;
    this.editorResizeState = null;
    if (!state?.editor.isConnected) return;
    const height = normalizeTextareaHeight(state.editor.getBoundingClientRect().height);
    if (height === null || Math.abs(height - state.startHeight) < 2) return;
    state.editor.dataset.manualHeight = String(height);
    state.editor.closest(".dmj-content-block").dataset.blockHeight = String(height);
    this.#scheduleAutosave();
  }

  #applyColumnWidth(column, value) {
    const width = normalizeColumnWidth(value);
    column.dataset.columnWidth = String(width);
    column.style.setProperty("--dmj-column-width", `${width}px`);
    column.querySelector("[data-column-resize-handle]")?.setAttribute("aria-valuenow", String(width));
    return width;
  }

  #applyColumnHeight(column, value) {
    const height = normalizeColumnHeight(value) ?? MIN_COLUMN_HEIGHT;
    column.dataset.columnHeight = String(height);
    column.style.setProperty("--dmj-column-height", `${height}px`);
    column.querySelector("[data-column-resize-handle][data-resize-axis='height']")?.setAttribute("aria-valuenow", String(height));
    return height;
  }

  #onKeyDown(event) {
    const resizeHandle = event.target.closest?.("[data-column-resize-handle]");
    const resizeAxis = resizeHandle?.dataset.resizeAxis === "height" ? "height" : "width";
    const resizeKeys = resizeAxis === "height" ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
    if (resizeHandle && resizeKeys.includes(event.key)) {
      const column = resizeHandle.closest(".dmj-kanban-column");
      if (!column) return;
      event.preventDefault();
      const grows = event.key === "ArrowRight" || event.key === "ArrowDown";
      const direction = grows ? 1 : -1;
      if (resizeAxis === "height") {
        const height = normalizeColumnHeight(column.dataset.columnHeight)
          ?? normalizeColumnHeight(column.getBoundingClientRect().height)
          ?? MIN_COLUMN_HEIGHT;
        this.#applyColumnHeight(column, height + direction * COLUMN_KEYBOARD_STEP);
      } else {
        const width = normalizeColumnWidth(column.dataset.columnWidth) + direction * COLUMN_KEYBOARD_STEP;
        this.#applyColumnWidth(column, width);
      }
      this.#scheduleAutosave();
      return;
    }

    const mention = event.target.closest?.("[data-dmj-mention]");
    if (mention && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      void this.#openMention(mention.dataset.uuid);
      return;
    }

    const editor = event.target.closest?.("[data-block-text]");
    if (editor?.closest(".dmj-check-block") && event.key === "Backspace" && !richTextToPlainText(editor.innerHTML).trim()) {
      event.preventDefault();
      this.#removeEmptyCheckBlock(editor);
      return;
    }
    const formatKey = event.key.toLocaleLowerCase(game.i18n.lang);
    if (editor && (event.ctrlKey || event.metaKey) && !event.altKey && ["b", "i"].includes(formatKey)) {
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
    if (this.mentionState && editor === this.mentionState.editor && event.key === "Tab") {
      this.#closeMentionMenu();
    }

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
    if (this.slashState && editor === this.slashState.editor && event.key === "Tab") {
      this.#closeSlashMenu();
    }
    if (editor && event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (editor.closest(".dmj-check-block") && !event.shiftKey) {
        this.#insertCheckBlockAfter(editor);
      } else {
        this.#insertLineBreak(editor);
        this.#handleEditorMutation(editor);
      }
      this.#scheduleAutosave();
    }
  }

  #handleEditorMutation(editor) {
    this.#enforceEditorLimit(editor);
    this.#autoSizeEditor(editor);
    if (editor.closest(".dmj-text-block")) this.#updateSlashMenu(editor);
    else this.#closeSlashMenu();
    this.#updateMentionMenu(editor);
  }

  #enforceEditorLimit(editor) {
    const text = richTextToPlainText(editor.innerHTML);
    if (text.length <= 20000) return;
    editor.innerHTML = plainTextToRichHTML(text.slice(0, 20000));
    this.#placeCaretAtEnd(editor);
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

  #insertLineBreak(editor) {
    const range = this.#getEditorRange(editor);
    if (!range) return;
    range.deleteContents();
    const fragment = editor.ownerDocument.createDocumentFragment();
    const lineBreak = editor.ownerDocument.createElement("br");
    const marker = editor.ownerDocument.createTextNode("\u200b");
    fragment.append(lineBreak, marker);
    range.insertNode(fragment);
    range.setStart(marker, marker.length);
    range.collapse(true);
    const selection = editor.ownerDocument.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  #insertCheckBlockAfter(editor) {
    const currentBlock = editor.closest(".dmj-check-block");
    if (!currentBlock) return;
    const nextBlock = this.#createBlockElement(newBlock("check"));
    currentBlock.after(nextBlock);
    this.#initializeEditorSizing(nextBlock);
    const nextEditor = nextBlock.querySelector("[data-block-text]");
    nextEditor?.focus();
    if (nextEditor) this.#placeCaretAtEnd(nextEditor);
  }

  #removeEmptyCheckBlock(editor) {
    const block = editor.closest(".dmj-check-block");
    const cardContent = block?.closest(".dmj-card-content");
    if (!block || !cardContent || richTextToPlainText(editor.innerHTML).trim()) return false;

    let nextEditor = block.previousElementSibling?.querySelector?.("[data-block-text]")
      ?? block.nextElementSibling?.querySelector?.("[data-block-text]");
    block.remove();
    if (!cardContent.querySelector(".dmj-content-block")) {
      const textBlock = this.#createBlockElement(newBlock());
      cardContent.append(textBlock);
      this.#initializeEditorSizing(textBlock);
      nextEditor = textBlock.querySelector("[data-block-text]");
    }

    this.#closeSlashMenu();
    this.#closeMentionMenu();
    nextEditor?.focus();
    if (nextEditor) this.#placeCaretAtEnd(nextEditor);
    this.#scheduleAutosave();
    return true;
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
          page,
          uuid: page.uuid,
          name: page.name,
          kind,
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
    const ownerWindow = getElementWindow(editor);
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
    const anchor = this.#getEditorOffsetPosition(editor, mentionStart + 1);
    const viewportPadding = 8;
    const availableWidth = Math.max(160, ownerWindow.innerWidth - (viewportPadding * 2));
    const menuWidth = Math.min(340, Math.max(280, editor.getBoundingClientRect().width), availableWidth);
    const left = Math.max(viewportPadding, Math.min(anchor.left, ownerWindow.innerWidth - menuWidth - viewportPadding));
    const top = Math.max(viewportPadding, anchor.bottom + 4);
    menu.style.width = `${menuWidth}px`;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.maxHeight = `${Math.max(72, ownerWindow.innerHeight - top - viewportPadding)}px`;
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
    this.#insertMention(editor, resource, mentionStart, mentionEnd);
  }

  #insertMention(editor, reference, startOffset = null, endOffset = null) {
    const uuid = String(reference?.uuid ?? "").trim();
    const name = String(reference?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!uuid || !name) return;
    editor.focus();
    const range = startOffset === null || endOffset === null
      ? this.#getEditorRange(editor)
      : this.#createEditorRange(editor, startOffset, endOffset);
    if (!range) return;

    range.deleteContents();
    const mention = editor.ownerDocument.createElement("span");
    mention.className = "dmj-inline-mention";
    mention.contentEditable = "false";
    mention.tabIndex = 0;
    mention.setAttribute("role", "link");
    mention.dataset.dmjMention = "";
    mention.dataset.uuid = uuid;
    mention.textContent = `@${name}`;
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
    this.#closeSlashMenu();
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
      if (!document || !["Actor", "Item"].includes(document.documentName)) {
        throw new Error(game.i18n.localize("DMJ.Board.MentionMissing"));
      }
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
    const commandEnd = cursor;
    this.#showSlashMenu({ editor, text, lineStart, commandStart, commandEnd, commands });
  }

  #showSlashMenu({ editor, text, lineStart, commandStart, commandEnd, commands }) {
    this.#closeSlashMenu();
    this.#closeMentionMenu();
    const ownerDocument = getElementDocument(editor);
    const ownerWindow = getElementWindow(editor);
    const menu = ownerDocument.createElement("div");
    menu.className = "dmj-slash-menu";
    menu.setAttribute("role", "listbox");
    for (const command of commands) {
      const button = ownerDocument.createElement("button");
      button.type = "button";
      button.dataset.action = "insert-slash-block";
      button.dataset.blockType = command.type;
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
    const anchor = this.#getEditorOffsetPosition(editor, commandStart + 1);
    const viewportPadding = 8;
    const availableWidth = Math.max(160, ownerWindow.innerWidth - (viewportPadding * 2));
    const menuWidth = Math.min(340, Math.max(280, editor.getBoundingClientRect().width), availableWidth);
    const left = Math.max(viewportPadding, Math.min(anchor.left, ownerWindow.innerWidth - menuWidth - viewportPadding));
    const top = Math.max(viewportPadding, anchor.bottom + 4);
    menu.style.width = `${menuWidth}px`;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.maxHeight = `${Math.max(72, ownerWindow.innerHeight - top - viewportPadding)}px`;
    this.slashState = { editor, text, lineStart, commandStart, commandEnd, commands, activeIndex: 0, menu };
    this.#highlightSlashCommand();
  }

  #getEditorOffsetPosition(editor, index) {
    const range = this.#createEditorRange(editor, Math.max(0, index - 1), index);
    const rectangles = range ? [...range.getClientRects()] : [];
    const rectangle = rectangles.at(-1);
    const bounds = editor.getBoundingClientRect();
    return rectangle ? { left: rectangle.right, bottom: rectangle.bottom } : { left: bounds.left + 6, bottom: bounds.top + 24 };
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
    if (!this.slashState || !BLOCK_TYPES.includes(type) || type === "text") return;
    const { editor, text, lineStart, commandStart, commandEnd } = this.slashState;
    const command = this.slashState.commands.find((entry) => entry.type === type);
    const sourceBlock = editor.closest(".dmj-content-block");
    const commandHasOnlyWhitespaceBeforeIt = !text.slice(lineStart, commandStart).trim();
    const beforeEnd = commandHasOnlyWhitespaceBeforeIt
      ? (lineStart > 0 && text[lineStart - 1] === "\n" ? lineStart - 1 : lineStart)
      : commandStart;
    const before = text.slice(0, beforeEnd);
    const afterStart = text[commandEnd] === "\n" ? commandEnd + 1 : commandEnd;
    const after = text.slice(afterStart);
    let trailingHTML = "";
    if (after) {
      const trailingRange = this.#createEditorRange(editor, afterStart, text.length);
      if (trailingRange) {
        const container = editor.ownerDocument.createElement("div");
        container.append(trailingRange.extractContents());
        trailingHTML = sanitizeRichTextHTML(container.innerHTML);
      }
    }
    const remainingText = richTextToPlainText(editor.innerHTML);
    const commandRange = this.#createEditorRange(editor, beforeEnd, remainingText.length);
    commandRange?.deleteContents();
    const insertedBlock = this.#createBlockElement(newBlock(type, "", command?.argument));
    const trailingData = after ? { ...newBlock("text", after), html: trailingHTML || plainTextToRichHTML(after) } : null;
    const trailingBlock = trailingData ? this.#createBlockElement(trailingData) : null;
    const insertedBlocks = trailingBlock ? [insertedBlock, trailingBlock] : [insertedBlock];
    this.#closeSlashMenu();

    if (before) {
      sourceBlock.after(...insertedBlocks);
      this.#autoSizeEditor(editor);
    } else {
      sourceBlock.replaceWith(...insertedBlocks);
    }
    this.#initializeEditorSizing(insertedBlock);
    if (trailingBlock) this.#initializeEditorSizing(trailingBlock);
    const focusTarget = (type === "test" || type === "clue") && !command?.argument
      ? insertedBlock.querySelector("[data-block-title]")
      : insertedBlock.querySelector("[data-block-text]");
    focusTarget?.focus();
    if (focusTarget?.matches("input")) focusTarget.select();
    this.#scheduleAutosave();
  }

  #createBlockElement(block) {
    const section = this.#document().createElement("section");
    section.className = `dmj-content-block dmj-${block.type}-block`;
    section.dataset.blockId = block.id;
    section.dataset.blockType = block.type;

    if (block.type === "text") {
      section.append(this.#createBlockEditor(block, "DMJ.Board.EditorPlaceholder", "DMJ.Board.EditorText"));
      return section;
    }

    if (block.type === "callout") {
      const header = this.#document().createElement("header");
      const label = this.#document().createElement("label");
      label.className = "dmj-callout-title";
      const icon = this.#document().createElement("i");
      icon.className = "fa-solid fa-comment-dots";
      icon.setAttribute("aria-hidden", "true");
      const title = this.#document().createElement("input");
      title.type = "text";
      title.maxLength = 120;
      title.dataset.blockTitle = "";
      title.value = block.title || game.i18n.localize("DMJ.Board.Callout");
      title.setAttribute("aria-label", game.i18n.localize("DMJ.Board.CalloutTitle"));
      label.append(icon, title);
      header.append(label, this.#createRemoveBlockButton());
      const editor = this.#createBlockEditor(block, "DMJ.Board.CalloutPlaceholder", "DMJ.Board.Callout");
      section.append(header, editor);
      return section;
    }

    if (block.type === "clue") {
      const header = this.#document().createElement("header");
      const label = this.#document().createElement("label");
      label.className = "dmj-clue-title";
      const icon = this.#document().createElement("i");
      icon.className = "fa-solid fa-magnifying-glass";
      icon.setAttribute("aria-hidden", "true");
      const title = this.#document().createElement("input");
      title.type = "text";
      title.maxLength = 120;
      title.dataset.blockTitle = "";
      title.value = block.title || game.i18n.localize("DMJ.Board.Clue");
      title.setAttribute("placeholder", game.i18n.localize("DMJ.Board.ClueTitlePlaceholder"));
      title.setAttribute("aria-label", game.i18n.localize("DMJ.Board.ClueTitle"));
      label.append(icon, title);

      const actions = this.#document().createElement("span");
      actions.className = "dmj-clue-actions";
      const privateIcon = this.#document().createElement("i");
      privateIcon.className = "fa-solid fa-shield-halved";
      privateIcon.title = game.i18n.localize("DMJ.Board.CluePrivate");
      privateIcon.setAttribute("aria-hidden", "true");
      const dragButton = this.#document().createElement("button");
      dragButton.type = "button";
      dragButton.draggable = true;
      dragButton.dataset.clueDragHandle = "";
      dragButton.title = game.i18n.localize("DMJ.Board.ClueDrag");
      dragButton.setAttribute("aria-label", game.i18n.localize("DMJ.Board.ClueDrag"));
      dragButton.innerHTML = '<i class="fa-solid fa-location-dot" aria-hidden="true"></i>';
      actions.append(privateIcon, dragButton, this.#createRemoveBlockButton());
      header.append(label, actions);
      const editor = this.#createBlockEditor(block, "DMJ.Board.CluePlaceholder", "DMJ.Board.Clue");
      section.append(header, editor);
      return section;
    }

    if (block.type === "test") {
      const header = this.#document().createElement("header");
      const label = this.#document().createElement("label");
      label.className = "dmj-test-title";
      const icon = this.#document().createElement("i");
      icon.className = "fa-solid fa-dice-d20";
      icon.setAttribute("aria-hidden", "true");
      const title = this.#document().createElement("input");
      title.type = "text";
      title.maxLength = 120;
      title.dataset.blockTitle = "";
      title.value = block.title || game.i18n.localize("DMJ.Board.Test");
      title.setAttribute("placeholder", game.i18n.localize("DMJ.Board.TestTitlePlaceholder"));
      title.setAttribute("aria-label", game.i18n.localize("DMJ.Board.TestTitle"));
      label.append(icon, title);
      header.append(label, this.#createRemoveBlockButton());

      const outcomes = this.#document().createElement("div");
      outcomes.className = "dmj-test-outcomes";
      const successHTML = sanitizeRichTextHTML(block.successHTML ?? plainTextToRichHTML(block.successText));
      const failureHTML = sanitizeRichTextHTML(block.failureHTML ?? plainTextToRichHTML(block.failureText));
      const descriptionHTML = sanitizeRichTextHTML(block.descriptionHTML ?? plainTextToRichHTML(block.descriptionText));
      const hasSuccess = Boolean(richTextToPlainText(successHTML).trim());
      const hasFailure = Boolean(richTextToPlainText(failureHTML).trim());
      const hasDescription = Boolean(richTextToPlainText(descriptionHTML).trim());
      const results = (Array.isArray(block.results) ? block.results : []).slice(0, 50);
      if (hasSuccess) outcomes.append(this.#createTestOutcome({ successHTML }, "success", "DMJ.Board.TestSuccess", "DMJ.Board.TestSuccessPlaceholder"));
      if (hasFailure) outcomes.append(this.#createTestOutcome({ failureHTML }, "failure", "DMJ.Board.TestFailure", "DMJ.Board.TestFailurePlaceholder"));
      results.forEach((result) => outcomes.append(this.#createTestResult(result)));
      section.append(
        header,
        outcomes,
        this.#createTestAddControl({ hasSuccess, hasFailure, hasDescription, resultCount: results.length }),
        this.#createTestDescription({ descriptionHTML })
      );
      return section;
    }

    const checkbox = this.#document().createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.blockDone = "";
    checkbox.checked = Boolean(block.done);
    checkbox.setAttribute("aria-label", game.i18n.localize("DMJ.Board.CheckDone"));
    const editor = this.#createBlockEditor(block, "DMJ.Board.CheckPlaceholder", "DMJ.Board.CheckPlaceholder");
    section.append(checkbox, editor, this.#createRemoveBlockButton());
    return section;
  }

  #createTestOutcome(block, result, labelKey, placeholderKey) {
    const outcome = this.#document().createElement("section");
    outcome.className = `dmj-test-outcome dmj-test-${result}`;
    outcome.dataset.testOutcome = result;
    const label = this.#document().createElement("strong");
    label.textContent = game.i18n.localize(labelKey);
    const editor = this.#createBlockEditor({
      html: block[`${result}HTML`],
      text: block[`${result}Text`]
    }, placeholderKey, labelKey);
    editor.dataset.testResult = result;
    outcome.append(label, editor, this.#createRemoveTestOutcomeButton());
    return outcome;
  }

  #createTestDescription(block) {
    const container = this.#document().createElement("div");
    container.className = "dmj-test-description";
    const html = sanitizeRichTextHTML(block.descriptionHTML ?? plainTextToRichHTML(block.descriptionText));
    if (richTextToPlainText(html).trim()) container.append(this.#createTestDescriptionEditor({ descriptionHTML: html }));
    return container;
  }

  #createTestDescriptionEditor(block = {}) {
    const editor = this.#createBlockEditor({
      html: block.descriptionHTML,
      text: block.descriptionText
    }, "DMJ.Board.TestDescriptionPlaceholder", "DMJ.Board.TestDescription");
    editor.dataset.testResult = "description";
    return editor;
  }

  #createTestResult(result = newTestResult()) {
    const outcome = this.#document().createElement("section");
    outcome.className = "dmj-test-outcome dmj-test-result";
    outcome.dataset.testOutcome = "result";
    outcome.dataset.testResultId = result.id || crypto.randomUUID();
    const label = this.#document().createElement("strong");
    label.textContent = game.i18n.localize("DMJ.Board.TestResult");
    const value = this.#document().createElement("input");
    value.type = "text";
    value.inputMode = "decimal";
    value.maxLength = 30;
    value.dataset.testResultValue = "";
    value.value = String(result.value ?? "").slice(0, 30);
    value.setAttribute("placeholder", game.i18n.localize("DMJ.Board.TestResultValuePlaceholder"));
    value.setAttribute("aria-label", game.i18n.localize("DMJ.Board.TestResultValue"));
    const editor = this.#createBlockEditor(result, "DMJ.Board.TestResultPlaceholder", "DMJ.Board.TestResult");
    editor.dataset.testResultText = "";
    outcome.append(label, value, editor, this.#createRemoveTestOutcomeButton());
    return outcome;
  }

  #createTestAddControl({ hasSuccess = false, hasFailure = false, hasDescription = false, resultCount = 0 } = {}) {
    const details = this.#document().createElement("details");
    details.className = "dmj-test-add-control";
    const summary = this.#document().createElement("summary");
    summary.setAttribute("aria-label", game.i18n.localize("DMJ.Board.TestAdd"));
    const icon = this.#document().createElement("i");
    icon.className = "fa-solid fa-plus";
    icon.setAttribute("aria-hidden", "true");
    const label = this.#document().createElement("span");
    label.textContent = game.i18n.localize("DMJ.Board.TestAdd");
    summary.append(icon, label);
    const menu = this.#document().createElement("div");
    menu.className = "dmj-test-add-menu";
    menu.setAttribute("role", "menu");
    if (!hasSuccess) menu.append(this.#createTestAddOption("success", "DMJ.Board.TestSuccess", "fa-check"));
    if (!hasFailure) menu.append(this.#createTestAddOption("failure", "DMJ.Board.TestFailure", "fa-xmark"));
    if (resultCount < 50) menu.append(this.#createTestAddOption("result", "DMJ.Board.TestResult", "fa-equals"));
    if (!hasDescription) menu.append(this.#createTestAddOption("description", "DMJ.Board.TestDescriptionMenu", "fa-align-left"));
    details.append(summary, menu);
    return details;
  }

  #createTestAddOption(type, labelKey, iconClass) {
    const button = this.#document().createElement("button");
    button.type = "button";
    button.dataset.action = "add-test-part";
    button.dataset.testPart = type;
    button.setAttribute("aria-label", game.i18n.localize(labelKey));
    const icon = this.#document().createElement("i");
    icon.className = `fa-solid ${iconClass}`;
    icon.setAttribute("aria-hidden", "true");
    const label = this.#document().createElement("span");
    label.textContent = game.i18n.localize(labelKey);
    button.append(icon, label);
    return button;
  }

  #createRemoveTestOutcomeButton() {
    const button = this.#document().createElement("button");
    button.type = "button";
    button.dataset.action = "remove-test-outcome";
    button.setAttribute("aria-label", game.i18n.localize("DMJ.Board.TestRemoveOutcome"));
    const icon = this.#document().createElement("i");
    icon.className = "fa-solid fa-xmark";
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
    return button;
  }

  #refreshTestAddControl(block) {
    if (!block) return;
    const next = this.#createTestAddControl({
      hasSuccess: Boolean(block.querySelector("[data-test-outcome='success']")),
      hasFailure: Boolean(block.querySelector("[data-test-outcome='failure']")),
      hasDescription: Boolean(block.querySelector("[data-test-result='description']")),
      resultCount: block.querySelectorAll("[data-test-outcome='result']").length
    });
    block.querySelector(".dmj-test-add-control")?.replaceWith(next);
  }

  #addTestPart(action) {
    const block = action.closest(".dmj-test-block");
    const outcomes = block?.querySelector(".dmj-test-outcomes");
    const type = action.dataset.testPart;
    if (!block || !outcomes || !["success", "failure", "result", "description"].includes(type)) return;

    action.closest("details")?.removeAttribute("open");
    let editor = null;
    let focusTarget = null;
    if (type === "success" || type === "failure") {
      if (block.querySelector(`[data-test-outcome='${type}']`)) return;
      const labelKey = type === "success" ? "DMJ.Board.TestSuccess" : "DMJ.Board.TestFailure";
      const placeholderKey = type === "success" ? "DMJ.Board.TestSuccessPlaceholder" : "DMJ.Board.TestFailurePlaceholder";
      const outcome = this.#createTestOutcome({}, type, labelKey, placeholderKey);
      const firstResult = outcomes.querySelector("[data-test-outcome='result']");
      if (type === "success") outcomes.prepend(outcome);
      else if (firstResult) outcomes.insertBefore(outcome, firstResult);
      else outcomes.append(outcome);
      editor = outcome.querySelector("[data-block-text]");
      focusTarget = editor;
    } else if (type === "result") {
      if (outcomes.querySelectorAll("[data-test-outcome='result']").length >= 50) return;
      const outcome = this.#createTestResult();
      outcomes.append(outcome);
      editor = outcome.querySelector("[data-block-text]");
      focusTarget = outcome.querySelector("[data-test-result-value]");
    } else {
      const container = block.querySelector(".dmj-test-description");
      if (!container || container.querySelector("[data-test-result='description']")) return;
      editor = this.#createTestDescriptionEditor();
      container.replaceChildren(editor);
      focusTarget = editor;
    }

    if (editor) this.#autoSizeEditor(editor);
    this.#refreshTestAddControl(block);
    focusTarget?.focus();
    if (focusTarget === editor) this.#placeCaretAtEnd(editor);
  }

  #createBlockEditor(block, placeholderKey, labelKey) {
    const editor = this.#document().createElement("div");
    editor.className = "dmj-block-editor";
    editor.contentEditable = "true";
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-multiline", "true");
    editor.setAttribute("aria-keyshortcuts", "Control+B Control+I");
    editor.dataset.blockText = "";
    editor.dataset.placeholder = game.i18n.localize(placeholderKey);
    editor.setAttribute("aria-label", game.i18n.localize(labelKey));
    editor.innerHTML = sanitizeRichTextHTML(block.html ?? plainTextToRichHTML(block.text));
    return editor;
  }

  #initializeEditorSizing(root) {
    const blocks = root.matches?.(".dmj-content-block") ? [root] : root.querySelectorAll(".dmj-content-block");
    for (const block of blocks) {
      delete block.dataset.blockHeight;
      for (const editor of block.querySelectorAll("[data-block-text]")) {
        delete editor.dataset.manualHeight;
        this.#autoSizeEditor(editor);
      }
    }
  }

  #autoSizeEditor(editor) {
    if (editor.dataset.manualHeight) return;
    editor.style.height = "auto";
    const style = getElementWindow(editor).getComputedStyle(editor);
    const borderHeight = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
    const minimumHeight = Number.parseFloat(style.minHeight) || 0;
    editor.style.height = `${Math.min(1600, Math.max(minimumHeight, editor.scrollHeight + borderHeight))}px`;
  }

  #createRemoveBlockButton() {
    const button = this.#document().createElement("button");
    button.type = "button";
    button.dataset.action = "remove-block";
    button.setAttribute("aria-label", game.i18n.localize("DMJ.Board.RemoveBlock"));
    const icon = this.#document().createElement("i");
    icon.className = "fa-solid fa-xmark";
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
    return button;
  }

  async #onClick(event) {
    const mention = event.target.closest?.("[data-dmj-mention]");
    if (mention) {
      event.preventDefault();
      await this.#openMention(mention.dataset.uuid);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const name = action.dataset.action;
    if (name === "select-scene" && event.target.matches("input")) return;
    event.preventDefault();

    if (name === "toggle-details") {
      this.detailsCollapsed = !this.detailsCollapsed;
      this.#applyDetailsState();
    } else if (name === "select-adventure-image") {
      await this.#selectAdventureImage(action);
    } else if (name === "insert-slash-block") {
      this.#insertSlashBlock(action.dataset.blockType);
    } else if (name === "popout-workspace") {
      void popoutApplication(this.workspaceHost ?? this);
    } else if (name === "add-scene-link") {
      this.#showSceneLinkMenu(action);
    } else if (name === "open-scene-link") {
      await this.#openMention(action.dataset.uuid);
    } else if (name === "remove-scene-link") {
      this.#syncActiveScene();
      const scene = this.#activeScene();
      if (scene) scene.links = (scene.links ?? []).filter((link) => link.id !== action.dataset.linkId);
      await this.#refreshView();
      this.#scheduleAutosave();
    } else if (name === "add-test-part") {
      this.#addTestPart(action);
    } else if (name === "remove-test-outcome") {
      const block = action.closest(".dmj-test-block");
      action.closest("[data-test-outcome]")?.remove();
      this.#refreshTestAddControl(block);
    } else if (name === "remove-block") {
      const card = action.closest(".dmj-task-card");
      action.closest(".dmj-content-block")?.remove();
      if (!card.querySelector(".dmj-content-block")) card.querySelector(".dmj-card-content").append(this.#createBlockElement(newBlock()));
    } else if (name === "add-scene") {
      this.#syncActiveScene();
      const scene = newScene(this.board.scenes.length + 1);
      this.board.scenes.push(scene);
      this.board.activeSceneId = scene.id;
      await this.#refreshView();
    } else if (name === "select-scene") {
      this.#syncActiveScene();
      this.board.activeSceneId = action.dataset.sceneId;
      await this.#refreshView();
    } else if (name === "remove-scene") {
      this.#syncActiveScene();
      const removedActiveScene = this.board.activeSceneId === action.dataset.sceneId;
      this.board.scenes = this.board.scenes.filter((scene) => scene.id !== action.dataset.sceneId);
      if (removedActiveScene) this.board.activeSceneId = this.board.scenes[0]?.id ?? "";
      await this.#refreshView();
    } else if (name === "add-column") {
      this.#syncActiveScene();
      this.#activeScene()?.columns.push(newColumn());
      await this.#refreshView();
    } else if (name === "remove-column") {
      this.#syncActiveScene();
      const scene = this.#activeScene();
      scene.columns = scene.columns.filter((column) => column.id !== action.dataset.columnId);
      await this.#refreshView();
    } else if (name === "add-card") {
      this.#syncActiveScene();
      const card = newCard();
      this.#activeScene()?.columns.find((column) => column.id === action.dataset.columnId)?.cards.push(card);
      this.focusAfterRender = card.id;
      await this.#refreshView();
    } else if (name === "remove-card") {
      this.#closeSlashMenu();
      this.#closeMentionMenu();
      action.closest(".dmj-task-card")?.remove();
      this.#updateCounts();
    }
    if (AUTOSAVE_ACTIONS.includes(name)) this.#scheduleAutosave();
  }

  #onDoubleClick(event) {
    const handle = event.target.closest?.("[data-card-drag-handle]");
    if (!handle || event.target.closest("button")) return;
    const card = handle.closest(".dmj-task-card");
    if (!card) return;
    event.preventDefault();
    const completed = !card.classList.contains("completed");
    card.classList.toggle("completed", completed);
    card.dataset.cardCompleted = String(completed);
    this.#scheduleAutosave();
  }

  #activeScene() {
    return this.board.scenes.find((scene) => scene.id === this.board.activeSceneId);
  }

  #syncActiveScene() {
    const scene = this.#activeScene();
    if (!scene) return;
    const title = this.#root().querySelector(`[data-scene-title][data-scene-id="${scene.id}"]`);
    if (title) scene.title = title.value.trim() || game.i18n.localize("DMJ.Board.NewScene");
    scene.links = [...this.#root().querySelectorAll("[data-scene-link]")].map((link) => ({
      id: link.dataset.linkId,
      uuid: link.dataset.uuid,
      name: link.dataset.linkName,
      documentName: link.dataset.linkDocumentName,
      kind: link.dataset.linkKind,
      image: link.dataset.linkImage,
      note: link.querySelector("[data-scene-link-note]")?.value ?? ""
    }));
    const columns = this.#root().querySelectorAll(".dmj-kanban-column");
    if (!columns.length) {
      scene.columns = [];
      return;
    }
    scene.columns = [...columns].map((column) => ({
      id: column.dataset.columnId,
      title: column.querySelector("[data-column-title]").value.trim() || game.i18n.localize("DMJ.Board.NewColumn"),
      width: normalizeColumnWidth(column.dataset.columnWidth),
      height: normalizeColumnHeight(column.dataset.columnHeight),
      cards: [...column.querySelectorAll(".dmj-task-card")].map((card) => ({
        id: card.dataset.cardId,
        completed: card.dataset.cardCompleted === "true",
        blocks: [...card.querySelectorAll(".dmj-content-block")].map((block) => {
          const type = BLOCK_TYPES.includes(block.dataset.blockType) ? block.dataset.blockType : "text";
          if (type === "test") {
            const successEditor = block.querySelector("[data-test-result='success']");
            const failureEditor = block.querySelector("[data-test-result='failure']");
            const descriptionEditor = block.querySelector("[data-test-result='description']");
            const successHTML = sanitizeRichTextHTML(successEditor?.innerHTML);
            const failureHTML = sanitizeRichTextHTML(failureEditor?.innerHTML);
            const descriptionHTML = sanitizeRichTextHTML(descriptionEditor?.innerHTML);
            const results = [...block.querySelectorAll("[data-test-outcome='result']")].map((result) => {
              const editor = result.querySelector("[data-test-result-text]");
              const html = sanitizeRichTextHTML(editor?.innerHTML);
              return {
                id: result.dataset.testResultId || crypto.randomUUID(),
                value: result.querySelector("[data-test-result-value]")?.value.trim().slice(0, 30) ?? "",
                html,
                text: richTextToPlainText(html).trim()
              };
            });
            return {
              id: block.dataset.blockId,
              type,
              title: block.querySelector("[data-block-title]")?.value.trim().slice(0, 120) || game.i18n.localize("DMJ.Board.Test"),
              height: null,
              html: "",
              text: "",
              done: false,
              successHTML,
              successText: richTextToPlainText(successHTML).trim(),
              failureHTML,
              failureText: richTextToPlainText(failureHTML).trim(),
              descriptionHTML,
              descriptionText: richTextToPlainText(descriptionHTML).trim(),
              results
            };
          }
          const editor = block.querySelector("[data-block-text]");
          const html = sanitizeRichTextHTML(editor?.innerHTML);
          return {
            id: block.dataset.blockId,
            type,
            title: type === "callout"
              ? block.querySelector("[data-block-title]")?.value.trim().slice(0, 120) || game.i18n.localize("DMJ.Board.Callout")
              : type === "clue"
                ? block.querySelector("[data-block-title]")?.value.trim().slice(0, 120) || game.i18n.localize("DMJ.Board.Clue")
                : "",
            height: null,
            html,
            text: richTextToPlainText(html).trim(),
            done: type === "check" && Boolean(block.querySelector("[data-block-done]")?.checked),
            successHTML: "",
            successText: "",
            failureHTML: "",
            failureText: "",
            descriptionHTML: "",
            descriptionText: "",
            results: []
          };
        })
      }))
    }));
  }

  #scheduleAutosave() {
    this.autosaveRevision += 1;
    this.#clearAutosaveTimer();
    this.#setAutosaveStatus("pending");
    this.autosaveTimer = window.setTimeout(() => {
      this.autosaveTimer = null;
      void this.#saveBoard();
    }, AUTOSAVE_DELAY_MS);
  }

  #clearAutosaveTimer() {
    if (this.autosaveTimer === null) return;
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  async #saveBoard() {
    if (this.savePromise) return this.savePromise;
    if (this.autosaveRevision === this.savedRevision) {
      this.#setAutosaveStatus("saved");
      return true;
    }

    const saveTask = (async () => {
      while (this.savedRevision !== this.autosaveRevision) {
        this.#clearAutosaveTimer();
        this.#syncSessionDetails();
        this.#syncActiveScene();
        const revision = this.autosaveRevision;
        this.#setAutosaveStatus("saving");
        try {
          await DiaryService.updateBoard(this.page, this.board, {
            ...this.sessionDetails,
            name: this.sessionDetails?.name.trim() || this.page.name
          });
          this.savedRevision = revision;
          this.saveErrorNotified = false;
          this.#fitInactiveEditorsToContent();
          await this.workspaceHost?.refreshSessionTile?.(this.page);
          this.workspaceHost?.updateWorkspaceLabel?.(
            "board",
            this.page.id,
            `${game.i18n.localize("DMJ.Board.Title")}: ${this.page.name}`
          );
        } catch (error) {
          console.error(`${MODULE_ID} |`, error);
          this.#setAutosaveStatus("error");
          if (!this.saveErrorNotified) {
            ui.notifications.error(game.i18n.localize("DMJ.Board.AutosaveError"));
            this.saveErrorNotified = true;
          }
          return false;
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
      pending: { icon: "fa-clock", label: "DMJ.Board.AutosavePending" },
      saving: { icon: "fa-spinner fa-spin", label: "DMJ.Board.AutosaveSaving" },
      saved: { icon: "fa-check", label: "DMJ.Board.AutosaveSaved" },
      error: { icon: "fa-triangle-exclamation", label: "DMJ.Board.AutosaveError" }
    };
    const status = statuses[state] ?? statuses.saved;
    this.autosaveState = state in statuses ? state : "saved";
    const indicator = this.#root()?.querySelector?.("[data-autosave-status]");
    if (!indicator) return;
    indicator.dataset.state = this.autosaveState;
    indicator.querySelector("i").className = `fa-solid ${status.icon}`;
    indicator.querySelector("span").textContent = game.i18n.localize(status.label);
  }

  #fitInactiveEditorsToContent() {
    for (const editor of this.#root().querySelectorAll("[data-block-text]")) {
      if (editor === editor.ownerDocument.activeElement) continue;
      delete editor.dataset.manualHeight;
      delete editor.closest(".dmj-content-block").dataset.blockHeight;
      this.#autoSizeEditor(editor);
    }
  }

  #updateCounts() {
    this.#root().querySelectorAll(".dmj-kanban-column").forEach((column) => {
      const count = column.querySelectorAll(".dmj-task-card").length;
      column.querySelector("[data-column-count]").textContent = String(count);
    });
  }

  #clearDropTargets() {
    this.#root().querySelectorAll(".dmj-task-list.drag-target").forEach((list) => list.classList.remove("drag-target"));
    this.#root().querySelectorAll(".dmj-block-editor.dmj-mention-drop-target").forEach((editor) => editor.classList.remove("dmj-mention-drop-target"));
    this.#root().querySelectorAll("[data-scene-links-drop].drag-target").forEach((zone) => zone.classList.remove("drag-target"));
  }
}
