// File versions in a plant job folder. Files are never overwritten: a
// fix or a resent file becomes the next _v<N> of its slot's name, and
// project.json's slot names point at the version that counts. Pure —
// plant/jobs.py does the renames and copies the page decides here.

import { fileSlots, setAt, historyEntry } from "./project.js";
import { fileExt } from "./package-naming.js";

// The package's own text files; replaced on a resend, never versioned.
export const TEXT_FILES = ["order_summary.txt", "tracklist.txt"];

// "X_labels_A_v2.pdf" → {base: "X_labels_A", version: 2, ext: ".pdf"};
// null for a name without _v<N>.
export function versionOf(name){
  const m = /^(.+)_v(\d+)(\.[^.]*)?$/.exec(name || "");
  return m ? {base: m[1], version: Number(m[2]), ext: m[3] || ""} : null;
}

// base_v<highest + 1><ext>, over names of any extension.
export function nextVersionName(base, ext, names){
  const highest = Math.max(0, ...names.map(versionOf).filter(v => v && v.base === base).map(v => v.version));
  return `${base}_v${highest + 1}${ext}`;
}

// The name a file gets when staff make it a slot's file: kept if it is
// already a version of that slot (saved by hand as _v2), else the next one.
export function assignedName(slotName, fileName, names){
  const slot = versionOf(slotName);
  const file = versionOf(fileName);
  if(!slot || (file && file.base === slot.base)) return fileName;
  return nextVersionName(slot.base, fileExt(fileName), names);
}

// Per filled slot: its other versions in the folder, newer ones marked;
// plus the files no slot knows (hand-dropped, sync conflict copies).
export function jobFiles(project, files){
  const names = files.map(f => f.name);
  const slots = fileSlots(project).filter(slot => slot.name);
  const bases = new Set(slots.map(slot => (versionOf(slot.name) || {}).base).filter(Boolean));
  const referenced = new Set(slots.map(slot => slot.name));
  return {
    slots: slots.map(slot => {
      const own = versionOf(slot.name);
      const others = own ? names.filter(n => n !== slot.name && (versionOf(n) || {}).base === own.base) : [];
      return {...slot, present: names.includes(slot.name),
        others: others.map(name => ({name, newer: versionOf(name).version > own.version}))
          .sort((a, b) => versionOf(b.name).version - versionOf(a.name).version)};
    }),
    unassigned: names.filter(n => !referenced.has(n) && !TEXT_FILES.includes(n)
      && !bases.has((versionOf(n) || {}).base))
  };
}

// A resend (new zip or folder from the customer) into an existing job.
// Per slot of the new project: content the job has, or had when it came
// in (plant.received — a fix may have been saved over it), is no change
// → the job's choice stays; else it's copied in as the next version.
// Form fields come from the new project, plant state and history from
// the job. oldFiles/newFiles: [{name, sha256}].
export function mergeResend(oldProject, oldFiles, newProject, newFiles, date = new Date()){
  const project = structuredClone(newProject);
  const names = oldFiles.map(f => f.name);
  const hashOf = new Map(newFiles.map(f => [f.name, f.sha256]));
  const plant = oldProject.plant || {};
  const received = {...plant.received};
  const oldSlots = fileSlots(oldProject).filter(slot => slot.name);
  const copies = [];
  const changed = [];
  for(const slot of fileSlots(project)){
    const own = versionOf(slot.name);
    if(!own || !hashOf.has(slot.name)) continue;
    const hash = hashOf.get(slot.name);
    const family = name => (versionOf(name) || {}).base === own.base;
    const same = oldFiles.find(f => family(f.name) && f.sha256 === hash);
    const came = Object.keys(received).some(name => family(name) && received[name] === hash);
    const chosen = oldSlots.find(s => family(s.name));
    const keep = (same || came) && (chosen ? chosen.name : same && same.name);
    if(keep){
      setAt(project, slot.path, keep);
      continue;
    }
    const to = nextVersionName(own.base, own.ext, names);
    names.push(to);
    received[to] = hash;
    copies.push({from: slot.name, to});
    setAt(project, slot.path, to);
    changed.push(`${slot.title} → ${to}`);
  }
  project.plant = {...plant, received};
  project.history = [...(Array.isArray(oldProject.history) ? oldProject.history : []),
    historyEntry(`resend: ${changed.join(", ") || "no file changes"}`, date)];
  return {project, copies, changed};
}
