// Generic bottom-sheet modal. Returns { el, close }. `build(el, close)` fills
// the sheet body; call `close()` from inside to dismiss (e.g. after save).
export function openSheet(build, { dismissable = true } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";

  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");

  const grabber = document.createElement("div");
  grabber.className = "sheet-grabber";
  sheet.appendChild(grabber);

  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  document.body.style.overflow = "hidden";

  function close() {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    document.body.style.overflow = "";
  }

  function onKey(e) {
    if (e.key === "Escape" && dismissable) close();
  }
  document.addEventListener("keydown", onKey);

  if (dismissable) {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
  }

  build(sheet, close);

  // Focus the first focusable element for keyboard users.
  requestAnimationFrame(() => {
    const focusable = sheet.querySelector("input, select, textarea, button:not(.sheet-close)");
    if (focusable) focusable.focus({ preventScroll: true });
  });

  return { el: sheet, close };
}

export function toast(message) {
  const app = document.getElementById("app");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  app.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    if (typeof child === "string") { node.appendChild(document.createTextNode(child)); continue; }
    if (!(child instanceof Node)) { console.warn(`el("${tag}"): ignoring non-node child`, child); continue; }
    node.appendChild(child);
  }
  return node;
}
