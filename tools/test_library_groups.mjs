import assert from "node:assert/strict";
import test from "node:test";

import { groupLessons, lessonGroupKey } from "../library-groups.js";

test("groups imported sentences by worksheet and local sentences by date", () => {
  const lessons = [
    { id: "a", sourceSheet: "Conversation One", date: "google-sheets" },
    { id: "b", sourceSheet: "Conversation One", date: "google-sheets" },
    { id: "c", sourceSheet: "Conversation Two", date: "google-sheets" },
    { id: "d", date: "2026-07-28", dayTitle: "日常对话" },
  ];

  const groups = groupLessons(lessons);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].title, "Conversation One");
  assert.equal(groups[0].lessons.length, 2);
  assert.equal(groups[2].title, "日常对话");
  assert.equal(lessonGroupKey(lessons[3]), "date:2026-07-28");
});
