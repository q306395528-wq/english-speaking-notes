import {
  installPageNavigation,
  readCachedShell,
  writeCachedShell
} from "./page-navigation.js?v=20260730-critical";

const view = document.body.dataset.view || "home";

async function mountPage() {
  let source = readCachedShell();
  if (!source) {
    const response = await fetch("./index.html", { cache: "no-cache" });
    if (!response.ok) throw new Error("Unable to load application shell");
    source = await response.text();
    writeCachedShell(source);
  }

  const template = new DOMParser().parseFromString(source, "text/html");
  template.querySelectorAll("script").forEach((script) => script.remove());
  document.body.innerHTML = template.body.innerHTML;
  installPageNavigation(view);
  await import("./app.js?v=20260730-ai-voice3");
}

mountPage().catch(() => {
  document.body.innerHTML = `
    <main class="shell-error">
      <strong>页面暂时无法加载</strong>
      <a href="./index.html">返回首页</a>
    </main>`;
});
