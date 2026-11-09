"use strict";

/* Filtering, search, statistics and due-date handling.
   Run with: node --test tests/ */

const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../taskflow-core.js");

function fixtureTasks() {
  return [
    core.createTask({ title: "Ship weekly report", priority: "high", dueDate: "2026-11-10" }),
    core.createTask({ title: "Buy groceries", priority: "low" }),
    core.createTask({ title: "Renew passport", priority: "medium", dueDate: "2026-11-30" }),
    core.createTask({ title: "Plan offsite", priority: "high", completed: true }),
    core.createTask({ title: "water plants", priority: "low", dueDate: "2026-11-09" })
  ];
}

/* ---------- Filtering ---------- */

test("filter 'all' returns every task", () => {
  const tasks = fixtureTasks();
  assert.equal(core.filterTasks(tasks, "all", "").length, 5);
  assert.deepEqual(core.filterTasks(tasks, "all", ""), tasks);
});

test("filter 'active' hides completed tasks", () => {
  const visible = core.filterTasks(fixtureTasks(), "active", "");
  assert.equal(visible.length, 4);
  assert.ok(visible.every((task) => !task.completed));
});

test("filter 'completed' shows only completed tasks", () => {
  const visible = core.filterTasks(fixtureTasks(), "completed", "");
  assert.equal(visible.length, 1);
  assert.equal(visible[0].title, "Plan offsite");
});

test("filtering an empty list yields an empty list", () => {
  assert.deepEqual(core.filterTasks([], "all", ""), []);
  assert.deepEqual(core.filterTasks([], "active", "anything"), []);
});

/* ---------- Search ---------- */

test("search matches titles case-insensitively", () => {
  const tasks = fixtureTasks();
  assert.equal(core.filterTasks(tasks, "all", "REPORT").length, 1);
  assert.equal(core.filterTasks(tasks, "all", "report").length, 1);
  assert.equal(core.filterTasks(tasks, "all", "rEpOrT")[0].title, "Ship weekly report");
});

test("search matches partial titles", () => {
  assert.equal(core.filterTasks(fixtureTasks(), "all", "pass").length, 1);
  assert.equal(core.filterTasks(fixtureTasks(), "all", "e").length, 5, "single letter matches all");
});

test("search with no match yields an empty list", () => {
  assert.deepEqual(core.filterTasks(fixtureTasks(), "all", "zzzz"), []);
});

test("search trims the query and ignores a whitespace-only query", () => {
  const tasks = fixtureTasks();
  assert.equal(core.filterTasks(tasks, "all", "   report   ").length, 1);
  assert.equal(core.filterTasks(tasks, "all", "    ").length, 5, "blank query shows everything");
});

test("search matches titles only, not descriptions", () => {
  const tasks = [
    core.createTask({ title: "Alpha", description: "secret notes about beta" }),
    core.createTask({ title: "Beta" })
  ];
  const visible = core.filterTasks(tasks, "all", "secret");
  assert.equal(visible.length, 0, "descriptions are not searched");
});

/* ---------- Search + filter combinations ---------- */

test("search combines with the active filter", () => {
  const tasks = fixtureTasks();

  // "report" exists but is active; asking for completed must not return it
  assert.equal(core.filterTasks(tasks, "completed", "report").length, 0);
  // "offsite" exists and is completed
  assert.equal(core.filterTasks(tasks, "completed", "offsite").length, 1);
  // "offsite" is completed, so the active filter must not return it
  assert.equal(core.filterTasks(tasks, "active", "offsite").length, 0);
  // "report" is active
  assert.equal(core.filterTasks(tasks, "active", "report").length, 1);
});

test("a query can narrow a filtered view to nothing", () => {
  assert.deepEqual(core.filterTasks(fixtureTasks(), "active", "zzz"), []);
});

test("a non-string query behaves like no query", () => {
  assert.equal(core.filterTasks(fixtureTasks(), "all", undefined).length, 5);
});

/* ---------- Statistics ---------- */

test("countTasks reports total, pending, completed and high priority", () => {
  assert.deepEqual(core.countTasks(fixtureTasks()), {
    total: 5,
    pending: 4,
    completed: 1,
    high: 2
  });
});

test("countTasks on an empty list is all zeros", () => {
  assert.deepEqual(core.countTasks([]), {
    total: 0,
    pending: 0,
    completed: 0,
    high: 0
  });
});

test("countTasks counts completed high-priority tasks as high priority", () => {
  const tasks = [
    core.createTask({ title: "Done high", priority: "high", completed: true }),
    core.createTask({ title: "Open low", priority: "low" })
  ];
  assert.deepEqual(core.countTasks(tasks), {
    total: 2,
    pending: 1,
    completed: 1,
    high: 1
  });
});

test("statistics are independent of which filter/search produced the view", () => {
  const tasks = fixtureTasks();
  const activeOnly = core.filterTasks(tasks, "active", "or");

  assert.equal(activeOnly.length, 2, "only active titles containing 'or'");
  assert.deepEqual(
    core.countTasks(tasks),
    { total: 5, pending: 4, completed: 1, high: 2 },
    "stats always describe the whole list"
  );
});

/* ---------- Due dates ---------- */

test("getDueDateInfo flags a past-due active task as overdue", () => {
  const task = core.createTask({ title: "Late", dueDate: "2026-11-01" });
  const info = core.getDueDateInfo(task, "2026-11-09");
  assert.equal(info.status, "overdue");
  assert.ok(info.dateLabel.length > 0, "a formatted label is provided");
});

test("getDueDateInfo flags today's date as today", () => {
  const task = core.createTask({ title: "Now", dueDate: "2026-11-09" });
  assert.equal(core.getDueDateInfo(task, "2026-11-09").status, "today");
});

test("getDueDateInfo flags a future date as upcoming", () => {
  const task = core.createTask({ title: "Later", dueDate: "2026-12-25" });
  assert.equal(core.getDueDateInfo(task, "2026-11-09").status, "upcoming");
});

test("a completed task with a past date is 'past', never overdue", () => {
  const task = core.createTask({ title: "Done", dueDate: "2026-11-01", completed: true });
  assert.equal(core.getDueDateInfo(task, "2026-11-09").status, "past");
});

test("getDueDateInfo returns null when there is no due date", () => {
  assert.equal(core.getDueDateInfo(core.createTask({ title: "No date" }), "2026-11-09"), null);
  assert.equal(core.getDueDateInfo(null, "2026-11-09"), null);
});

test("date strings compare correctly across month and year boundaries", () => {
  const task = core.createTask({ title: "Year end", dueDate: "2026-12-31" });
  assert.equal(core.getDueDateInfo(task, "2026-12-31").status, "today");
  assert.equal(core.getDueDateInfo(task, "2027-01-01").status, "overdue");
  assert.equal(core.getDueDateInfo(task, "2026-12-30").status, "upcoming");
});

test("getTodayString produces a local YYYY-MM-DD string", () => {
  assert.match(core.getTodayString(), /^\d{4}-\d{2}-\d{2}$/);
});

test("isValidDueDate accepts real dates and rejects everything else", () => {
  assert.equal(core.isValidDueDate("2026-11-09"), true);
  assert.equal(core.isValidDueDate("2028-02-29"), true, "leap day");
  assert.equal(core.isValidDueDate("2027-02-29"), false);
  assert.equal(core.isValidDueDate("2026-11-31"), false, "November has 30 days");
  assert.equal(core.isValidDueDate("2026-00-10"), false);
  assert.equal(core.isValidDueDate("2026-11"), false);
  assert.equal(core.isValidDueDate("09-11-2026"), false);
  assert.equal(core.isValidDueDate(20261109), false);
  assert.equal(core.isValidDueDate(null), false);
});
