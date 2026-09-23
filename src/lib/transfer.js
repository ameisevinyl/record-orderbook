// Pure logic for the "Send" panel's handoff instructions — no DOM. See
// CONFIG.plant.transfer in config.js for the shape `transfer` takes
// here.

// Where the "open" step should point: a specific, already-targeted
// drop-link if the plant configured one (e.g. a Nextcloud File Request
// URL) — that alone is the whole flow, open it and drop the file in.
// Otherwise falls back to the transfer service's plain homepage
// (SwissTransfer-style), where the customer starts a new transfer and
// types the recipient themselves.
export function transferLink(transfer){
  return transfer.uploadUrl || transfer.uploadServiceUrl;
}

// Ordered steps shown in the send panel and copied as plain text. The
// "send it to <email>" step only applies when there's no direct upload
// link — a pre-targeted drop-link already routes the file, so naming a
// recipient would be redundant.
export function transferInstructions(transfer, fileName){
  const steps = [
    `File saved: ${fileName}`,
    `Open ${transferLink(transfer)} and upload the file`
  ];
  if(!transfer.uploadUrl){
    steps.push(`Send it to: ${transfer.uploadEmail}`);
  }
  return steps;
}
