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

// Steps shown in the send panel and copied as plain text, for one
// option. A direct (browser-to-browser, e.g. FilePizza) service stores
// nothing: the customer sends its link and keeps the tab open until the
// plant has the file.
export function transferInstructions(transfer, fileName, option = transferOptions(transfer)[0]){
  const steps = [`File saved: ${fileName}`];
  if(option.dropLink) steps.push(`Open ${option.url} and upload the file`);
  else if(option.direct) steps.push(
    `Open ${option.url} and drop the file in`,
    `Send the link it shows to: ${transfer.uploadEmail}`,
    "Keep that tab open until the plant has downloaded the file"
  );
  else steps.push(`Open ${option.url} and upload the file`, `Send it to: ${transfer.uploadEmail}`);
  return steps;
}
