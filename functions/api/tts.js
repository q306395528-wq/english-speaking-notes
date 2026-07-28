const MODEL = "@cf/deepgram/aura-2-en";
const VOICES = Object.freeze({
  female: "luna",
  male: "apollo",
});
const CACHE_VERSION = "v2";
const MAX_DAYS = 5000;
const MAX_LESSONS_PER_DAY = 500;

function jsonError(message, status) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
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

async function handleGet(context) {
  const requestUrl = new URL(context.request.url);
  const date = requestUrl.searchParams.get("date") || "";
  const id = requestUrl.searchParams.get("id") || "";
  const voice = requestUrl.searchParams.get("voice") || "female";
  const speaker = VOICES[voice];

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
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
    const cacheUrl = new URL(
      `/__tts-cache/${CACHE_VERSION}/${voice}/${date}/${id}-${textHash}.mp3`,
      requestUrl.origin,
    );
    const cacheKey = new Request(cacheUrl);
    const cached = await caches.default.match(cacheKey);

    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-TTS-Cache", "HIT");
      return new Response(cached.body, {
        status: cached.status,
        headers,
      });
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
      console.error(
        JSON.stringify({
          message: "TTS generation failed",
          model: MODEL,
          status: aiResponse.status,
          lessonId: id,
          voice,
        }),
      );
      return jsonError("Natural voice is temporarily unavailable", 503);
    }

    const headers = new Headers(aiResponse.headers);
    headers.set("Content-Type", "audio/mpeg");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-TTS-Cache", "MISS");
    headers.set("X-TTS-Voice", voice);
    const response = new Response(aiResponse.body, { status: 200, headers });

    context.waitUntil(
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
    );

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
