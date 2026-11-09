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
    sortTasks: sortTasks
  };

  if (typeof module === "object" && module.exports) {
    module.exports = core; // Node test runner
  } else {
    window.TaskFlowCore = core; // Browser
  }
})();
