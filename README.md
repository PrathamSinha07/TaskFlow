# TaskFlow

A polished, local-first to-do dashboard built with **plain HTML5, CSS3 and vanilla JavaScript** — no frameworks, no build step, no servers, no dependencies.

Dark charcoal interface with a warm gold accent, designed to stay practical: everything you need to capture, prioritise and finish tasks, and nothing you don't.

---

## Features

### Task management
- Add tasks with a title, optional description, priority (Low / Medium / High) and optional due date
- Empty and whitespace-only titles are rejected with an inline, accessible error message
- Enter key submits from the title field
- Every task gets a unique ID (`crypto.randomUUID()` with a fallback)
- Edit any task — the form is pre-filled, saving updates in place (never duplicates), and Cancel or `Esc` exits edit mode
- Delete any task with a confirmation prompt that names the task
- Mark tasks complete/incomplete with a custom checkbox; completed tasks are visually distinct (dimmed, struck through, status badge flips to *Completed*)

### Organising
- **Filters:** All / Active / Completed, with correct `aria-pressed` state
- **Search:** case-insensitive match on title, combined with the active filter
- Four different empty states: no tasks at all, nothing active, nothing completed, no search matches

### Dashboard
- Live statistics: total, pending, completed and high-priority counts (refresh on every change, unaffected by filters/search)
- "Showing X of Y" result counter above the list

### Due dates
- Relative date chips: `Due today · …`, plain date, and a red **Overdue · …** chip with a warning icon for past-due tasks
- Completed tasks are never flagged as overdue
- Dates are compared in the user's local timezone (no UTC off-by-one)

### Storage
- Tasks persist in `localStorage` under the key `taskflow.tasks` and reload on startup
- Missing, corrupt or structurally invalid data is repaired or discarded safely — the app never crashes on bad storage
- Only useful fields are stored: `id`, `title`, `description`, `priority`, `dueDate`, `completed` (no UI state, timestamps or junk)

### Interface & accessibility
- Responsive layout: two-column dashboard on desktop, stacked panels on tablet, single column on mobile (verified at 1400 px, 834 px and 390 px)
- Priority colour coding: green (low) / amber (medium) / red (high) as badges and a left accent bar
- Accessible names on every icon button and checkbox, `aria-live` announcements for add/edit/delete/complete, visible `:focus-visible` rings, hidden labels where visual labels aren't needed
- Subtle motion that respects `prefers-reduced-motion`
- `<noscript>` notice for browsers with JavaScript disabled

---

## Getting started

No installation, no build tools.

**Option A — open directly**

Double-click `index.html`. It runs from the file system in any modern browser.

**Option B — local server (optional)**

Any static server works, for example VS Code's **Live Server** extension, or:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

That's it. Your tasks are saved to that browser's `localStorage` immediately after every change.

---

## Project structure

```
todo-list-app/
├── index.html    # Markup: header, stats, form, toolbar, list, empty state
├── style.css     # Design tokens, layout, components, motion, responsive rules
├── script.js     # App logic: storage, rendering, filters, search, CRUD
├── README.md
└── .gitignore
```

`script.js` is organised as one private IIFE with clearly named sections: *constants → state → storage → helpers → derived data → rendering → form handling → task actions → search/filters/keyboard → init*. All user-provided text is written with `textContent`; icons are built with `createElementNS`, so no user input is ever passed through `innerHTML`.

---

## How data is stored

```json
{
  "id": "8f3a…",
  "title": "Ship weekly report",
  "description": "Include charts",
  "priority": "high",
  "dueDate": "2026-11-10",
  "completed": false
}
```

- Storage key: `taskflow.tasks`
- `dueDate` is an ISO `YYYY-MM-DD` string or `""`
- To reset the app: clear the browser's site data for the page (or run `localStorage.removeItem("taskflow.tasks")` in the console)

---

## Keyboard & shortcuts

| Input | Result |
|---|---|
| `Enter` (title field) | Submit the task |
| `Esc` (while editing) | Cancel the edit and reset the form |
| Tab / Shift+Tab | Move between controls — every control shows a visible focus ring |

---

## Testing

The finished app was exercised end-to-end in headless Chrome through a temporary DOM harness (removed after testing) that drives the real UI with real events. **Result: 158/158 checks passed.**

| Area | Checks | Result |
|---|---|---|
| Adding tasks, empty/whitespace rejection, Enter submit | 19 | ✅ |
| Rendering: title, description, priority, status, due-date variants | 24 | ✅ |
| Filters (All / Active / Completed) + filter-empty states | 13 | ✅ |
| Complete / reopen + statistics | 16 | ✅ |
| Edit (pre-fill, save in place, no duplicates), Cancel, Esc | 21 | ✅ |
| Delete with confirm/decline + statistics | 9 | ✅ |
| Search alone, case-insensitivity, combined with filters, clear button | 18 | ✅ |
| Accessibility spot checks (labels, unique ids, icon paths) | 5 | ✅ |
| LocalStorage payload shape + final statistics | 12 | ✅ |
| Cold-start reload of saved tasks (separate browser profile) | 7 | ✅ |
| Corrupt / structurally invalid stored data | 18 | ✅ |
| Uncaught page errors during all runs | 1 | ✅ |

Visual checks: desktop (1400 px), tablet (834 px) and true 390 px mobile renders, plus the empty state — verified via headless screenshots.

Two bugs were caught by visual review and fixed: an icon-key mismatch that hid the delete button, and a CSS specificity clash that let the search icon overlap the placeholder.

---

## Limitations

- Data lives in **one browser, one profile** — there is no sync, export/import or cross-device access
- Search matches **titles only** (by specification); descriptions aren't searched
- The high-priority statistic counts *all* high-priority tasks, including completed ones
- Deletion confirmation uses the native `window.confirm()` dialog
- No sorting, drag-and-drop, subtasks, recurring tasks or tags
- `localStorage` has a ~5 MB quota; heavy paste-ins could theoretically exceed it (the app warns via a screen-reader announcement if a save fails)

---

## Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari) that support `replaceChildren`, `requestSubmit`, `crypto.randomUUID` and CSS custom properties.
