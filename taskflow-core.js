/* ==========================================================================
   TaskFlow core — pure task logic shared by the browser app and the tests.
   Contains no DOM access, so Node can load it with require() while the
   browser gets it as window.TaskFlowCore (script.js loads this first).
   ========================================================================== */

(function () {
  "use strict";

  /* ---------- Constants ---------- */

  const PRIORITIES = ["low", "medium", "high"];
  const FILTERS = ["all", "active", "completed"];
  const MAX_TITLE_LENGTH = 120;
  const MAX_DESCRIPTION_LENGTH = 500;

  /* ---------- Normalisation (single source of truth for field rules) ---------- */

  /** Trimmed title, capped at 120 chars, or null when nothing is usable. */
  function normalizeTitle(value) {
    if (typeof value !== "string") return null;
    const title = value.trim().slice(0, MAX_TITLE_LENGTH);
    return title === "" ? null : title;
  }

  function normalizeDescription(value) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, MAX_DESCRIPTION_LENGTH);
  }

  function normalizePriority(value) {
    return PRIORITIES.includes(value) ? value : "medium";
  }

  /** A due date is kept only when it is a real "YYYY-MM-DD" calendar date. */
  function normalizeDueDate(value) {
    return isValidDueDate(value) ? value : "";
  }

  /** Checks both the format and the real-world validity of "YYYY-MM-DD". */
  function isValidDueDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const parts = value.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    return (
      date.getFullYear() === parts[0] &&
      date.getMonth() === parts[1] - 1 &&
      date.getDate() === parts[2]
    );
  }

  function createTaskId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return (
      "task-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 10)
    );
  }

  /**
   * Builds a new task from form values.
   * Returns null when the title is missing or blank — callers should show
   * a validation message in that case.
   */
  function createTask(values) {
    const source = values || {};
    const title = normalizeTitle(source.title);
    if (!title) return null;

    return {
      id: createTaskId(),
      title: title,
      description: normalizeDescription(source.description),
      priority: normalizePriority(source.priority),
      dueDate: normalizeDueDate(source.dueDate),
      completed: source.completed === true
    };
  }

  /**
   * Applies form values to an existing task (never changes its id, position
   * or completion state). Returns the task, or null when the id is unknown
   * or the new title is unusable.
   */
  function updateTask(tasks, id, values) {
    const task = tasks.find(function (entry) {
      return entry.id === id;
    });
    if (!task) return null;

    const source = values || {};
    const title = normalizeTitle(source.title);
    if (!title) return null;

    task.title = title;
    task.description = normalizeDescription(source.description);
    task.priority = normalizePriority(source.priority);
    task.dueDate = normalizeDueDate(source.dueDate);
    return task;
  }

  function deleteTask(tasks, id) {
    return tasks.filter(function (entry) {
      return entry.id !== id;
    });
  }

  function setTaskCompletion(tasks, id, isCompleted) {
    const task = tasks.find(function (entry) {
      return entry.id === id;
    });
    if (!task) return null;
    task.completed = isCompleted === true;
    return task;
  }

  /* ---------- Stored data ---------- */

  /**
   * Returns a well-formed task, or null when the entry is unusable.
   * Unknown extra fields are dropped so storage stays minimal.
   */
  function sanitizeTask(entry) {
    if (!entry || typeof entry !== "object") return null;

    const title = normalizeTitle(entry.title);
    if (!title) return null;

    return {
      id:
        typeof entry.id === "string" && entry.id.trim()
          ? entry.id
          : createTaskId(),
      title: title,
      description:
        typeof entry.description === "string"
          ? entry.description.slice(0, MAX_DESCRIPTION_LENGTH)
          : "",
      priority: normalizePriority(entry.priority),
      dueDate: normalizeDueDate(entry.dueDate),
      completed: entry.completed === true
    };
  }

  /**
   * Turns the raw LocalStorage string into a safe task list.
   * Missing, corrupt or structurally invalid data yields [] instead of
   * a crash; duplicate ids are dropped so rows stay addressable.
   */
  function parseStoredTasks(raw) {
    if (typeof raw !== "string" || raw === "") return [];

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    const tasks = [];
    const seenIds = new Set();
    for (const entry of parsed) {
      const task = sanitizeTask(entry);
      if (task && !seenIds.has(task.id)) {
        seenIds.add(task.id);
        tasks.push(task);
      }
    }
    return tasks;
  }

  /* ---------- Dates ---------- */

  /** Local date string (never UTC) so "today" matches the user's timezone. */
  function getTodayString() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return now.getFullYear() + "-" + month + "-" + day;
  }

  function formatDueDate(value) {
    const parts = value.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  /**
   * Returns due-date presentation info, or null when the task has no date.
   * A completed task is never shown as overdue.
   * `today` may be passed explicitly so tests stay deterministic.
   */
  function getDueDateInfo(task, today) {
    if (!task || !task.dueDate) return null;

    const reference = typeof today === "string" ? today : getTodayString();
    let status = "upcoming";
    if (task.dueDate < reference) status = task.completed ? "past" : "overdue";
    else if (task.dueDate === reference) status = "today";

    return {
      status: status,
      dateLabel: formatDueDate(task.dueDate)
    };
  }

  /* ---------- Views: filtering, searching, counting ---------- */

  /** Tasks that match the given filter *and* search query. */
  function filterTasks(tasks, filter, search) {
    const query = typeof search === "string" ? search.trim().toLowerCase() : "";

    return tasks.filter(function (task) {
      const matchesFilter =
        filter === "all" ||
        (filter === "active" && !task.completed) ||
        (filter === "completed" && task.completed);

      const matchesSearch =
        query === "" || task.title.toLowerCase().includes(query);

      return matchesFilter && matchesSearch;
    });
  }

  function countTasks(tasks) {
    const total = tasks.length;
    let pending = 0;
    let completed = 0;
    let high = 0;

    for (const task of tasks) {
      if (task.completed) completed += 1;
      else pending += 1;
      if (task.priority === "high") high += 1;
    }
    return { total: total, pending: pending, completed: completed, high: high };
  }

  /* ---------- Sorting ---------- */

  const SORT_KEYS = ["newest", "oldest", "title", "due", "priority"];

  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  function compareTitles(a, b) {
    const left = a.title.toLowerCase();
    const right = b.title.toLowerCase();
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  /**
   * Returns a new array ordered by the given key — the input is never
   * mutated, so the stored creation order always survives.
   *   newest   stored order (creation order, newest first) — the default
   *   oldest   reverse creation order
   *   title    A → Z, case-insensitive
   *   due      soonest first, tasks without a due date last
   *   priority High → Medium → Low
   * Ties keep their original relative order (Array#sort is stable), and an
   * unknown key falls back to the default order.
   */
  function sortTasks(tasks, key) {
    const sorted = tasks.slice();

    if (key === "oldest") {
      return sorted.reverse();
    }

    if (key === "title") {
      return sorted.sort(compareTitles);
    }

    if (key === "due") {
      return sorted.sort(function (a, b) {
        // Tasks without a due date always go to the end.
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        if (a.dueDate < b.dueDate) return -1;
        if (a.dueDate > b.dueDate) return 1;
        return 0;
      });
    }

    if (key === "priority") {
      return sorted.sort(function (a, b) {
        const left = PRIORITY_RANK[a.priority];
        const right = PRIORITY_RANK[b.priority];
        return (left === undefined ? 3 : left) - (right === undefined ? 3 : right);
      });
    }

    // "newest" and anything unknown: creation order as stored.
    return sorted;
  }

  /* ---------- Submission safety ---------- */

  // Accidental double-activations (double-click, held Enter) land within
  // this window after a successful submit.
  const RESUBMIT_WINDOW_MS = 1000;

  /**
   * True when `now` falls inside the short window after a successful
   * submission — used to swallow stray re-submits silently instead of
   * flashing a confusing error at the user.
   */
  function isDuplicateResubmit(lastSubmitAt, now) {
    if (typeof lastSubmitAt !== "number" || typeof now !== "number") return false;
    const elapsed = now - lastSubmitAt;
    return elapsed >= 0 && elapsed < RESUBMIT_WINDOW_MS;
  }

  /* ---------- Data export / import ---------- */

  const EXPORT_APP = "TaskFlow";
  const EXPORT_FORMAT_VERSION = 1;
  // 1 MB comfortably holds thousands of tasks while keeping a stray or
  // hostile file from stalling the tab while it is parsed.
  const MAX_IMPORT_BYTES = 1024 * 1024;
  // Ids that may enter the app through an import file: the shapes this app
  // itself generates (UUIDs and "task-…" fallbacks), 1–128 characters.
  const IMPORT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

  /**
   * Builds the downloadable export document. Every task is re-sanitised
   * first so a file produced by TaskFlow can always be imported back.
   * `exportedAt` may be passed for deterministic tests.
   */
  function buildExportDocument(tasks, exportedAt) {
    const list = Array.isArray(tasks) ? tasks : [];
    const exported = [];
    for (const entry of list) {
      const task = sanitizeTask(entry);
      if (task) exported.push(task);
    }

    return {
      app: EXPORT_APP,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt:
        typeof exportedAt === "string" && exportedAt !== ""
          ? exportedAt
          : new Date().toISOString(),
      count: exported.length,
      tasks: exported
    };
  }

  /** "taskflow-tasks-YYYY-MM-DD.json" — falls back to today's date. */
  function buildExportFilename(dateString) {
    const date =
      typeof dateString === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateString)
        ? dateString
        : getTodayString();
    return "taskflow-tasks-" + date + ".json";
  }

  /**
   * Validates an import file's text and returns either
   *   { ok: true,  tasks: [...] }   — a clean, de-duplicated task list, or
   *   { ok: false, error: "…" }     — a user-facing reason to reject it.
   *
   * Policy: structure and identity are strict (a bad title, id or a
   * duplicate id rejects the whole file), while repairable field values
   * (priority, due date, completion flag, length caps) are normalised —
   * the same rules LocalStorage data is repaired with.
   */
  function parseImportedTasks(text) {
    if (typeof text !== "string" || text.trim() === "") {
      return { ok: false, error: "The file is empty." };
    }
    if (text.length > MAX_IMPORT_BYTES) {
      return {
        ok: false,
        error: "The file is too large to import (limit is 1 MB)."
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { ok: false, error: "The file is not valid JSON." };
    }

    let entries;
    if (Array.isArray(parsed)) {
      entries = parsed;
    } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.tasks)) {
      entries = parsed.tasks;
    } else {
      return {
        ok: false,
        error: "The file must contain a list of TaskFlow tasks."
      };
    }

    if (entries.length === 0) {
      return { ok: false, error: "The file does not contain any tasks." };
    }

    const tasks = [];
    const seenIds = new Set();

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const label = "Task " + (index + 1);

      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return { ok: false, error: label + " is not a valid task object." };
      }
      if (!normalizeTitle(entry.title)) {
        return { ok: false, error: label + " is missing a title." };
      }

      let id;
      if (entry.id !== undefined) {
        if (typeof entry.id !== "string" || !IMPORT_ID_PATTERN.test(entry.id)) {
          return { ok: false, error: label + " has an invalid id." };
        }
        if (seenIds.has(entry.id)) {
          return {
            ok: false,
            error: label + ' repeats the id "' + entry.id + '".'
          };
        }
        id = entry.id;
      }

      // Missing ids are generated, so a hand-written file still imports.
      while (id === undefined || seenIds.has(id)) {
        id = createTaskId();
      }
      seenIds.add(id);

      const task = sanitizeTask(Object.assign({}, entry, { id: id }));
      if (!task) {
        return { ok: false, error: label + " is not a valid task object." };
      }
      tasks.push(task);
    }

    return { ok: true, tasks: tasks };
  }

  /**
   * Merges validated imported tasks into the existing list without losing
   * anything that is already there.
   *   - new ids are added at the front (creation order stays newest first)
   *   - ids that already exist are only replaced when `replaceExisting`
   *     is true (the UI asks for that confirmation first); otherwise the
   *     current task is kept and counted as skipped
   * Returns { tasks, added, replaced, skipped }.
   */
  function mergeImportedTasks(existing, imported, replaceExisting) {
    const current = Array.isArray(existing) ? existing.slice() : [];
    const incoming = Array.isArray(imported) ? imported : [];
    const replace = replaceExisting === true;

    const indexById = new Map();
    current.forEach(function (task, index) {
      if (!indexById.has(task.id)) indexById.set(task.id, index);
    });

    const additions = [];
    let replaced = 0;
    let skipped = 0;

    incoming.forEach(function (task) {
      const index = indexById.get(task.id);
      if (index === undefined) {
        additions.push(task);
        return;
      }
      if (replace) {
        current[index] = task;
        replaced += 1;
      } else {
        skipped += 1;
      }
    });

    return {
      tasks: additions.concat(current),
      added: additions.length,
      replaced: replaced,
      skipped: skipped
    };
  }

  /**
   * True when the task with `taskId` would appear under the given
   * filter + search view — used to decide whether a just-saved task is
   * hidden by the current view and needs revealing.
   */
  function isTaskInView(tasks, filter, search, taskId) {
    if (!Array.isArray(tasks)) return false;
    return filterTasks(tasks, filter, search).some(function (task) {
      return task.id === taskId;
    });
  }

  /* ---------- Exports ---------- */

  const core = {
    PRIORITIES: PRIORITIES,
    FILTERS: FILTERS,
    MAX_TITLE_LENGTH: MAX_TITLE_LENGTH,
    MAX_DESCRIPTION_LENGTH: MAX_DESCRIPTION_LENGTH,
    normalizeTitle: normalizeTitle,
    normalizeDescription: normalizeDescription,
    normalizePriority: normalizePriority,
    normalizeDueDate: normalizeDueDate,
    isValidDueDate: isValidDueDate,
    createTaskId: createTaskId,
    createTask: createTask,
    updateTask: updateTask,
    deleteTask: deleteTask,
    setTaskCompletion: setTaskCompletion,
    sanitizeTask: sanitizeTask,
    parseStoredTasks: parseStoredTasks,
    getTodayString: getTodayString,
    formatDueDate: formatDueDate,
    getDueDateInfo: getDueDateInfo,
    filterTasks: filterTasks,
    countTasks: countTasks,
    SORT_KEYS: SORT_KEYS,
    sortTasks: sortTasks,
    RESUBMIT_WINDOW_MS: RESUBMIT_WINDOW_MS,
    isDuplicateResubmit: isDuplicateResubmit,
    EXPORT_APP: EXPORT_APP,
    EXPORT_FORMAT_VERSION: EXPORT_FORMAT_VERSION,
    MAX_IMPORT_BYTES: MAX_IMPORT_BYTES,
    IMPORT_ID_PATTERN: IMPORT_ID_PATTERN,
    buildExportDocument: buildExportDocument,
    buildExportFilename: buildExportFilename,
    parseImportedTasks: parseImportedTasks,
    mergeImportedTasks: mergeImportedTasks,
    isTaskInView: isTaskInView
  };

  if (typeof module === "object" && module.exports) {
    module.exports = core; // Node test runner
  } else {
    window.TaskFlowCore = core; // Browser
  }
})();
