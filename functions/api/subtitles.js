import {
  googleSheetsConfig,
  loadGoogleSheetsPack,
} from "../_lib/google-sheets.js";

function errorResponse(message, status = 502) {
  return Response.json(
    {
      error: message,
      source: googleSheetsConfig.spreadsheetUrl,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }
  try {
    const pack = await loadGoogleSheetsPack(context);
    return Response.json(pack, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Google-Sheets-Sync": "ready",
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Google Sheets subtitle sync failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return errorResponse("Subtitle sync is temporarily unavailable");
  }
}
