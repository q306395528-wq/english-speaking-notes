import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSubtitlePack,
  classifySubtitle,
} from "../functions/_lib/google-sheets.js";

test("merges subtitle fragments and keeps worksheet metadata", async () => {
  const sheets = [{
    title: "How Tech Salaries Work",
    rows: [
      { time: "0s", subtitle: "Last week,", translation: "上周，" },
      { time: "1s", subtitle: "I found out my coworker became a millionaire.", translation: "我发现同事成了百万富翁。" },
      { time: "4s", subtitle: "The company offered stock options.", translation: "公司提供了股票期权。" },
    ],
  }];

  const pack = await buildSubtitlePack(sheets);
  assert.equal(pack.date, "google-sheets");
  assert.equal(pack.lessons.length, 2);
  assert.equal(
    pack.lessons[0].english,
    "Last week, I found out my coworker became a millionaire.",
  );
  assert.equal(pack.lessons[0].sourceSheet, "How Tech Salaries Work");
  assert.match(pack.lessons[0].id, /^gs-[a-f0-9]{20}$/);
});

test("generates stable IDs and automatic categories", async () => {
  const sheets = [{
    title: "Salary",
    rows: [
      { time: "0s", subtitle: "My salary includes equity and stock options.", translation: "我的薪酬包括股权和股票期权。" },
    ],
  }];

  const first = await buildSubtitlePack(sheets);
  const second = await buildSubtitlePack(sheets);
  assert.equal(first.lessons[0].id, second.lessons[0].id);
  assert.equal(first.lessons[0].category, "职场与薪资");
  assert.equal(classifySubtitle("We deployed a new AI API.").category, "科技与互联网");
});
