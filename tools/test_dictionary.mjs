import assert from "node:assert/strict";
import { onRequest } from "../functions/api/dictionary.js";

const cache = new Map();
globalThis.caches = {
  default: {
    async match(request) {
      const response = cache.get(request.url);
      return response ? response.clone() : undefined;
    },
    async put(request, response) {
      cache.set(request.url, response.clone());
    },
  },
};

let fetchCount = 0;
globalThis.fetch = async (url) => {
  fetchCount += 1;
  const word = decodeURIComponent(new URL(url).pathname.split("/").pop());
  if (word === "missing") {
    return Response.json({}, { status: 404 });
  }
  return Response.json([
    {
      word,
      phonetic: "həˈləʊ",
      phonetics: [
        {
          text: "həˈləʊ",
          audio: "//example.com/hello.mp3",
        },
      ],
      meanings: [
        {
          partOfSpeech: "exclamation",
          definitions: [
            {
              definition: "Used as a greeting.",
              example: "Hello there!",
            },
          ],
        },
      ],
    },
  ]);
};

async function request(word, method = "GET") {
  const pending = [];
  const response = await onRequest({
    request: new Request(
      `https://example.com/api/dictionary?word=${encodeURIComponent(word)}`,
      { method },
    ),
    waitUntil(promise) {
      pending.push(promise);
    },
  });
  await Promise.all(pending);
  return response;
}

const first = await request("Hello");
assert.equal(first.status, 200);
assert.equal(first.headers.get("X-Dictionary-Cache"), "MISS");
assert.deepEqual(await first.json(), {
  word: "hello",
  phonetic: "həˈləʊ",
  audio: "https://example.com/hello.mp3",
  meanings: [
    {
      partOfSpeech: "exclamation",
      definitions: [
        {
          definition: "Used as a greeting.",
          example: "Hello there!",
        },
      ],
    },
  ],
});

const cached = await request("hello");
assert.equal(cached.status, 200);
assert.equal(cached.headers.get("X-Dictionary-Cache"), "HIT");
assert.equal(fetchCount, 1);

assert.equal((await request("123")).status, 400);
assert.equal((await request("missing")).status, 404);
assert.equal((await request("hello", "POST")).status, 405);

console.log("OK: dictionary validation, normalization, caching, and errors.");
