// The staff's order view is the customer page served at /order/<job>
// (plant/server.py); src/staff.js fills it from the job folder.

export const orderUrl = job => `/order/${encodeURIComponent(job)}`;

// The job of an /order/<job> path, else null (the customer's own page).
export function staffJob(pathname = location.pathname){
  const [, job] = /^\/order\/([^/]+)$/.exec(pathname) || [];
  if(!job) return null;
  try{
    return decodeURIComponent(job);
  }catch{
    return null;
  }
}

const RESELECT = "please re-select this file (not stored in the order file)";

// The customer reopens a project without its files and picks them again;
// the plant reads the names, its files are in the job folder.
export const reselectNote = (staff = staffJob() !== null) => staff ? "" : RESELECT;

export const storedFileText = (name, staff = staffJob() !== null) => `file: ${name}` + (staff ? "" : ` — ${RESELECT}`);
