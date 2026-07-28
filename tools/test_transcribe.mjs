import assert from "node:assert/strict";
import { onRequest } from "../functions/api/transcribe.js";

const url = "https://example.com/api/transcribe";

async function call({
  method = "POST",
  contentType = "audio/webm",
  bytes = new Uint8Array([1, 2, 3]),
  contentLength = bytes.byteLength,
  run = async () => ({
    text: "Traffic is moving smoothly.",
    transcription_info: { duration: 1.25 },
  }),
} = {}) {
  const request = new Request(url, {
    method,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(contentLength),
    },
    body: method === "POST" ? bytes : undefined,
  });
  const response = await onRequest({
    request,
    env: { AI: { run } },
  });
  return {
    response,
    body: await response.json(),
  };
}

{
  const { response } = await call({ method: "GET" });
  assert.equal(response.status, 405);
}

{
  const { response } = await call({ contentType: "text/plain" });
  assert.equal(response.status, 415);
}

{
  const { response } = await call({ contentLength: 2 * 1024 * 1024 + 1 });
  assert.equal(response.status, 413);
}

{
  const request = new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "audio/webm",
      "Content-Length": "3",
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    },
    body: new Uint8Array([1, 2, 3]),
  });
  const response = await onRequest({
    request,
    env: { AI: { run: async () => ({ text: "unused" }) } },
  });
  assert.equal(response.status, 403);
}

{
  let received;
  const { response, body } = await call({
    run: async (model, input) => {
      received = { model, input };
      return {
        text: "Traffic is moving smoothly.",
        transcription_info: { duration: 1.25 },
      };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(body.text, "Traffic is moving smoothly.");
  assert.equal(body.duration, 1.25);
  assert.equal(received.model, "@cf/openai/whisper-large-v3-turbo");
  assert.equal(received.input.language, "en");
  assert.equal(received.input.vad_filter, true);
  assert.equal(received.input.audio, "AQID");
}

{
  const { response } = await call({ run: async () => ({ text: "" }) });
  assert.equal(response.status, 422);
}

{
  const originalError = console.error;
  console.error = () => {};
  try {
    const { response } = await call({
      run: async () => {
        throw new Error("model unavailable");
      },
    });
    assert.equal(response.status, 503);
  } finally {
    console.error = originalError;
  }
}

console.log("OK: transcription validation, model input, and error handling.");
