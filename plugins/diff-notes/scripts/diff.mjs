// Parses unified `git diff` output into files -> hunks -> lines with old/new line numbers.

/**
 * @typedef {{ type: "add" | "del" | "ctx", oldLine?: number, newLine?: number, text: string }} DiffLine
 * @typedef {{ header: string, lines: DiffLine[] }} Hunk
 * @typedef {{ path: string, deleted?: boolean, hunks: Hunk[] }} DiffFile
 */

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** @returns {DiffFile[]} files that have at least one hunk (binary files have none). */
export function parseDiff(raw) {
  const files = [];
  let file = null;
  let hunk = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git")) {
      file = { path: "", hunks: [] };
      hunk = null;
      files.push(file);
      continue;
    }
    if (!file) continue;

    // "---"/"+++" are file headers only before the first hunk; inside a hunk,
    // "--- x" is a deleted line whose text happens to start with "--".
    if (!hunk && line.startsWith("--- ")) {
      file.path = headerPath(line.slice(4), "a/");
      continue;
    }
    if (!hunk && line.startsWith("+++ ")) {
      // A deleted file has "+++ /dev/null": keep the name from the "---" line.
      if (line === "+++ /dev/null") file.deleted = true;
      else file.path = headerPath(line.slice(4), "b/");
      continue;
    }

    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    const text = line.slice(1);
    if (line.startsWith("+")) {
      hunk.lines.push({ type: "add", newLine: newLine++, text });
    } else if (line.startsWith("-")) {
      hunk.lines.push({ type: "del", oldLine: oldLine++, text });
    } else if (line.startsWith(" ")) {
      hunk.lines.push({
        type: "ctx",
        oldLine: oldLine++,
        newLine: newLine++,
        text,
      });
    }
    // Anything else ("\ No newline at end of file", the final empty line) is skipped.
  }

  return files.filter((f) => f.hunks.length > 0);
}

/**
 * Reads a path from a "---"/"+++" header and strips its "a/" or "b/" prefix.
 * Git adds a trailing tab when the path has spaces, and wraps unusual paths in C-style
 * quotes: "b/we\"ird.txt", or octal UTF-8 bytes for non-ASCII ("b/\303\251.txt").
 */
export function headerPath(raw, prefix) {
  let path = raw.replace(/\t$/, "");
  if (path.startsWith('"') && path.endsWith('"')) path = unquoteCString(path.slice(1, -1));
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

const C_ESCAPES = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92,
};

function unquoteCString(quoted) {
  // Collect raw bytes first: one character can be split across several \ooo escapes.
  const bytes = [];
  for (let i = 0; i < quoted.length; i++) {
    const octal = quoted.slice(i + 1, i + 4);
    if (quoted[i] !== "\\") {
      const codePoint = quoted.codePointAt(i);
      bytes.push(...Buffer.from(String.fromCodePoint(codePoint)));
      if (codePoint > 0xffff) i++; // emoji and other astral characters use two UTF-16 units
    } else if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      i += 3;
    } else {
      const escaped = quoted[++i];
      bytes.push(C_ESCAPES[escaped] ?? escaped.charCodeAt(0));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}
