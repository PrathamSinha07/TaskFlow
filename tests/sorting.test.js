"use strict";

/* Task sorting and organisation.
   Run with: node --test */

const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../taskflow-core.js");

/* Creation order below equals "newest first": index 0 is the newest task. */
function fixtureTasks() {
  return [
    core.createTask({ title: "Ship weekly report", priority: "high", dueDate: "2026-11-10" }),
    core.createTask({ title: "buy groceries", priority: "low" }),
    core.createTask({ title: "Renew passport", priority: "medium", dueDate: "2026-11-01" }),
    core.createTask({
      title: "Plan offsite",
      priority: "high",
      dueDate: "2026-11-30",
      completed: true
    }),
    core.createTask({ title: "apple pie", priority: "medium", dueDate: "2026-11-10" })
  ];
}

const titlesOf = (tasks) => tasks.map((task) => task.title);

/* ---------- Creation order ---------- */

test("sortTasks keeps creation order (newest first) by default", () => {
  const tasks = fixtureTasks();
  assert.deepEqual(titlesOf(core.sortTasks(tasks, "newest")), titlesOf(tasks));
});

test("sortTasks treats an unknown key as the default order", () => {
  const tasks = fixtureTasks();
  assert.deepEqual(titlesOf(core.sortTasks(tasks, "banana")), titlesOf(tasks));
});

test("sortTasks 'oldest' reverses creation order", () => {
  const tasks = fixtureTasks();
  assert.deepEqual(
    titlesOf(core.sortTasks(tasks, "oldest")),
    titlesOf(tasks).slice().reverse()
  );
});

test("every exported sort key produces a full, ordered copy", () => {
  const tasks = fixtureTasks();
  for (const key of core.SORT_KEYS) {
    const sorted = core.sortTasks(tasks, key);
    assert.equal(sorted.length, tasks.length, key + " keeps all tasks");
    assert.deepEqual(
      sorted.map((task) => task.id).sort(),
      tasks.map((task) => task.id).sort(),
      key + " keeps the same tasks"
    );
  }
});

/* ---------- Alphabetical ---------- */

test("sortTasks 'title' orders A → Z ignoring case", () => {
  const sorted = core.sortTasks(fixtureTasks(), "title");
  assert.deepEqual(titlesOf(sorted), [
    "apple pie",
    "buy groceries",
    "Plan offsite",
    "Renew passport",
    "Ship weekly report"
  ]);
});

test("sortTasks 'title' keeps tied titles in creation order", () => {
  const tasks = [
    core.createTask({ title: "Zeta" }),
    core.createTask({ title: "tie" }),
    core.createTask({ title: "Tie" }),
    core.createTask({ title: "tie" })
  ];
  assert.deepEqual(titlesOf(core.sortTasks(tasks, "title")), [
    "tie",
    "Tie",
    "tie",
    "Zeta"
  ]);
});

/* ---------- Due date ---------- */

test("sortTasks 'due' puts the soonest date first and undated tasks last", () => {
  const sorted = core.sortTasks(fixtureTasks(), "due");
  assert.deepEqual(titlesOf(sorted), [
    "Renew passport", // 2026-11-01
    "Ship weekly report", // 2026-11-10
    "apple pie", // 2026-11-10 (tie → creation order)
    "Plan offsite", // 2026-11-30
    "buy groceries" // no due date
  ]);
});

test("sortTasks 'due' keeps creation order when every task is undated", () => {
  const tasks = [
    core.createTask({ title: "First" }),
    core.createTask({ title: "Second" }),
    core.createTask({ title: "Third" })
  ];
  assert.deepEqual(titlesOf(core.sortTasks(tasks, "due")), ["First", "Second", "Third"]);
});

test("sortTasks 'due' puts all undated tasks last, in creation order", () => {
  const tasks = [
    core.createTask({ title: "Newest dated", dueDate: "2026-12-01" }),
    core.createTask({ title: "Newest undated" }),
    core.createTask({ title: "Oldest dated", dueDate: "2026-01-01" }),
    core.createTask({ title: "Oldest undated" })
  ];
  assert.deepEqual(titlesOf(core.sortTasks(tasks, "due")), [
    "Oldest dated",
    "Newest dated",
    "Newest undated",
    "Oldest undated"
  ]);
});

/* ---------- Priority ---------- */

test("sortTasks 'priority' orders High → Medium → Low", () => {
  const sorted = core.sortTasks(fixtureTasks(), "priority");
  assert.deepEqual(titlesOf(sorted), [
    "Ship weekly report", // high
    "Plan offsite", // high
    "Renew passport", // medium
    "apple pie", // medium
    "buy groceries" // low
  ]);
});

test("sortTasks 'priority' sinks an unexpected priority value to the end", () => {
  const tasks = [
    { id: "a", title: "Odd", priority: "someday", dueDate: "", completed: false },
    core.createTask({ title: "Normal low", priority: "low" })
  ];
  assert.deepEqual(titlesOf(core.sortTasks(tasks, "priority")), ["Normal low", "Odd"]);
});

/* ---------- Safety: no mutation ---------- */

test("sortTasks never mutates the stored array", () => {
  const tasks = fixtureTasks();
  const before = titlesOf(tasks);

  core.sortTasks(tasks, "title");
  core.sortTasks(tasks, "due");
  core.sortTasks(tasks, "oldest");

  assert.deepEqual(titlesOf(tasks), before, "creation order survives every sort");
  assert.notEqual(core.sortTasks(tasks, "title"), tasks, "returns a copy, not the same array");
});

test("sorting changes neither task data nor statistics", () => {
  const tasks = fixtureTasks();
  const snapshot = JSON.stringify(tasks);
  const statsBefore = core.countTasks(tasks);

  core.sortTasks(tasks, "priority");

  assert.equal(JSON.stringify(tasks), snapshot, "task objects untouched");
  assert.deepEqual(core.countTasks(tasks), statsBefore, "statistics untouched");
});

/* ---------- Sorting + filtering + searching ---------- */

test("sorting composes with the active filter", () => {
  const active = core.filterTasks(fixtureTasks(), "active", "");
  const sorted = core.sortTasks(active, "due");

  assert.deepEqual(titlesOf(sorted), [
    "Renew passport",
    "Ship weekly report",
    "apple pie",
    "buy groceries"
  ]);
  assert.ok(sorted.every((task) => !task.completed), "filtering still applies");
});

test("sorting composes with a search query", () => {
  const matching = core.filterTasks(fixtureTasks(), "all", "r");
  const sorted = core.sortTasks(matching, "title");

  assert.deepEqual(titlesOf(sorted), [
    "buy groceries",
    "Renew passport",
    "Ship weekly report"
  ]);
});

test("sorting composes with filter + search + order together", () => {
  const view = core.sortTasks(
    core.filterTasks(fixtureTasks(), "active", "e"),
    "priority"
  );

  // Active tasks containing "e": report, groceries, passport, apple.
  assert.deepEqual(titlesOf(view), [
    "Ship weekly report", // high
    "Renew passport", // medium
    "apple pie", // medium
    "buy groceries" // low
  ]);
});

test("completed tasks stay completed after any sort", () => {
  for (const key of core.SORT_KEYS) {
    const sorted = core.sortTasks(fixtureTasks(), key);
    const done = sorted.filter((task) => task.completed);
    assert.equal(done.length, 1, key + " keeps exactly one completed task");
    assert.equal(done[0].title, "Plan offsite", key + " keeps its state");
  }
});

test("sorting an empty list yields an empty list", () => {
  assert.deepEqual(core.sortTasks([], "title"), []);
  assert.deepEqual(core.sortTasks([], "due"), []);
});
