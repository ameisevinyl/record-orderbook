# Plant view layout — plain HTML structure — design

Status: approved 2026-09-29, built.

## Context

The plant view grew section by section (board, inbox, job: stage bar,
header, gaps, files, audio, artwork, overview) and shows the same facts
several times: the catalogue number three times per job (header,
Release, folder name), each file name up to four times (Files table,
tracklist/labels, Audio, Artwork). Staff need the job's main details on
top and the rest in a fixed, logical order.

This step settles structure and order only: plain HTML5, no styling, as
simple as a TUI. A look (a CSS reset, a framework, a plant's own theme)
comes later and may differ per plant.

Unchanged: everything the page does — checks, versions, moves, merges,
the change polling, spectrograms — and the customer page.

## Rules

- Plain HTML5: `header`, `nav`, `main`, `section`, `h1`–`h3`, `table`,
  `ul`, `pre`, `button`, `select`, `a`, `img`. Browser default fonts;
  colours only as HTML defines them (no colour anywhere in the
  page's own markup or CSS).
- Every labelled field is a table row: label in `<th scope="row">`,
  value in `<td>`. Lists of things (tracks, slots, addresses, history)
  are tables with a header row.
- No duplicates: a catalogue number appears once in the overview (the
  nav) and once in a job's view (Basic). A file name appears once in a
  job's view, in its slot's row. The job folder name is not shown (the
  nav marks the open job).
- One stylesheet, `src/plant/structure.css`, structure only: the two
  columns and the positioning the pictures need (below). No fonts,
  spacing or animation; lines and fills only where a picture needs them
  (waveform markers and played part, artwork cut lines), in HTML's
  named colours (black, white, gray) — no hex or rgb values. It is where a plant's theme or
  a reset hooks in later. `src/plant/index.html` has no `<style>` and no
  `style=` attributes except the computed positions of waveform markers
  and the artwork preview's aspect ratio.

## Page skeleton

```
<header>
  <h1><a href="#/">Plant view</a></h1>
  [Load project zip] [Load project folder]
  <pre id="status">   one CLI status line (see Progress)
  <p id="error">
<nav>
  <h2>Jobs</h2>        the jobs tree
  <h2>Sections</h2>    only while a job is open
<main>                 the chosen view
```

`structure.css`: `header` spans both columns; `nav` left, `main` right
(CSS grid, `nav` as wide as its content); the waveform box
(`position: relative`, played shading and markers absolute on top);
the artwork preview box (image, overlay image and cut-line SVG stacked).
Nothing else.

### Stages with sub-stages

A stage folder that has sub-stages (10_ORDERS with 10_PREPRESS and
20_PRESS) only groups them: no job belongs in it directly.

- The move select offers only stages without sub-stages (00_INBOX,
  10_ORDERS/10_PREPRESS, 10_ORDERS/20_PRESS, 20_DONE, 99_ARCHIVE);
  `/api/move` refuses a grouping stage (`jobs.move`).
- A job found directly in a grouping stage (moved there by hand) is a
  problem on the overview: "<job> is in 10_ORDERS — move it to one of
  its sub-stages". It still opens, so staff can move it from its page.
- In the nav a grouping stage is a heading with its sub-stages nested
  under it, no job list of its own.
- The overview's problem list is computed on the page from
  `/api/board` (the server only refuses such moves).

### Nav

- **Jobs:** nested lists, stage folders as the page finds them
  (sub-stages nested under their grouping stage), each with its count; per job one link
  "CAT — Title" to `#/job/<job>`; the open job is marked with
  `aria-current="page"` (and shown bold by the browser via `<b>`);
  inbox items (zips, folders) under 00_INBOX as links to
  `#/inbox/<item>`. This tree is the overview: the only place outside a
  job where catalogue numbers appear.
- **Sections** (job open): Basic · Artwork · Audio · Shipping & billing ·
  History, as links `#/job/<job>/<section>`. When that job is already
  shown, a section link scrolls to the section's `<h2 id>` and does not
  reload the job or re-run its checks; a changed job or a page load
  loads the job and then scrolls.

### Progress (CLI status line)

One `<pre id="status">` line at the top, text only, updated by the
page script:

```
checking audio    PZ-01_A_side_v1.wav    2/3   47 %  |
creating waveform PZ-01_A_side_v1.wav    2/3         /
checking artwork  PZ-01_labels_A_v1.pdf  1/4         -
plotting spectrum PZ-01_B_side_v1.wav    2/2         \
idle
```

- While something runs, the last character steps through `| / - \`
  every 150 ms (script, no CSS animation, no images).
- Server reports:
  - audio check (already streamed): each line also carries `file`,
    `index`, `count` and `step` (`reading facts`, `creating waveform`),
    besides `progress`;
  - artwork check becomes a stream in the same NDJSON form: one line
    per file as it starts (`file`, `index`, `count`,
    `step: "checking artwork"`), then `{"result": …}`;
  - spectrum (background): `spectrum.py` keeps the file being plotted
    and its position per job; the job page's 3-second change poll
    (`/api/job/stamp`) also returns it (`spectrum: {file, index,
    count}` or null) and the line shows "plotting spectrum …" until it
    is null, then "idle".
- Errors stay in `#error`, under the status line.

## Views

### Overview (`#/`)

`main` holds only what needs attention: the problems list (a job in two
stages, a job in a grouping stage — linked, since the nav doesn't list
it) and how many items wait in the inbox. Their names, like the jobs,
are in the nav only.

### Inbox item (`#/inbox/<item>`)

A table: Item · Catalogue # · Title · Artist · Files (count). Then per
job with the same catalogue number a section "Resend of <job> (stage)"
with the merge plan (list of changes) and a Merge button; last
"Accept as new job".

### Job (`#/job/<job>[/<section>]`)

Five sections, each `<section><h2 id="…">`:

1. **Basic** — one table, rows:
   Catalogue # · Title · Artist · Format · Quantity (per colour, and the
   total) · Customer (billing name, email) · Products (labels: printed,
   whitelabel per side, big hole; inner sleeve, cover, inlay: product
   names) · Stage (stage name; move select + Move, Rescan, Download zip)
   · Last change (date and who of the last history entry; its note is
   in History) · Notes.
   Below the table: the gaps of groups Release and Quantity.
2. **Artwork** — the gaps of groups Labels, Inner sleeve, Cover, Inlay.
   One table, a row per artwork slot: Slot · File · Other versions (each
   with "use", newer ones marked) · Verdict. Then per slot an `<h3>`
   with the slot name, the preview (cut lines, "problem areas"
   checkbox) and the checklist table. Last, if any: "Not assigned" — a
   table of files no slot knows, with a slot select and "use".
3. **Audio** — the gaps of groups Side A/B and the audio findings. Per
   side a table Side · RPM · Matrix · Total (with soundsystem cut when
   set); then the track table: Pos · Title · Artist · Length · Gap ·
   File · Other versions · Spectrum (link); a continuous side lists its
   side file and tracklist file as rows of the side table instead. Then
   per audio file an `<h3>` with its position (A1, Side A): the facts
   table (format, duration, software, tags), play button, waveform with
   the file's and the form's markers. Last, if any: "Not assigned" —
   like Artwork's, for files no slot knows. A file goes to Audio's by
   its audio extension (`checks.AUDIO_EXT`), every other one to
   Artwork's.
4. **Shipping & billing** — the gaps of groups Billing and Shipping n.
   The complete billing address table (field rows) — name and email
   stand in Basic's Customer row too, on purpose: staff copy the
   address as a whole; per shipping address an
   `<h3>`, its address table and its quantities, residential flag and
   note.
5. **History** — a table: Date · By · Note, oldest first.

Gap groups map to sections by name: Release, Quantity → Basic; Side A,
Side B → Audio; Labels, Inner sleeve, Cover, Inlay → Artwork; Billing,
Shipping n → Shipping & billing. The separate gaps list at the top, the
header, the Files table and the old overview go away.

## Code

- `src/lib/plant-overview.js` becomes the job view: `renderBasic`,
  `renderArtwork`, `renderAudio`, `renderShipping`, `renderHistory` and
  `sectionGaps(gaps, section)`; pure string functions as now.
- `src/lib/plant-board.js`: `renderNav(board, openJob)`,
  `renderOverview(board)`, `renderInbox(…)`; `renderJobBar` and
  `renderFiles` fold into Basic, Artwork and Audio.
- `src/lib/versions.js` `jobFiles()` gains the slot's section
  (artwork or audio) so each section lists its own slots and
  unassigned files.
- `src/plant/app.js`: the nav is rendered on every route (board fetched
  once per route), section scrolling, the status line (spinner,
  streamed steps, spectrum from the poll).
- `plant/checks.py` / `plant/server.py`: step and file in the audio
  stream; the artwork check streamed; `spectrum.py` records its
  progress; `/api/job/stamp` returns it.
- `src/plant/index.html` loses its `<style>`; `src/plant/structure.css`
  is new.

## Testing

- Per section renderer: rows and order, escaping, gaps sorted into the
  right section.
- No duplicates: for a sample project, the job view contains the
  catalogue number exactly once and each file name exactly once; the
  nav contains each job's catalogue number exactly once.
- `index.html` has no `<style>`; `structure.css` has no `font`,
  `margin`, `padding` or `animation` declarations and no hex or rgb
  colour values.
- Server: audio stream lines carry file/step, artwork stream ends in a
  result, stamp returns spectrum progress while it runs.
- Stages: the move select and `jobs.move` refuse 10_ORDERS; a job put
  there by hand is reported on the overview and still opens.
- Manual: open a job, watch the status line walk through audio,
  waveform, artwork, spectrum to idle; section links scroll without
  re-checking; reload keeps the section.
