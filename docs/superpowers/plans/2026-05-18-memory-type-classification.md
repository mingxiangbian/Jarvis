# Memory Type Classification 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤必须按 TDD 执行：先写失败测试，再做最小实现，再验证并提交。

**目标：** 为 `MEMORY.md` 索引行嵌入可选类型标记 `[type]`，实现 4 种记忆类型（`user` / `feedback` / `project` / `reference`）的分类，同时保持旧索引格式可读。

**架构：** 类型只存储在 `MEMORY.md` 索引行中，不写入 memory 文件正文。加载时通过统一解析函数解析索引行，写入时通过 `writeMemoryEntry` / `updateMemoryIndex` / `compactMemories` 传递类型。加载输出保留 scope 信息，避免把“项目记忆”和 `project` 类型混淆。

**Tech Stack:** TypeScript, Vitest, Node.js fs/promises.

---

## 类型定义与格式约定

新增类型：

```ts
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'
```

索引行格式：

```markdown
- [Title](file.md) — summary
- [Title](file.md) — [project] summary
```

加载行为：

- 新格式有效 type：正常加载，并在 heading 中显示 type。
- 旧格式无 type：正常加载，heading 不显示 type。
- 新格式非法 type：跳过该索引行，不加载对应 memory 文件。
- malformed 索引行：继续跳过，保持现有行为。

heading 格式：

```markdown
## Project Memory: Title
## Project Memory [project]: Title
## Global Memory: Title
## Global Memory [user]: Title
```

`loadMemories(cwd)` 是旧兼容 API，继续输出：

```markdown
## Memory: Title
## Memory [project]: Title
```

---

### 任务 1：新增索引解析 helper，加载端兼容新旧格式

**文件：** `src/memory.ts`、`tests/memory-load.test.ts`

**做什么：**

- 新增 `MemoryType`。
- 新增 `parseMemoryIndexLine(line)`，统一解析 `MEMORY.md` 索引行。
- 修改 `loadMemoryScope` 使用 `parseMemoryIndexLine`。
- 修改 `loadMemories` 使用 `parseMemoryIndexLine`。
- 新格式有效 type 在 heading 中显示 `[type]`。
- 旧格式无 type 继续加载，不显示 `[type]`。
- 非法 type 的新格式行跳过。

**测试要点：**

- `- [Style](style.md) — [project] coding style` 加载为 `## Project Memory [project]: Style`。
- `- [Style](style.md) — coding style` 旧格式加载为 `## Project Memory: Style`。
- mixed 新旧格式同一个 `MEMORY.md` 都能加载。
- `- [Bad](bad.md) — [invalid] bad type` 被跳过。
- `loadMemories(cwd)` 同步覆盖新旧格式 heading。

**验证命令：**

```bash
npx vitest run tests/memory-load.test.ts
npx tsc --noEmit
```

Commit: `feat: parse typed memory index lines`

---

### 任务 2：writeMemoryEntry + updateMemoryIndex 接受可选 type

**文件：** `src/memory.ts`、`tests/memory-load.test.ts`

**做什么：**

- `writeMemoryEntry` 的 entry 参数新增可选 `type?: MemoryType`。
- `updateMemoryIndex` 的 entry 参数新增可选 `type?: MemoryType`。
- `appendMemoryIndexEntry` 接受可选 type。
- 有 type 时写入 `- [title](file) — [type] summary`。
- 无 type 时继续写入旧格式 `- [title](file) — summary`。
- `validateMemoryIndexEntry` 校验 type：如果传入 type，必须是 4 种有效值之一。

**测试要点：**

- `writeMemoryEntry(... type: 'feedback')` 写入索引行包含 `[feedback]`。
- `writeMemoryEntry(... type: undefined)` 写入旧格式，不包含 `[type]`。
- `updateMemoryIndex(... type: 'reference')` 写入 `[reference]`。
- 非法 type 返回/抛出明确错误，并且不写 `MEMORY.md`。

**验证命令：**

```bash
npx vitest run tests/memory-load.test.ts
npx tsc --noEmit
```

Commit: `feat: write typed memory index entries`

---

### 任务 3：compactMemories 要求 LLM 输出 type

**文件：** `src/memory.ts`、`tests/memory-load.test.ts`

**做什么：**

- `CompactedMemoryEntry` 接口新增必填 `type: MemoryType`。
- `buildMemoryCompactionPrompt` 更新 JSON 格式，要求每条 memory 返回 `type`。
- 在 prompt 中明确分类指引：
  - `user`: 用户偏好、身份、角色、长期习惯。
  - `feedback`: 用户纠正、对 agent 行为的反馈、以后必须遵守的工作方式。
  - `project`: 项目决策、架构约定、代码库内事实。
  - `reference`: 外部系统、链接、文档、账号或环境引用。
- `parseCompactedMemoryEntries` 校验 `type` 必填且必须是有效 `MemoryType`。
- `validateCompactedMemoryEntries` 复用 type 校验。
- `compactMemories` 写入 durable memory 时把 type 传给 `writeMemoryEntry`。

**测试要点：**

- prompt 包含 `"type"` 字段和 4 类分类说明。
- LLM 返回有效 type 后，`MEMORY.md` 写入 `[type]`。
- LLM 返回缺失 type：`compactMemories` 返回 `{ ok:false }`。
- LLM 返回非法 type：`compactMemories` 返回 `{ ok:false }`。
- compaction 失败时仍保留 `daily.md` 原文，不 archive，不 truncate。

**验证命令：**

```bash
npx vitest run tests/memory-load.test.ts
npx tsc --noEmit
```

Commit: `feat: classify compacted memory entries`

---

### 任务 4：集成测试与回归验证

**文件：** `tests/memory-load.test.ts`、`tests/memory-v2-integration.test.ts`

**做什么：**

- 保留旧格式测试，不要全部改成新格式。
- 新增 mixed format 测试：同一个 `MEMORY.md` 中旧格式和新格式一起加载。
- 更新 Memory v2 集成测试：模拟 LLM 返回带 type 的 JSON，确认写入、加载、archive/truncate 全链路保留类型。
- 确认 `loadProjectMemories` / `loadGlobalMemories` 的 heading 同时保留 scope 和 type。

**测试要点：**

- 新格式加载正确。
- 旧格式继续兼容。
- mixed format 兼容。
- typed compaction 端到端保留 type。
- 非法 type 不污染 startup prompt。

**验证命令：**

```bash
npx vitest run tests/memory-load.test.ts tests/memory-v2-integration.test.ts
npx vitest run
npx tsc --noEmit
git status --short
```

Commit: `test: cover memory type classification`

---

## 变更总结

| 文件 | 变更 |
|------|------|
| `src/memory.ts` | 新增 `MemoryType`、`parseMemoryIndexLine`，加载新旧索引格式，写入可选 type，compaction 输出必填 type |
| `tests/memory-load.test.ts` | 新增 typed/legacy/mixed/invalid type 覆盖，更新写入与 compaction 测试 |
| `tests/memory-v2-integration.test.ts` | 端到端验证 typed memory 从 LLM 输出到加载 heading 全链路保留 |

## 执行注意事项

- 执行前使用独立 worktree/branch，避免混入当前工作区已有改动。
- 不迁移已有 `MEMORY.md` 文件。
- 不把 type 写入 memory 文件正文。
- 不把无 type 的旧索引行强行标为 `project`；旧格式保持无 type heading。
- 不删除旧的 session summary 兼容函数，除非另一个计划明确要求。
