import { SessionDashboard } from "./applications/session-dashboard.js?v=1.12.0";
import { PlayerDiary } from "./applications/player-diary.js?v=1.12.0";
import { DOCUMENT_TYPES, FLAGS, MODULE_ID, SETTINGS } from "./constants.js";
import { ItemPilesIntegration } from "./integrations/item-piles.js?v=1.11.0";
import { DiaryService } from "./services/diary-service.js";
import { PlayerDiaryService } from "./services/player-diary-service.js?v=1.12.0";
import { CLUE_DRAG_TYPE, ClueService } from "./services/clue-service.js";
import { getJournalDirectory } from "./compat/journal-directory.js";
import { getElementDocument, isPopoutAvailable, popoutApplication, registerPopoutCompatibility } from "./compat/popout.js";

let dashboard;
let playerDiary;
let playerDiaryRefreshTimer = null;

function refreshPlayerDiary() {
  if (!playerDiary?.rendered) return;
  if (playerDiaryRefreshTimer !== null) globalThis.clearTimeout(playerDiaryRefreshTimer);
  playerDiaryRefreshTimer = globalThis.setTimeout(() => {
    playerDiaryRefreshTimer = null;
    if (playerDiary?.rendered) void playerDiary.render({ force: true });
  }, 100);
}

function refreshPlayerDiaryForActor(actor) {
  if (!playerDiary?.rendered || !actor?.uuid) return;
  const linked = PlayerDiaryService.getArticlePages().some(
    (page) => page.getFlag(MODULE_ID, FLAGS.MERCHANT_UUID) === actor.uuid
  );
  let merchant = false;
  const status = ItemPilesIntegration.getStatus();
  if (status.available) {
    try {
      merchant = status.api.isItemPileMerchant(actor);
    } catch {
      merchant = false;
    }
  }
  if (linked || merchant) refreshPlayerDiary();
}

function refreshPlayerDiaryForItem(item) {
  if (item?.parent?.documentName === "Actor") refreshPlayerDiaryForActor(item.parent);
}

function handleClueCanvasDrop(targetCanvas, data) {
  if (data?.type !== CLUE_DRAG_TYPE) return;
  if (!game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize("DMJ.Error.GMOnly"));
    return false;
  }
  void ClueService.dropOnCanvas(targetCanvas, data).catch((error) => {
    console.error(`${MODULE_ID} | Failed to create a private clue Note`, error);
    ui.notifications.error(error?.message || game.i18n.localize("DMJ.Clue.Invalid"));
  });
  return false;
}

function handleClueNoteActivation(note) {
  const document = note?.document;
  if (document?.getFlag(MODULE_ID, "clue") !== true) return;
  if (!game.user?.isGM) return false;

  const sourceSessionPageId = String(document.getFlag(MODULE_ID, "sourceSessionPageId") ?? "");
  const sourceBlockId = String(document.getFlag(MODULE_ID, "sourceBlockId") ?? "");
  const diary = DiaryService.getDiary();
  const page = diary?.pages.get(sourceSessionPageId);
  if (!page || page.getFlag(MODULE_ID, FLAGS.TYPE) !== DOCUMENT_TYPES.SESSION) {
    ui.notifications.error(game.i18n.localize("DMJ.Clue.Invalid"));
    return false;
  }

  const api = game.modules.get(MODULE_ID)?.api;
  if (typeof api?.openBoard !== "function") {
    ui.notifications.error(game.i18n.localize("DMJ.Clue.Invalid"));
    return false;
  }
  void Promise.resolve(api.openBoard(page, { focusBlockId: sourceBlockId })).catch((error) => {
    console.error(`${MODULE_ID} | Failed to open a clue in the Game Master's Journal`, error);
    ui.notifications.error(error?.message || game.i18n.localize("DMJ.Clue.Invalid"));
  });
  return false;
}

function requireGameMasterUI() {
  if (game.user?.isGM) return true;
  ui.notifications.warn(game.i18n.localize("DMJ.Error.GMOnly"));
  return false;
}

function injectJournalLauncher(app, html) {
  if (!game.user) return;

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
  footer.innerHTML = `${game.user.isGM ? `<button type="button" data-action="open-gm-diary">
    <i class="fa-solid fa-book-journal-whills" aria-hidden="true"></i>
    <span>${game.i18n.localize("DMJ.App.Open")}</span>
  </button>` : ""}<button type="button" data-action="open-player-diary">
    <i class="fa-solid fa-book-open-reader" aria-hidden="true"></i>
    <span>${game.i18n.localize("DMJ.PlayerDiary.Open")}</span>
  </button>`;
  footer.querySelector("[data-action='open-gm-diary']")?.addEventListener("click", () => game.modules.get(MODULE_ID).api.open());
  footer.querySelector("[data-action='open-player-diary']")?.addEventListener("click", () => game.modules.get(MODULE_ID).api.openPlayerDiary());

  const directoryList = root.querySelector(".directory-list");
  if (directoryList) directoryList.insertAdjacentElement("afterend", footer);
  else root.append(footer);
}

Hooks.once("init", () => {
  registerPopoutCompatibility();
  Hooks.on("dropCanvasData", handleClueCanvasDrop);
  Hooks.on("activateNote", handleClueNoteActivation);
  game.settings.register(MODULE_ID, SETTINGS.SESSION_VIEW, {
    name: "DMJ.Settings.SessionView.Name",
    hint: "DMJ.Settings.SessionView.Hint",
    scope: "client",
    config: false,
    type: String,
    default: "cards"
  });
  game.settings.registerMenu(MODULE_ID, "dashboard", {
    name: "DMJ.Settings.Open.Name",
    label: "DMJ.Settings.Open.Label",
    hint: "DMJ.Settings.Open.Hint",
    icon: "fa-solid fa-book-journal-whills",
    type: SessionDashboard,
    restricted: true
  });
  for (const provider of ItemPilesIntegration.providerDefinitions) Hooks.on(provider.readyHook, refreshPlayerDiary);
});

Hooks.once("setup", () => {
  const module = game.modules.get(MODULE_ID);
  module.api = Object.freeze({
    open() {
      if (!requireGameMasterUI()) return null;
      dashboard ??= new SessionDashboard();
      dashboard.activateTab("sessions");
      return dashboard.render({ force: true });
    },
    getDiary() {
      return game.user?.isGM ? DiaryService.getDiary() : null;
    },
    getPlayerDiary() {
      return PlayerDiaryService.getDiary();
    },
    openPlayerDiary() {
      playerDiary ??= new PlayerDiary();
      return playerDiary.render({ force: true });
    },
    getSessions() {
      return game.user?.isGM ? DiaryService.getSessions() : [];
    },
    openLibrary() {
      if (!requireGameMasterUI()) return null;
      dashboard ??= new SessionDashboard();
      dashboard.activateTab("library");
      return dashboard.render({ force: true });
    },
    async openSession(page) {
      if (!requireGameMasterUI()) return null;
      dashboard ??= new SessionDashboard();
      if (!dashboard.rendered) await dashboard.render({ force: true });
      return dashboard.openSession(page);
    },
    async openBoard(page, options = {}) {
      if (!requireGameMasterUI()) return null;
      dashboard ??= new SessionDashboard();
      if (!dashboard.rendered) await dashboard.render({ force: true });
      return dashboard.openBoard(page, options);
    },
    async openResource(page) {
      if (!requireGameMasterUI()) return null;
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
    addResource(page) {
      if (!dashboard?.rendered) return null;
      return dashboard.addResourceTile(page);
    },
    isPopoutAvailable,
    popout(app) {
      if (!requireGameMasterUI()) return false;
      return popoutApplication(app);
    }
  });
});

Hooks.once("ready", () => {
  const directory = getJournalDirectory();
  injectJournalLauncher(directory, directory?.element);
  const itemPilesStatus = ItemPilesIntegration.getStatus();
  if (game.user?.isGM && itemPilesStatus.conflict) ui.notifications.warn(game.i18n.localize("DMJ.ItemPiles.Error.Conflict"));
});

Hooks.on("renderApplicationV2", (app, element) => {
  if (app === getJournalDirectory()) injectJournalLauncher(app, element);
});

for (const hook of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"]) {
  Hooks.on(hook, (page) => {
    if (page?.parent?.getFlag(MODULE_ID, FLAGS.TYPE) === DOCUMENT_TYPES.PLAYER_DIARY) refreshPlayerDiary();
  });
}

Hooks.on("createActor", refreshPlayerDiaryForActor);
Hooks.on("updateActor", refreshPlayerDiaryForActor);
Hooks.on("deleteActor", refreshPlayerDiaryForActor);
Hooks.on("createItem", refreshPlayerDiaryForItem);
Hooks.on("updateItem", refreshPlayerDiaryForItem);
Hooks.on("deleteItem", refreshPlayerDiaryForItem);
