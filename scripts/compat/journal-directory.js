/**
 * Return the Journal sidebar application through the public WorldCollection
 * accessor, with the v13 UI reference as a fallback.
 */
export function getJournalDirectory() {
  return game.journal?.directory ?? ui.journal ?? null;
}
