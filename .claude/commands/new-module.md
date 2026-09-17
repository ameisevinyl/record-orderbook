Scaffold a new artifact-type module (e.g. labels, cover-sleeve, shipping-billing).

Ask which module to create if not given as an argument. Then:

1. Create `src/modules/<name>.js` following the pattern in
   `src/modules/tracklist.js`: import `CONFIG` from `../config.js` and
   whatever pure helpers from `src/lib/` it needs; export a single
   `init<Name>()` function that wires up DOM events; keep all pure/
   testable logic in `src/lib/` instead, not inline in the module.
2. Add its markup section to `src/index.html` (mirror the structure of
   the existing `<fieldset>`/`<div class="side-box">` sections — same
   CSS classes, same visual language, no new colors or fonts).
3. Wire it into `src/app.js`: import and call `init<Name>()` alongside
   `initTracklist()`.
4. If the module needs new pure logic (e.g. a new file-format parser,
   a new calculation), write it in `src/lib/<name>.js` first, with a
   matching `tests/<name>.test.js`, before touching the DOM-facing code.
5. Add the new lib/module file paths to the `FILES` array in
   `build/build.js`, in dependency order (deps before dependents).
6. Run `node --test tests/*.test.js` and `node build/build.js` — both
   must pass before considering this done.

Follow CLAUDE.md's constraints throughout: no runtime dependencies, no
build tooling beyond plain Node, KISS.
