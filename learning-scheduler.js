const MIN_EASE = 1.3;
const MAX_EASE = 3;
const MAX_INTERVAL = 365;
const VALID_GRADES = new Set(["know", "fuzzy", "forget"]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function addDaysFrom(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isLearned(item) {
  return Boolean(
    item &&
      ((Number(item.attempts) || 0) > 0 ||
        (Number(item.reviews) || 0) > 0 ||
        item.last),
  );
}

function inferredInterval(item) {
  const explicit = Number(item.interval);
  if (Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }
  const legacy = [0, 1, 3, 7, 30][Number(item.stage) || 0];
  return legacy || 0;
}

export function normalizeLearningItem(item = {}) {
  const learned = isLearned(item);
  return {
    ...item,
    ease: clamp(Number(item.ease) || 2.3, MIN_EASE, MAX_EASE),
    interval: inferredInterval(item),
    streak: Math.max(0, Number(item.streak) || 0),
    lapses: Math.max(0, Number(item.lapses) || 0),
    fuzzyCount: Math.max(0, Number(item.fuzzyCount) || 0),
    attempts: Math.max(
      0,
      Number(item.attempts) || Number(item.reviews) || 0,
    ),
    reviews: Math.max(0, Number(item.reviews) || 0),
    lastGrade:
      item.lastGrade ||
      (learned && (Number(item.stage) || 0) > 0 ? "know" : ""),
  };
}

function stageForInterval(interval) {
  if (interval >= 30) return 4;
  if (interval >= 14) return 3;
  if (interval >= 7) return 2;
  if (interval >= 3) return 1;
  return 0;
}

export function scheduleLearningItem(item, grade, dateKey) {
  if (!VALID_GRADES.has(grade)) {
    throw new Error(`Unsupported learning grade: ${grade}`);
  }

  const current = normalizeLearningItem(item);
  const sameLearningDay = current.learningDay === dateKey;
  const dayFuzzy = sameLearningDay
    ? Number(current.dayFuzzy) || 0
    : current.sameDay && current.lastGrade === "fuzzy"
      ? 1
      : 0;
  const dayForgot = sameLearningDay
    ? Number(current.dayForgot) || 0
    : current.sameDay && current.lastGrade === "forget"
      ? 1
      : 0;
  const attempts = current.attempts + 1;

  if (grade === "forget") {
    return {
      ...current,
      attempts,
      ease: clamp(current.ease - 0.2, MIN_EASE, MAX_EASE),
      interval: 0,
      streak: 0,
      lapses: current.lapses + 1,
      stage: 0,
      last: dateKey,
      next: dateKey,
      lastGrade: "forget",
      sameDay: true,
      learningDay: dateKey,
      dayFuzzy,
      dayForgot: dayForgot + 1,
    };
  }

  if (grade === "fuzzy") {
    return {
      ...current,
      attempts,
      ease: clamp(current.ease - 0.07, MIN_EASE, MAX_EASE),
      streak: 0,
      fuzzyCount: current.fuzzyCount + 1,
      stage: Math.min(Number(current.stage) || 0, 1),
      last: dateKey,
      next: dateKey,
      lastGrade: "fuzzy",
      sameDay: true,
      learningDay: dateKey,
      dayFuzzy: dayFuzzy + 1,
      dayForgot,
    };
  }

  const ease = clamp(
    current.ease + (dayFuzzy || dayForgot ? 0 : 0.05),
    MIN_EASE,
    MAX_EASE,
  );
  const streak = current.streak + 1;
  let interval;

  if (dayForgot) {
    interval = 1;
  } else if (dayFuzzy) {
    interval = current.reviews
      ? Math.max(1, Math.round(Math.max(1, current.interval) * 0.65))
      : 1;
  } else if (!current.reviews) {
    interval = 3;
  } else if (current.interval <= 1) {
    interval = 3;
  } else {
    const stabilityBonus = Math.min(streak, 5) * 0.08;
    interval = Math.max(
      current.interval + 1,
      Math.round(current.interval * (ease + stabilityBonus)),
    );
  }
  interval = clamp(interval, 1, MAX_INTERVAL);

  return {
    ...current,
    attempts,
    ease,
    interval,
    streak,
    reviews: current.reviews + 1,
    stage: stageForInterval(interval),
    last: dateKey,
    next: addDaysFrom(dateKey, interval),
    lastGrade: "know",
    sameDay: false,
    learningDay: dateKey,
    dayFuzzy,
    dayForgot,
  };
}

export function learningStatus(item, dateKey) {
  if (!isLearned(item)) return "new";
  const current = normalizeLearningItem(item);
  if (current.sameDay && current.next <= dateKey) {
    return current.lastGrade === "forget" ? "forget" : "fuzzy";
  }
  if (!current.next || current.next <= dateKey) return "due";
  return current.lastGrade === "know" ? "know" : current.lastGrade || "due";
}
