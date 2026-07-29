# 我的英语口语库 V2

这是一个无需后端、适合发布到 GitHub Pages 的个人英语学习网站。内容按日期拆分，重点保存“原来的错句、正确表达、错误原因”，并用间隔复习安排下一次练习。

## V2 功能

- 今日待复习、未学习、连续学习和掌握率统计
- 间隔复习：再来 / 有点难 / 记住了 / 很熟练
- 看中文说英文
- 听写训练
- 听写音频提前加载，首次未就绪时自动快速朗读
- 例句录音回放，可轮流听自己的录音和 AI 自然发音
- 看中文说英文支持录音回答、AI 语音识别和逐词对比
- 三态学习反馈：认识 / 模糊 / 忘记
- 模糊和忘记的句子当天自动重新进入队列，直到选择认识
- 根据直接认识、模糊、遗忘、连续答对和历史间隔自适应安排复习
- 统计每日新学、复习和记住的句子数量
- 跟读三遍
- 随机测试
- 错句与正确句对照
- 日期、场景、难度、状态和关键词筛选
- 收藏、英文朗读和单句练习
- Cloudflare Aura-2 自然语音（不可用时自动使用浏览器语音）
- 男声 / 女声与语速设置（保存在浏览器本地）
- 点击英文单词查看音标、词性、释义和单词发音
- 学习进度导出、导入和重置
- 深色模式和手机端布局
- 每日 JSON 编辑器 `add.html`
- GitHub Actions 自动检查 JSON、必填字段和重复 ID
- 自动同步公开 Google 表格中的字幕工作表，并按内容分类

## 项目结构

```text
english-speaking-notes-v2/
├── index.html                学习主页
├── add.html                  每日内容编辑器
├── app.js                    学习、复习和数据逻辑
├── styles.css                公共样式
├── dictionary.css            点词查询弹窗样式
├── functions/api/dictionary.js 免费词典查询与边缘缓存
├── functions/api/tts.js      自然语音接口
├── functions/api/subtitles.js Google 表格字幕同步接口
├── _routes.json              Pages Functions 路由
├── wrangler.jsonc            Cloudflare Pages 与 AI 绑定配置
├── data/
│   ├── index.json            日期文件目录
│   └── 2026-07-28.json       某一天的学习内容
├── tools/check_data.py       数据校验工具
├── .github/workflows/
│   └── validate.yml          GitHub 自动校验
└── .nojekyll                 GitHub Pages 静态发布标记
```

## 本地打开

网站使用 `fetch` 加载日期 JSON。部分浏览器不允许直接双击 HTML 读取本地 JSON，因此建议在项目目录运行：

```bash
python -m http.server 8000
```

然后访问：

```text
http://localhost:8000
```

## 每天新增内容

## Google 表格字幕自动同步

网站会从项目配置的公开 Google 表格读取所有工作表。每个工作表使用以下表头：

```text
Time | Subtitle | Machine Translation
```

- `Subtitle` 是英文字幕，`Machine Translation` 是中文翻译。
- 相邻的字幕片段会自动合并成完整句子。
- 工作表名称会作为来源标签；新建同样表头的工作表后会自动进入句库。
- 句子会按关键词自动归入职场、科技、理财、出行、生活等分类。
- 网页端和边缘节点缓存 15 分钟，表格更新后通常会在 15 分钟内同步，无需重新部署。
- 表格必须保持“知道链接的任何人可查看”。同步只使用公开导出地址，不需要 API Token，也不会把账号凭证提交到 GitHub。

当前同步表格：<https://docs.google.com/spreadsheets/d/1fI07mAuiV_LC0GvcoC0S5HZOrZbWAfgbhkyJPjporS0/edit>

### 方法一：使用网页编辑器

1. 打开 `add.html`。
2. 填写正确英文、中文、原错句和错误原因。
3. 把当天全部内容加入草稿。
4. 下载 `YYYY-MM-DD.json`，放入 `data/`。
5. 下载更新后的 `index.json`，替换 `data/index.json`。
6. 提交到 GitHub。

### 方法二：让我生成

每天英语练习结束后，对我说：

> 整理今天的内容

我会按 V2 结构生成：

- 当天日期 JSON
- 更新后的 `data/index.json`
- 今日重点复习清单

## 每条学习内容的数据结构

```json
{
  "id": "2026-07-29-im-on-my-way-home",
  "category": "出行表达",
  "icon": "🏠",
  "level": "A2",
  "type": "语法纠错",
  "english": "I'm on my way home.",
  "chinese": "我正在回家的路上。",
  "original": "I on my way home.",
  "reason": "句子缺少 be 动词 am。",
  "note": "也可以说 I'm heading home.",
  "tags": ["home", "present continuous"]
}
```

`id` 必须在整个项目中唯一。推荐用“日期 + 英文短句”的格式。

## 发布到 Cloudflare Pages

线上地址：<https://english-speaking-notes.pages.dev>

在 Cloudflare Pages 中连接这个 GitHub 仓库，并使用以下设置：

- Project name：`english-speaking-notes`
- Production branch：`main`
- Framework preset：`None`
- Build command：留空
- Build output directory：仓库根目录（`/`）

保存后，Cloudflare Pages 会部署当前 `main` 分支。以后向 `main`
推送更新时，Cloudflare Pages 会自动重新部署。

自然语音通过 Cloudflare Workers AI 绑定调用 Aura-2，不需要也不会在
GitHub 中保存 API Token。同一句课程内容会在 Cloudflare 边缘缓存；
如果自然语音暂时不可用，网站会自动改用浏览器自带的英文朗读。
语音设置支持 Luna 女声、Apollo 男声和 `0.70×` 至 `1.20×` 语速。
句子中的英文单词可以点击查询，音标、词性、英文释义与单词音频来自
Free Dictionary API；无需 API Key，查询结果会在 Cloudflare 边缘缓存。

## 发布前检查

在项目根目录运行：

```bash
python tools/check_data.py
```

成功时会显示：

```text
OK: 1 day file(s), 19 lesson(s), all IDs unique.
```

GitHub Actions 也会在每次推送和 Pull Request 时自动执行同样的检查。

## 学习进度说明

收藏、复习日期和连续学习记录保存在浏览器 `localStorage` 中，不会提交到 GitHub。建议定期在网站“数据与发布”区域导出进度 JSON。换电脑或清除浏览器数据前，先导出备份。
