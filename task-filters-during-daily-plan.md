# Plan: Task filters during the daily

## Goal

During each person's turn, show the project tasks where they are an assignee or reviewer, in the correct task-view filter. Make the list predictable to scan and let participants inspect the task description and task notes without leaving the daily.

## Current implementation notes

- `src/app.js` already loads assigned and reviewed task queries in `fetchTasksForUser`, then merges duplicate IDs by keeping the assignee relationship. A task where the same person has both roles therefore loses its reviewer role.
- `filteredTasks` handles the assignee mappings, but its reviewer `Done` branch checks review feedback without requiring task status `inReview`.
- `Remaining` already requires `inReview` for reviewers and defaults missing feedback to pending. Validate that missing reviewer feedback means pending in the Solutions API before relying on that behavior.
- The task mapping currently retains number, title, status, type, relationship, and review feedback only. Description and task notes are not loaded or displayed.
- `src/index.html` renders a basic task list with Done, Current, Remaining, and All filters. Meeting notes in the adjacent panel are stand-up notes, not notes attached to a task.
- The repository has no configured test suite (`npm test` is currently a placeholder).
- Follow-up UI decisions: start each speaker on Current; sanitize and render rich task HTML in the details view; put task refresh in the Tasks header and use it to retry open details too.

## High-level plan

1. **Confirm task/review data semantics.** Verify the actual Solutions API status values, the per-user feedback shape and pending representation, and the API fields/endpoint for task descriptions and task notes. Confirm whether notes are embedded or need an on-demand request.
2. **Normalize task roles and apply the mapping.** Merge results by task ID without losing either relationship. Classify a task into a view when either role matches that view's rule; do not show duplicate rows for tasks with both roles.
3. **Make ordering intentional.** Sort consistently within every filter using a documented status-group order, then task number ascending as a deterministic tie-breaker.
4. **Improve task-list scanning and inspection.** Refine the task row hierarchy, default to Current, and add an accessible disclosure to show sanitized HTML descriptions and task notes in place. Put refresh in the Tasks header and use it for list and open-details retries.
5. **Verify behavior.** Add focused automated checks for role/status/feedback classification and ordering, then exercise details and all filters in the active daily view.

## Low-level implementation plan

### 1. Validate API contract

- Inspect a representative task response for `status`, `number`, `description`, `priority` (if present), assignees, reviewers, review feedback, update timestamp, and task-note representation.
- Confirm the exact feedback values for approved, changes requested, and pending, and whether no feedback record is equivalent to pending.
- Confirm whether task notes arrive in the task response or require a separate endpoint/query, and determine the least costly supported way to retrieve them.
- Keep the UI labels based on the verified API values; handle absent description or notes gracefully.

### 2. Normalize, filter, and sort tasks (`src/app.js`)

- Replace the exclusive `relation` representation with role membership (for example, `roles: ['Assignee', 'Reviewer']`) while merging by task ID.
- Preserve a reviewer-specific feedback lookup for the active speaker; do not infer reviewer approval from another person's feedback.
- Implement the required classification rules:

  | View | Match rule |
  | --- | --- |
  | Done | Assignee + `completed`, or Reviewer + `inReview` + my feedback `approved` / `changesRequested` |
  | Current | Assignee + `inProgress` |
  | Remaining | Reviewer + `inReview` + my feedback `pending`, or Assignee + `toDo` |
  | All | Any task returned for either role |

- Treat the review feedback requirement as role-specific: a task may qualify for a view through either role, including when the same person has both roles, but appears once.
- Sort by view-specific status groups, then task number ascending (numeric comparison when possible; stable title/ID fallback if a number is missing):
  - Done: `completed`, then `inReview`.
  - Current: `inProgress`.
  - Remaining: `inReview`, then `toDo`.
  - All: `toDo`, `inProgress`, `inReview`, `completed`.
- Keep the sort deterministic for equal status/number and ensure changing the active speaker/filter recomputes the displayed results.

### 3. Task details (`src/app.js`, `src/index.html`, `src/style.css`)

- Carry the task description through task normalization. Load notes with the task when available in the list response; otherwise retrieve them on demand when a participant opens that task and cache the result for the current daily session.
- Add an explicit, keyboard-operable Details disclosure to each task row. Show the description and task notes in an expanded panel without navigating away from the daily.
- Sanitize API-provided rich text before rendering it as HTML; escape the content if the sanitizer is unavailable. Provide sensible empty-content copy and loading/error feedback for on-demand note retrieval.
- Add an accessible Refresh icon button in the Tasks header. Remove retry controls from the task-list and detail bodies; refreshing reloads the task list and, when open, its details.
- Present task number/title as the primary content, role(s) and task type as secondary metadata, and status as a clearly readable badge. Keep the row usable on narrow screens and in both light and dark themes.
- Distinguish task notes in the expanded task details from the existing daily-level Notes panel.

### 4. Tests and verification

- Add focused tests for the pure role/status/feedback classifier, including: each mapping row, wrong status, wrong reviewer feedback, missing feedback semantics, dual assignee/reviewer role, and duplicate task IDs.
- Add ordering tests for each view's status groups and deterministic task-number tie-breaks.
- Verify the Details control can be opened and closed by keyboard and pointer, and that empty description/notes and note-fetch failure do not break the task list.
- Run the automated test command and manually verify all four views against representative task data in both themes.
- The existing `npm test` script is only a placeholder; update it to run the focused tests without adding a test dependency if the built-in Node test runner is suitable.

## Acceptance checklist

- [ ] Assignee and reviewer tasks match the provided mapping, including reviewer status and the active person's feedback.
- [ ] A task matching through both roles appears once and retains enough role information to explain why it is included.
- [ ] Every view has a stable, documented ordering.
- [ ] The daily task list exposes each task's description and notes, with usable empty/loading/error behavior.
- [ ] The list and detail disclosure are readable, keyboard-operable, responsive, and work in light/dark themes.
- [ ] Automated checks cover the mapping, dual-role handling, and ordering.

## Open validation point

The issue does not specify the Solutions API field/endpoint for task notes or the exact representation of a pending review. Confirm both before implementation; preserve the requested behavior while adapting the retrieval layer to the actual API contract.
