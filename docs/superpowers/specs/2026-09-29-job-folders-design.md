# Job folders, file versions, check cache — design

Status: approved in conversation 2026-09-29, built on branch `job-folders`.
Replaces the plant view's upload-and-wipe `plant/work/` flow.

## Context

A small workgroup (Mac/Linux on disk, Windows via the plant view) runs
orders on a plain folder tree that may live on a local disk, a NAS or
in Nextcloud. Symlinks and a folder per department were considered and
dropped: sync tools (Nextcloud) and mixed OS/file servers don't carry
links. So: few folders, and everything else in `project.json`.

## Layout

```
<jobs root>/                    server --jobs, default plant/jobs/
  00_INBOX/                     received zips + new job folders
  10_ORDERS/10_PREPRESS/<job>/  sub-stages are cosmetic
  10_ORDERS/20_PRESS/<job>/
  20_DONE/<job>/
  99_ARCHIVE/<job>.zip          archive.py (cron), after N days in DONE
<job>/ = <YYMMDD>_<catalogue#>_<email>/
  project.json  order_summary.txt  tracklist.txt  <cat>_…_v<N>.<ext>
  .checks/                      facts cache + previews; never listed or zipped
```

- A stage is any `NN_NAME` folder, plus one level of `NN_NAME` below;
  a folder holding `project.json` in a stage is a job. The server
  creates the default set only in an empty root.
- Moving = moving the folder, by button, Finder or `mv`. `project.json`
  keeps `plant.stage`; every board scan compares it with where the job
  is and appends a history entry (`by: "disk"`, or `"plant"` for
  buttons), so moves made on disk are logged too.
- Job names are unique across the tree; the board flags a job found in
  two stages.

## Several people on one job

- Never overwrite. A staff fix is saved by hand as the next version
  (`…_labels_A_v2.pdf`); the job view lists it as a newer version, one
  click makes it the slot's file. Files no slot knows (`cover_final.pdf`,
  sync conflict copies) are listed as not assigned, with a slot select;
  assigning renames to the slot's next version.
- A customer resend arrives as a new zip in the inbox. Jobs with the
  same catalogue number are offered for a merge (`mergeResend`): per
  slot, content already present as a version of that name keeps the
  job's choice (a staff fix survives an unchanged resend); changed
  content is copied in as the next version. Form fields come from the
  new project, `plant` and `history` from the job; the text files are
  replaced. Or it becomes a new job.
- `project.json` writes send the sha256 the page read; changed on disk
  meanwhile → 409, the page shows it and the user reloads. Written via
  temp file + rename.

## Checks

- The browser rules run on every load. Python facts are cached per file
  in `.checks/audio.json` / `artwork.json`: size+mtime equal → reused;
  else sha256 decides (a sync touch costs a hash, not a check). Artwork
  params (ink limit, sizes) and `CHECKS_VERSION` are part of the key.
  Previews of files no longer checked are removed.

## Split

Python (`plant/jobs.py`, `server.py`, `archive.py`) only reads and writes
the disk; the page decides names and merges (`src/lib/versions.js`) and
renders (`src/lib/plant-board.js`, `plant-overview.js`).

## Later

- Per-department task list in `project.json` (`plant.tasks`).
- Adding a file to an empty slot from the plant view.
