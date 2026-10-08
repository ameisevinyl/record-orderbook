import { test } from "node:test";
import assert from "node:assert/strict";
import { transferOptions, transferPrompt } from "../src/lib/transfer.js";

const services = [
  { name: "SwissTransfer", url: "https://www.swisstransfer.com/" },
  { name: "FilePizza", url: "https://file.pizza/" }
];
const withUploadUrl = { uploadUrl: "https://cloud.plant.example/s/AbCd1234", services, uploadEmail: "cutting@example.com" };
const withoutUploadUrl = { uploadUrl: "", services, uploadEmail: "cutting@example.com" };

test("transferOptions: a direct upload link is the only option", () => {
  assert.deepEqual(transferOptions(withUploadUrl),
    [{ name: "upload page", url: "https://cloud.plant.example/s/AbCd1234", dropLink: true }]);
});

test("transferOptions: without one, the configured services", () => {
  assert.deepEqual(transferOptions(withoutUploadUrl), services);
});

test("transferPrompt: services name the recipient, whose address gets a copy button", () => {
  assert.deepEqual(transferPrompt(withoutUploadUrl),
    { text: "Open one of the transfer services below and send to", email: "cutting@example.com" });
  assert.deepEqual(transferPrompt({ ...withoutUploadUrl, services: services.slice(0, 1) }),
    { text: "Open the transfer service below and send to", email: "cutting@example.com" });
});

test("transferPrompt: a direct upload link needs no recipient", () => {
  assert.deepEqual(transferPrompt(withUploadUrl),
    { text: "Open the upload page below and upload the file", email: null });
});
