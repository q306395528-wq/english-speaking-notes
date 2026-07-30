import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");

assert.match(source, /function preloadNatural\(\)\{return null\}/);
assert.doesNotMatch(source, /Promise\.all\(\[worker\(\),worker\(\)\]\)/);
assert.match(source, /response\.status===429/);
assert.match(source, /storage==="GENERATED"\?12e3:300/);
assert.match(source, /TTS_WARM_NEXT_KEY/);
assert.match(source, /deferAudioWarmup\(retrySeconds\*1e3\)/);
assert.match(source, /pauseAudioWarmup\(\)/);
assert.match(source, /AI 服务繁忙，稍后重试/);

console.log(
  "OK: AI audio warmup is serialized, rate-limit aware, and paused for foreground playback.",
);
