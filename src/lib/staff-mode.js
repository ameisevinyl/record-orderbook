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

// The staff's page marks its body (src/staff.js). Not the address: a plant
// may host the customer's page under any path, /order/ included.
export const isStaffPage = () => typeof document !== "undefined" && document.body.classList.contains("staff");

// The customer reopens a project without its files and picks them again;
// the plant reads the names, its files are in the job folder.
export const reselectNote = (staff = isStaffPage()) => staff ? "" : RESELECT;

export const storedFileText = (name, staff = isStaffPage()) => `file: ${name}` + (staff ? "" : ` — ${RESELECT}`);
