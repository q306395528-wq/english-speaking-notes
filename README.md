# 我的英语口语库 V2

这是一个无需后端、适合发布到 GitHub Pages 的个人英语学习网站。内容按日期拆分，重点保存“原来的错句、正确表达、错误原因”，并用间隔复习安排下一次练习。

## V2 功能

- 今日待复习、未学习、连续学习和掌握率统计
- 间隔复习：再来 / 有点难 / 记住了 / 很熟练
- 看中文说英文
- 听写训练
- 跟读三遍
- 随机测试
- 错句与正确句对照
- 日期、场景、难度、状态和关键词筛选
- 收藏、英文朗读和单句练习
- 学习进度导出、导入和重置
- 深色模式和手机端布局
- 每日 JSON 编辑器 `add.html`
- GitHub Actions 自动检查 JSON、必填字段和重复 ID

## 项目结构

```text
english-speaking-notes-v2/
├── index.html                学习主页
├── add.html                  每日内容编辑器
├── app.js                    学习、复习和数据逻辑
├── add.js                    每日 JSON 生成逻辑
├── styles.css                公共样式
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

## 发布到 GitHub Pages

1. 新建 GitHub 仓库并上传整个项目。
2. 在仓库 Pages 设置中选择从 `main` 分支根目录发布。
3. 推送后等待网站构建完成。
4. 以后修改 `data/` 并推送，网站内容就会更新。

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
