# dsh-wikilink-completion

DeepSeek Harness 插件。在 Web 对话输入框里输入 `[[`，会列出当前工作区的笔记名称；方向键选择，回车插入 `[[笔记名]]`。

交互参照 Obsidian 的双链补全：未闭合的 `[[` 打开列表，继续输入会按名称、别名和文件夹过滤，已经闭合的链接不再提示。

## 试用对话

`preview/` 是同一个补全逻辑的对话框。笔记是浏览器里的示例数据，用来在没有 Harness 的时候试打 `[[`。

```sh
npm --prefix preview install
npm run preview
```

打开本机预览地址后，在底部输入框输入 `[[`。`↑` `↓` 移动，`Enter` 插入，`Esc` 关闭。没有打开补全时，`Enter` 发送，`Shift+Enter` 换行。

## 装进 DeepSeek Harness

需要 Web profile。在本仓库根目录：

```sh
dsh plugin --profile web add ./
```

重启 Web 服务并刷新页面。插件行写在包内的 `cordis.patch.yml`，`dsh plugin add` 会把它放进 profile。

工作区里的 `.md` / `.markdown` 会进入列表。名称取文件名；前言里的 `aliases` 和第一级标题只用来搜索。同名笔记会插入带文件夹的链接，例如 `[[工作/笔记]]`。

可选上限写在 profile 的插件配置里：

```yaml
- id: dsh-wikilink-completion
  config:
    maxNotes: 8000
```

接口是 `GET /api/wikilink-completion/notes?sessionId=`。目录只从会话自己的工作区读取，不接受浏览器传来的路径。

## 开发

```sh
npm install
npm test
npm run build
```

`lib/index.js` 和 `lib/client.js` 是安装时加载的产物，改完 `src/` 要重新构建。

## 限制

- 面向 Web profile。会话还没有工作区时，列表会说明这一点。
- 输入法如果会把 `[` 自动配成 `[]`，连续的 `[[` 就打不出来，需要关掉符号自动补全。
- 代码块里的 `[[` 不提示。查询里出现 `#`、`|` 或 `]` 时列表关闭。
- 插件只插入笔记名，不会把正文放进发给模型的提示词。
