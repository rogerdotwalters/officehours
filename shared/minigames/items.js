/**
 * Item pictures and their collision shapes, ready to use.
 * The data comes from items.generated.js (built from client/assets/items/items.csv).
 */
import { ITEMS as RAW, ITEM_CELL } from './items.generated.js';
import { decodeMask, solidCells, maskEdges } from './pixelMask.js';

export { ITEM_CELL };

export const ITEMS = RAW.map((it) => {
  const mask = decodeMask(it.mask, it.cols);
  const cells = solidCells(mask, it.cols, it.rows);
  return {
    ...it,
    maskBits: mask,
    cells,
    // Lowest solid row: what the item "stands on".
    bottom: Math.max(...cells.map((c) => c[1])),
    top: Math.min(...cells.map((c) => c[1])),
    right: Math.max(...cells.map((c) => c[0])),
    left: Math.min(...cells.map((c) => c[0])),
    edges: maskEdges(mask, it.cols, it.rows),
  };
});

export const ITEMS_BY_ID = new Map(ITEMS.map((it) => [it.id, it]));

export function itemsFor(use) {
  return ITEMS.filter((it) => it.uses.includes(use));
}

/** URL of an item's picture, relative to the page. */
export function itemUrl(item) {
  return `assets/items/${item.file}`;
}
