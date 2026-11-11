"use strict";

/* Regression tests for edge cases found during the final code review:
   id safety, character-cap boundaries and surrogate pairs.
   Run with: node --test */

const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../taskflow-core.js");

// True when the string contains a surrogate that lost its partner —
// the broken remnant a naive slice(0, max) can leave behind.
function hasLoneSurrogate(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1; // skip the paired low surrogate
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
const EMOJI = "😀"; // U+1F600 — two UTF-16 code units

/* ---------- Id safety ---------- */

test("sanitizeTask trims padded ids", () => {
  const task = core.sanitizeTask({ id: "  spaced-id  ", title: "Padded" });
  assert.equal(task.id, "spaced-id");
});

test("sanitizeTask replaces ids that are not import-safe", () => {
  const unsafe = [
    "has space",
    "<script>alert(1)</script>",
    'quote"id',
    "  ",
    "",
    "tab\tid",
    "newline\nid",
    "../../etc/passwd"
  ];

  for (const id of unsafe) {
    const task = core.sanitizeTask({ id: id, title: "Safe title" });
    assert.ok(
      core.IMPORT_ID_PATTERN.test(task.id),
      "id " + JSON.stringify(id) + " produced unsafe id " + JSON.stringify(task.id)
    );
    assert.notEqual(task.id, id, "the unsafe id must be replaced");
  }
});

test("sanitizeTask keeps ids this app generates, including long ones", () => {
  const uuid = "3f1d2a4c-8b7e-4f5a-9c2d-1e0f6a7b8c9d";
  const legacy = "task-abc123-xyz98765";

  assert.equal(core.sanitizeTask({ id: uuid, title: "A" }).id, uuid);
  assert.equal(core.sanitizeTask({ id: legacy, title: "A" }).id, legacy);
  assert.equal(core.sanitizeTask({ id: "x", title: "A" }).id, "x");
});

test("sanitizeTask caps absurdly long ids instead of keeping them", () => {
  const long = "a".repeat(5000);
  const task = core.sanitizeTask({ id: long, title: "Long id" });

  assert.equal(task.id.length, core.MAX_ID_LENGTH);
  assert.ok(core.IMPORT_ID_PATTERN.test(task.id), "the capped id stays valid");
  assert.ok(core.MAX_ID_LENGTH <= 128, "ids match the import pattern's limit");
});

test("sanitizeTask still generates an id when none is usable", () => {
  assert.ok(core.IMPORT_ID_PATTERN.test(core.sanitizeTask({ id: "  ", title: "A" }).id));
  assert.ok(core.IMPORT_ID_PATTERN.test(core.sanitizeTask({ title: "A" }).id));
  assert.notEqual(
    core.sanitizeTask({ title: "A" }).id,
    core.sanitizeTask({ title: "B" }).id,
    "generated ids differ"
  );
});

test("parseStoredTasks collapses ids that only differ by padding", () => {
  const loaded = core.parseStoredTasks(
    JSON.stringify([
      { id: " dup-id ", title: "First copy" },
      { id: "dup-id", title: "Second copy" },
      { id: "dup-id", title: "Third copy" }
    ])
  );

  assert.equal(loaded.length, 1, "padding must not smuggle in duplicates");
  assert.equal(loaded[0].id, "dup-id");
  assert.equal(loaded[0].title, "First copy");
});

test("an exported file stays importable even with tampered storage ids", () => {
  // LocalStorage can be edited by hand; the export must still produce a
  // file TaskFlow itself accepts again.
  const payload = core.buildExportDocument([
    { id: "bad id", title: "Tampered one" },
    { id: "<b>x</b>", title: "Tampered two" }
  ]);

  assert.equal(payload.count, 2);
  for (const task of payload.tasks) {
    assert.ok(core.IMPORT_ID_PATTERN.test(task.id), "exported id must be importable");
  }

  const result = core.parseImportedTasks(JSON.stringify(payload));
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.tasks.map((task) => task.id),
    payload.tasks.map((task) => task.id),
    "round-trip keeps the repaired ids"
  );
});

/* ---------- Character caps ---------- */

test("a capped title never ends with whitespace", () => {
  const title = "a".repeat(119) + " " + "bbbbbbbbbb";
  const normalized = core.normalizeTitle(title);

  assert.equal(normalized, "a".repeat(119), "the cut space is trimmed away");
  assert.ok(!/\s$/.test(normalized), "no trailing whitespace");
});

test("a capped description never ends with whitespace", () => {
  const description = "d".repeat(499) + " " + "tail";
  const normalized = core.normalizeDescription(description);

  assert.equal(normalized, "d".repeat(499));
  assert.ok(!/\s$/.test(normalized));
});

test("capping a title never splits an emoji in half", () => {
  // The emoji starts at index 119, so a naive slice(0, 120) would keep
  // only its high surrogate — a lone, broken character.
  const title = "a".repeat(119) + EMOJI + " and some more text";
  const normalized = core.normalizeTitle(title);

  assert.ok(normalized.length <= core.MAX_TITLE_LENGTH, "still capped");
  assert.ok(!hasLoneSurrogate(normalized), "no orphaned surrogate halves");
  assert.equal(normalized, "a".repeat(119), "the partial emoji is dropped");
});

test("a title whose emoji fits keeps it whole", () => {
  const title = "a".repeat(50) + EMOJI + "b".repeat(70); // 122 units
  const normalized = core.normalizeTitle(title);

  assert.equal(normalized.length, core.MAX_TITLE_LENGTH);
  assert.ok(normalized.includes(EMOJI), "the whole emoji survives");
  assert.ok(!hasLoneSurrogate(normalized), "no orphaned surrogate halves");
});

test("capping a description never splits an emoji in half", () => {
  const description = "d".repeat(499) + EMOJI + " tail";
  const normalized = core.normalizeDescription(description);

  assert.ok(normalized.length <= core.MAX_DESCRIPTION_LENGTH, "still capped");
  assert.ok(!hasLoneSurrogate(normalized), "no orphaned surrogate halves");
  assert.equal(normalized, "d".repeat(499));
});

test("a description of exactly the cap keeps complete emoji", () => {
  const normalized = core.normalizeDescription(EMOJI.repeat(300)); // 600 units

  assert.equal(normalized.length, core.MAX_DESCRIPTION_LENGTH);
  assert.ok(!hasLoneSurrogate(normalized), "pairs stay complete");
  assert.equal(normalized, EMOJI.repeat(250));
});

test("surrogate-safe capping still applies to stored and imported tasks", () => {
  const fromStorage = core.parseStoredTasks(
    JSON.stringify([{ title: "a".repeat(119) + EMOJI + " more" }])
  );
  assert.ok(!hasLoneSurrogate(fromStorage[0].title), "storage repair is safe");

  const fromFile = core.parseImportedTasks(
    JSON.stringify([{ id: "id-1", title: "d".repeat(119) + EMOJI + " more" }])
  );
  assert.equal(fromFile.ok, true);
  assert.ok(!hasLoneSurrogate(fromFile.tasks[0].title), "import is safe");
});
