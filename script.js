/* ==========================================================================
   TaskFlow — application script
   Sections: constants · state · storage · helpers · rendering ·
             form handling · task actions · events · init
   ========================================================================== */

(function () {
  "use strict";

  /* ---------- Constants ---------- */

  // Pure task logic lives in taskflow-core.js so Node can test it directly.
  const core = window.TaskFlowCore;

  const STORAGE_KEY = "taskflow.tasks";

  // Single-path icons so dynamically built buttons stay free of innerHTML.
  const ICON_PATHS = {
    edit:
      "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
    delete:
      "M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M18.5 6v14a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6M10 11v6M14 11v6",
    calendar:
      "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    alert:
      "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"
  };

  /* ---------- State ---------- */

  const state = {
    tasks: [],
    filter: "all",
    search: "",
    editingId: null,
    highlightId: null // task row to flash once after add/edit
  };

  // DOM references, populated in init() once the page is ready.
  let dom = {};

  /* =======================================================================
     Storage
     ======================================================================= */

  /**
   * Reads tasks from LocalStorage. Any missing or corrupt data results in
   * an empty list instead of a crash (validation lives in the core).
   */
  function loadTasks() {
    let raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.warn("TaskFlow: browser storage is unavailable.", error);
      return [];
    }

    const tasks = core.parseStoredTasks(raw);
    if (raw && tasks.length === 0 && raw.trim() !== "[]") {
      console.warn("TaskFlow: stored data was invalid, starting fresh.");
    }
    return tasks;
  }

  function saveTasks() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
    } catch (error) {
      console.warn("TaskFlow: tasks could not be saved.", error);
      announce("Warning: changes could not be saved to browser storage.");
    }
  }

  /* =======================================================================
     Small helpers
     ======================================================================= */

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function findTask(taskId) {
    return state.tasks.find(function (task) {
      return task.id === taskId;
    });
  }

  /** Builds an <svg> icon without touching innerHTML. */
  function createIcon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "icon");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATHS[name]);
    svg.appendChild(path);
    return svg;
  }

  /** Reports important changes to screen readers. */
  function announce(message) {
    dom.liveStatus.textContent = "";
    window.setTimeout(function () {
      dom.liveStatus.textContent = message;
    }, 50);
  }

  /* =======================================================================
     Derived data
     ======================================================================= */

  /** Tasks that match the current filter *and* the current search query. */
  function getVisibleTasks() {
    return core.filterTasks(state.tasks, state.filter, state.search);
  }

  /**
   * Returns due-date presentation info, or null when the task has no date.
   * A completed task is never shown as overdue.
   */
  function getDueDateInfo(task) {
    return core.getDueDateInfo(task, core.getTodayString());
  }

  /* =======================================================================
     Rendering
     ======================================================================= */

  function render() {
    const visibleTasks = getVisibleTasks();
    renderStats();
    renderFilterButtons();
    renderTaskList(visibleTasks);
    renderResultCount(visibleTasks);
    renderEmptyState(visibleTasks);
  }

  function renderStats() {
    const counts = core.countTasks(state.tasks);
    dom.statTotal.textContent = String(counts.total);
    dom.statPending.textContent = String(counts.pending);
    dom.statCompleted.textContent = String(counts.completed);
    dom.statHigh.textContent = String(counts.high);
  }

  function renderFilterButtons() {
    dom.filterButtons.forEach(function (button) {
      const isActive = button.dataset.filter === state.filter;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  function renderTaskList(visibleTasks) {
    // Remember keyboard focus so a re-render (toggle, filter, search)
    // does not throw the user back to the top of the page.
    const active = document.activeElement;
    const focusKey =
      active && active.dataset && active.dataset.focusKey
        ? active.dataset.focusKey
        : null;

    const fragment = document.createDocumentFragment();
    visibleTasks.forEach(function (task) {
      fragment.appendChild(createTaskElement(task));
    });
    dom.taskList.replaceChildren(fragment);

    if (focusKey) {
      const controls = dom.taskList.querySelectorAll("[data-focus-key]");
      for (const control of controls) {
        if (control.dataset.focusKey === focusKey) {
          control.focus();
          break;
        }
      }
    }

    // One-shot highlight for the task that was just added or edited.
    if (state.highlightId) {
      const rows = dom.taskList.querySelectorAll(".task-item");
      for (const row of rows) {
        if (row.dataset.id === state.highlightId) {
          row.classList.add("is-highlighted");
          break;
        }
      }
      state.highlightId = null;
    }
  }

  function renderResultCount(visibleTasks) {
    dom.resultCount.textContent =
      "Showing " + visibleTasks.length + " of " + state.tasks.length;
  }

  function renderEmptyState(visibleTasks) {
    const isEmpty = visibleTasks.length === 0;
    dom.emptyState.hidden = !isEmpty;
    if (!isEmpty) return;

    if (state.tasks.length === 0) {
      dom.emptyTitle.textContent = "No tasks yet";
      dom.emptyText.textContent =
        "Add your first task using the form and it will show up here.";
    } else if (state.search.trim() !== "") {
      dom.emptyTitle.textContent = "No matches";
      dom.emptyText.textContent =
        "No tasks in this view contain “" + state.search.trim() + "”.";
    } else if (state.filter === "active") {
      dom.emptyTitle.textContent = "Nothing active";
      dom.emptyText.textContent = "All tasks are completed. Nice work.";
    } else {
      dom.emptyTitle.textContent = "No completed tasks yet";
      dom.emptyText.textContent =
        "Tick off a task and it will appear here.";
    }
  }

  function createTaskElement(task) {
    const item = document.createElement("li");
    item.className =
      "task-item priority-" +
      task.priority +
      (task.completed ? " is-completed" : "");
    item.dataset.id = task.id;

    /* Checkbox */
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-check";
    checkbox.checked = task.completed;
    checkbox.id = "task-check-" + task.id;
    checkbox.dataset.action = "toggle";
    checkbox.dataset.focusKey = task.id + ":toggle";
    checkbox.setAttribute(
      "aria-label",
      "Mark “" + task.title + "” as " + (task.completed ? "active" : "complete")
    );
    item.appendChild(checkbox);

    /* Body: title, badges, description, meta */
    const body = document.createElement("div");
    body.className = "task-body";

    const head = document.createElement("div");
    head.className = "task-head";

    const title = document.createElement("h3");
    title.className = "task-title";
    title.textContent = task.title;
    head.appendChild(title);

    head.appendChild(
      makeBadge("badge badge-priority-" + task.priority, capitalize(task.priority))
    );
    head.appendChild(
      makeBadge(
        "badge badge-status" + (task.completed ? " is-done" : ""),
        task.completed ? "Completed" : "Active"
      )
    );
    body.appendChild(head);

    if (task.description) {
      const description = document.createElement("p");
      description.className = "task-desc";
      description.textContent = task.description;
      body.appendChild(description);
    }

    const dueInfo = getDueDateInfo(task);
    if (dueInfo) {
      const meta = document.createElement("div");
      meta.className = "task-meta";
      meta.appendChild(createDueChip(dueInfo));
      body.appendChild(meta);
    }

    item.appendChild(body);

    /* Actions */
    const actions = document.createElement("div");
    actions.className = "task-actions";
    actions.appendChild(
      createActionButton(task.id, "edit", "Edit task: " + task.title, false)
    );
    actions.appendChild(
      createActionButton(task.id, "delete", "Delete task: " + task.title, true)
    );
    item.appendChild(actions);

    return item;
  }

  function makeBadge(className, text) {
    const badge = document.createElement("span");
    badge.className = className;
    badge.textContent = text;
    return badge;
  }

  function createDueChip(dueInfo) {
    const chip = document.createElement("span");

    if (dueInfo.status === "overdue") {
      chip.className = "meta-chip is-overdue";
      chip.appendChild(createIcon("alert"));
      chip.appendChild(document.createTextNode("Overdue · " + dueInfo.dateLabel));
    } else if (dueInfo.status === "today") {
      chip.className = "meta-chip is-today";
      chip.appendChild(createIcon("calendar"));
      chip.appendChild(document.createTextNode("Due today · " + dueInfo.dateLabel));
    } else {
      chip.className = "meta-chip";
      chip.appendChild(createIcon("calendar"));
      chip.appendChild(document.createTextNode(dueInfo.dateLabel));
    }
    return chip;
  }

  function createActionButton(taskId, action, label, isDanger) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-btn" + (isDanger ? " is-danger" : "");
    button.dataset.action = action;
    button.dataset.focusKey = taskId + ":" + action;
    button.setAttribute("aria-label", label);
    button.title = action === "edit" ? "Edit" : "Delete";
    button.appendChild(createIcon(action));
    return button;
  }

  /* =======================================================================
     Form handling (add + edit)
     ======================================================================= */

  function handleFormSubmit(event) {
    event.preventDefault();

    const title = core.normalizeTitle(dom.titleInput.value);
    if (!title) {
      showTitleError("Please enter a task title before saving.");
      dom.titleInput.focus();
      return;
    }

    const values = {
      title: title,
      description: dom.descriptionInput.value,
      priority: dom.priorityInput.value,
      dueDate: dom.dueDateInput.value
    };

    if (state.editingId) {
      saveEdits(values);
    } else {
      addTask(values);
    }
  }

  function addTask(values) {
    const task = core.createTask(values);
    if (!task) {
      showTitleError("Please enter a task title before saving.");
      dom.titleInput.focus();
      return;
    }

    state.tasks.unshift(task); // newest first
    state.highlightId = task.id;

    saveTasks();
    clearTitleField();
    render();
    announce("Task added: " + task.title);
  }

  function saveEdits(values) {
    const task = core.updateTask(state.tasks, state.editingId, values);
    if (!task) {
      // The task vanished (e.g. cleared storage in another tab).
      resetForm();
      announce("That task no longer exists.");
      return;
    }

    state.highlightId = task.id;

    saveTasks();
    resetForm();
    render();
    announce("Task updated: " + task.title);
    dom.titleInput.focus();
  }

  function startEditing(taskId) {
    const task = findTask(taskId);
    if (!task) return;

    state.editingId = task.id;
    dom.titleInput.value = task.title;
    dom.descriptionInput.value = task.description;
    dom.priorityInput.value = task.priority;
    dom.dueDateInput.value = task.dueDate;

    dom.formHeading.textContent = "Edit task";
    dom.formHint.hidden = false;
    dom.submitLabel.textContent = "Save changes";
    dom.iconPlus.hidden = true;
    dom.iconSave.hidden = false;
    dom.cancelButton.hidden = false;
    dom.composerPanel.classList.add("is-editing");
    clearTitleError();

    dom.titleInput.focus();
    dom.titleInput.select();
    announce("Editing task: " + task.title);
  }

  function cancelEditing() {
    const wasEditing = Boolean(state.editingId);
    resetForm();
    if (wasEditing) announce("Edit cancelled.");
    dom.titleInput.focus();
  }

  /** Clears the form and returns the composer to "New task" mode. */
  function resetForm() {
    dom.taskForm.reset();
    state.editingId = null;
    dom.formHeading.textContent = "New task";
    dom.formHint.hidden = true;
    dom.submitLabel.textContent = "Add task";
    dom.iconPlus.hidden = false;
    dom.iconSave.hidden = true;
    dom.cancelButton.hidden = true;
    dom.composerPanel.classList.remove("is-editing");
    clearTitleError();
  }

  /** After adding, keep priority and due date for rapid batch entry. */
  function clearTitleField() {
    dom.titleInput.value = "";
    dom.descriptionInput.value = "";
    clearTitleError();
    dom.titleInput.focus();
  }

  function showTitleError(message) {
    dom.titleError.textContent = message;
    dom.titleError.hidden = false;
    dom.titleInput.setAttribute("aria-invalid", "true");
  }

  function clearTitleError() {
    dom.titleError.textContent = "";
    dom.titleError.hidden = true;
    dom.titleInput.removeAttribute("aria-invalid");
  }

  /* =======================================================================
     Task actions (toggle · delete)
     ======================================================================= */

  function toggleTask(taskId, isCompleted) {
    const task = core.setTaskCompletion(state.tasks, taskId, isCompleted);
    if (!task) return;

    saveTasks();
    render();
    announce(
      (task.completed ? "Completed: " : "Reopened: ") + task.title
    );
  }

  function deleteTask(taskId) {
    const task = findTask(taskId);
    if (!task) return;

    const confirmed = window.confirm(
      "Delete “" + task.title + "”? This cannot be undone."
    );
    if (!confirmed) return;

    state.tasks = core.deleteTask(state.tasks, taskId);

    if (state.editingId === taskId) resetForm();
    saveTasks();
    render();
    announce("Task deleted: " + task.title);

    // Keep the keyboard where it was useful: next task, or the form.
    const nextEdit = dom.taskList.querySelector('button[data-action="edit"]');
    if (nextEdit) nextEdit.focus();
    else dom.titleInput.focus();
  }

  /* =======================================================================
     Search, filters, keyboard
     ======================================================================= */

  function handleSearchInput() {
    state.search = dom.searchInput.value;
    dom.clearSearchButton.hidden = state.search.length === 0;
    render();
  }

  function clearSearch() {
    dom.searchInput.value = "";
    state.search = "";
    dom.clearSearchButton.hidden = true;
    render();
    dom.searchInput.focus();
  }

  function handleFilterClick(event) {
    const button = event.target.closest(".filter-btn");
    if (!button) return;

    const filter = button.dataset.filter;
    if (!core.FILTERS.includes(filter)) return;

    state.filter = filter;
    render();
  }

  function handleListChange(event) {
    const checkbox = event.target.closest('input[data-action="toggle"]');
    if (!checkbox || !dom.taskList.contains(checkbox)) return;

    const row = checkbox.closest(".task-item");
    if (row) toggleTask(row.dataset.id, checkbox.checked);
  }

  function handleListClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button || !dom.taskList.contains(button)) return;

    const row = button.closest(".task-item");
    if (!row) return;

    if (button.dataset.action === "edit") {
      startEditing(row.dataset.id);
    } else if (button.dataset.action === "delete") {
      deleteTask(row.dataset.id);
    }
  }

  function handleTitleKeydown(event) {
    // Explicit Enter handling guarantees submission across browsers
    // (and keeps the behaviour testable).
    if (event.key === "Enter") {
      event.preventDefault();
      dom.taskForm.requestSubmit();
    }
  }

  function handleGlobalKeydown(event) {
    if (event.key === "Escape" && state.editingId) {
      cancelEditing();
    }
  }

  /* =======================================================================
     Init
     ======================================================================= */

  function cacheDom() {
    dom = {
      liveStatus: document.getElementById("live-status"),
      statTotal: document.getElementById("stat-total"),
      statPending: document.getElementById("stat-pending"),
      statCompleted: document.getElementById("stat-completed"),
      statHigh: document.getElementById("stat-high"),
      composerPanel: document.querySelector(".composer-panel"),
      taskForm: document.getElementById("task-form"),
      formHeading: document.getElementById("form-heading"),
      formHint: document.getElementById("form-hint"),
      titleInput: document.getElementById("task-title"),
      titleError: document.getElementById("title-error"),
      descriptionInput: document.getElementById("task-description"),
      priorityInput: document.getElementById("task-priority"),
      dueDateInput: document.getElementById("task-due-date"),
      submitButton: document.getElementById("submit-btn"),
      submitLabel: document.getElementById("submit-label"),
      iconPlus: document.getElementById("icon-plus"),
      iconSave: document.getElementById("icon-save"),
      cancelButton: document.getElementById("cancel-btn"),
      searchInput: document.getElementById("task-search"),
      clearSearchButton: document.getElementById("clear-search"),
      filterButtons: Array.from(document.querySelectorAll(".filter-btn")),
      resultCount: document.getElementById("result-count"),
      taskList: document.getElementById("task-list"),
      emptyState: document.getElementById("empty-state"),
      emptyTitle: document.getElementById("empty-title"),
      emptyText: document.getElementById("empty-text")
    };
  }

  function bindEvents() {
    dom.taskForm.addEventListener("submit", handleFormSubmit);
    dom.titleInput.addEventListener("input", clearTitleError);
    dom.titleInput.addEventListener("keydown", handleTitleKeydown);
    dom.cancelButton.addEventListener("click", cancelEditing);

    dom.searchInput.addEventListener("input", handleSearchInput);
    dom.clearSearchButton.addEventListener("click", clearSearch);

    dom.filterButtons.forEach(function (button) {
      button.addEventListener("click", handleFilterClick);
    });

    dom.taskList.addEventListener("change", handleListChange);
    dom.taskList.addEventListener("click", handleListClick);

    document.addEventListener("keydown", handleGlobalKeydown);
  }

  function init() {
    cacheDom();
    state.tasks = loadTasks();
    bindEvents();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
