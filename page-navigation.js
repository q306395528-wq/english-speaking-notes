const SHELL_CACHE_KEY = "english-v2-shell-20260728-cloud";

const pages = {
  home: {
    file: "index.html",
    title: "我的英语口语库 V2",
    sections: ["dashboard"]
  },
  practice: {
    file: "practice.html",
    title: "练习 · 我的英语口语库",
    sections: ["practice"],
    heading: ["PRACTICE", "练习", "选择训练方式"]
  },
  library: {
    file: "library.html",
    title: "句子库 · 我的英语口语库",
    sections: ["library", "mistakes"],
    heading: ["ENGLISH NOTES", "句子库", "查找、收藏和复习句子"]
  },
  stats: {
    file: "stats.html",
    title: "学习统计 · 我的英语口语库",
    sections: ["dashboard"],
    heading: ["ENGLISH NOTES", "学习统计", "查看今天与近七天的学习情况"]
  },
  settings: {
    file: "settings.html",
    title: "我的 · 我的英语口语库",
    sections: ["data"],
    heading: ["ENGLISH NOTES", "我的", "语音与学习数据"]
  }
};

function viewFromUrl(url) {
  const file = new URL(url, location.href).pathname.split("/").pop() || "index.html";
  return Object.entries(pages).find(([, page]) => page.file === file)?.[0] || null;
}

function ensureHeading() {
  let heading = document.querySelector(".standalone-heading");
  if (heading) return heading;
  heading = document.createElement("header");
  heading.className = "standalone-heading";
  document.querySelector("main")?.prepend(heading);
  return heading;
}

export function applyView(view, { historyMode = "none", url = null } = {}) {
  const page = pages[view] || pages.home;
  const previousView = document.body.dataset.view || "home";

  document.body.classList.remove(...Object.keys(pages).map((name) => `view-${name}`));
  document.body.classList.toggle("standalone-page", view !== "home");
  document.body.classList.add(`view-${view}`);
  document.body.dataset.view = view;
  document.title = page.title;

  const heading = ensureHeading();
  if (page.heading) {
    heading.innerHTML = `<div><span class="section-kicker">${page.heading[0]}</span><h1>${page.heading[1]}</h1><p>${page.heading[2]}</p></div>`;
  } else {
    heading.innerHTML = "";
  }

  document.querySelectorAll("main > .section").forEach((section) => {
    section.hidden = !page.sections.includes(section.id);
  });

  document.querySelectorAll(".desktop-nav a, .mobile-tabbar a").forEach((link) => {
    const active = viewFromUrl(link.href) === view;
    link.toggleAttribute("aria-current", active);
  });

  if (historyMode === "push" && url) history.pushState({ view }, "", url);
  if (previousView !== view) {
    window.dispatchEvent(new CustomEvent("app:viewchange", { detail: { from: previousView, to: view } }));
    window.scrollTo(0, 0);
  }
}

export function installPageNavigation(initialView = viewFromUrl(location.href) || "home") {
  applyView(initialView);

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[href]");
    if (!link || link.target || link.hasAttribute("download")) return;

    const url = new URL(link.href, location.href);
    const nextView = url.origin === location.origin ? viewFromUrl(url) : null;
    if (!nextView) return;

    event.preventDefault();
    applyView(nextView, {
      historyMode: "push",
      url: `${url.pathname}${url.search}${url.hash}`
    });
  });

  window.addEventListener("popstate", () => applyView(viewFromUrl(location.href) || "home"));

  const primeShell = () => {
    try {
      if (sessionStorage.getItem(SHELL_CACHE_KEY)) return;
    } catch {}
    fetch("./index.html", { cache: "force-cache" })
      .then((response) => response.ok ? response.text() : "")
      .then((source) => {
        if (!source) return;
        try { sessionStorage.setItem(SHELL_CACHE_KEY, source); } catch {}
      })
      .catch(() => {});
  };

  if ("requestIdleCallback" in window) requestIdleCallback(primeShell, { timeout: 1200 });
  else setTimeout(primeShell, 100);
}

export function readCachedShell() {
  try { return sessionStorage.getItem(SHELL_CACHE_KEY) || ""; }
  catch { return ""; }
}

export function writeCachedShell(source) {
  try { sessionStorage.setItem(SHELL_CACHE_KEY, source); }
  catch {}
}
