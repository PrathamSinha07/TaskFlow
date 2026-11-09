"use strict";

/* LocalStorage persistence: round-trips and corrupted/invalid data.
   Run with: node --test tests/ */

const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../taskflow-core.js");

const TASK_KEYS = ["completed", "description", "dueDate", "id", "priority", "title"];

function sampleTasks() {
  return [
    core.createTask({
      title: "Ship weekly report",
      description: "Include charts",
      priority: "high",
      dueDate: "2026-11-10"
    }),
    core.createTask({ title: "Buy groceries", priority: "low" }),
    core.createTask({ title: "Renew passport", completed: true })
  ];
}

/* ---------- Round-trip ---------- */

test("tasks survive a save → load round-trip unchanged", () => {
  const original = sampleTasks();
  const raw = JSON.stringify(original);

  const loaded = core.parseStoredTasks(raw);

  assert.deepEqual(loaded, original, "ids, order and fields must match");
});

test("an empty stored list loads as an empty list", () => {
  assert.deepEqual(core.parseStoredTasks("[]"), []);
});

/* ---------- Missing or corrupt data ---------- */

test("missing or non-string storage yields an empty list", () => {
  assert.deepEqual(core.parseStoredTasks(null), []);
  assert.deepEqual(core.parseStoredTasks(undefined), []);
  assert.deepEqual(core.parseStoredTasks(""), []);
  assert.deepEqual(core.parseStoredTasks(42), []);
});

test("corrupted JSON yields an empty list instead of throwing", () => {
  assert.deepEqual(core.parseStoredTasks("{definitely not json"), []);
  assert.deepEqual(core.parseStoredTasks("[{'broken':"), []);
  assert.deepEqual(core.parseStoredTasks("undefined"), []);
});

test("valid JSON that is not an array yields an empty list", () => {
  assert.deepEqual(core.parseStoredTasks('{"title":"single task"}'), []);
  assert.deepEqual(core.parseStoredTasks('"just a string"'), []);
  assert.deepEqual(core.parseStoredTasks("123"), []);
});

test("junk entries inside a stored array are dropped, valid ones kept", () => {
  const raw = JSON.stringify([
    "just-a-string",
    42,
    null,
    { title: "   " },
    { priority: "high" },
    { title: "Real task", priority: "medium" }
  ]);

  const loaded = core.parseStoredTasks(raw);

  assert.equal(loaded.length, 1, "only the usable entry survives");
  assert.equal(loaded[0].title, "Real task");
});

test("duplicate ids are collapsed to the first occurrence", () => {
  const raw = JSON.stringify([
    { id: "same-id", title: "First copy" },
    { id: "same-id", title: "Second copy" },
    { id: "other-id", title: "Different task" }
  ]);

  const loaded = core.parseStoredTasks(raw);

  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].title, "First copy");
});

test("entries without ids get unique generated ones", () => {
  const loaded = core.parseStoredTasks(
    JSON.stringify([{ title: "A" }, { title: "B" }])
  );

  assert.equal(loaded.length, 2);
  assert.ok(loaded[0].id && loaded[1].id);
  assert.notEqual(loaded[0].id, loaded[1].id);
});

/* ---------- Field-level repair ---------- */

test("impossible due dates are cleared, valid ones kept", () => {
  const loaded = core.parseStoredTasks(
    JSON.stringify([
      { title: "Feb 30", dueDate: "2026-02-30" },
      { title: "Month 13", dueDate: "2026-13-01" },
      { title: "US format", dueDate: "11/09/2026" },
      { title: "No zeros", dueDate: "2026-1-5" },
      { title: "Number", dueDate: 20261109 },
      { title: "Leap day", dueDate: "2028-02-29" },
      { title: "Non-leap", dueDate: "2027-02-29" },
      { title: "Fine", dueDate: "2026-11-09" }
    ])
  );

  const byTitle = Object.fromEntries(loaded.map((task) => [task.title, task.dueDate]));

  assert.equal(byTitle["Feb 30"], "");
  assert.equal(byTitle["Month 13"], "");
  assert.equal(byTitle["US format"], "");
  assert.equal(byTitle["No zeros"], "");
  assert.equal(byTitle["Number"], "");
  assert.equal(byTitle["Leap day"], "2028-02-29", "real leap day is valid");
  assert.equal(byTitle["Non-leap"], "", "2027 is not a leap year");
  assert.equal(byTitle["Fine"], "2026-11-09");
});

test("unknown priorities and non-boolean completion are repaired", () => {
  const loaded = core.parseStoredTasks(
    JSON.stringify([
      { title: "Odd priority", priority: "asap" },
      { title: "No priority" },
      { title: "Odd completed", completed: "true" },
      { title: "Real completed", completed: true }
    ])
  );

  const byTitle = Object.fromEntries(loaded.map((task) => [task.title, task]));

  assert.equal(byTitle["Odd priority"].priority, "medium");
  assert.equal(byTitle["No priority"].priority, "medium");
  assert.equal(byTitle["Odd completed"].completed, false);
  assert.equal(byTitle["Real completed"].completed, true);
});

test("over-long titles and descriptions are trimmed to the caps", () => {
  const loaded = core.parseStoredTasks(
    JSON.stringify([
      { title: "  " + "T".repeat(400) + "  ", description: "D".repeat(900) }
    ])
  );

  assert.equal(loaded[0].title.length, core.MAX_TITLE_LENGTH);
  assert.equal(loaded[0].description.length, core.MAX_DESCRIPTION_LENGTH);
});

test("stored tasks never contain fields the app does not use", () => {
  const loaded = core.parseStoredTasks(
    JSON.stringify([
      {
        id: "x",
        title: "Bloat",
        createdAt: 1700000000000,
        tags: ["home"],
        order: 3
      }
    ])
  );

  assert.deepEqual(Object.keys(loaded[0]).sort(), TASK_KEYS);
});
