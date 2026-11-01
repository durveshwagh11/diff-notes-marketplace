#!/usr/bin/env node
// diff-notes review server
//
// Usage: node review-server.mjs [git-base]
//   no argument -> uncommitted changes (staged, unstaged and untracked) vs HEAD
//   HEAD~3      -> everything since that commit
//
// Serves the diff in the browser and blocks until the user sends their notes (or the tab
// goes away), then prints the notes as a markdown list for Claude and exits.

import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDiff } from "./diff.mjs";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
// The page pings every 10s, but browsers can slow a background tab down to one ping a
// minute, so allow 90s of silence. Before the page first loads, wait up to 10 minutes.
const TAB_CLOSED_AFTER_MS = 90_000;
const NEVER_OPENED_AFTER_MS = 10 * 60_000;

const base = process.argv[2] || "HEAD";
const cwd = process.cwd();
const outputFile = join(cwd, ".claude", "diff-notes", "comments.json");

// ---------- Git ----------

// execFileSync passes arguments straight to git, with no shell, so nothing in them is executed.
function git(args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    });
  } catch (error) {
    // `git diff --no-index` exits with 1 when the files differ; its output is still the diff.
    if (error.status === 1 && error.stdout) return error.stdout;
    throw error;
  }
}

function readDiff() {
  let diff = git(["diff", "--no-color", "--unified=3", base, "--"]);
  if (base === "HEAD") {
    // Untracked files aren't in `git diff`; diff each one against an empty file.
    // Skip this tool's own output folder so old notes don't show up as changes.
    const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"])
      .split("\0")
      .filter((file) => file && !file.startsWith(".claude/diff-notes/"));
    for (const file of untracked) {
      diff += git(["diff", "--no-index", "--no-color", "--", "/dev/null", file]);
    }
  }
  return diff;
}

// ---------- Output for Claude ----------

function exitWith(message) {
  console.log(message);
  process.exit(0);
}

function formatComments(comments) {
  if (comments.length === 0) return "No comments.";
  const items = comments.map((c) => {
    const code = c.code
      .trim()
      .replace(/\s*\n\s*/g, " ⏎ ")
      .slice(0, 120);
    return `- ${c.path}:${c.line} (on \`${code}\`) — ${c.text.replace(/\n+/g, " ")}`;
  });
  return [`${comments.length} comment(s) from the user:`, "", ...items].join("\n");
}

/** Keeps only well-formed comments, or returns null if the body isn't a list. */
function parseComments(body) {
  let value;
  try {
    value = JSON.parse(body || "[]");
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  return value
    .filter((c) => c && typeof c.path === "string" && typeof c.text === "string")
    .map((c) => ({
      path: c.path,
      line: String(c.line ?? ""),
      code: String(c.code ?? ""),
      text: c.text,
    }));
}

function saveComments(comments) {
  mkdirSync(join(outputFile, ".."), { recursive: true });
  const record = { base, at: new Date().toISOString(), comments };
  writeFileSync(outputFile, JSON.stringify(record, null, 2));
}

// ---------- HTTP server ----------

function readAsset(name) {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

function renderPage(files) {
  // Escaping "<" stops a file containing "</script>" from ending the data block early.
  const data = JSON.stringify({ files, base }).replace(/</g, "\\u003c");
  return readAsset("review.html").replace("__DIFF_DATA__", () => data);
}

function send(res, status, body = "", type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

function startServer(files) {
  const routes = {
    "GET /": { body: renderPage(files), type: "text/html; charset=utf-8" },
    "GET /review.js": {
      body: readAsset("review.js"),
      type: "text/javascript; charset=utf-8",
    },
    "GET /review.css": {
      body: readAsset("review.css"),
      type: "text/css; charset=utf-8",
    },
  };
  let opened = false;
  let lastSeen = Date.now();

  const server = http.createServer((req, res) => {
    const route = `${req.method} ${req.url.replace(/\/+/g, "/")}`;

    if (routes[route]) {
      if (route === "GET /") opened = true;
      lastSeen = Date.now();
      return send(res, 200, routes[route].body, routes[route].type);
    }
    if (route === "POST /ping") {
      lastSeen = Date.now();
      return send(res, 204);
    }
    if (route === "POST /done") return receiveComments(req, res);
    send(res, 404, "not found");
  });

  // Give up when the tab stops pinging, or was never opened.
  setInterval(() => {
    const silentFor = Date.now() - lastSeen;
    if (opened && silentFor > TAB_CLOSED_AFTER_MS) {
      exitWith("Review tab was closed without sending. No comments.");
    }
    if (!opened && silentFor > NEVER_OPENED_AFTER_MS) {
      exitWith("Review page was never opened. No comments.");
    }
  }, 5_000).unref();

  server.listen(0, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.error(`Review open at ${url}  (click "Send to Claude" when done)`);
    openBrowser(url);
  });
}

function receiveComments(req, res) {
  // Requiring JSON blocks other websites: a cross-site JSON request needs a CORS
  // preflight, which this server never approves.
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
    return send(res, 415, "expected application/json");
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      send(res, 413, "too large");
      req.destroy();
    }
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    const comments = parseComments(body);
    if (!comments) return send(res, 400, "expected a JSON array of comments");
    saveComments(comments);
    res.writeHead(200);
    res.end("ok", () => exitWith(formatComments(comments)));
  });
}

function openBrowser(url) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    execFileSync(command, args, { stdio: "ignore" });
  } catch {
    // No browser available: the user can still open the printed URL.
  }
}

// ---------- Main ----------

// A base starting with "-" would be read by git as an option (e.g. --output=FILE).
if (base.startsWith("-")) {
  console.log(`Invalid git base "${base}".`);
  process.exit(1);
}

let files;
try {
  files = parseDiff(readDiff());
} catch (error) {
  console.log(`Could not read the git diff: ${(error.stderr || error.message).trim()}`);
  process.exit(1);
}

if (files.length === 0) exitWith("No changes to review.");
startServer(files);
