// Run: node --test plugins/diff-notes/scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, headerPath } from "./diff.mjs";

test("decodes the ways git writes file paths", () => {
  assert.equal(headerPath("b/src/app.ts", "b/"), "src/app.ts");
  assert.equal(headerPath("b/sp ace.txt\t", "b/"), "sp ace.txt");
  assert.equal(headerPath('"b/we\\"ird; touch PWNED.txt"\t', "b/"), 'we"ird; touch PWNED.txt');
  assert.equal(headerPath('"b/\\303\\251.txt"', "b/"), "é.txt");
  assert.equal(headerPath('"a/tab\\there 😀.txt"', "a/"), "tab\there 😀.txt");
});

test("tracks old and new line numbers through a hunk", () => {
  const [file] = parseDiff(`diff --git a/sum.js b/sum.js
index 1111111..2222222 100644
--- a/sum.js
+++ b/sum.js
@@ -10,3 +10,3 @@ function sum(a, b) {
 const x = 1;
-return a + b;
+return a + b + x;
 }
`);
  assert.equal(file.path, "sum.js");
  assert.deepEqual(file.hunks[0].lines, [
    { type: "ctx", oldLine: 10, newLine: 10, text: "const x = 1;" },
    { type: "del", oldLine: 11, text: "return a + b;" },
    { type: "add", newLine: 11, text: "return a + b + x;" },
    { type: "ctx", oldLine: 12, newLine: 12, text: "}" },
  ]);
});

test("keeps the real name of a deleted file", () => {
  const [file] = parseDiff(`diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
`);
  assert.equal(file.path, "old.txt");
  assert.equal(file.deleted, true);
});

test("reads a new file and several files in one diff", () => {
  const files = parseDiff(`diff --git a/a.txt b/a.txt
new file mode 100644
--- /dev/null
+++ b/a.txt
@@ -0,0 +1,2 @@
+one
+two
diff --git a/b.txt b/b.txt
--- a/b.txt
+++ b/b.txt
@@ -5 +5 @@
-x
+y
`);
  assert.deepEqual(
    files.map((f) => f.path),
    ["a.txt", "b.txt"],
  );
  assert.deepEqual(
    files[0].hunks[0].lines.map((l) => l.newLine),
    [1, 2],
  );
  assert.equal(files[1].hunks[0].lines[1].newLine, 5);
});

test("a deleted line that looks like a file header stays a deleted line", () => {
  const [file] = parseDiff(`diff --git a/notes.md b/notes.md
--- a/notes.md
+++ b/notes.md
@@ -1,2 +1 @@
--- a list item
 keep
`);
  assert.equal(file.path, "notes.md");
  assert.deepEqual(file.hunks[0].lines[0], {
    type: "del",
    oldLine: 1,
    text: "-- a list item",
  });
});

test("ignores the trailing newline, binary files and the no-newline marker", () => {
  const files = parseDiff(`diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
diff --git a/t.txt b/t.txt
--- a/t.txt
+++ b/t.txt
@@ -1 +1 @@
-a
\\ No newline at end of file
+b
`);
  assert.deepEqual(
    files.map((f) => f.path),
    ["t.txt"],
  );
  assert.equal(files[0].hunks[0].lines.length, 2);
});
