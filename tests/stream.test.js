import { test } from "node:test";
import assert from "node:assert/strict";
import { readStream } from "../src/lib/stream.js";

const lines = (...objects) => new Response(objects.map(o => JSON.stringify(o) + "\n").join(""));

test("steps go to the callback, the result is returned", async () => {
  const steps = [];
  const result = await readStream(lines({step: "a", index: 1}, {step: "b", index: 2}, {result: {n: 5}}), s => steps.push(s.step));
  assert.deepEqual([steps, result], [["a", "b"], {n: 5}]);
});

test("an error line throws its message", async () => {
  await assert.rejects(readStream(lines({step: "a"}, {error: "boom"}), () => {}), /boom/);
});

test("a stream that ends without a result throws", async () => {
  await assert.rejects(readStream(lines({step: "a"}), () => {}), /ended without a result/);
});

test("a line split across chunks is read whole", async () => {
  const body = new ReadableStream({start(controller){
    const encode = text => new TextEncoder().encode(text);
    controller.enqueue(encode('{"step":"a"}\n{"res'));
    controller.enqueue(encode('ult":1}\n'));
    controller.close();
  }});
  assert.equal(await readStream(new Response(body), () => {}), 1);
});
