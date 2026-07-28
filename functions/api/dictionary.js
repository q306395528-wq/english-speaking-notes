const API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const CACHE_VERSION = "v1";
const MAX_RESPONSE_BYTES = 500_000;

function jsonResponse(body, status, cacheControl = "no-store") {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function normalizeWord(value) {
  const word = value.trim().toLowerCase().replaceAll("’", "'");
  return /^[a-z]+(?:['-][a-z]+){0,2}$/.test(word) && word.length <= 64
    ? word
    : "";
}

function cleanText(value, maxLength) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function normalizeEntry(word, data) {
  const entries = Array.isArray(data) ? data : [];
  const entry = entries.find((item) => item && typeof item === "object");

  if (!entry) {
    return null;
  }

  const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
  const phonetic =
    cleanText(entry.phonetic, 100) ||
    phonetics.map((item) => cleanText(item?.text, 100)).find(Boolean) ||
    "";
  const audio =
    phonetics
      .map((item) => {
        const url = cleanText(item?.audio, 500);
        return url.startsWith("//") ? `https:${url}` : url;
      })
      .find((url) => /^https:\/\/.+/i.test(url)) || "";
  const meanings = (Array.isArray(entry.meanings) ? entry.meanings : [])
    .slice(0, 4)
    .map((meaning) => ({
      partOfSpeech: cleanText(meaning?.partOfSpeech, 50),
      definitions: (
        Array.isArray(meaning?.definitions) ? meaning.definitions : []
      )
        .slice(0, 3)
        .map((definition) => ({
          definition: cleanText(definition?.definition, 500),
          example: cleanText(definition?.example, 500),
        }))
        .filter((definition) => definition.definition),
    }))
    .filter((meaning) => meaning.definitions.length);

  if (!meanings.length) {
    return null;
  }

  return {
    word: cleanText(entry.word, 100) || word,
    phonetic,
    audio,
    meanings,
  };
}

async function lookupWord(context, word) {
  const cacheUrl = new URL(
    `/__dictionary-cache/${CACHE_VERSION}/${encodeURIComponent(word)}.json`,
    context.request.url,
  );
  const cacheKey = new Request(cacheUrl);
  const cached = await caches.default.match(cacheKey);

  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("X-Dictionary-Cache", "HIT");
    return new Response(cached.body, {
      status: cached.status,
      headers,
    });
  }

  const upstream = await fetch(`${API_BASE}${encodeURIComponent(word)}`, {
    headers: { Accept: "application/json" },
  });

  if (upstream.status === 404) {
    return jsonResponse({ error: "Word not found" }, 404, "public, max-age=300");
  }

  if (!upstream.ok) {
    return jsonResponse({ error: "Dictionary unavailable" }, 503);
  }

  const length = Number(upstream.headers.get("Content-Length") || 0);
  if (length > MAX_RESPONSE_BYTES) {
    return jsonResponse({ error: "Dictionary response too large" }, 502);
  }

  const raw = await upstream.text();
  if (raw.length > MAX_RESPONSE_BYTES) {
    return jsonResponse({ error: "Dictionary response too large" }, 502);
  }

  const entry = normalizeEntry(word, JSON.parse(raw));
  if (!entry) {
    return jsonResponse({ error: "Word not found" }, 404, "public, max-age=300");
  }

  const response = jsonResponse(
    entry,
    200,
    "public, max-age=86400, s-maxage=604800",
  );
  response.headers.set("X-Dictionary-Cache", "MISS");
  context.waitUntil(
    caches.default.put(cacheKey, response.clone()).catch((error) => {
      console.error(
        JSON.stringify({
          message: "Dictionary cache write failed",
          error: error instanceof Error ? error.message : String(error),
          word,
        }),
      );
    }),
  );
  return response;
}

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const word = normalizeWord(
    new URL(context.request.url).searchParams.get("word") || "",
  );
  if (!word) {
    return jsonResponse({ error: "Invalid word" }, 400);
  }

  try {
    return await lookupWord(context, word);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Dictionary lookup failed",
        error: error instanceof Error ? error.message : String(error),
        word,
      }),
    );
    return jsonResponse({ error: "Dictionary unavailable" }, 503);
  }
}
