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
  const api = typeof PopoutModule !== "undefined" ? PopoutModule : globalThis.PopoutModule;
  return typeof api?.popoutApp === "function"
    ? api
    : null;
}

function hasNativeDetach(app) {
  return typeof app?.detachWindow === "function";
}

export function isPopoutAvailable(app) {
  return hasNativeDetach(app) || Boolean(getPopoutAPI());
}

export async function popoutApplication(app) {
  if (!app?.rendered) {
    ui.notifications.warn(game.i18n.localize("DMJ.Popout.RenderFirst"));
    return false;
  }

  try {
    if (hasNativeDetach(app)) {
      await app.detachWindow();
      return true;
    }

    const api = getPopoutAPI();
    if (!api) {
      ui.notifications.warn(game.i18n.localize("DMJ.Popout.Unavailable"));
      return false;
    }
    api.popoutApp(app);
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | PopOut`, error);
    ui.notifications.error(game.i18n.localize("DMJ.Popout.Error"));
    return false;
  }
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
