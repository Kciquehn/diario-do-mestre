import { SessionDashboard } from "./applications/session-dashboard.js";
import { MODULE_ID } from "./constants.js";
import { DiaryService } from "./services/diary-service.js";
import { getJournalDirectory } from "./compat/journal-directory.js";
import { getElementDocument, isPopoutAvailable, popoutApplication, registerPopoutCompatibility } from "./compat/popout.js";

let dashboard;

function injectJournalLauncher(app, html) {
  if (!game.user?.isGM) return;

  const isElement = (value) => value?.nodeType === 1 && typeof value.querySelector === "function";
  const fallbackDocument = getElementDocument(app?.element?.[0] ?? app?.element);
  const root = isElement(html)
    ? html
    : isElement(html?.[0])
      ? html[0]
      : isElement(app?.element)
        ? app.element
        : app?.element?.[0] ?? fallbackDocument.querySelector("#journal");
  if (!root || root.querySelector(`[data-${MODULE_ID}-launcher]`)) return;

  const footer = getElementDocument(root).createElement("div");
  footer.className = "dmj-sidebar-launcher";
  footer.setAttribute(`data-${MODULE_ID}-launcher`, "true");
  footer.innerHTML = `<button type="button">
    <i class="fa-solid fa-book-journal-whills" aria-hidden="true"></i>
    <span>${game.i18n.localize("DMJ.App.Open")}</span>
  </button>`;
  footer.querySelector("button").addEventListener("click", () => game.modules.get(MODULE_ID).api.open());

  const directoryList = root.querySelector(".directory-list");
  if (directoryList) directoryList.insertAdjacentElement("afterend", footer);
  else root.append(footer);
}

Hooks.once("init", () => {
  registerPopoutCompatibility();
  game.settings.registerMenu(MODULE_ID, "dashboard", {
    name: "DMJ.Settings.Open.Name",
    label: "DMJ.Settings.Open.Label",
    hint: "DMJ.Settings.Open.Hint",
    icon: "fa-solid fa-book-journal-whills",
    type: SessionDashboard,
    restricted: true
  });
});

Hooks.once("setup", () => {
  const module = game.modules.get(MODULE_ID);
  module.api = Object.freeze({
    open() {
      dashboard ??= new SessionDashboard();
      dashboard.activateTab("sessions");
      return dashboard.render({ force: true });
    },
    getDiary: DiaryService.getDiary.bind(DiaryService),
    getSessions: DiaryService.getSessions.bind(DiaryService),
    openLibrary() {
      dashboard ??= new SessionDashboard();
      dashboard.activateTab("library");
      return dashboard.render({ force: true });
    },
    async openSession(page) {
      dashboard ??= new SessionDashboard();
      if (!dashboard.rendered) await dashboard.render({ force: true });
      return dashboard.openSession(page);
    },
    async openBoard(page) {
      dashboard ??= new SessionDashboard();
      if (!dashboard.rendered) await dashboard.render({ force: true });
      return dashboard.openBoard(page);
    },
    async openResource(page) {
      dashboard ??= new SessionDashboard();
      if (!dashboard.rendered) await dashboard.render({ force: true });
      return dashboard.openResource(page);
    },
    refreshDashboard() {
      if (!dashboard?.rendered) return null;
      return dashboard.render({ force: true });
    },
    refreshResource(page) {
      if (!dashboard?.rendered) return null;
      return dashboard.refreshResourceTile(page);
    },
    isPopoutAvailable,
    popout: popoutApplication
  });
});

Hooks.once("ready", () => {
  const directory = getJournalDirectory();
  injectJournalLauncher(directory, directory?.element);
});

Hooks.on("renderApplicationV2", (app, element) => {
  if (app === getJournalDirectory()) injectJournalLauncher(app, element);
});
