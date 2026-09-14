#!/usr/bin/env node
// diff-notes review server
// Usage: node review-server.mjs [git-base]
//   no arg   -> uncommitted changes (staged + unstaged + untracked) vs HEAD
//   HEAD~3   -> everything since that commit
// Blocks until the browser sends comments, then prints them as markdown and exits.

import http from "node:http";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] || "HEAD";
const cwd = process.cwd();

function sh(cmd) {
  return execSync(cmd, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function collectDiff() {
  let diff = sh(`git diff ${base} --no-color --unified=3`);
  if (base === "HEAD") {
    const untracked = sh("git ls-files --others --exclude-standard").split("\n").filter(Boolean);
    for (const f of untracked) {
      try {
        // exit code 1 is normal for --no-index when files differ
        diff += execSync(`git diff --no-index --no-color -- /dev/null "${f}"`, { cwd, encoding: "utf8" });
      } catch (e) {
        if (e.stdout) diff += e.stdout;
      }
    }
  }
  return diff;
}

function parseDiff(raw) {
  const files = [];
  let file = null, hunk = null, oldN = 0, newN = 0;
  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git")) {
      file = { path: "", hunks: [] };
      files.push(file);
      continue;
    }
    if (!file) continue;
    if (line.startsWith("+++ ")) {
      file.path = line.slice(4).replace(/^b\//, "");
      if (file.path === "/dev/null") file.deleted = true;
      continue;
    }
    if (line.startsWith("--- ")) {
      if (!file.path) file.path = line.slice(4).replace(/^a\//, "");
      continue;
    }
    if (line.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/.exec(line);
      oldN = +m[1]; newN = +m[2];
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("+")) hunk.lines.push({ t: "add", n: newN++, text: line.slice(1) });
    else if (line.startsWith("-")) hunk.lines.push({ t: "del", o: oldN++, text: line.slice(1) });
    else if (line.startsWith(" ") || line === "") hunk.lines.push({ t: "ctx", o: oldN++, n: newN++, text: line.slice(1) });
  }
  return files.filter(f => f.hunks.length);
}

const files = parseDiff(collectDiff());
if (!files.length) {
  console.log("No changes to review.");
  process.exit(0);
}

const page = readFileSync(new URL("./review.html", import.meta.url), "utf8")
  .replace("__DATA__", JSON.stringify({ files, base }).replace(/</g, "\\u003c"));

const outDir = join(cwd, ".claude", "diff-notes");

const server = http.createServer((req, res) => {
  req.url = req.url.replace(/\/+/g, "/");
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(page);
  }
  if (req.method === "POST" && req.url === "/done") {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      const comments = JSON.parse(body || "[]");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "comments.json"), JSON.stringify({ base, at: new Date().toISOString(), comments }, null, 2));
      res.writeHead(200); res.end("ok");
      if (!comments.length) console.log("No comments.");
      else {
        console.log(`${comments.length} comment(s) from the user:\n`);
        for (const c of comments) {
          const code = c.code.trim().slice(0, 80);
          console.log(`- ${c.path}:${c.line} (on \`${code}\`) — ${c.text.replace(/\n+/g, " ")}`);
        }
      }
      server.close(() => process.exit(0));
    });
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(0, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.error(`Review open at ${url}  (click "Send to Claude" when done)`);
  const open = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try { execSync(`${open} ${url}`, { stdio: "ignore" }); } catch {}
});
