import { MODULE_ID } from "../constants.js";
import { DiaryService } from "../services/diary-service.js";
import { getElementWindow } from "../compat/popout.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TEMPLATE = `modules/${MODULE_ID}/templates/session-planner.hbs`;

export class SessionPlanner extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(page, options = {}) {
    super({ id: `${MODULE_ID}-session-${page.id}`, ...options });
    this.page = page;
    this.embeddedRoot = null;
    this.workspaceHost = null;
    this.draftData = null;
  }

  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "session-planner"],
    tag: "section",
    window: {
      title: "DMJ.Planner.Title",
      icon: "fa-solid fa-pen-ruler",
      resizable: true
    },
    position: { width: 900, height: 760 }
  };

  static PARTS = {
    main: { template: TEMPLATE }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return { ...context, ...this.#prepareViewContext() };
  }

  #prepareViewContext() {
    const data = DiaryService.getSessionData(this.page);
    const rawStatus = this.page.getFlag(MODULE_ID, "status");
    const status = ["draft", "ready", "played"].includes(rawStatus) ? rawStatus : "draft";
    const values = this.draftData ? { ...data, ...this.draftData } : data;
    const currentStatus = this.draftData?.status ?? status;
    return {
      ...values,
      formIdSuffix: this.page.id,
      name: this.draftData?.name ?? this.page.name,
      date: this.draftData?.date ?? this.page.getFlag(MODULE_ID, "date") ?? "",
      statusDraft: currentStatus === "draft",
      statusReady: currentStatus === "ready",
      statusPlayed: currentStatus === "played"
    };
  }

  async mount(container, host) {
    this.embeddedRoot = container;
    this.workspaceHost = host;
    container.classList.add(MODULE_ID, "session-planner", "dmj-workspace-view");
    container.innerHTML = await foundry.applications.handlebars.renderTemplate(TEMPLATE, this.#prepareViewContext());
    this.#activate(container);
    return this;
  }

  captureForHostRender() {
    const form = this.embeddedRoot?.querySelector("form[data-form='planner']");
    if (form) this.draftData = Object.fromEntries(new (getElementWindow(form).FormData)(form));
  }

  async unmount() {
    this.captureForHostRender();
    this.listenerController?.abort();
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
    this.listenerController?.abort();
    this.listenerController = new (getElementWindow(root).AbortController)();
    const listenerOptions = { signal: this.listenerController.signal };
    root.addEventListener("submit", this.#onSubmit.bind(this), listenerOptions);
    root.querySelector("[data-action='open-board']").addEventListener("click", () => {
      if (this.workspaceHost) void this.workspaceHost.openBoard(this.page);
      else void game.modules.get(MODULE_ID).api.openBoard(this.page);
    }, listenerOptions);
    root.querySelector("[data-action='open-library']").addEventListener("click", () => {
      if (this.workspaceHost) this.workspaceHost.activateTab("library");
      else game.modules.get(MODULE_ID).api.openLibrary();
    }, listenerOptions);
  }

  async #refreshView() {
    if (this.embeddedRoot) return this.mount(this.embeddedRoot, this.workspaceHost);
    return this.render({ force: true });
  }

  async #onSubmit(event) {
    const form = event.target.closest("form[data-form='planner']");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;

    try {
      await DiaryService.updateSession(this.page, new (getElementWindow(form).FormData)(form));
      this.draftData = null;
      ui.notifications.info(game.i18n.localize("DMJ.Planner.Saved"));
      await this.workspaceHost?.refreshSessionTile?.(this.page);
      this.workspaceHost?.updateWorkspaceLabel?.("session", this.page.id, this.page.name);
      this.workspaceHost?.updateWorkspaceLabel?.("board", this.page.id, `${game.i18n.localize("DMJ.Board.Title")}: ${this.page.name}`);
      await this.#refreshView();
      if (!this.workspaceHost) await game.modules.get(MODULE_ID).api.refreshDashboard();
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error.message);
      button.disabled = false;
    }
  }
}
