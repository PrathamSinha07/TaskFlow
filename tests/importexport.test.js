"use strict";

/* Task data export and import: file format, validation and merging.
   Run with: node --test */

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

const rejectsWith = (result, fragment) => {
  assert.equal(result.ok, false, "expected the import to be rejected");
  assert.equal(typeof result.error, "string");
  assert.ok(
    result.error.includes(fragment),
    'expected error to mention "' + fragment + '", got: ' + result.error
  );
};
/* ---------- Export ---------- */

test("buildExportDocument exports every task field plus file metadata", () => {
  const tasks = sampleTasks();
  const payload = core.buildExportDocument(tasks, "2026-11-11T09:00:00.000Z");

  assert.equal(payload.app, core.EXPORT_APP);
  assert.equal(payload.formatVersion, core.EXPORT_FORMAT_VERSION);
  assert.equal(payload.exportedAt, "2026-11-11T09:00:00.000Z");
  assert.equal(payload.count, 3);
  assert.equal(payload.tasks.length, 3);

  for (const task of payload.tasks) {
    assert.deepEqual(Object.keys(task).sort(), TASK_KEYS);
  }

  const first = payload.tasks[0];
  assert.equal(first.id, tasks[0].id, "ids are preserved");
  assert.equal(first.title, "Ship weekly report");
  assert.equal(first.description, "Include charts");
  assert.equal(first.priority, "high");
  assert.equal(first.dueDate, "2026-11-10");
  assert.equal(first.completed, false);
  assert.equal(payload.tasks[2].completed, true, "completion state exported");
});

test("buildExportDocument stamps a UTC timestamp when none is given", () => {
  const payload = core.buildExportDocument(sampleTasks());
  assert.match(payload.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("exporting an empty list produces a well-formed file", () => {
  const payload = core.buildExportDocument([], "2026-11-11T09:00:00.000Z");

  assert.equal(payload.count, 0);
  assert.deepEqual(payload.tasks, []);

  // The file is valid JSON — importing it reports a clear message
  // instead of crashing.
  const parsed = JSON.parse(JSON.stringify(payload));
  assert.deepEqual(parsed.tasks, []);
  rejectsWith(
    core.parseImportedTasks(JSON.stringify(payload)),
    "does not contain any tasks"
  );
});

test("buildExportDocument ignores unusable entries instead of failing", () => {
  const payload = core.buildExportDocument([
    null,
    "not a task",
    { title: "" },
    { title: "Real task" }
  ]);

  assert.equal(payload.count, 1);
  assert.equal(payload.tasks[0].title, "Real task");
  assert.ok(payload.tasks[0].id, "the surviving task still gets an id");
});

test("buildExportFilename embeds the export date", () => {
  assert.equal(
    core.buildExportFilename("2026-11-11"),
    "taskflow-tasks-2026-11-11.json"
  );
  assert.match(
    core.buildExportFilename(),
    /^taskflow-tasks-\d{4}-\d{2}-\d{2}\.json$/,
    "falls back to today"
  );
  assert.match(
    core.buildExportFilename("not-a-date"),
    /^taskflow-tasks-\d{4}-\d{2}-\d{2}\.json$/,
    "an invalid date falls back to today"
  );
});

test("export → import round-trip restores the exact task list", () => {
  const original = sampleTasks();
  const json = JSON.stringify(core.buildExportDocument(original, "2026-11-11"));

  const result = core.parseImportedTasks(json);

  assert.equal(result.ok, true);
  assert.deepEqual(result.tasks, original, "ids, order and fields survive");
});

/* ---------- Import: structure ---------- */

test("import accepts a bare task array as well as the TaskFlow envelope", () => {
  const tasks = sampleTasks();

  const bare = core.parseImportedTasks(JSON.stringify(tasks));
  assert.equal(bare.ok, true);
  assert.deepEqual(bare.tasks, tasks);

  const envelope = core.parseImportedTasks(
    JSON.stringify({ app: "TaskFlow", tasks: tasks })
  );
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.tasks, tasks);
});

test("import rejects malformed JSON with a clear message", () => {
  rejectsWith(core.parseImportedTasks("{definitely not json"), "not valid JSON");
  rejectsWith(core.parseImportedTasks(""), "empty");
  rejectsWith(core.parseImportedTasks("   "), "empty");
  rejectsWith(core.parseImportedTasks("undefined"), "not valid JSON");
  rejectsWith(core.parseImportedTasks(null), "empty");
});

test("import rejects files that are not a list of tasks", () => {
  rejectsWith(core.parseImportedTasks("42"), "list of TaskFlow tasks");
  rejectsWith(core.parseImportedTasks('"just a string"'), "list of TaskFlow tasks");
  rejectsWith(
    core.parseImportedTasks('{"title":"single task"}'),
    "list of TaskFlow tasks"
  );
  rejectsWith(
    core.parseImportedTasks('{"tasks":"not an array"}'),
    "list of TaskFlow tasks"
  );
  rejectsWith(core.parseImportedTasks("[]"), "does not contain any tasks");
  rejectsWith(
    core.parseImportedTasks('{"tasks":[]}'),
    "does not contain any tasks"
  );
});

test("import rejects invalid task objects and missing titles", () => {
  rejectsWith(core.parseImportedTasks(JSON.stringify(["just a string"])), "Task 1");
  rejectsWith(core.parseImportedTasks(JSON.stringify([42])), "Task 1");
  rejectsWith(core.parseImportedTasks(JSON.stringify([null])), "Task 1");
  rejectsWith(core.parseImportedTasks(JSON.stringify([[1, 2]])), "Task 1");
  rejectsWith(core.parseImportedTasks(JSON.stringify([{}])), "missing a title");
  rejectsWith(
    core.parseImportedTasks(JSON.stringify([{ title: "   " }])),
    "missing a title"
  );
  rejectsWith(
    core.parseImportedTasks(
      JSON.stringify([{ title: "Fine" }, { title: "" }, { title: "Also fine" }])
    ),
    "Task 2"
  );
});

test("import rejects invalid and duplicate ids", () => {
  rejectsWith(
    core.parseImportedTasks(JSON.stringify([{ id: 42, title: "Number id" }])),
    "invalid id"
  );
  rejectsWith(
    core.parseImportedTasks(JSON.stringify([{ id: "   ", title: "Blank id" }])),
    "invalid id"
  );
  rejectsWith(
    core.parseImportedTasks(JSON.stringify([{ id: "has space", title: "Spaced" }])),
    "invalid id"
  );
  rejectsWith(
    core.parseImportedTasks(
      JSON.stringify([{ id: "<script>", title: "Hostile id" }])
    ),
    "invalid id"
  );
  rejectsWith(
    core.parseImportedTasks(
      JSON.stringify([
        { id: "same-id", title: "First copy" },
        { id: "same-id", title: "Second copy" }
      ])
    ),
    "repeats the id"
  );
  rejectsWith(
    core.parseImportedTasks(
      JSON.stringify([
        { id: "ok-id", title: "First" },
        { title: "Second" },
        { id: "ok-id", title: "Third" }
      ])
    ),
    "repeats the id"
  );
});

test("import accepts the id shapes TaskFlow itself generates", () => {
  const uuid = "3f1d2a4c-8b7e-4f5a-9c2d-1e0f6a7b8c9d";
  const legacy = "task-abc123-xyz98765";

  const result = core.parseImportedTasks(
    JSON.stringify([
      { id: uuid, title: "UUID id" },
      { id: legacy, title: "Legacy id" }
    ])
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.tasks.map((task) => task.id),
    [uuid, legacy]
  );
});

test("import generates unique ids when the file has none", () => {
  const result = core.parseImportedTasks(
    JSON.stringify([{ title: "A" }, { title: "B" }, { title: "C" }])
  );

  assert.equal(result.ok, true);
  assert.equal(result.tasks.length, 3);
  const ids = new Set(result.tasks.map((task) => task.id));
  assert.equal(ids.size, 3, "no duplicate ids are introduced");
});

/* ---------- Import: field validation ---------- */

test("import repairs repairable fields instead of rejecting the file", () => {
  const result = core.parseImportedTasks(
    JSON.stringify([
      {
        title: "  Needs trimming  ",
        description: "D".repeat(900),
        priority: "urgent",
        dueDate: "2026-02-30",
        completed: "true",
        createdAt: 123456,
        evil: "<img src=x onerror=alert(1)>"
      }
    ])
  );

  assert.equal(result.ok, true);
  const task = result.tasks[0];
  assert.deepEqual(Object.keys(task).sort(), TASK_KEYS, "unknown fields dropped");
  assert.equal(task.title, "Needs trimming");
  assert.equal(task.description.length, core.MAX_DESCRIPTION_LENGTH);
  assert.equal(task.priority, "medium");
  assert.equal(task.dueDate, "");
  assert.equal(task.completed, false);
});

test("imported tasks are safe to render: text stays text", () => {
  const result = core.parseImportedTasks(
    JSON.stringify([
      { title: "<b>bold</b> & \"quotes\"", description: "<script>alert(1)</script>" }
    ])
  );

  assert.equal(result.ok, true);
  assert.equal(result.tasks[0].title, '<b>bold</b> & "quotes"');
  assert.equal(result.tasks[0].description, "<script>alert(1)</script>");
  // Rendering goes through textContent, so this is data, not markup —
  // the assertion documents that the import never interprets it.
  assert.ok(result.tasks[0].title.includes("<b>"));
});

test("a file larger than the limit is rejected without parsing", () => {
  const huge = "[".repeat(core.MAX_IMPORT_BYTES + 1);
  const result = core.parseImportedTasks(huge);
  rejectsWith(result, "too large");
  assert.ok(core.MAX_IMPORT_BYTES >= 512 * 1024, "the limit is sensible");
});

/* ---------- Import: merging ---------- */

test("mergeImportedTasks adds new tasks to an empty list", () => {
  const incoming = sampleTasks();
  const merge = core.mergeImportedTasks([], incoming, false);

  assert.equal(merge.added, 3);
  assert.equal(merge.replaced, 0);
  assert.equal(merge.skipped, 0);
  assert.deepEqual(merge.tasks, incoming);
});

test("mergeImportedTasks preserves existing tasks and keeps them in front", () => {
  const existing = [
    core.createTask({ title: "Existing one" }),
    core.createTask({ title: "Existing two" })
  ];
  const incoming = [
    core.createTask({ title: "Imported one" }),
    core.createTask({ title: "Imported two" })
  ];

  const merge = core.mergeImportedTasks(existing, incoming, false);

  assert.equal(merge.added, 2);
  assert.equal(merge.tasks.length, 4);
  assert.deepEqual(
    merge.tasks.map((task) => task.title),
    ["Imported one", "Imported two", "Existing one", "Existing two"],
    "new tasks land on top, existing order untouched"
  );
  assert.deepEqual(
    existing.map((task) => task.title),
    ["Existing one", "Existing two"],
    "the input list is not mutated"
  );
});

test("mergeImportedTasks never overwrites without the replace flag", () => {
  const sharedId = "shared-id";
  const existing = [
    core.createTask({ title: "Original", priority: "high" }),
    core.createTask({ title: "Untouched" })
  ];
  existing[0].id = sharedId;
  const incoming = [
    Object.assign(core.createTask({ title: "Replaced", priority: "low" }), {
      id: sharedId
    }),
    core.createTask({ title: "Brand new" })
  ];

  const kept = core.mergeImportedTasks(existing, incoming, false);
  assert.equal(kept.replaced, 0);
  assert.equal(kept.skipped, 1);
  assert.equal(kept.added, 1);
  assert.equal(kept.tasks[1].title, "Original", "current copy is kept");
  assert.equal(
    kept.tasks.filter((task) => task.id === sharedId).length,
    1,
    "no duplicate ids"
  );

  const replaced = core.mergeImportedTasks(existing, incoming, true);
  assert.equal(replaced.replaced, 1);
  assert.equal(replaced.skipped, 0);
  assert.equal(replaced.added, 1);
  assert.equal(replaced.tasks[1].title, "Replaced", "replaced in place");
  assert.equal(replaced.tasks[0].title, "Brand new");
  assert.equal(
    replaced.tasks.filter((task) => task.id === sharedId).length,
    1,
    "still no duplicate ids"
  );
});

test("merging the same file twice produces no duplicates", () => {
  const incoming = sampleTasks();

  const first = core.mergeImportedTasks([], incoming, false);
  const second = core.mergeImportedTasks(first.tasks, incoming, false);

  assert.equal(second.added, 0);
  assert.equal(second.skipped, 3);
  assert.equal(second.tasks.length, 3, "the list is unchanged");
  assert.deepEqual(second.tasks, first.tasks);
});

test("mergeImportedTasks handles empty or non-array input", () => {
  const merge = core.mergeImportedTasks(undefined, undefined, true);
  assert.deepEqual(merge, { tasks: [], added: 0, replaced: 0, skipped: 0 });
});

/* ---------- View helper used by the import flow ---------- */

test("isTaskInView reflects the current filter and search", () => {
  const tasks = sampleTasks();

  assert.equal(core.isTaskInView(tasks, "all", "", tasks[0].id), true);
  assert.equal(core.isTaskInView(tasks, "completed", "", tasks[0].id), false);
  assert.equal(core.isTaskInView(tasks, "completed", "", tasks[2].id), true);
  assert.equal(core.isTaskInView(tasks, "all", "groceries", tasks[1].id), true);
  assert.equal(core.isTaskInView(tasks, "all", "groceries", tasks[0].id), false);
  assert.equal(core.isTaskInView(tasks, "all", "", "missing-id"), false);
  assert.equal(core.isTaskInView(null, "all", "", "x"), false);
});
