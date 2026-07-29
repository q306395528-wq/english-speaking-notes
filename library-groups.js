export function lessonGroupKey(lesson) {
  if (lesson?.sourceSheet) return `sheet:${lesson.sourceSheet}`;
  return `date:${lesson?.date || "uncategorized"}`;
}

export function groupLessons(lessons = []) {
  const groups = new Map();
  for (const lesson of lessons) {
    const key = lessonGroupKey(lesson);
    if (!groups.has(key)) {
      const isSheet = Boolean(lesson.sourceSheet);
      groups.set(key, {
        key,
        title:
          lesson.sourceSheet ||
          lesson.dayTitle ||
          lesson.date ||
          "未分类句子",
        source: isSheet ? "Google 表格工作表" : "本地对话句库",
        icon: isSheet ? "▤" : "EN",
        lessons: [],
      });
    }
    groups.get(key).lessons.push(lesson);
  }
  return [...groups.values()];
}
