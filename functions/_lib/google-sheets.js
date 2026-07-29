const SPREADSHEET_ID = "1fI07mAuiV_LC0GvcoC0S5HZOrZbWAfgbhkyJPjporS0";
const SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=xlsx`;
const CACHE_VERSION = "v2";
const CACHE_SECONDS = 60;
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_BYTES = 12 * 1024 * 1024;
const MAX_ENTRIES = 512;
const MAX_LESSONS = 5000;
const textDecoder = new TextDecoder();

function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function findEndOfCentralDirectory(bytes) {
  const minimum = Math.max(0, bytes.length - 65557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (readU32(bytes, offset) === 0x06054b50) return offset;
  }
  throw new Error("Invalid XLSX archive");
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzipXlsx(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!bytes.length || bytes.length > MAX_ARCHIVE_BYTES) {
    throw new Error("Spreadsheet export is too large");
  }

  const end = findEndOfCentralDirectory(bytes);
  const entryCount = readU16(bytes, end + 10);
  const centralOffset = readU32(bytes, end + 16);
  if (entryCount > MAX_ENTRIES || centralOffset >= bytes.length) {
    throw new Error("Invalid XLSX directory");
  }

  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(bytes, cursor) !== 0x02014b50) {
      throw new Error("Invalid XLSX entry");
    }
    const method = readU16(bytes, cursor + 10);
    const compressedSize = readU32(bytes, cursor + 20);
    const uncompressedSize = readU32(bytes, cursor + 24);
    const nameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const commentLength = readU16(bytes, cursor + 32);
    const localOffset = readU32(bytes, cursor + 42);
    const name = textDecoder.decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );

    if (uncompressedSize > MAX_ENTRY_BYTES || localOffset >= bytes.length) {
      throw new Error("XLSX entry is too large");
    }
    if (readU32(bytes, localOffset) !== 0x04034b50) {
      throw new Error("Invalid XLSX local entry");
    }
    const localNameLength = readU16(bytes, localOffset + 26);
    const localExtraLength = readU16(bytes, localOffset + 28);
    const dataOffset =
      localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(
      dataOffset,
      dataOffset + compressedSize,
    );
    let content;
    if (method === 0) content = compressed.slice();
    else if (method === 8) content = await inflateRaw(compressed);
    else throw new Error("Unsupported XLSX compression");
    if (content.length > MAX_ENTRY_BYTES) {
      throw new Error("Expanded XLSX entry is too large");
    }
    entries.set(name.replace(/^\/+/, ""), content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function decodeXml(value = "") {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attributes(source = "") {
  const result = {};
  for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    result[match[1]] = decodeXml(match[2]);
  }
  return result;
}

function xmlText(source = "") {
  return [...source.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function normalizeZipPath(target) {
  const parts = target.replace(/^\/+/, "").split("/");
  const output = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") output.pop();
    else output.push(part);
  }
  return output.join("/");
}

function readSharedStrings(entries) {
  const bytes = entries.get("xl/sharedStrings.xml");
  if (!bytes) return [];
  const xml = textDecoder.decode(bytes);
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(
    (match) => xmlText(match[1]),
  );
}

function readWorkbookSheets(entries) {
  const workbookBytes = entries.get("xl/workbook.xml");
  const relsBytes = entries.get("xl/_rels/workbook.xml.rels");
  if (!workbookBytes || !relsBytes) {
    throw new Error("XLSX workbook metadata is missing");
  }

  const relationships = new Map();
  const relsXml = textDecoder.decode(relsBytes);
  for (const match of relsXml.matchAll(
    /<Relationship\b([^>]*?)(?:\/>|>[\s\S]*?<\/Relationship>)/g,
  )) {
    const attrs = attributes(match[1]);
    if (attrs.Id && attrs.Target) {
      const target = attrs.Target.startsWith("/")
        ? attrs.Target
        : `xl/${attrs.Target}`;
      relationships.set(attrs.Id, normalizeZipPath(target));
    }
  }

  const workbookXml = textDecoder.decode(workbookBytes);
  const sheets = [];
  for (const match of workbookXml.matchAll(
    /<sheet\b([^>]*?)(?:\/>|>[\s\S]*?<\/sheet>)/g,
  )) {
    const attrs = attributes(match[1]);
    const relationshipId = attrs["r:id"];
    const path = relationships.get(relationshipId);
    if (attrs.name && path?.startsWith("xl/worksheets/")) {
      sheets.push({ title: attrs.name, path });
    }
  }
  return sheets;
}

function columnLetters(reference) {
  return reference.match(/^([A-Z]+)/i)?.[1]?.toUpperCase() || "";
}

function readCellValue(body, type, sharedStrings) {
  if (type === "inlineStr") return xmlText(body);
  const raw = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] || "";
  if (type === "s") return sharedStrings[Number(raw)] || "";
  return decodeXml(raw);
}

function readWorksheet(bytes, sharedStrings) {
  const xml = textDecoder.decode(bytes);
  const rows = new Map();
  for (const match of xml.matchAll(
    /<c\b([^>]*?)(?:>([\s\S]*?)<\/c>|\/>)/g,
  )) {
    const attrs = attributes(match[1]);
    const reference = attrs.r || "";
    const rowNumber = Number(reference.match(/(\d+)$/)?.[1]);
    const column = columnLetters(reference);
    if (!rowNumber || !column) continue;
    if (!rows.has(rowNumber)) rows.set(rowNumber, {});
    rows.get(rowNumber)[column] = readCellValue(
      match[2] || "",
      attrs.t || "",
      sharedStrings,
    );
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rowNumber, values]) => ({ rowNumber, values }));
}

function normalizedHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function readableTime(value) {
  const text = String(value || "").trim();
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(text) || !text.includes(".")) {
    return text;
  }
  const totalSeconds = Math.round(Number(text) * 24 * 60 * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function findColumns(rows) {
  for (const row of rows.slice(0, 20)) {
    const columns = {};
    for (const [column, value] of Object.entries(row.values)) {
      const header = normalizedHeader(value);
      if (["time", "timestamp", "时间", "时间戳"].includes(header)) {
        columns.time = column;
      }
      if (
        [
          "subtitle",
          "subtitles",
          "english",
          "englishsubtitle",
          "英文",
          "英文字幕",
          "字幕",
        ].includes(header)
      ) {
        columns.subtitle = column;
      }
      if (
        [
          "machinetranslation",
          "translation",
          "chinese",
          "中文",
          "中文字幕",
          "机器翻译",
          "翻译",
        ].includes(header)
      ) {
        columns.translation = column;
      }
    }
    if (columns.subtitle) return { ...columns, headerRow: row.rowNumber };
  }
  return null;
}

export async function parseSubtitleWorkbook(buffer) {
  const entries = await unzipXlsx(buffer);
  const sharedStrings = readSharedStrings(entries);
  const sheets = [];
  for (const sheet of readWorkbookSheets(entries)) {
    const bytes = entries.get(sheet.path);
    if (!bytes) continue;
    const rows = readWorksheet(bytes, sharedStrings);
    const columns = findColumns(rows);
    if (!columns) continue;
    const dataRows = rows
      .filter((row) => row.rowNumber > columns.headerRow)
      .map((row) => ({
        time: readableTime(row.values[columns.time]),
        subtitle: String(row.values[columns.subtitle] || "").trim(),
        translation: String(
          row.values[columns.translation] || "",
        ).trim(),
      }))
      .filter((row) => row.subtitle);
    if (dataRows.length) sheets.push({ title: sheet.title, rows: dataRows });
  }
  return sheets;
}

function joinEnglish(parts) {
  return parts
    .join(" ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function joinChinese(parts) {
  return parts
    .join("")
    .replace(/\s+([，。！？；：])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isSentenceEnd(text) {
  return /(?:[.!?]+|[…]{1,2})["')\]]*$/.test(text.trim());
}

function subtitleSentences(rows) {
  const sentences = [];
  let english = [];
  let chinese = [];
  let startTime = "";
  let rowCount = 0;

  const flush = () => {
    const mergedEnglish = joinEnglish(english);
    const mergedChinese = joinChinese(chinese);
    if (mergedEnglish) {
      sentences.push({
        english: mergedEnglish,
        chinese: mergedChinese || "（待补充中文翻译）",
        time: startTime,
      });
    }
    english = [];
    chinese = [];
    startTime = "";
    rowCount = 0;
  };

  for (const row of rows) {
    if (!startTime) startTime = row.time;
    english.push(row.subtitle);
    if (row.translation) chinese.push(row.translation);
    rowCount += 1;
    const merged = joinEnglish(english);
    if (
      isSentenceEnd(merged) ||
      merged.length >= 240 ||
      rowCount >= 7
    ) {
      flush();
    }
  }
  flush();
  return sentences;
}

const CATEGORY_RULES = [
  {
    category: "职场与薪资",
    icon: "💼",
    terms: [
      "salary",
      "salaries",
      "bonus",
      "stock option",
      "compensation",
      "promotion",
      "negotiate",
      "millionaire",
      "薪资",
      "工资",
      "奖金",
      "股票",
      "升职",
    ],
  },
  {
    category: "职场表达",
    icon: "🧑‍💻",
    terms: [
      "coworker",
      "co-worker",
      "job",
      "office",
      "manager",
      "team",
      "employee",
      "designer",
      "工作",
      "同事",
      "团队",
      "办公室",
    ],
  },
  {
    category: "科技与互联网",
    icon: "💻",
    terms: [
      " ai ",
      "tech",
      "google",
      "software",
      "data",
      "app",
      "人工智能",
      "科技",
      "软件",
      "互联网",
    ],
  },
  {
    category: "金钱与理财",
    icon: "💰",
    terms: [
      "money",
      "dollar",
      "worth",
      "price",
      "rich",
      "financial",
      "美元",
      "价格",
      "价值",
      "理财",
    ],
  },
  {
    category: "出行与地点",
    icon: "🗺️",
    terms: [
      "new york",
      "london",
      "travel",
      "drive",
      "train",
      "flight",
      "纽约",
      "伦敦",
      "旅行",
      "开车",
    ],
  },
  {
    category: "饮食与生活",
    icon: "☕",
    terms: [
      "coffee",
      "food",
      "eat",
      "drink",
      "dinner",
      "咖啡",
      "吃",
      "喝",
      "晚餐",
    ],
  },
];

export function classifySubtitle(english, chinese, sheetTitle = "") {
  const sentenceText = ` ${english} ${chinese} `.toLowerCase();
  const titleText = ` ${sheetTitle} `.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.terms.some((term) => sentenceText.includes(term))) return rule;
  }
  for (const rule of CATEGORY_RULES) {
    if (rule.terms.some((term) => titleText.includes(term))) return rule;
  }
  return { category: "字幕精选", icon: "🎬" };
}

function levelFor(english) {
  const words = english.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g) || [];
  if (words.length <= 8) return "A2";
  if (words.length <= 17) return "B1";
  return "B2";
}

async function stableLessonId(sheetTitle, english) {
  const input = new TextEncoder().encode(
    `${sheetTitle}\n${english.toLowerCase().replace(/\s+/g, " ").trim()}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", input);
  const hash = [...new Uint8Array(digest).slice(0, 10)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `gs-${hash}`;
}

export async function buildSubtitlePack(sheets) {
  const lessons = [];
  const seen = new Set();
  for (const sheet of sheets) {
    for (const sentence of subtitleSentences(sheet.rows)) {
      const normalized = sentence.english
        .toLowerCase()
        .replace(/[^a-z0-9']+/g, " ")
        .trim();
      const dedupeKey = `${sheet.title}\n${normalized}`;
      if (!normalized || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const classification = classifySubtitle(
        sentence.english,
        sentence.chinese,
        sheet.title,
      );
      lessons.push({
        id: await stableLessonId(sheet.title, sentence.english),
        category: classification.category,
        icon: classification.icon,
        level: levelFor(sentence.english),
        type: "字幕学习",
        english: sentence.english,
        chinese: sentence.chinese,
        original: "",
        reason: "",
        note: `来自 Google 表格「${sheet.title}」${sentence.time ? ` · ${sentence.time}` : ""}`,
        tags: ["Google Sheets", sheet.title, classification.category],
        sourceSheet: sheet.title,
        sourceTime: sentence.time,
      });
      if (lessons.length >= MAX_LESSONS) break;
    }
    if (lessons.length >= MAX_LESSONS) break;
  }

  return {
    version: 1,
    date: "google-sheets",
    title: "Google 表格字幕",
    source: {
      spreadsheetId: SPREADSHEET_ID,
      spreadsheetUrl: SPREADSHEET_URL,
      sheets: sheets.map((sheet) => sheet.title),
    },
    updatedAt: new Date().toISOString(),
    lessons,
  };
}

async function fetchSpreadsheetPack() {
  const response = await fetch(EXPORT_URL, {
    redirect: "follow",
    headers: {
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    cf: { cacheEverything: true, cacheTtl: CACHE_SECONDS },
  });
  if (!response.ok) {
    throw new Error(`Google Sheets export returned ${response.status}`);
  }
  const contentLength = Number(response.headers.get("Content-Length") || 0);
  if (contentLength > MAX_ARCHIVE_BYTES) {
    throw new Error("Spreadsheet export is too large");
  }
  const buffer = await response.arrayBuffer();
  const sheets = await parseSubtitleWorkbook(buffer);
  if (!sheets.length) {
    throw new Error("No subtitle worksheets found");
  }
  return buildSubtitlePack(sheets);
}

export async function loadGoogleSheetsPack(context) {
  const cacheUrl = new URL(
    `/__google-sheets-cache/${CACHE_VERSION}.json`,
    context.request.url,
  );
  const cacheKey = new Request(cacheUrl);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached.json();

  const pack = await fetchSpreadsheetPack();
  const response = Response.json(pack, {
    headers: {
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
  context.waitUntil(
    caches.default.put(cacheKey, response.clone()).catch((error) => {
      console.error(
        JSON.stringify({
          message: "Google Sheets cache write failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }),
  );
  return pack;
}

export const googleSheetsConfig = Object.freeze({
  spreadsheetId: SPREADSHEET_ID,
  spreadsheetUrl: SPREADSHEET_URL,
  cacheSeconds: CACHE_SECONDS,
});
