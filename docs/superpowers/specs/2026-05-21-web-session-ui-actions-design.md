# Web Session UI Actions 设计

## 目标

更新 Cyrene Web UI 的 session 侧栏和主题体验，保持现有玻璃拟态风格，避免扩大到无关重构。

成功标准：

- session 侧栏只显示标题，不显示 preview/content。
- 当前选中的 session 显示三点菜单入口，菜单内支持置顶/取消置顶和删除。
- 置顶状态持久化，下次启动仍然置顶，直到用户取消。
- 删除 session 前弹确认；删除当前打开的 session 后回到空白新对话。
- 收起侧栏时，展开按钮使用现有 Cyrene 卡通头像。
- 深色模式由用户手动切换，使用太阳/月亮线条 icon，并记住选择。
- 深色模式不是普通黑灰主题，而是浅色 Cyrene 风格的夜间玻璃版本。

## 非目标

| 不做什么 | 原因 |
|----------|------|
| 模型生成或重命名 session 标题 | 本次只改列表展示和操作 |
| 批量删除、批量置顶 | 需求没有提出，先保持单项操作 |
| 拖拽排序 session | 置顶加更新时间排序已经足够 |
| 新增外部 icon 库 | 当前静态前端没有构建链，线条 icon 可用内联 SVG 实现 |
| 改聊天区消息渲染 | 本次只涉及侧栏、header 和主题变量 |

## Session 列表交互

session 行只显示 `title`。不再显示 `preview` 或更新时间文本，避免左侧列表显得拥挤。

交互规则：

1. 点击 session 行加载该 session，并把它标为当前选中。
2. 只有当前选中的 session 行显示三点 icon 按钮。
3. 点击三点按钮打开轻量菜单。
4. 菜单包含 `Pin chat` 或 `Unpin chat`，以及 `Delete`。
5. 菜单 icon 使用简约线条 SVG；delete 使用克制的粉/玫红线条，不用高饱和警告红。
6. 点击菜单外、切换 session、开始运行时关闭菜单。
7. 运行中禁用 session 切换和菜单操作，沿用当前 run lock 语义。

删除规则：

1. 点击 `Delete` 后使用确认弹窗。
2. 用户取消时不修改任何状态。
3. 删除非当前 session 后，只刷新列表，当前聊天保持不变。
4. 删除当前 session 后，前端清空 `sessionId`、messages、tools 和输入状态，回到空白新对话。

置顶规则：

1. 未置顶 session 菜单显示 `Pin chat`。
2. 已置顶 session 菜单显示 `Unpin chat`。
3. 置顶状态持久化到 session index。
4. session 列表排序为：置顶在前；置顶组内按 `updatedAt` 倒序；未置顶组内按 `updatedAt` 倒序。

## Session Store 数据模型

在现有 `SessionIndexItem` 上增加可选字段：

```typescript
interface SessionIndexItem {
  id: string
  mode: SessionMode
  title: string
  preview: string
  createdAt: string
  updatedAt: string
  model: string
  pinned?: boolean
}
```

兼容规则：

- 旧 `index.json` 中没有 `pinned` 的条目视为 `false`。
- 写回 index 时可以补齐 `pinned: false`，但前端不能依赖旧文件已经补齐。
- 删除 session 时，同时移除 index 条目和对应 `.jsonl` 文件。
- 删除和更新置顶状态复用现有 safe id、symlink 和路径边界检查。

新增 store 能力：

```typescript
deleteSession({ cwd, sessionId }): Promise<boolean>
updateSessionPinned({ cwd, sessionId, pinned }): Promise<SessionIndexItem | null>
```

`deleteSession` 找不到时返回 `false`，找到并删除时返回 `true`。如果 `.jsonl` 文件已经不存在，但 index 条目存在，仍应移除 index 条目并返回 `true`。

`updateSessionPinned` 找不到时返回 `null`。找到时更新 index 并返回更新后的 session。

## Web API

新增最小 API：

| 方法 | 路径 | 用途 |
|------|------|------|
| `DELETE` | `/api/sessions/:id` | 删除 session |
| `PATCH` | `/api/sessions/:id` | 更新 `{ "pinned": boolean }` |

错误处理：

- unsafe session id 返回 400。
- 找不到 session 返回 404。
- `PATCH` body 不是 JSON 或 `pinned` 不是 boolean 时返回 400。
- 删除或更新成功返回 JSON，便于前端刷新状态。

## 主题设计

主题切换放在 chat header 的 actions 区域，使用 icon-only button：

- 浅色模式显示月亮线条 icon，表示切换到深色。
- 深色模式显示太阳线条 icon，表示切换到浅色。
- 按钮有 `aria-label` 和 `title`，可访问文本不显示在界面上。
- 用户选择保存到 `localStorage`，刷新后保持。

深色模式不是简单黑灰或反色，而是当前浅色 Cyrene 风格的夜间版本：

- 背景继续使用多层柔和径向光和线性渐变，但底色切到深蓝紫、墨蓝和低饱和粉紫/青色光。
- 面板保持玻璃质感，使用半透明深蓝灰、轻微白色描边和柔和内高光。
- 文字不用刺眼纯白；主文字使用柔和浅蓝白，次级文字使用蓝灰。
- `New chat`、当前 session、按钮 hover、菜单等保留粉/青/紫的轻量渐变或描边，只降低亮度。
- Delete 保持克制粉红/玫红线条。
- 太阳 icon 在深色中使用温暖淡黄，月亮 icon 在浅色中使用柔紫。

实现方式优先使用 CSS 变量：

- `:root` 保持现有浅色 token。
- `body.theme-dark` 覆盖背景、面板、文字、边框、hover、菜单和按钮 token。
- 初始化时先从 `localStorage` 读取主题并设置 class，避免刷新后闪错主题。

## 收起侧栏

收起侧栏时，展开按钮从 chevron 改成现有头像资源：

```text
/static/assets/cyrene-cartoon-avatar.png
```

行为保持不变：

- 按钮仍然展开侧栏。
- `aria-label` 仍为 expand sidebar 含义。
- 头像在 rail 中保持固定尺寸，不影响 rail 布局。

## 前端状态

新增轻量 UI 状态：

```javascript
state.openSessionMenuId = null
state.theme = 'light' | 'dark'
```

`openSessionMenuId` 只控制菜单显示，不持久化。运行中、reset chat、load session、delete session 后应清空。

`theme` 从 `localStorage` 初始化，并在点击主题按钮后写回。

## 测试计划

| 测试 | 内容 |
|------|------|
| legacy pinned 兼容 | 没有 `pinned` 字段的 index 条目可正常列出，视为未置顶 |
| 置顶排序 | pinned session 在前，组内按 `updatedAt` 倒序 |
| 更新置顶 | `updateSessionPinned` 可 pin/unpin 并持久化 |
| 删除 session | `deleteSession` 移除 index 条目和 JSONL 文件 |
| 删除缺失 JSONL | index 存在、JSONL 缺失时仍能删除 index 条目 |
| DELETE API | 成功删除返回 200，找不到返回 404，unsafe id 返回 400 |
| PATCH API | boolean pinned 可更新；非法 body 返回 400 |
| 静态 UI | session 行只渲染 title，不渲染 preview；包含三点菜单、pin/delete action、头像 rail expand、主题 icon toggle |
| 主题持久化 | 前端包含 localStorage 初始化和切换写回逻辑 |

## 验收

本次实现完成后，运行相关 session store、web server 和静态 Web UI 测试。若需要人工查看 UI，应启动 Web server 并检查浅色和夜间玻璃主题下的侧栏、菜单、header icon 和收起 rail。
