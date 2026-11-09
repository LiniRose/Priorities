const list = document.getElementById("list");
const form = document.getElementById("add-form");
const input = document.getElementById("add-input");
const empty = document.getElementById("empty");
const undoBtn = document.getElementById("undo-btn");
const redoBtn = document.getElementById("redo-btn");

const STORAGE_KEY = "priorities";
const defaults = [];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Storage
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : defaults;
  } catch {
    return defaults;
  }
}

function readList() {
  return [...list.children].map((li) => li.querySelector(".text").textContent);
}

function persist(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // if storrage is blocked
  }
  empty.hidden = items.length > 0;
}

// Undo/redo

const MAX_HISTORY = 10;
const undoStack = [];
const redoStack = [];
let current = [];

// records the change
function save() {
  const items = readList();
  if (JSON.stringify(items) !== JSON.stringify(current)) {
    undoStack.push(current);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0; // a new change clears the redo history
    current = items;
  }
  persist(items);
  updateHistoryButtons();
}

function restore(items) {
  current = items;
  list.innerHTML = "";
  items.forEach((text) => list.appendChild(createItem(text)));
  persist(items);
  updateHistoryButtons();
}

function undo() {
  if (drag || undoStack.length === 0) return;
  redoStack.push(current);
  restore(undoStack.pop());
}

function redo() {
  if (drag || redoStack.length === 0) return;
  undoStack.push(current);
  restore(redoStack.pop());
}

function updateHistoryButtons() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);

// Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z/Ctrl+Y
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.target.closest && e.target.closest("textarea, input")) return;
  const key = e.key.toLowerCase();
  if (key === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if ((key === "z" && e.shiftKey) || key === "y") {
    e.preventDefault();
    redo();
  }
});

// Building item cards
function createItem(text) {
  const li = document.createElement("li");
  li.className = "item";
  li.tabIndex = 0;

  const handle = document.createElement("span");
  handle.className = "handle";
  handle.textContent = "⋮⋮";
  handle.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.className = "text";
  label.textContent = text;

  const remove = document.createElement("button");
  remove.className = "remove";
  remove.type = "button";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `Remove ${text}`);

  li.append(handle, label, remove);
  return li;
}

// Smooth movement
function snapshot() {
  const tops = new Map();
  list.querySelectorAll(".item:not(.placeholder)").forEach((el) => {
    tops.set(el, el.getBoundingClientRect().top);
  });
  return tops;
}

function animateFrom(before) {
  if (reduceMotion.matches) return;
  before.forEach((oldTop, el) => {
    const delta = oldTop - el.getBoundingClientRect().top;
    if (delta) {
      el.animate(
        [
          { transform: `translateY(${delta}px)` },
          { transform: "translateY(0)" },
        ],
        { duration: 180, easing: "cubic-bezier(.2,.8,.3,1)" },
      );
    }
  });
}

//Dragging with pointer events
let drag = null;

list.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.target.closest(".remove")) return;
  const item = e.target.closest(".item");
  if (!item) return;
  // for touch screens
  if (e.pointerType === "touch" && !e.target.closest(".handle")) return;

  const rect = item.getBoundingClientRect();
  drag = {
    item,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    y: e.clientY,
    offsetY: e.clientY - rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    started: false,
    ghost: null,
    raf: 0,
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
});

function startDrag() {
  const { item } = drag;

  // floating copy
  const ghost = item.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.removeAttribute("tabindex");
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.width = `${drag.width}px`;
  ghost.style.height = `${drag.height}px`;
  ghost.style.left = `${drag.left}px`;
  document.body.appendChild(ghost);

  // empty slot where it will land
  item.classList.add("placeholder");
  document.body.classList.add("is-dragging");

  drag.ghost = ghost;
  drag.started = true;
  update();
  drag.raf = requestAnimationFrame(autoscroll);
}

function onMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.y = e.clientY;

  if (!drag.started) {
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (moved < 5) return; // no tiny movements
    startDrag();
  }
  update();
}

function update() {
  const top = drag.y - drag.offsetY;
  drag.ghost.style.top = `${top}px`;

  const centerY = top + drag.height / 2;
  const after = getItemAfter(centerY);

  if (after !== drag.item.nextElementSibling) {
    const before = snapshot();
    list.insertBefore(drag.item, after);
    animateFrom(before);
  }

  // sync with slot
  const rank = [...list.children].indexOf(drag.item) + 1;
  drag.ghost.style.setProperty("--rank", `"${rank}"`);
  drag.ghost.classList.toggle("is-top", rank === 1);
}

function getItemAfter(y) {
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  list.querySelectorAll(".item:not(.placeholder)").forEach((el) => {
    const box = el.getBoundingClientRect();
    const offset = y - (box.top + box.height / 2);
    if (offset < 0 && offset > closest.offset)
      closest = { offset, element: el };
  });
  return closest.element;
}

// Scroll the page when dragging
function autoscroll() {
  if (!drag || !drag.started) return;
  const edge = 70;
  let dy = 0;
  if (drag.y < edge) dy = -(edge - drag.y) / 3;
  else if (drag.y > window.innerHeight - edge)
    dy = (drag.y - (window.innerHeight - edge)) / 3;
  if (dy) {
    window.scrollBy(0, dy);
    update();
  }
  drag.raf = requestAnimationFrame(autoscroll);
}

function onUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;

  document.removeEventListener("pointermove", onMove);
  document.removeEventListener("pointerup", onUp);
  document.removeEventListener("pointercancel", onUp);

  const { item, ghost, started, raf } = drag;
  drag = null;
  if (!started) return;

  cancelAnimationFrame(raf);

  const finish = () => {
    ghost.remove();
    item.classList.remove("placeholder");
    document.body.classList.remove("is-dragging");
    save();
  };

  // settles into slot
  if (reduceMotion.matches) return finish();
  const target = item.getBoundingClientRect();
  const lifted = "scale(1.03) rotate(-1.2deg)";
  ghost
    .animate(
      [
        { top: ghost.style.top, transform: lifted },
        { top: `${target.top}px`, transform: "none" },
      ],
      { duration: 160, easing: "ease-out", fill: "forwards" },
    )
    .addEventListener("finish", finish);
}

// Keyboard
list.addEventListener("keydown", (e) => {
  const item = e.target.closest(".item");
  if (!item || e.target !== item || !e.altKey) return;

  const before = snapshot();
  if (e.key === "ArrowUp" && item.previousElementSibling) {
    e.preventDefault();
    list.insertBefore(item, item.previousElementSibling);
  } else if (e.key === "ArrowDown" && item.nextElementSibling) {
    e.preventDefault();
    list.insertBefore(item.nextElementSibling, item);
  } else {
    return;
  }
  animateFrom(before);
  item.focus();
  save();
});

// Add, remove and clear
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const lines = input.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return;

  lines.forEach((text) => list.appendChild(createItem(text)));
  input.value = "";
  save();
});

// Ctrl+Enter/Cmd+Enter
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    form.requestSubmit();
  }
});

document.getElementById("clear-btn").addEventListener("click", () => {
  if (list.children.length === 0) return;
  if (confirm("Remove all priorities from the list?")) {
    list.innerHTML = "";
    save();
  }
});

list.addEventListener("click", (e) => {
  if (e.target.classList.contains("remove")) {
    e.target.closest(".item").remove();
    save();
  }
});

// Start
load().forEach((text) => list.appendChild(createItem(text)));
current = readList();
persist(current);
updateHistoryButtons();
