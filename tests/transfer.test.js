import { test } from "node:test";
import assert from "node:assert/strict";
import { transferLink, transferInstructions } from "../src/lib/transfer.js";

const withUploadUrl = {
  uploadUrl: "https://cloud.plant.example/s/AbCd1234",
  uploadServiceUrl: "https://www.swisstransfer.com/",
  uploadEmail: "cutting@example.com"
};

const withoutUploadUrl = {
  uploadUrl: "",
  uploadServiceUrl: "https://www.swisstransfer.com/",
  uploadEmail: "cutting@example.com"
};

test("transferLink prefers a direct upload link when set", () => {
  assert.equal(transferLink(withUploadUrl), "https://cloud.plant.example/s/AbCd1234");
});

test("transferLink falls back to the service homepage when no direct link is set", () => {
  assert.equal(transferLink(withoutUploadUrl), "https://www.swisstransfer.com/");
});

test("transferInstructions omits the recipient step when there's a direct upload link", () => {
  const steps = transferInstructions(withUploadUrl, "PNKRCK007.zip");
  assert.deepEqual(steps, [
    "File saved: PNKRCK007.zip",
    "Open https://cloud.plant.example/s/AbCd1234 and upload the file"
  ]);
});

test("transferInstructions adds a recipient step when there's no direct upload link", () => {
  const steps = transferInstructions(withoutUploadUrl, "PNKRCK007.zip");
  assert.deepEqual(steps, [
    "File saved: PNKRCK007.zip",
    "Open https://www.swisstransfer.com/ and upload the file",
    "Send it to: cutting@example.com"
  ]);
});
