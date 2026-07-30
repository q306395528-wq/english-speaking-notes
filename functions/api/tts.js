import { loadGoogleSheetsPack } from "../_lib/google-sheets.js";

const MODEL = "@cf/deepgram/aura-2-en";
const VOICES = Object.freeze({
  female: "luna",
  male: "apollo",
});
const CACHE_VERSION = "v2";
const R2_PREFIX = "english-speaking-notes/tts";
const MAX_DAYS = 5000;
const MAX_LESSONS_PER_DAY = 500;

function jsonError(message, status, extraHeaders = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  Object.entries(extraHeaders).forEach(([name, value]) => {
    if (value) headers.set(name, String(value));
  });
  return Response.json(
    { error: message },
    {
      status,
      headers,
    },
  );
}

async function fetchJsonAsset(context, path) {
  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = path;
  assetUrl.search = "";

  const response = await context.env.ASSETS.fetch(
    new Request(assetUrl, {
      headers: { Accept: "application/json" },
    }),
  );

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function findLesson(context, date, id) {
  if (date === "google-sheets") {
    const pack = await loadGoogleSheetsPack(context);
    const lesson = pack.lessons.find((item) => item?.id === id);
    if (
      !lesson ||
      typeof lesson.english !== "string" ||
      lesson.english.length < 1 ||
      lesson.english.length > 500
    ) {
      return null;
    }
    return lesson;
  }

  const index = await fetchJsonAsset(context, "/data/index.json");
  if (
    !index ||
    !Array.isArray(index.days) ||
    index.days.length > MAX_DAYS
  ) {
    throw new Error("Invalid lesson index");
  }

  const day = index.days.find((item) => item?.date === date);
  if (
    !day ||
    typeof day.file !== "string" ||
    !/^\d{4}-\d{2}-\d{2}\.json$/.test(day.file) ||
    day.file !== `${date}.json`
  ) {
    return null;
  }

  const pack = await fetchJsonAsset(context, `/data/${day.file}`);
  if (
    !pack ||
    pack.date !== date ||
    !Array.isArray(pack.lessons) ||
    pack.lessons.length > MAX_LESSONS_PER_DAY
  ) {
    throw new Error("Invalid lesson file");
  }

  const lesson = pack.lessons.find((item) => item?.id === id);
  if (
    !lesson ||
    typeof lesson.english !== "string" ||
    lesson.english.length < 1 ||
    lesson.english.length > 500
  ) {
    return null;
  }

  return lesson;
}

async function hashText(text) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readD1Audio(context, objectKey) {
  if (!context.env.SYNC_DB) return null;
  try {
    return await context.env.SYNC_DB
      .prepare(
        `SELECT hex(audio_data) AS audio_hex, content_type, byte_length
         FROM tts_audio
         WHERE audio_key = ?`,
      )
      .bind(objectKey)
      .first();
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "TTS D1 read failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

function decodeHexAudio(value) {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(value)
  ) {
    return null;
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function writeD1Audio(context, objectKey, response, metadata) {
  if (!context.env.SYNC_DB) return;
  const audioData = await response.arrayBuffer();
  await context.env.SYNC_DB
    .prepare(
      `INSERT INTO tts_audio (
         audio_key, audio_data, content_type, byte_length,
         voice, lesson_date, lesson_id, text_hash, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(audio_key) DO UPDATE SET
         audio_data = excluded.audio_data,
         content_type = excluded.content_type,
         byte_length = excluded.byte_length,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      objectKey,
      audioData,
      "audio/mpeg",
      audioData.byteLength,
      metadata.voice,
      metadata.date,
      metadata.lessonId,
      metadata.textHash,
    )
    .run();
}

function logDurableWriteFailure(message, error, lessonId, voice) {
  console.error(
    JSON.stringify({
      message,
      error: error instanceof Error ? error.message : String(error),
      lessonId,
      voice,
    }),
  );
}

async function handleGet(context) {
  const requestUrl = new URL(context.request.url);
  const date = requestUrl.searchParams.get("date") || "";
  const id = requestUrl.searchParams.get("id") || "";
  const voice = requestUrl.searchParams.get("voice") || "female";
  const speaker = VOICES[voice];

  if (
    !(date === "google-sheets" || /^\d{4}-\d{2}-\d{2}$/.test(date)) ||
    !/^[a-z0-9][a-z0-9-]{0,119}$/.test(id) ||
    !speaker
  ) {
    return jsonError("Invalid lesson reference", 400);
  }

  try {
    const lesson = await findLesson(context, date, id);
    if (!lesson) {
      return jsonError("Lesson not found", 404);
    }

    const textHash = await hashText(lesson.english);
    const objectKey =
      `${R2_PREFIX}/${CACHE_VERSION}/${voice}/${date}/${id}-${textHash}.mp3`;
    const cacheUrl = new URL(
      `/__tts-cache/${CACHE_VERSION}/${voice}/${date}/${id}-${textHash}.mp3`,
      requestUrl.origin,
    );
    const cacheKey = new Request(cacheUrl);

    if (context.env.AUDIO_BUCKET) {
      try {
        const stored = await context.env.AUDIO_BUCKET.get(objectKey);
        if (stored?.body) {
          const headers = new Headers({
            "Content-Type": stored.httpMetadata?.contentType || "audio/mpeg",
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
            "X-TTS-Cache": "R2",
            "X-TTS-Storage": "R2",
            "X-TTS-Voice": voice,
            ETag: stored.httpEtag || stored.etag,
          });
          const response = new Response(stored.body, { status: 200, headers });
          context.waitUntil(
            caches.default.put(cacheKey, response.clone()).catch(() => {}),
          );
          return response;
        }
      } catch (error) {
        logDurableWriteFailure("TTS R2 read failed", error, id, voice);
      }
    }

    const storedInD1 = await readD1Audio(context, objectKey);
    const d1Audio = decodeHexAudio(storedInD1?.audio_hex);
    if (d1Audio) {
      const headers = new Headers({
        "Content-Type": storedInD1.content_type || "audio/mpeg",
        "Content-Length": String(d1Audio.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "X-TTS-Cache": "D1",
        "X-TTS-Storage": "D1",
        "X-TTS-Voice": voice,
      });
      const response = new Response(d1Audio, {
        status: 200,
        headers,
      });
      context.waitUntil(
        caches.default.put(cacheKey, response.clone()).catch(() => {}),
      );
      return response;
    }

    const cached = await caches.default.match(cacheKey);

    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-TTS-Cache", "HIT");
      headers.set("X-TTS-Storage", "EDGE");
      const response = new Response(cached.body, {
        status: cached.status,
        headers,
      });
      if (context.env.AUDIO_BUCKET) {
        context.waitUntil(
          context.env.AUDIO_BUCKET.put(objectKey, response.clone().body, {
            httpMetadata: {
              contentType: "audio/mpeg",
              cacheControl: "public, max-age=31536000, immutable",
            },
            customMetadata: { voice, date, lessonId: id, textHash },
          }).catch((error) => {
            console.error(
              JSON.stringify({
                message: "TTS R2 backfill failed",
                error: error instanceof Error ? error.message : String(error),
                lessonId: id,
                voice,
              }),
            );
          }),
        );
      }
      if (context.env.SYNC_DB) {
        context.waitUntil(
          writeD1Audio(context, objectKey, response.clone(), {
            voice,
            date,
            lessonId: id,
            textHash,
          }).catch((error) => {
            logDurableWriteFailure(
              "TTS D1 backfill failed",
              error,
              id,
              voice,
            );
          }),
        );
      }
      return response;
    }

    const aiResponse = await context.env.AI.run(
      MODEL,
      {
        text: lesson.english,
        speaker,
        encoding: "mp3",
      },
      { returnRawResponse: true },
    );

    if (!aiResponse.ok || !aiResponse.body) {
      const retryable = aiResponse.status === 429;
      const retryAfter = aiResponse.headers.get("Retry-After") || "300";
      console.error(
        JSON.stringify({
          message: "TTS generation failed",
          model: MODEL,
          status: aiResponse.status,
          lessonId: id,
          voice,
        }),
      );
      if (retryable) {
        return jsonError("AI voice service is busy", 429, {
          "Retry-After": retryAfter,
          "X-TTS-Retryable": "1",
        });
      }
      return jsonError("Natural voice is temporarily unavailable", 503);
    }

    const headers = new Headers(aiResponse.headers);
    headers.set("Content-Type", "audio/mpeg");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-TTS-Cache", "MISS");
    headers.set("X-TTS-Storage", "GENERATED");
    headers.set("X-TTS-Voice", voice);
    const response = new Response(aiResponse.body, { status: 200, headers });

    const writes = [
      caches.default.put(cacheKey, response.clone()).catch((error) => {
        console.error(
          JSON.stringify({
            message: "TTS cache write failed",
            error: error instanceof Error ? error.message : String(error),
            lessonId: id,
            voice,
          }),
        );
      }),
    ];
    if (context.env.AUDIO_BUCKET) {
      writes.push(
        context.env.AUDIO_BUCKET.put(objectKey, response.clone().body, {
          httpMetadata: {
            contentType: "audio/mpeg",
            cacheControl: "public, max-age=31536000, immutable",
          },
          customMetadata: { voice, date, lessonId: id, textHash },
        }).catch((error) => {
          console.error(
            JSON.stringify({
              message: "TTS R2 write failed",
              error: error instanceof Error ? error.message : String(error),
              lessonId: id,
              voice,
            }),
          );
        }),
      );
    }
    if (context.env.SYNC_DB) {
      writes.push(
        writeD1Audio(context, objectKey, response.clone(), {
          voice,
          date,
          lessonId: id,
          textHash,
        }).catch((error) => {
          logDurableWriteFailure("TTS D1 write failed", error, id, voice);
        }),
      );
    }
    context.waitUntil(Promise.all(writes));

    return response;
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "TTS request failed",
        error: error instanceof Error ? error.message : String(error),
        lessonId: id,
        voice,
      }),
    );
    return jsonError("Natural voice is temporarily unavailable", 503);
  }
}

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return jsonError("Method not allowed", 405);
  }

  return handleGet(context);
}
