// @generated-source wix-headless-replatform
// Framework-neutral state mechanics for cloned interaction primitives.

export function bindActiveItemRail(root, { activateOnHover = false, alignActive = false } = {}) {
  requireRoot(root, "active-card-rail");
  const items = Array.from(root.querySelectorAll("[data-rp-item]"));
  const controls = Array.from(root.querySelectorAll("[data-rp-direction]"));
  const track = root.querySelector("[data-rp-track]");
  const viewport = root.querySelector("[data-rp-viewport]") || track?.parentElement || null;
  const listeners = [];
  const activate = (item) => {
    if (!item || !items.includes(item)) return;
    for (const candidate of items) {
      const active = candidate === item;
      candidate.setAttribute("data-rp-active", String(active));
      candidate.setAttribute("aria-selected", String(active));
    }
    if (alignActive) alignItemInViewport(item, viewport);
    root.dispatchEvent(new CustomEvent("rp:statechange", { detail: { index: items.indexOf(item) } }));
  };
  for (const item of items) {
    const target = item.querySelector("[data-rp-activate]") || item;
    listen(listeners, item, "click", (event) => {
      const interactive = event.target?.closest?.("a,button,input,select,textarea,[role='button']");
      if (interactive && interactive !== item && interactive !== target && !target.contains(interactive)) return;
      activate(item);
    });
    listen(listeners, target, "keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate(item);
      }
    });
    if (activateOnHover) listen(listeners, item, "pointerenter", () => activate(item));
  }
  for (const control of controls) {
    listen(listeners, control, "click", () => {
      const direction = Number(control.getAttribute("data-rp-direction")) || 0;
      const activeIndex = Math.max(0, items.findIndex((item) => item.getAttribute("data-rp-active") === "true"));
      activate(items[wrapIndex(activeIndex + direction, items.length)]);
    });
  }
  const initialState = root.getAttribute("data-rp-initial-state") || "single-active";
  if (initialState !== "all-collapsed" && !items.some((item) => item.getAttribute("data-rp-active") === "true") && items[0]) activate(items[0]);
  markInitialized(root, "active-card-rail");
  return { activate, destroy: () => removeListeners(listeners) };
}

export function bindContentSwitcher(root) {
  requireRoot(root, "content-switcher");
  const items = Array.from(root.querySelectorAll("[data-rp-item][data-rp-state]"));
  const panels = Array.from(root.querySelectorAll("[data-rp-panel][data-rp-state]"));
  const listeners = [];
  const activate = (state) => {
    for (const item of items) {
      const active = item.getAttribute("data-rp-state") === state;
      item.setAttribute("data-rp-active", String(active));
      item.setAttribute("aria-selected", String(active));
    }
    for (const panel of panels) {
      const active = panel.getAttribute("data-rp-state") === state;
      panel.hidden = !active;
      panel.setAttribute("aria-hidden", String(!active));
    }
    root.dispatchEvent(new CustomEvent("rp:statechange", { detail: { state } }));
  };
  for (const item of items) {
    const target = item.querySelector("[data-rp-activate]") || item;
    listen(listeners, item, "click", () => activate(item.getAttribute("data-rp-state")));
  }
  const initial = items.find((item) => item.getAttribute("data-rp-active") === "true")?.getAttribute("data-rp-state") || items[0]?.getAttribute("data-rp-state");
  if (initial) activate(initial);
  markInitialized(root, "content-switcher");
  return { activate, destroy: () => removeListeners(listeners) };
}

export function bindScrollScene(root, { phases = defaultScrollPhases() } = {}) {
  requireRoot(root, "scroll-scene");
  const ordered = normalizePhases(phases);
  let frame = 0;
  const update = () => {
    frame = 0;
    const rect = root.getBoundingClientRect();
    const travel = Math.max(1, rect.height - window.innerHeight);
    const progress = clamp((-rect.top) / travel, 0, 1);
    const entryProgress = clamp((window.innerHeight - rect.top) / Math.max(1, window.innerHeight), 0, 1);
    const phase = phaseForProgress(progress, ordered);
    root.setAttribute("data-rp-phase", phase.name);
    root.style.setProperty("--rp-scroll-progress", String(progress));
    root.style.setProperty("--rp-entry-progress", String(entryProgress));
    root.dispatchEvent(new CustomEvent("rp:scrollphase", { detail: { phase: phase.name, progress, entryProgress } }));
  };
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  update();
  markInitialized(root, "scroll-scene");
  return {
    update,
    destroy: () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    },
  };
}

export function autoBindInteractions(scope = document) {
  const roots = Array.from(scope.querySelectorAll("[data-rp-scene]"));
  const bindings = [];
  for (const root of roots) {
    if (root.querySelector("[data-rp-track]") && !isInitialized(root, "active-card-rail")) {
      bindings.push(bindActiveItemRail(root, {
        activateOnHover: root.getAttribute("data-rp-activate-on-hover") === "true",
        alignActive: root.getAttribute("data-rp-align-active") !== "false",
      }));
    }
    if (root.querySelector("[data-rp-item][data-rp-state]") && root.querySelector("[data-rp-panel][data-rp-state]") && !isInitialized(root, "content-switcher")) {
      bindings.push(bindContentSwitcher(root));
    }
    if (root.querySelector("[data-rp-visual]") && !isInitialized(root, "scroll-scene")) {
      bindings.push(bindScrollScene(root));
    }
  }
  return { bindings, destroy: () => bindings.forEach((binding) => binding?.destroy?.()) };
}

export function phaseForProgress(progress, phases = defaultScrollPhases()) {
  const ordered = normalizePhases(phases);
  const value = clamp(Number(progress) || 0, 0, 1);
  return [...ordered].reverse().find((phase) => value >= phase.at) || ordered[0];
}

function defaultScrollPhases() {
  return [
    { name: "approach", at: 0 },
    { name: "active", at: 0.25 },
    { name: "reveal", at: 0.65 },
    { name: "release", at: 0.92 },
  ];
}

function normalizePhases(phases) {
  const normalized = (phases || []).map((phase, index) => ({
    name: String(phase.name || phase.id || `phase-${index + 1}`),
    at: clamp(Number(phase.at ?? phase.progress ?? 0), 0, 1),
  })).sort((left, right) => left.at - right.at);
  return normalized.length ? normalized : defaultScrollPhases();
}

function requireRoot(root, primitive) {
  if (!root || typeof root.querySelectorAll !== "function") throw new Error(`Missing root element for ${primitive}.`);
}

function listen(listeners, target, type, handler) {
  target.addEventListener(type, handler);
  listeners.push([target, type, handler]);
}

function removeListeners(listeners) {
  for (const [target, type, handler] of listeners) target.removeEventListener(type, handler);
}

function alignItemInViewport(item, viewport) {
  if (!viewport || typeof viewport.scrollTo !== "function") return;
  const viewportRect = viewport.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const left = viewport.scrollLeft + itemRect.left - viewportRect.left - ((viewportRect.width - itemRect.width) / 2);
  viewport.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
}

function initializedTokens(root) {
  return new Set(String(root.getAttribute("data-rp-initialized") || "").split(/\s+/).filter(Boolean));
}

function isInitialized(root, primitive) {
  return initializedTokens(root).has(primitive);
}

function markInitialized(root, primitive) {
  const tokens = initializedTokens(root);
  tokens.add(primitive);
  root.setAttribute("data-rp-initialized", Array.from(tokens).join(" "));
}

function wrapIndex(index, length) {
  return length ? (index % length + length) % length : 0;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
