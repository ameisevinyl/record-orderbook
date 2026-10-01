# Tickets — design

Status: approved in conversation 2026-10-02, pending written-spec review. The first
piece of the plant workflow system. Next pieces: automatic size and bleed fixers;
tickets for audio, mastering, plating and press; editing assignee and priority in
the UI; automatic stage moves.

## Context

At the plant, an order needs work before it can be pressed. Its label might have the
wrong size, no bleed, or too much ink, and then it needs the customer's approval. So
far the plant view shows check results, but not what still has to be done, by whom,
or what's waiting for what.

Tickets make that work visible per job and across all jobs. Work may happen anywhere:
in the plant view, in external software, or by the customer. The result lands in the
job folder, and the ticket follows.

## Principle: tickets are derived, decisions are stored

- **Derived:** every scan computes each ticket from `CONFIG`, the job's
  `project.json`, its files, and its cached check results. That's the reconciliation
  idea of Kubernetes controllers and build systems: rebuilding is always safe.
- **Stored:** only human decisions, in `project.json` under `plant.tickets[<id>]`,
  editable with any editor. A decision for a ticket that no longer exists is ignored.
- **Approvals:** an approval stores the sha256 of the file it approved. When that
  file changes, the approval is void (GitHub's "dismiss stale approvals").
- **Stages:** stages stay manual (moving the folder). When all tickets of a stage are
  done, the plant view suggests moving on.

## Ticket

A derived ticket, never stored:

```
{ id: "artwork.size:labels.A", type: "artwork.size", subject: "labels.A",
  stage: "10_ORDERS/10_PREPRESS", column: "label print", title: "Label A: fix size",
  why: "96.0×96.0 mm, expected 98×98 mm", kind: "work" | "approval",
  state: "waiting" | "open" | "done", doneBy: "check" | "staff" | "customer" | null,
  waitsFor: [ids], assignee: "staff" | "customer", priority: 1 | 2 | 3, notify: bool,
  told: bool }
```

- **id:** `<type>:<subject>`, where `subject` is the slot (`labels.A`, `labels.B`) or
  `order` for order-wide tickets.
- **Work tickets:** `open` while their cause exists. They're `done` by `check` once
  the cause is gone, or `done` by a person through a stored decision. That's also how
  staff accept a file as it is.
- **Approval tickets:** `waiting` while any `waitsFor` ticket isn't done. Then `open`
  until a stored `approved` decision whose `sha256` matches the slot's current file;
  then `done`, by the approver.
- **Waiting:** any ticket is `waiting` while one of its `waitsFor` tickets isn't done.
  A waiting ticket is shown, but it can't be decided.
- **Notify:** a ticket type with `notify` gets `told: false` once done, until a
  stored `notified` decision exists.
- **Assignee and priority:** from `CONFIG`, overridden by the stored decision.

## Stored decisions

In `project.json`, under `plant.tickets`, keyed by ticket id:

```json
"plant": { "tickets": {
  "artwork.size:labels.A": { "done": { "by": "staff", "at": "2026-10-02T10:12:00.000Z", "note": "rescaled in Affinity" } },
  "approve.artwork:labels.A": { "approved": { "by": "customer", "at": "…", "sha256": "d012…" }, "notified": { "at": "…" } },
  "artwork.colour:labels.B": { "assignee": "customer", "priority": 2 }
} }
```

- `by` is `"staff"` or `"customer"`. Staff may approve in the customer's place.
- Every decision made in the plant view also adds a `history` entry.
- `prepareProject` keeps `plant.tickets` as it is: an object of objects; anything
  else becomes `{}`.

## Ticket types (registry in `src/lib/tickets.js`)

Each type decides whether it applies and why, in code. `CONFIG` gives its settings.
Per printed label slot (not whitelabel), in work order:

| Type | Kind | Applies / open when | waitsFor |
|---|---|---|---|
| `artwork.size` | work | the Size row warns | — |
| `artwork.bleed` | work | the Bleed row warns | size |
| `artwork.colour` | work | the Ink or Black row warns | bleed |
| `artwork.file` | work | any other row warns (fonts, resolution, colour mode, …) | — |
| `approve.artwork` | approval | always, for each printed slot | size, bleed, colour, file |

Plus one per order:

| Type | Kind | Open when |
|---|---|---|
| `order.complete` | work | `projectGaps` returns gaps; `why` = the first gap and the count |

- **Ticket appearance:** a work ticket whose cause never showed is not listed at all. A
  ticket appears once its cause is seen, and stays as `done` by check once it's fixed
  (see "Seen" below).
- **Not checked yet:** a slot whose facts are missing (never checked) gets one ticket,
  `artwork.check`, `open`, why "not checked yet", and no others.

### Seen: keeping fixed work visible

A rebuild from the current state alone would make a fixed problem disappear, rather
than show as done. So the first decision about a ticket can be automatic:

- **Recording:** when the plant view sees a work ticket open, it stores
  `{"seen": {"at"}}` for it, once.
- **Derivation:** a stored `seen` with the cause gone gives `done`, by `check`. Without
  `seen` and without a cause, the ticket isn't listed.
- **Rebuild:** deleting `plant.tickets` is still safe. It only loses the record of
  problems already fixed.

## Config (`src/config.js`)

```js
workflow: {
  // Board columns between Inbox and Done, in order.
  columns: ["order", "label print"],
  tickets: {
    "order.complete":  { stage: "00_INBOX", column: "order", title: "Order complete", assignee: "staff", priority: 1 },
    "artwork.check":   { stage: "10_ORDERS/10_PREPRESS", column: "label print", title: "Check artwork", assignee: "staff", priority: 1, parts: ["labels"] },
    "artwork.size":    { stage: "10_ORDERS/10_PREPRESS", column: "label print", title: "Fix size", assignee: "staff", priority: 1, parts: ["labels"] },
    "artwork.bleed":   { stage: "10_ORDERS/10_PREPRESS", column: "label print", title: "Fix bleed", assignee: "staff", priority: 1, parts: ["labels"] },
    "artwork.colour":  { stage: "10_ORDERS/10_PREPRESS", column: "label print", title: "Fix colours", assignee: "staff", priority: 2, parts: ["labels"] },
    "artwork.file":    { stage: "10_ORDERS/10_PREPRESS", column: "label print", title: "Fix file", assignee: "staff", priority: 2, parts: ["labels"] },
    "approve.artwork": { stage: "10_ORDERS/10_PREPRESS", column: "label print", title: "Approve artwork", assignee: "customer", priority: 1, notify: true, parts: ["labels"] }
  }
}
```

- The title shown is `<slot title>: <title>`, e.g. "Label A: Fix size".
- A type missing from `tickets` is switched off.
- `config-validation` checks:
  - every registry type used exists;
  - `stage` is a non-empty string, and `column` is listed in `columns`;
  - `assignee` is staff or customer;
  - `priority` is 1–3, and `notify` is a boolean;
  - `parts` names printable parts (`labels`, `innerSleeve`, `outerCover`, `inlay`).

## Plant view

- **Job page:** a section **Tickets**, between Basic and Artwork. It's a table:
  - columns: ticket, state, why, assignee, priority;
  - a **done** button on open work tickets;
  - **approve** on open approvals (as staff);
  - **told** on done tickets with `notify` and `told: false`.

  Waiting tickets have no button. Each button posts a decision; the page reloads.
- **Seen:** after a job's checks finish, the page stores `seen` for every open work
  ticket that has none yet, in one write. Its history entry reads
  "tickets: N opened".
- **Move suggestion:** in Basic's stage row, when the job's stage has tickets and
  all of them are done: "all tickets done — move on?" next to the existing move
  control.
- **Board:** a grid view, linked from the nav as "Board":
  - one row per job, sorted by catalogue number as the tree already is;
  - columns: Inbox, the `workflow.columns`, Done;
  - Inbox and Done show the job's stage as a mark;
  - each ticket column shows the job's tickets of that column as small marks per state
    (open ●, waiting ○, done ✓), with the ticket title as tooltip.
  - The board request also returns each job's `project.json`, file list, and cached
    artwork facts from `.checks/artwork.json`, read only; the page derives the tickets.
    A slot without facts reads as `artwork.check` open.

## Server

- **`POST /api/ticket`** `{job, id, decision, basedOn}`:
  - `decision` is one of `{done: {note}}`, `{approved: {}}`, `{notified: {}}`, or
    `{seen: {}}` for a list of ids (`ids`);
  - the page computes the decision's content (`by: "staff"`, `at`, the sha256 for an
    approval, which comes from the job's file listing or `plant.received`), and the
    server writes through `write_project` (409 when the file changed);
  - the response is the new project hash.
- **`GET /api/board`** gains per job: `project`, `files` and `artwork` (the cached
  facts by file name, or `{}`).

## Tests

- **`tests/tickets.test.js`**, on the pure `deriveTickets(project, config, files, artworkFacts)`
  and `stageDone(tickets, stage)`:
  - every state and transition;
  - waiting order;
  - a stale approval (sha256 differs) → open;
  - a staff approval in the customer's place counts;
  - an orphan decision is ignored;
  - a decision edited by hand is honoured;
  - `seen` → done by check;
  - no cause and no `seen` → not listed;
  - unchecked slot → `artwork.check` only.
  - **The KMPN012 facts as a fixture:** per label, size open, bleed and colour waiting,
    approval waiting; `order.complete` per its gaps.
- **`tests/config-validation.test.js`:** the workflow block.
- **`plant/test_server.py`:** `/api/ticket` writes, refuses on conflict; `/api/board`
  carries project, files and facts.
- **`tests/plant-overview.test.js` / `tests/plant-board.test.js`:** the ticket table
  and its buttons, the move suggestion, the grid's cells.
- **Manual:**
  - open KMPN012: the tickets appear;
  - "fix colours" + "use" on label A: colour turns done by check once size and bleed
    are done, or done by staff;
  - approve: done; replace the file: open again;
  - the board shows the row.
