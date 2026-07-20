/* global PopoutModule */

import { MODULE_ID } from "../constants.js";

const POPOUT_MODULE_ID = "popout";

export function getElementDocument(element) {
  return element?.ownerDocument ?? globalThis.document;
}

export function getElementWindow(element) {
  return getElementDocument(element)?.defaultView ?? globalThis.window;
}

function getPopoutAPI() {
  if (!game.modules.get(POPOUT_MODULE_ID)?.active) return null;
  return typeof PopoutModule !== "undefined" && typeof PopoutModule.popoutApp === "function"
    ? PopoutModule
    : null;
}

export function isPopoutAvailable() {
  return Boolean(getPopoutAPI());
}

export function popoutApplication(app) {
  const api = getPopoutAPI();
  if (!api) {
    ui.notifications.warn(game.i18n.localize("DMJ.Popout.Unavailable"));
    return false;
  }
  if (!app?.rendered) {
    ui.notifications.warn(game.i18n.localize("DMJ.Popout.RenderFirst"));
    return false;
  }
  api.popoutApp(app);
  return true;
}

export function registerPopoutCompatibility() {
  Hooks.on("PopOut:loaded", (app, node) => {
    if (typeof app?.onPopoutLoaded !== "function") return;
    try {
      const result = app.onPopoutLoaded(node);
      if (result?.catch) result.catch((error) => console.error(`${MODULE_ID} | PopOut`, error));
    } catch (error) {
      console.error(`${MODULE_ID} | PopOut`, error);
    }
  });
}
