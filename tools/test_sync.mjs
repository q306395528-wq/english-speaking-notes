import assert from "node:assert/strict";
import { onRequest } from "../functions/api/sync.js";

function createDatabase() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          const id = this.values[0];
          const row = rows.get(id);
          if (!row) return null;
          if (sql.includes("progress_json")) return { ...row };
          return { revision: row.revision, updated_at: row.updated_at };
        },
        async run() {
          const [id, progressJson, voiceJson] = this.values;
          const previous = rows.get(id);
          rows.set(id, {
            progress_json: progressJson,
            voice_json: voiceJson,
            revision: previous ? previous.revision + 1 : 1,
            updated_at: "2026-07-28 12:00:00",
          });
          return { success: true };
        },
      };
    },
  };
}

function request(method, token, body, headers = {}) {
  return new Request("https://english-speaking-notes.pages.dev/api/sync", {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const token = "a".repeat(43);
const db = createDatabase();
const env = { SYNC_DB: db };

let response = await onRequest({ request: request("GET"), env });
assert.equal(response.status, 401);

response = await onRequest({ request: request("GET", token), env });
assert.equal(response.status, 404);

response = await onRequest({
  request: request("PUT", token, {
    progress: { items: { sentence: { fav: true } }, history: {}, daily: {} },
    voice: { voice: "female", rate: 0.95 },
  }),
  env,
});
assert.equal(response.status, 200);
assert.equal((await response.json()).revision, 1);
assert.equal(db.rows.size, 1);
assert.equal([...db.rows.keys()][0].length, 64);
assert.equal([...db.rows.keys()][0].includes(token), false);

response = await onRequest({ request: request("GET", token), env });
assert.equal(response.status, 200);
const snapshot = await response.json();
assert.equal(snapshot.progress.items.sentence.fav, true);
assert.equal(snapshot.voice.rate, 0.95);

response = await onRequest({
  request: request(
    "PUT",
    token,
    { progress: {}, voice: {} },
    { Origin: "https://example.com" },
  ),
  env,
});
assert.equal(response.status, 403);

response = await onRequest({
  request: request("PUT", token, { progress: [], voice: {} }),
  env,
});
assert.equal(response.status, 400);

console.log("OK: cloud sync auth, hashing, validation, create, and restore.");
