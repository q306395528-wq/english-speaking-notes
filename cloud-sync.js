const SYNC_CODE_KEY = "english-v2-cloud-code";
const FORCE_UPLOAD_KEY = "english-v2-cloud-force-upload";
const CODE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

let syncContext = null;
let syncCode = "";
let syncTimer = null;
let syncRunning = false;
let syncPending = false;
let lastSignature = "";
let watcherStarted = false;

function generateSyncCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function getStoredCode() {
  try {
    const value = localStorage.getItem(SYNC_CODE_KEY) || "";
    if (CODE_PATTERN.test(value)) return value;
    const created = generateSyncCode();
    localStorage.setItem(SYNC_CODE_KEY, created);
    return created;
  } catch {
    return generateSyncCode();
  }
}

function setStatus(text, state = "") {
  const node = document.querySelector("#cloudSyncState");
  if (!node) return;
  node.textContent = text;
  node.dataset.state = state;
}

function renderCode() {
  const node = document.querySelector("#cloudSyncCode");
  if (node) node.textContent = `•••• •••• •••• ${syncCode.slice(-4)}`;
}

function syncHeaders() {
  return {
    Authorization: `Bearer ${syncCode}`,
    "Content-Type": "application/json",
  };
}

function snapshotSignature() {
  if (!syncContext) return "";
  try {
    return JSON.stringify({
      progress: syncContext.getProgress(),
      voice: syncContext.getVoice(),
    });
  } catch {
    return "";
  }
}

async function pushSnapshot(keepalive = false) {
  if (!syncContext || syncRunning) {
    syncPending = true;
    return;
  }

  syncRunning = true;
  syncPending = false;
  setStatus("同步中…", "syncing");
  try {
    const response = await fetch("./api/sync", {
      method: "PUT",
      headers: syncHeaders(),
      keepalive,
      body: JSON.stringify({
        progress: syncContext.getProgress(),
        voice: syncContext.getVoice(),
      }),
    });
    if (!response.ok) throw new Error("sync-failed");
    const result = await response.json();
    lastSignature = snapshotSignature();
    setStatus("已同步", "synced");
    const timeNode = document.querySelector("#cloudSyncTime");
    if (timeNode) {
      const time = result.updatedAt ? new Date(result.updatedAt) : new Date();
      timeNode.textContent = Number.isNaN(time.getTime())
        ? ""
        : time.toLocaleString("zh-CN", { hour12: false });
    }
  } catch {
    setStatus("离线保存", "offline");
  } finally {
    syncRunning = false;
    if (syncPending) {
      syncPending = false;
      void pushSnapshot();
    }
  }
}

async function pullOrCreate() {
  if (!syncContext) return;
  setStatus("连接云端…", "syncing");
  try {
    const forceUpload = sessionStorage.getItem(FORCE_UPLOAD_KEY) === "1";
    sessionStorage.removeItem(FORCE_UPLOAD_KEY);
    if (forceUpload) {
      await pushSnapshot();
      return;
    }

    const response = await fetch("./api/sync", {
      headers: { Authorization: `Bearer ${syncCode}` },
    });
    if (response.status === 404) {
      await pushSnapshot();
      return;
    }
    if (!response.ok) throw new Error("sync-failed");

    const snapshot = await response.json();
    syncContext.applyCloud(snapshot);
    lastSignature = snapshotSignature();
    setStatus("已同步", "synced");
    const timeNode = document.querySelector("#cloudSyncTime");
    if (timeNode && snapshot.updatedAt) {
      const time = new Date(snapshot.updatedAt);
      timeNode.textContent = Number.isNaN(time.getTime())
        ? ""
        : time.toLocaleString("zh-CN", { hour12: false });
    }
  } catch {
    setStatus("离线保存", "offline");
  }
}

async function copySyncCode(button) {
  try {
    await navigator.clipboard.writeText(syncCode);
    const previous = button.textContent;
    button.textContent = "已复制";
    setTimeout(() => {
      if (button.isConnected) button.textContent = previous;
    }, 1200);
  } catch {
    prompt("复制这个同步码", syncCode);
  }
}

async function changeSyncCode() {
  const next = prompt("输入另一台设备上的云端同步码", "");
  if (next === null) return;
  const normalized = next.trim();
  if (!CODE_PATTERN.test(normalized)) {
    alert("同步码格式不正确");
    return;
  }
  syncCode = normalized;
  localStorage.setItem(SYNC_CODE_KEY, syncCode);
  renderCode();
  await pullOrCreate();
}

function bindControls() {
  document.querySelector("#cloudSyncNow")?.addEventListener("click", () => {
    void pushSnapshot();
  });
  document.querySelector("#copySyncCode")?.addEventListener("click", (event) => {
    void copySyncCode(event.currentTarget);
  });
  document.querySelector("#changeSyncCode")?.addEventListener("click", () => {
    void changeSyncCode();
  });
  document.querySelector("#importProgress")?.addEventListener("change", () => {
    try { sessionStorage.setItem(FORCE_UPLOAD_KEY, "1"); }
    catch {}
  });
  document.querySelector("#resetProgress")?.addEventListener("click", () => {
    try { sessionStorage.setItem(FORCE_UPLOAD_KEY, "1"); }
    catch {}
  });
}

function startChangeWatcher() {
  if (watcherStarted) return;
  watcherStarted = true;
  setInterval(() => {
    const signature = snapshotSignature();
    if (signature && signature !== lastSignature) queueCloudSync();
  }, 500);
  const flush = () => {
    const signature = snapshotSignature();
    if (signature && signature !== lastSignature) void pushSnapshot(true);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

export function queueCloudSync() {
  if (!syncContext) return;
  if (syncTimer) return;
  setStatus("等待同步", "pending");
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void pushSnapshot();
  }, 650);
}

export function forceCloudUploadOnReload() {
  try { sessionStorage.setItem(FORCE_UPLOAD_KEY, "1"); }
  catch {}
}

export function initCloudSync(context) {
  syncContext = context;
  syncCode = getStoredCode();
  renderCode();
  bindControls();
  lastSignature = snapshotSignature();
  void pullOrCreate().finally(startChangeWatcher);
}
