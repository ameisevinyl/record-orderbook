// Pure logic for the "Send" panel's handoff instructions — no DOM. See
// CONFIG.plant.transfer (plant.config.local.example.js) for its shape.

// A plant's own drop-link (e.g. a Nextcloud File Request) routes the
// file by itself and is then the only option. Otherwise the customer
// picks one of the configured transfer services.
export function transferOptions(transfer){
  return transfer.uploadUrl
    ? [{name: "upload page", url: transfer.uploadUrl, dropLink: true}]
    : transfer.services;
}

// The send panel's line under "File saved": where to go, and the
// address to send to (shown with a copy button) unless the plant's own
// drop-link routes the file by itself.
export function transferPrompt(transfer){
  if(transfer.uploadUrl) return {text: "Open the upload page below and upload the file", email: null};
  const which = transfer.services.length > 1 ? "one of the transfer services" : "the transfer service";
  return {text: `Open ${which} below and send to`, email: transfer.uploadEmail};
}
