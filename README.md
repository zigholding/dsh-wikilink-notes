# dsh-wikilink-completion

DeepSeek Harness 插件。在对话输入框里输入 `[[`，会列出笔记名称；方向键选择，回车插入 `[[笔记名]]`。打开对话后会提前读取笔记名，第一次输入 `[[` 不用等整库扫完。默认扫描当前会话工作区里的 Markdown。在设置里的「双链补全」可以再添加多个 Obsidian 仓库，也可以关掉工作区扫描。

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

默认扫描当前会话工作区里的 `.md` / `.markdown`。打开 DSH 的设置，停在「通用设置」。「打开配置文件」是 DSH 自己的按钮，留在标题栏上。它下面的「双链补全」才是这个插件的表单：勾选是否包含当前工作区；第一个文本框每行写一个本机 Obsidian 仓库的绝对路径（目录里要有 `.obsidian`）；第二个文本框每行写一个 NoteChain 服务地址，例如 `http://192.168.1.8:3000/mcp`。插件会调用该服务的 `obsidian_query_by_datacore`（查询 `@page`）取得笔记名，这样另一台电脑上的库也能补全。然后点「保存」。本机 Obsidian 已经打开过的库会列出来，点一下就填进第一个文本框。设置写在 `$DSH_HOME/wikilink-completion.json`（没设 `DSH_HOME` 时是 `~/.dsh/wikilink-completion.json`）。

如果通用设置里仍然只有「打开配置文件」，说明当前这个界面没有加载到插件。在插件目录再执行一次安装后完全退出应用：

```sh
dsh plugin --profile web add .
```

Desktop 若使用单独的 `desktop` profile，把上面的 `web` 换成 `desktop`，用应用自带的 `dsh` 执行。

名称取文件名；前言里的 `aliases` 和第一级标题只用来搜索。同一个库里的同名笔记会插入带文件夹的链接，例如 `[[工作/笔记]]`。不同库里的同名笔记会再带上库名，例如 `[[日记/周会纪要]]`。来自 NoteChain 的笔记插入为 `[[周会纪要]](from 192.168.1.8:3000)`。

可选上限写在 profile 的插件配置里：

```yaml
- id: dsh-wikilink-completion
  config:
    maxNotes: 8000
```

笔记列表是 `GET /api/wikilink-completion/notes?sessionId=`。设置是 `GET` / `PUT /api/wikilink-completion/settings`。补全请求不接受浏览器传来的目录；仓库路径只在保存设置时提交，并且必须是带 `.obsidian` 的绝对路径。

## 开发

```sh
npm install
npm test
npm run build
```

`lib/index.js` 和 `lib/client.js` 是安装时加载的产物，改完 `src/` 要重新构建。Desktop 和 Web 用的是同一个包，差别只在 `--profile`。

## 限制

- Desktop 和 Web 都能用。关掉工作区、又还没添加仓库时，列表会说明去设置里添加。
- 输入法如果会把 `[` 自动配成 `[]`，连续的 `[[` 就打不出来，需要关掉符号自动补全。
- 代码块里的 `[[` 不提示。查询里出现 `#`、`|` 或 `]` 时列表关闭。
- 插件只插入笔记名，不会把正文放进发给模型的提示词。
