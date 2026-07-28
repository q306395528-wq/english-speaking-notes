const view = document.body.dataset.view || "home";
const titles = {
  practice: "练习 · 我的英语口语库",
  library: "句子库 · 我的英语口语库",
  stats: "学习统计 · 我的英语口语库",
  settings: "我的 · 我的英语口语库"
};

async function mountPage() {
  const response = await fetch("./index.html");
  if (!response.ok) throw new Error("Unable to load application shell");

  const source = await response.text();
  const template = new DOMParser().parseFromString(source, "text/html");
  template.querySelectorAll("script").forEach((script) => script.remove());
  document.body.innerHTML = template.body.innerHTML;
  document.body.dataset.view = view;
  document.body.className = `standalone-page view-${view}`;
  document.title = titles[view] || template.title;

  const pageHeadings = {
    practice: ["练习", "选择训练方式"],
    library: ["句子库", "查找、收藏和复习句子"],
    stats: ["学习统计", "查看今天与近七天的学习情况"],
    settings: ["我的", "语音与学习数据"]
  };
  const [heading, subtitle] = pageHeadings[view] || pageHeadings.practice;
  document.querySelector("main")?.insertAdjacentHTML(
    "afterbegin",
    `<header class="standalone-heading"><div><span class="section-kicker">${heading === "练习" ? "PRACTICE" : "ENGLISH NOTES"}</span><h1>${heading}</h1><p>${subtitle}</p></div></header>`
  );

  const visibleSections = {
    practice: ["practice"],
    library: ["library", "mistakes"],
    stats: ["dashboard"],
    settings: ["data"]
  }[view] || ["dashboard"];

  document.querySelectorAll("main > .section").forEach((section) => {
    section.hidden = !visibleSections.includes(section.id);
  });

  document.querySelectorAll(".desktop-nav a").forEach((link) => {
    const active = link.getAttribute("href")?.includes(`${view}.html`);
    link.toggleAttribute("aria-current", Boolean(active));
  });

  const activeTab = document.querySelector(`.tab-${view}`);
  if (activeTab) activeTab.setAttribute("aria-current", "page");

  await import("./app.js?v=20260728-pages");
}

mountPage().catch(() => {
  document.body.innerHTML = `
    <main class="shell-error">
      <strong>页面暂时无法加载</strong>
      <a href="./index.html">返回首页</a>
    </main>`;
});
