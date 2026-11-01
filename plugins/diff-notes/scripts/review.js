// Browser side of diff-notes: renders the diff, lets the user attach notes to lines,
// and posts the notes back to the review server.

const PING_INTERVAL_MS = 10_000;

/** @type {{ files: import("./diff.mjs").DiffFile[], base: string }} */
const diff = JSON.parse(document.getElementById("diff-data").textContent);

/** Saved notes, keyed by file + side + line span. @type {Map<string, Comment>} */
const notes = new Map();

/** Row where the current selection started, and the selected rows. */
let anchorRow = null;
let selectedRows = [];

const $ = (id) => document.getElementById(id);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const escapeHtml = (text) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------- Rendering ----------

function renderFiles() {
  $("meta").textContent = `${plural(diff.files.length, "file")} changed · vs ${diff.base}`;
  for (const file of diff.files) $("files").appendChild(renderFile(file));
}

function renderFile(file) {
  const lines = file.hunks.flatMap((hunk) => hunk.lines);
  const added = lines.filter((line) => line.type === "add").length;
  const removed = lines.filter((line) => line.type === "del").length;

  const box = document.createElement("div");
  box.className = "file";
  box.innerHTML = `
    <div class="path">
      <span>${escapeHtml(file.path)}</span>
      <span class="count">+${added} −${removed}</span>
    </div>`;

  const table = document.createElement("table");
  for (const hunk of file.hunks) {
    table.insertAdjacentHTML(
      "beforeend",
      `<tr class="hunk"><td colspan="3">${escapeHtml(hunk.header)}</td></tr>`,
    );
    for (const line of hunk.lines) table.appendChild(renderLine(file, line));
  }
  box.appendChild(table);
  return box;
}

function renderLine(file, line) {
  const row = document.createElement("tr");
  row.className = `line ${line.type}`;
  // Notes point at the new version of the file; a deleted line only has an old number.
  row.dataset.path = file.path;
  row.dataset.line = line.newLine ?? line.oldLine;
  row.dataset.side = line.type === "del" ? "old" : "new";
  row.innerHTML = `
    <td class="n">${line.oldLine ?? ""}</td>
    <td class="n">${line.newLine ?? ""}</td>
    <td class="code">${escapeHtml(line.text)}</td>`;

  row.addEventListener("click", (event) => {
    if (event.shiftKey) return select(rangeTo(row));
    anchorRow = row;
    select([row]);
    openNoteEditor([row]);
  });
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (!selectedRows.includes(row)) {
      anchorRow = row;
      select([row]);
    }
    openMenu(event.clientX, event.clientY, selectedRows);
  });
  return row;
}

// ---------- Selection ----------

function select(rows) {
  for (const row of selectedRows) row.classList.remove("sel");
  selectedRows = rows;
  for (const row of rows) row.classList.add("sel");
}

/** Rows from the anchor to `row`, but only within the same file. */
function rangeTo(row) {
  const table = row.closest("table");
  if (!anchorRow || anchorRow.closest("table") !== table) return [row];
  const rows = [...table.querySelectorAll("tr.line")];
  const from = rows.indexOf(anchorRow);
  const to = rows.indexOf(row);
  return rows.slice(Math.min(from, to), Math.max(from, to) + 1);
}

const codeOf = (rows) => rows.map((row) => row.querySelector("td.code").textContent).join("\n");

/** "42", "42 (deleted line)" or "40-45". */
function lineSpanOf(rows) {
  const first = rows[0];
  if (rows.length > 1) return `${first.dataset.line}-${rows.at(-1).dataset.line}`;
  return first.dataset.side === "old" ? `${first.dataset.line} (deleted line)` : first.dataset.line;
}

const noteKeyOf = (rows) => `${rows[0].dataset.path}:${rows[0].dataset.side}:${lineSpanOf(rows)}`;

// ---------- Right-click menu ----------

function closeMenu() {
  $("menu")?.remove();
}

function openMenu(x, y, rows) {
  closeMenu();
  const verb = notes.has(noteKeyOf(rows)) ? "Edit" : "Add";
  const span = rows.length > 1 ? ` (${rows.length} lines)` : "";

  const menu = document.createElement("div");
  menu.id = "menu";
  menu.innerHTML = `
    <button data-action="note">${verb} note${span}</button>
    <button data-action="ref">Copy ref</button>
    <button data-action="lines">Copy lines</button>`;
  document.body.appendChild(menu);
  // Keep the menu inside the window.
  menu.style.left = `${Math.min(x, innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - menu.offsetHeight - 8)}px`;

  menu.onclick = (event) => {
    const action = event.target.closest("button")?.dataset.action;
    closeMenu();
    if (action === "note") openNoteEditor(rows);
    if (action === "ref")
      navigator.clipboard.writeText(`${rows[0].dataset.path}:${lineSpanOf(rows)}`);
    if (action === "lines") navigator.clipboard.writeText(codeOf(rows));
  };
}

addEventListener("click", (event) => {
  if (!event.target.closest("#menu")) closeMenu();
});
addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});

// ---------- Note editor ----------

function openNoteEditor(rows) {
  const lastRow = rows.at(-1);
  if (lastRow.nextElementSibling?.classList.contains("note")) return; // already open

  const key = noteKeyOf(rows);
  const existing = notes.get(key);
  const editor = document.createElement("tr");
  editor.className = "note";
  editor.innerHTML = `
    <td colspan="3">
      <textarea placeholder="What should change here, or what's unclear?">${
        existing ? escapeHtml(existing.text) : ""
      }</textarea>
      <div class="row">
        <button class="save">Save note</button>
        <button class="cancel">Cancel</button>
        ${existing ? '<button class="remove">Remove</button>' : ""}
      </div>
    </td>`;
  lastRow.after(editor);

  const textarea = editor.querySelector("textarea");
  textarea.focus();

  const close = () => editor.remove();
  const markRows = (hasNote) => rows.forEach((row) => row.classList.toggle("has-note", hasNote));

  const save = () => {
    const text = textarea.value.trim();
    if (text) {
      notes.set(key, {
        path: rows[0].dataset.path,
        line: lineSpanOf(rows),
        code: codeOf(rows),
        text,
      });
      markRows(true);
      updateTally();
    }
    close();
  };
  const remove = () => {
    notes.delete(key);
    markRows(false);
    updateTally();
    close();
  };

  editor.querySelector(".save").onclick = save;
  editor.querySelector(".cancel").onclick = close;
  editor.querySelector(".remove")?.addEventListener("click", remove);
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) save();
    if (event.key === "Escape") close();
  });
}

function updateTally() {
  $("tally").textContent = plural(notes.size, "comment");
}

// ---------- Talking to the server ----------

// Tells the server the tab is still open; if the pings stop, it stops waiting.
const heartbeat = setInterval(
  () => fetch("/ping", { method: "POST" }).catch(() => {}),
  PING_INTERVAL_MS,
);

async function sendNotes() {
  const button = $("send");
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    const response = await fetch("/done", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([...notes.values()]),
    });
    if (!response.ok) throw new Error(await response.text());
  } catch (error) {
    button.disabled = false;
    button.textContent = "Send to Claude";
    alert(`Could not send: ${error.message}. Is the Claude Code session still waiting?`);
    return;
  }
  clearInterval(heartbeat);
  document.body.innerHTML = `
    <main>
      <h1>Sent</h1>
      <p class="hint">${plural(notes.size, "comment")} handed to Claude. You can close this tab.</p>
    </main>`;
}

$("send").onclick = sendNotes;
renderFiles();

/** @typedef {{ path: string, line: string, code: string, text: string }} Comment */
