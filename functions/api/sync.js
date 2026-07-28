const MAX_BODY_BYTES = 600_000;
const MAX_PROGRESS_BYTES = 550_000;
const MAX_VOICE_BYTES = 10_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return fetchSite !== "cross-site" && (!origin || origin === url.origin);
}

function readToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : "";
}

async function tokenHash(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function parseStoredJson(value) {
  try {
    return parseObject(JSON.parse(value || "{}")) || {};
  } catch {
    return {};
  }
}

async function readBoundedJson(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_BODY_BYTES
  ) {
    return null;
  }

  const text = await request.text();
  if (!text || new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return null;
  }

  try {
    return parseObject(JSON.parse(text));
  } catch {
    return null;
  }
}

async function handleGet(context, profileId) {
  const row = await context.env.SYNC_DB
    .prepare(
      `SELECT progress_json, voice_json, revision, updated_at
       FROM cloud_profiles
       WHERE profile_id = ?`,
    )
    .bind(profileId)
    .first();

  if (!row) {
    return jsonResponse({ exists: false }, 404);
  }

  return jsonResponse({
    exists: true,
    progress: parseStoredJson(row.progress_json),
    voice: parseStoredJson(row.voice_json),
    revision: Number(row.revision) || 1,
    updatedAt: row.updated_at,
  });
}

async function handlePut(context, profileId) {
  if (!sameOrigin(context.request)) {
    return jsonResponse({ error: "Cross-site requests are not allowed" }, 403);
  }

  const contentType = (context.request.headers.get("Content-Type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return jsonResponse({ error: "Content-Type must be application/json" }, 415);
  }

  const body = await readBoundedJson(context.request);
  const progress = parseObject(body?.progress);
  const voice = parseObject(body?.voice);
  if (!progress || !voice) {
    return jsonResponse({ error: "Invalid sync payload" }, 400);
  }

  const progressJson = JSON.stringify(progress);
  const voiceJson = JSON.stringify(voice);
  if (
    new TextEncoder().encode(progressJson).byteLength > MAX_PROGRESS_BYTES ||
    new TextEncoder().encode(voiceJson).byteLength > MAX_VOICE_BYTES
  ) {
    return jsonResponse({ error: "Sync payload is too large" }, 413);
  }

  await context.env.SYNC_DB
    .prepare(
      `INSERT INTO cloud_profiles (
         profile_id, progress_json, voice_json, revision, updated_at
       ) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(profile_id) DO UPDATE SET
         progress_json = excluded.progress_json,
         voice_json = excluded.voice_json,
         revision = cloud_profiles.revision + 1,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(profileId, progressJson, voiceJson)
    .run();

  const row = await context.env.SYNC_DB
    .prepare(
      `SELECT revision, updated_at
       FROM cloud_profiles
       WHERE profile_id = ?`,
    )
    .bind(profileId)
    .first();

  return jsonResponse({
    ok: true,
    revision: Number(row?.revision) || 1,
    updatedAt: row?.updated_at || new Date().toISOString(),
  });
}

export async function onRequest(context) {
  if (!context.env.SYNC_DB) {
    return jsonResponse({ error: "Cloud sync is not configured" }, 503);
  }

  const token = readToken(context.request);
  if (!token) {
    return jsonResponse({ error: "A valid sync code is required" }, 401);
  }
  const profileId = await tokenHash(token);

  try {
    if (context.request.method === "GET") {
      return handleGet(context, profileId);
    }
    if (context.request.method === "PUT") {
      return handlePut(context, profileId);
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Cloud sync failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return jsonResponse({ error: "Cloud sync is temporarily unavailable" }, 503);
  }
}
