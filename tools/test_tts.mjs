import assert from "node:assert/strict";
import { onRequest } from "../functions/api/tts.js";

const edgeCache = new Map();
globalThis.caches = {
  default: {
    async match(request) {
      const response = edgeCache.get(request.url);
      return response?.clone();
    },
    async put(request, response) {
      edgeCache.set(request.url, response.clone());
    },
  },
};

function createBucket() {
  const objects = new Map();
  return {
    objects,
    async get(key) {
      const value = objects.get(key);
      if (!value) return null;
      return {
        body: new Response(value.bytes).body,
        etag: value.etag,
        httpEtag: `"${value.etag}"`,
        httpMetadata: value.httpMetadata,
      };
    },
    async put(key, body, options = {}) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, {
        bytes,
        etag: "test-etag",
        httpMetadata: options.httpMetadata || {},
      });
    },
  };
}

function createD1() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (!sql.includes("hex(audio_data)")) return null;
              const row = rows.get(values[0]);
              if (!row) return null;
              return {
                content_type: row.content_type,
                byte_length: row.byte_length,
                audio_hex: [...new Uint8Array(row.audio_data)]
                  .map((byte) => byte.toString(16).padStart(2, "0"))
                  .join(""),
              };
            },
            async run() {
              if (!sql.includes("INSERT INTO tts_audio")) {
                throw new Error("Unexpected D1 statement");
              }
              const [
                audioKey,
                audioData,
                contentType,
                byteLength,
                voice,
                lessonDate,
                lessonId,
                textHash,
              ] = values;
              rows.set(audioKey, {
                audio_data: audioData.slice(0),
                content_type: contentType,
                byte_length: byteLength,
                voice,
                lesson_date: lessonDate,
                lesson_id: lessonId,
                text_hash: textHash,
              });
              return { success: true };
            },
          };
        },
      };
    },
  };
}

function createContext(bucket, d1 = null) {
  const waits = [];
  return {
    waits,
    context: {
      request: new Request(
        "https://example.com/api/tts?date=2026-07-30&id=lesson-one&voice=female",
      ),
      env: {
        AUDIO_BUCKET: bucket,
        SYNC_DB: d1,
        ASSETS: {
          async fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === "/data/index.json") {
              return Response.json({
                days: [
                  {
                    date: "2026-07-30",
                    file: "2026-07-30.json",
                  },
                ],
              });
            }
            if (path === "/data/2026-07-30.json") {
              return Response.json({
                date: "2026-07-30",
                lessons: [
                  {
                    id: "lesson-one",
                    english: "Cloud audio is ready.",
                  },
                ],
              });
            }
            return new Response(null, { status: 404 });
          },
        },
        AI: {
          async run() {
            return new Response(new Uint8Array([1, 2, 3, 4]), {
              headers: { "Content-Type": "audio/mpeg" },
            });
          },
        },
      },
      waitUntil(promise) {
        waits.push(promise);
      },
    },
  };
}

const bucket = createBucket();
let run = createContext(bucket);
let response = await onRequest(run.context);
assert.equal(response.status, 200);
assert.equal(response.headers.get("X-TTS-Storage"), "GENERATED");
await response.arrayBuffer();
await Promise.all(run.waits);
assert.equal(bucket.objects.size, 1);

edgeCache.clear();
run = createContext(bucket);
response = await onRequest(run.context);
assert.equal(response.status, 200);
assert.equal(response.headers.get("X-TTS-Storage"), "R2");
assert.deepEqual(
  [...new Uint8Array(await response.arrayBuffer())],
  [1, 2, 3, 4],
);

console.log("OK: generated AI audio is persisted to and restored from R2.");

edgeCache.clear();
const d1 = createD1();
run = createContext(null, d1);
response = await onRequest(run.context);
assert.equal(response.status, 200);
assert.equal(response.headers.get("X-TTS-Storage"), "GENERATED");
await response.arrayBuffer();
await Promise.all(run.waits);
assert.equal(d1.rows.size, 1);

edgeCache.clear();
run = createContext(null, d1);
response = await onRequest(run.context);
assert.equal(response.status, 200);
assert.equal(response.headers.get("X-TTS-Storage"), "D1");
assert.deepEqual(
  [...new Uint8Array(await response.arrayBuffer())],
  [1, 2, 3, 4],
);

console.log("OK: generated AI audio is persisted to and restored from D1.");
