import { test } from "node:test";
import assert from "node:assert/strict";
import { transferOptions, transferInstructions } from "../src/lib/transfer.js";

const services = [
  { name: "SwissTransfer", url: "https://www.swisstransfer.com/" },
  { name: "FilePizza", url: "https://file.pizza/", direct: true }
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

test("transferInstructions: a direct upload link needs no recipient", () => {
  assert.deepEqual(transferInstructions(withUploadUrl, "PNKRCK007.zip"), [
    "File saved: PNKRCK007.zip",
    "Open https://cloud.plant.example/s/AbCd1234 and upload the file"
  ]);
});

test("transferInstructions: a transfer service defaults to the first and names the recipient", () => {
  assert.deepEqual(transferInstructions(withoutUploadUrl, "PNKRCK007.zip"), [
    "File saved: PNKRCK007.zip",
    "Open https://www.swisstransfer.com/ and upload the file",
    "Send it to: cutting@example.com"
  ]);
});

test("transferInstructions: browser-to-browser sends the link and keeps the tab open", () => {
  assert.deepEqual(transferInstructions(withoutUploadUrl, "PNKRCK007.zip", services[1]), [
    "File saved: PNKRCK007.zip",
    "Open https://file.pizza/ and drop the file in",
    "Send the link it shows to: cutting@example.com",
    "Keep that tab open until the plant has downloaded the file"
  ]);
});
