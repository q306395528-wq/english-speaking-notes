const MODEL = "@cf/openai/whisper-large-v3-turbo";
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-m4a",
]);

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readBoundedBody(request) {
  if (!request.body) {
    return null;
  }

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_AUDIO_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (!total) {
    return null;
  }

  const audio = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return audio;
}

function toBase64(audio) {
  const chunkSize = 32 * 1024;
  let binary = "";
  for (let offset = 0; offset < audio.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(
      ...audio.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

async function handlePost(context) {
  const requestUrl = new URL(context.request.url);
  const origin = context.request.headers.get("Origin");
  const fetchSite = context.request.headers.get("Sec-Fetch-Site");
  if (
    fetchSite === "cross-site" ||
    (origin && origin !== requestUrl.origin)
  ) {
    return jsonResponse({ error: "Cross-site requests are not allowed" }, 403);
  }

  const contentType = (context.request.headers.get("Content-Type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const contentLength = Number(
    context.request.headers.get("Content-Length") || "0",
  );

  if (!AUDIO_TYPES.has(contentType)) {
    return jsonResponse({ error: "Unsupported audio format" }, 415);
  }
  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > MAX_AUDIO_BYTES
  ) {
    return jsonResponse({ error: "Audio is too large" }, 413);
  }

  try {
    const audio = await readBoundedBody(context.request);
    if (!audio) {
      return jsonResponse({ error: "Audio is empty or too large" }, 413);
    }

    const result = await context.env.AI.run(MODEL, {
      audio: toBase64(audio),
      task: "transcribe",
      language: "en",
      vad_filter: true,
      condition_on_previous_text: false,
      initial_prompt: "A short English speaking practice answer.",
    });
    const text = String(result?.text || "").trim();

    if (!text) {
      return jsonResponse(
        { error: "No English speech was recognized" },
        422,
      );
    }

    return jsonResponse({
      text,
      duration: result.transcription_info?.duration,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Speech transcription failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return jsonResponse(
      { error: "Speech recognition is temporarily unavailable" },
      503,
    );
  }
}

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  return handlePost(context);
}
