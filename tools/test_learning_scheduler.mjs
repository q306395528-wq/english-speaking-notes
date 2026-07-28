import assert from "node:assert/strict";
import {
  addDaysFrom,
  isLearned,
  learningStatus,
  normalizeLearningItem,
  scheduleLearningItem,
} from "../learning-scheduler.js";

const date = "2026-07-28";

assert.equal(addDaysFrom(date, 3), "2026-07-31");
assert.equal(isLearned({ fav: true }), false);
assert.equal(isLearned({ reviews: 1 }), true);

{
  const result = scheduleLearningItem({}, "know", date);
  assert.equal(result.interval, 3);
  assert.equal(result.next, "2026-07-31");
  assert.equal(result.lastGrade, "know");
  assert.equal(result.sameDay, false);
}

{
  const fuzzy = scheduleLearningItem({}, "fuzzy", date);
  assert.equal(fuzzy.next, date);
  assert.equal(fuzzy.sameDay, true);
  assert.equal(learningStatus(fuzzy, date), "fuzzy");
  const learned = scheduleLearningItem(fuzzy, "know", date);
  assert.equal(learned.interval, 1);
  assert.equal(learned.next, "2026-07-29");
}

{
  const forgotten = scheduleLearningItem(
    { reviews: 3, interval: 21, ease: 2.5, streak: 3 },
    "forget",
    date,
  );
  assert.equal(forgotten.lapses, 1);
  assert.equal(forgotten.interval, 0);
  assert.equal(learningStatus(forgotten, date), "forget");
  const relearned = scheduleLearningItem(forgotten, "know", date);
  assert.equal(relearned.interval, 1);
  const nextDayRelearned = scheduleLearningItem(
    forgotten,
    "know",
    "2026-07-29",
  );
  assert.equal(nextDayRelearned.interval, 1);
}

{
  const fuzzy = scheduleLearningItem(
    { reviews: 3, interval: 20, ease: 2.5, streak: 3 },
    "fuzzy",
    date,
  );
  const relearned = scheduleLearningItem(fuzzy, "know", date);
  assert.equal(relearned.interval, 13);
}

{
  const first = scheduleLearningItem({}, "know", date);
  const second = scheduleLearningItem(first, "know", "2026-07-31");
  assert.ok(second.interval > first.interval);
  assert.ok(second.ease > first.ease);
}

{
  const migrated = normalizeLearningItem({
    stage: 3,
    reviews: 2,
    last: "2026-07-20",
    next: "2026-07-27",
    fav: true,
  });
  assert.equal(migrated.interval, 7);
  assert.equal(migrated.lastGrade, "know");
  assert.equal(migrated.fav, true);
}

assert.throws(
  () => scheduleLearningItem({}, "unsupported", date),
  /Unsupported learning grade/,
);

console.log("OK: adaptive learning schedule, same-day relearning, and migration.");
