/**
 * Small helpers shared by the mini-game screens: element builder, drag with
 * mouse/touch/pen (pointer events), and hit-testing.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children.flat()) if (c) node.append(c);
  return node;
}

/**
 * Make an element draggable. Callbacks get the pointer event; onStart can
 * return false to refuse. While dragging, the element follows the pointer via
 * a CSS transform unless `onMove` returns true (it positioned it itself).
 */
export function draggable(node, { onStart, onMove, onEnd } = {}) {
  node.style.touchAction = 'none';
  node.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    if (onStart?.(e) === false) return;
    e.preventDefault();
    node.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY;
    node.classList.add('is-dragging');
    const move = (ev) => {
      if (onMove?.(ev, ev.clientX - x0, ev.clientY - y0) === true) return;
      node.style.transform = `translate(${ev.clientX - x0}px, ${ev.clientY - y0}px)`;
    };
    const up = (ev) => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.classList.remove('is-dragging');
      node.style.transform = '';
      onEnd?.(ev, ev.type === 'pointercancel');
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
  });
}

/** Is a screen point inside an element's box (with optional padding)? */
export function over(node, x, y, pad = 0) {
  const r = node.getBoundingClientRect();
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}
