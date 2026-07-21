import { DOCUMENT_TYPES, FLAGS, MODULE_ID } from "../constants.js";
import { DiaryService } from "./diary-service.js";

export const CLUE_DRAG_TYPE = `${MODULE_ID}.Clue`;

const MAX_TITLE_LENGTH = 120;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

function requireGameMaster() {
  if (!game.user?.isGM) throw new Error(game.i18n.localize("DMJ.Error.GMOnly"));
}

function cleanTitle(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_TITLE_LENGTH);
}

function cleanSourceId(value) {
  const id = String(value ?? "").trim();
  return SOURCE_ID_PATTERN.test(id) ? id : "";
}

export class ClueService {
  static async dropOnCanvas(targetCanvas, rawData = {}) {
    requireGameMaster();
    const scene = targetCanvas?.scene;
    const x = Number(rawData.x);
    const y = Number(rawData.y);
    const sourceSessionPageId = cleanSourceId(rawData.sourceSessionPageId);
    const sourceBlockId = cleanSourceId(rawData.sourceBlockId);
    if (!scene || !Number.isFinite(x) || !Number.isFinite(y) || !sourceSessionPageId || !sourceBlockId) {
      throw new Error(game.i18n.localize("DMJ.Clue.Invalid"));
    }

    const diary = await DiaryService.getOrCreateDiary();
    const sourcePage = diary.pages.get(sourceSessionPageId);
    if (!sourcePage || sourcePage.getFlag(MODULE_ID, FLAGS.TYPE) !== DOCUMENT_TYPES.SESSION) {
      throw new Error(game.i18n.localize("DMJ.Clue.Invalid"));
    }

    const title = cleanTitle(rawData.title) || game.i18n.localize("DMJ.Board.Clue");
    const [note] = await scene.createEmbeddedDocuments("Note", [{
      entryId: diary.id,
      pageId: sourcePage.id,
      x: Math.round(x),
      y: Math.round(y),
      text: title,
      global: true,
      iconSize: 40,
      texture: { src: "icons/svg/eye.svg" },
      flags: {
        [MODULE_ID]: {
          clue: true,
          sourceSessionPageId,
          sourceBlockId
        }
      }
    }]);
    if (!note) throw new Error(game.i18n.localize("DMJ.Clue.Invalid"));
    ui.notifications.info(game.i18n.localize("DMJ.Clue.Placed"));
    return note;
  }
}
