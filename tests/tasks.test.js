"use strict";

/* Task creation, validation, editing, deletion and completion.
   Run with: node --test tests/ */

const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../taskflow-core.js");

const TASK_KEYS = ["completed", "description", "dueDate", "id", "priority", "title"];

function makeTask(overrides) {
  return core.createTask(Object.assign({ title: "Sample task" }, overrides));
}

/* ---------- Creation & validation ---------- */

test("createTask produces a task with only the stored fields", () => {
  const task = makeTask({ description: "Details", priority: "high", dueDate: "2026-11-30" });
  assert.deepEqual(Object.keys(task).sort(), TASK_KEYS);
  assert.equal(task.title, "Sample task");
  assert.equal(task.description, "Details");
  assert.equal(task.priority, "high");
  assert.equal(task.dueDate, "2026-11-30");
  assert.equal(task.completed, false);
  assert.equal(typeof task.id, "string");
  assert.ok(task.id.length > 0, "id must not be empty");
});

test("createTask trims the title", () => {
  assert.equal(makeTask({ title: "   Padded title   " }).title, "Padded title");
});

test("createTask rejects missing or blank titles", () => {
  assert.equal(core.createTask({ title: "" }), null);
  assert.equal(core.createTask({ title: "     " }), null);
  assert.equal(core.createTask({ title: 42 }), null);
  assert.equal(core.createTask(null), null);
});

test("createTask applies safe defaults for bad field values", () => {
  const task = makeTask({ priority: "urgent", dueDate: "not-a-date", description: 7 });
  assert.equal(task.priority, "medium");
  assert.equal(task.dueDate, "");
  assert.equal(task.description, "");
});

test("createTask accepts every supported priority", () => {
  assert.equal(makeTask({ priority: "low" }).priority, "low");
  assert.equal(makeTask({ priority: "medium" }).priority, "medium");
  assert.equal(makeTask({ priority: "high" }).priority, "high");
});

test("createTask caps title at 120 and description at 500 characters", () => {
  const task = makeTask({
    title: "T".repeat(500),
    description: "D".repeat(1200)
  });
  assert.equal(task.title.length, core.MAX_TITLE_LENGTH);
  assert.equal(task.description.length, core.MAX_DESCRIPTION_LENGTH);
});

test("createTask generates unique ids", () => {
  const ids = new Set();
  for (let i = 0; i < 100; i += 1) ids.add(makeTask({ title: "Task " + i }).id);
  assert.equal(ids.size, 100);
});

test("createTask starts active unless completed is explicitly true", () => {
  assert.equal(makeTask().completed, false);
  assert.equal(makeTask({ completed: true }).completed, true);
  assert.equal(makeTask({ completed: "yes" }).completed, false);
});

test("normalizeTitle mirrors the app's title rules", () => {
  assert.equal(core.normalizeTitle("  hello  "), "hello");
  assert.equal(core.normalizeTitle("   "), null);
  assert.equal(core.normalizeTitle(""), null);
  assert.equal(core.normalizeTitle(undefined), null);
  assert.equal(core.normalizeTitle("x".repeat(300)).length, 120);
});

/* ---------- Editing ---------- */

test("updateTask applies new values without touching id, order or completion", () => {
  const first = makeTask({ title: "First" });
  const second = makeTask({ title: "Second", completed: true });
  const third = makeTask({ title: "Third" });
  const tasks = [first, second, third];

  const updated = core.updateTask(tasks, second.id, {
    title: "  Second, revised  ",
    description: "New details",
    priority: "low",
    dueDate: "2026-12-24"
  });

  assert.equal(updated, second, "returns the same task object");
  assert.equal(tasks.length, 3, "no duplicate task created");
  assert.deepEqual(
    tasks.map((task) => task.id),
    [first.id, second.id, third.id],
    "order unchanged"
  );
  assert.equal(second.title, "Second, revised");
  assert.equal(second.description, "New details");
  assert.equal(second.priority, "low");
  assert.equal(second.dueDate, "2026-12-24");
  assert.equal(second.completed, true, "completion state preserved");
  assert.equal(first.title, "First", "other tasks untouched");
  assert.equal(third.title, "Third", "other tasks untouched");
});

test("updateTask returns null for an unknown id and changes nothing", () => {
  const tasks = [makeTask({ title: "Only" })];
  const snapshot = JSON.stringify(tasks);

  assert.equal(core.updateTask(tasks, "missing-id", { title: "Hacked" }), null);
  assert.equal(JSON.stringify(tasks), snapshot);
});

test("updateTask rejects a blank title and leaves the task untouched", () => {
  const task = makeTask({ title: "Keep me" });
  const tasks = [task];

  assert.equal(core.updateTask(tasks, task.id, { title: "   " }), null);
  assert.equal(task.title, "Keep me");
});

test("updateTask re-validates priority and due date", () => {
  const task = makeTask({ title: "Validate" });
  core.updateTask([task], task.id, {
    title: "Validate",
    priority: "someday",
    dueDate: "2026-02-30"
  });
  assert.equal(task.priority, "medium");
  assert.equal(task.dueDate, "");
});

/* ---------- Deletion ---------- */

test("deleteTask removes only the targeted task", () => {
  const first = makeTask({ title: "One" });
  const second = makeTask({ title: "Two" });
  const tasks = [first, second];

  const remaining = core.deleteTask(tasks, first.id);

  assert.deepEqual(
    remaining.map((task) => task.id),
    [second.id]
  );
  assert.equal(tasks.length, 2, "input array is not mutated");
});

test("deleteTask with an unknown id keeps every task", () => {
  const tasks = [makeTask({ title: "Stay" }), makeTask({ title: "Stay too" })];
  assert.equal(core.deleteTask(tasks, "nope").length, 2);
});

/* ---------- Completion ---------- */

test("setTaskCompletion marks a task complete and back to active", () => {
  const task = makeTask({ title: "Toggle me" });
  const tasks = [task];

  const done = core.setTaskCompletion(tasks, task.id, true);
  assert.equal(done, task);
  assert.equal(task.completed, true);

  const reopened = core.setTaskCompletion(tasks, task.id, false);
  assert.equal(reopened.completed, false);
  assert.equal(tasks.length, 1, "toggling never duplicates the task");
});

test("setTaskCompletion returns null for an unknown id", () => {
  const tasks = [makeTask()];
  assert.equal(core.setTaskCompletion(tasks, "missing", true), null);
  assert.equal(tasks[0].completed, false);
});

test("setTaskCompletion only affects the targeted task", () => {
  const first = makeTask({ title: "A" });
  const second = makeTask({ title: "B" });
  core.setTaskCompletion([first, second], first.id, true);
  assert.equal(first.completed, true);
  assert.equal(second.completed, false);
});

test("setTaskCompletion coerces non-boolean values to false", () => {
  const task = makeTask();
  core.setTaskCompletion([task], task.id, "truthy");
  assert.equal(task.completed, false);
});

/* ---------- Stored-data sanitisation ---------- */

test("sanitizeTask drops entries that are not usable objects", () => {
  assert.equal(core.sanitizeTask(null), null);
  assert.equal(core.sanitizeTask("a string"), null);
  assert.equal(core.sanitizeTask(42), null);
  assert.equal(core.sanitizeTask({}), null, "missing title");
  assert.equal(core.sanitizeTask({ title: "   " }), null, "blank title");
});

test("sanitizeTask normalises fields and drops unknown extras", () => {
  const task = core.sanitizeTask({
    id: "fixed-id",
    title: "  Stored task  ",
    description: "Stored notes",
    priority: "high",
    dueDate: "2026-11-09",
    completed: true,
    createdAt: 123456,
    notes: "should not survive"
  });

  assert.deepEqual(Object.keys(task).sort(), TASK_KEYS);
  assert.equal(task.id, "fixed-id");
  assert.equal(task.title, "Stored task");
  assert.equal(task.completed, true);
});

test("sanitizeTask generates an id when one is missing", () => {
  const a = core.sanitizeTask({ title: "No id a" });
  const b = core.sanitizeTask({ title: "No id b" });
  assert.ok(a.id.length > 0);
  assert.ok(b.id.length > 0);
  assert.notEqual(a.id, b.id, "generated ids must differ");
});
