# Production lines — design

Status: approved in conversation 2026-10-02, pending written-spec review. It replaces the
tickets design of the same day, which was too general a task manager.

## Context

A record order runs through a few fixed production lines: labels, master, sleeves,
covers, inlays, then press, invoice and shipping. Each line is a sequence of steps:
- **Checks** the backend runs itself, with a fixer where one exists.
- **Hand-offs** to someone outside: a printer, a mastering engineer, the press.
- **Returns** confirmed by staff: prints back and fine, lacquers cut.

Anything a check stops waits for staff: they repair it, accept it, or tell the customer.
When a line is through, the job moves on.

## Model

- **`CONFIG.lines`:** per product, its steps in order, plus the lines it waits for.
- **Where a line stands:** derived on every scan. It's the first step that isn't done.
- **`project.json`:** each line keeps a log of what people and fixers did. Nothing else
  is stored.
- **Hashes:** a log entry that names files counts only while those files are unchanged
  (sha256). A changed file sends the line back to that step.

```js
lines: {
  labels: { parts: ["labels"],
            steps: ["size", "resolution", "pdf", "bleed", "colour", "approve", "send:printer", "back:printed"] }
  // innerSleeve, outerCover, inlay, press, pack, ship: see CONFIG.lines; audio (master, reference cut, plating) and invoice follow
},
partners: { printer: ["in-house", "external"] }   // a plant lists its named suppliers here
```

## Steps

| Kind | Names | Done when |
|---|---|---|
| check | `size`, `resolution`, `pdf`, `bleed`, `colour` | the check passes for every file of the line, live from the current check results; or a valid `accept` entry |
| approve | `approve` | a valid `approve` entry (staff, or the customer through staff) |
| send | `send:<partner list>` | a valid entry naming who it went to, chosen from `CONFIG.partners[<list>]` |
| back | `back:<what>` | a valid entry: staff confirm it came back fine |

- **Which checks belong to which step.** A fixed table in code maps each step to the
  artwork checklist rows that decide it (`artworkRows`). A step passes when none of
  its rows is `warn` or `error`:

  | Step | Rows |
  |---|---|
  | `size` | Size |
  | `resolution` | Resolution |
  | `pdf` | PDF version, Encryption, Fonts, Colour profile |
  | `bleed` | Bleed |
  | `colour` | Colour mode, Spot colours, Ink, Black |

- **A line's files** are the files of its parts' slots, e.g. labels A and B, never a
  whitelabel side.

## The log (`project.json`)

```json
"plant": { "lines": { "labels": [
  { "step": "colour", "by": "fixer", "at": "…", "from": "KMPN012_labels_A_v1.pdf", "files": { "KMPN012_labels_A_v2.pdf": "9ec…" } },
  { "step": "bleed",  "by": "staff", "at": "…", "note": "bleed checked by eye", "files": { "KMPN012_labels_A_v2.pdf": "9ec…", "KMPN012_labels_B_v1.pdf": "d01…" } },
  { "step": "approve", "by": "customer", "at": "…", "files": { … } },
  { "step": "send:printer", "by": "staff", "at": "…", "to": "external", "files": { … } }
] } }
```

- Entries are only appended. The plant view never edits or removes them; a person
  may do so by hand.
- **`files`** maps each of the line's current files to its sha256 at the time. An entry
  counts while every listed file still exists with that hash. An entry without
  `files` always counts.
- **`by`:** `staff`, `customer` (entered by staff), or `fixer`.
- **Undo:** a line rewinds by itself when its files change. Deleting `plant.lines`
  resets every line to what the current check results say.
- **Normalising:** `prepareProject` keeps `plant.lines` as an object of arrays of
  objects and drops anything else.

## Fixers

- **Fixers by step:** `colour` → the existing colour fix (`plant/colourfix.py`).
  `size` and `bleed` get fixers later; until then those steps wait for staff.
- **Automatic:** after the checks of a job, the plant view runs the fixer of the line's
  current step, if it has one. It runs only when the line has no `by: "fixer"` entry
  from the same source file and hash, so a failed fix isn't repeated.
- **Result:** the fixed file is written as the slot's next version and becomes the
  slot's file right away (the "use" mechanism). The log entry records `from` and the
  new files. The job is then checked again.
- **If the fix doesn't pass:** the line stays at that step for staff.
- **Undo:** "use" on the older version, as today. That changes the files, so the line
  rewinds.

## Line state

`lineState(line, files, log, checkResults)` returns:
- `step`: the first step not done;
- `ready`: all steps before the first `send:` are done;
- `done`: all steps are done;
- `waiting`: one of the lines in `after` isn't done.

Also each step's state (done, current, ahead) and why the current step stops: the
failing row's text.

## Plant view

- **Job page:** a section **Production** between Basic and Artwork. One block per line
  shows its steps in order, done ones ticked, and the current step with its reason. The
  current step offers one action:
  - **check step:** "accept" (with a note);
  - **approve:** "approved by customer" and "approved by staff";
  - **send:** a select from the partner list, plus "sent";
  - **back:** "back, fine".

  Each action appends a log entry with the line's current files and hashes, through
  one generic safe save. The page reloads.
- **Board:** a view "Board" (nav link): one row per job and one column per line. A cell
  shows the line's current step, or ✓ when done, or "waiting".
- **Stages stay manual.** When every line of a job is through (or "ready", for the
  lines of the current stage), Basic shows "lines through — move on?" next to the
  existing move control.

## Server

- **Artwork check results carry each file's `sha256`,** taken from the checks cache.
- **`POST /api/project` `{job, project, basedOn}`:** saves `project.json` as the page
  built it, through `write_project` (409 when it changed). Log entries and fixer
  results use it.
- **`/api/fix/label`** (existing) is reused by the automatic fixer. Making the fixed
  file the slot's file goes through the existing `/api/assign`.
- **`/api/board`** cards carry `project`, `files` and the cached artwork facts, so the
  board can derive every job's lines.

## Scope of the first implementation

- **In:**
  - `src/lib/lines.js` (pure: the step table, `lineState`, the board cell);
  - `CONFIG.lines` with `labels`, and `CONFIG.partners.printer`, both validated;
  - `plant.lines` normalised;
  - the automatic colour fixer;
  - the Production section and its actions;
  - the board;
  - sha256 in check results, `/api/project`, and the board data.
- **Out (next):** the master and other part lines, press, invoice, ship; size and
  bleed fixers; customer access.

## Tests

- **`tests/lines.test.js`:**
  - each step kind;
  - check steps live from the check results;
  - an `accept` entry valid until the file changes;
  - approve, send and back;
  - `after` → waiting;
  - ready and done;
  - whitelabel sides left out;
  - junk in the log ignored;
  - the KMPN012 facts: labels at `size`, why "96.0×96.0mm, expected 98×98mm".
- **`tests/config-validation.test.js`:** lines (known step kinds; `send:` lists exist in
  `partners`; `after` names existing lines) and partners.
- **`tests/project.test.js`:** `plant.lines` normalised.
- **`plant/test_*.py`:** sha256 in artwork results; `/api/project` with 409; board cards
  with project, files and facts.
- **`tests/plant-overview.test.js`, `tests/plant-board.test.js`:** the Production section
  and its action per step kind; the board cells.
- **Manual (KMPN012):**
  - labels stop at `size`;
  - accept it by hand: the line moves to `resolution` and on to `bleed`, then `colour`;
  - the fixer runs by itself and the line moves on;
  - approve, then send to a printer, then back fine: done;
  - replacing a label file rewinds the line.
