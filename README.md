# dsh-tavern-font-control

只服务于 DSH Tavern 的酒馆插件，可以修改**正文字号**、**行间距**、**字间距**，设置有预览界面。

<img width="785" height="769" alt="bd900c16f6bdab4750d66b3da8257e25" src="https://github.com/user-attachments/assets/acfe3a54-f25e-46f1-b012-1272063cc21e" />

## 功能

- 正文字号：px，数字框可直接输入任意值（滑杆只是方便拖），**不设上下限**
- 行间距：倍数，默认 1.71（等于酒馆原来的 24px 行高）
- 字间距：em，负数收紧、正数放宽
- 5 个快捷预设（偏小 / 默认 / 舒适 / 偏大 / 大字）+ 恢复酒馆默认
- 面板底部带实时预览、一行诊断信息（命中的正文块数量、样式是否注入）和「重新扫描正文」按钮

生效范围：聊天正文、你的对话气泡、舞台文本。侧栏面板等界面文字不受影响。取值保存在浏览器本地，刷新、重开都保留。

打开位置：**设置 → 正文字号与行距**（和「本地生图」「酒馆状态」同一层）。

## 安装

把整个文件夹放进酒馆数据目录的 `plugins/` 下：

```
<DSH_HOME>/profile-data/tavern/data/plugins/dsh-tavern-font-control/
├─ package.json
├─ index.mjs
└─ client.js
```

- 宿主侧几秒内自动加载，浏览器侧**刷新页面**后出现设置页
- 目录里自动生成的 `.tavern-entry.mjs` 是酒馆的加载守卫，**不要提交**（已在 `.gitignore` 里）
- 插件名不能与已安装的包重名，否则会被跳过（原因写在酒馆日志里）

## 原理

酒馆里两套正文渲染要分别处理：

1. **宿主原生 markdown 正文**：容器类名是 CSS module 哈希（形如 `_markdown_1ypvv_5`），字号来自
   `font: var(--dsw-font-markdown-base)` 这条 `font` **简写**——所以覆盖 `--dsw-font-*-font-size`
   子变量无效，必须自己声明 `font-size` / `line-height` 并加 `!important`。选择器按前缀
   `[class*="_markdown_"]` 匹配，宿主升版改了哈希也不会失效。
2. **酒馆自己渲染的正文**（舞台文本、对话气泡、卡内脚本 frame）：用
   `--dsh-content-font-size` / `--dsh-content-font-delta` 与 `.dsh-tavern-assistant` 等类名，
   插件同时覆盖变量与类样式。

正文可能出现在三种容器里，样式逐一注入：主文档、每个消息 iframe
（`iframe.dsh-tavern-message-frame`）、以及各个 shadow root。

重渲染靠 `MutationObserver`（只处理新增节点里真正含正文的）+ 酒馆的
`dsh-tavern-message-rendered` 事件 + 30 秒低频兜底，**不做全量轮询**，避免长对话越玩越卡。

## 版本

### 1.1.0

- 修正主聊天正文不生效的问题：改用 `_markdown_` 选择器覆盖宿主的 `font` 简写
- 支持 shadow root 与消息 iframe 内的注入
- 性能：去掉每 2 秒的 `querySelectorAll('*')` 全量扫描，改为按新增节点过滤 + 30 秒兜底；
  拖动滑杆时不做全量扫描
- 设置面板增加诊断行与「重新扫描正文」按钮

### 1.0.0

- 首个版本：设置页 + 字号 / 行距 / 字距

## 卸载

删除 `plugins/dsh-tavern-font-control` 整个文件夹，刷新页面即可；酒馆会自动清理
`cordis.patch.yml` 里以 `tavern-user-plugin-` 开头的条目。
