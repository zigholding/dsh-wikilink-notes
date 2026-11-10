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

## 装进 DSH Desktop

Desktop 的 `desktop` profile 只归桌面应用管。先完全退出应用（托盘里选退出，不要只关窗口），再用桌面应用自带的 `dsh`，在本仓库根目录执行：

```sh
dsh plugin --profile desktop add .
```

Windows 上如果提示找不到 `dsh`，打开应用菜单里的「管理 dsh 命令」并安装，然后新开一个终端再执行上面的命令。装完重新打开 DSH Desktop。在已经选了工作区的对话里输入 `[[`。

`dsh plugin --profile web add .` 只会进 Web profile，Desktop 里看不到。

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

`lib/index.js` 和 `lib/client.js` 是安装时加载的产物，改完 `src/` 要重新构建。Desktop 和 Web 用的是同一个包，差别只在 `--profile`。

## 限制

- 面向 Web profile。会话还没有工作区时，列表会说明这一点。
- 输入法如果会把 `[` 自动配成 `[]`，连续的 `[[` 就打不出来，需要关掉符号自动补全。
- 代码块里的 `[[` 不提示。查询里出现 `#`、`|` 或 `]` 时列表关闭。
- 插件只插入笔记名，不会把正文放进发给模型的提示词。
