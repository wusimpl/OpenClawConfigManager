# OpenClaw 配置管理器

OpenClaw 的 Electron 桌面管理工具，提供可视化方式管理 `openclaw.json`、网关状态、日志、Skills 与常见运行参数，减少手动编辑配置文件的成本。

## 功能总览

1. Agent 模型配置：支持按 Agent 设置主模型，或继承默认模型。
2. 默认模型故障转移：支持配置 `agents.defaults.model.primary` 和 `fallbacks`，并可调整顺序。
3. Agent 新建：通过 `openclaw agents add` 创建 Agent，并可设置名称。
4. Agent 导入：从已有 Workspace 导入身份文件、`scripts/`、`skills/`，可选迁移记忆和会话历史。
5. Provider 管理：新增、编辑、删除 Provider，支持远程拉取模型列表，支持自定义请求头（用于 403 兼容场景）。
6. Agent 身份文件编辑：浏览并编辑 Workspace 内 `.md` 文件，支持 Markdown 实时预览。
7. 网关管理：查看网关状态和健康信息，执行启动、停止、重启，并记录执行日志。
8. OpenClaw 日志查看：支持多来源日志读取、自动刷新与滚动查看。
9. 路由绑定管理：可视化维护 `bindings`。
10. Channel 管理：可视化维护 `channels`，支持分组覆盖配置。
11. Agent 高级配置：维护 compaction、并发参数、group mention patterns。
12. Tools 配置：维护 `tools.web.search`、`tools.web.fetch`。
13. Skills 管理：查看 Bundled/全局/工作区/个人 Skills，支持 Bundled 白名单（`allowBundled`）、启用禁用、`apiKey/env` 配置。
14. 配置热更新协助：检测外部配置变更并提示刷新，避免界面与磁盘配置不一致。
15. 安全保护：写入配置时会拦截明显的占位密钥，避免误保存无效 secret。

## 运行要求

1. 已安装并可在终端直接执行 `openclaw` 命令。
2. 本机已具备 OpenClaw 运行环境（通常包含 `~/.openclaw/openclaw.json`）。
3. 已安装 Node.js 与 npm（用于启动本项目）。

## 使用方式

### 本地运行

```bash
npm install
npm start
```

### 打包安装程序

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

打包产物位于 `dist` 目录。

## 关键行为说明

1. 配置文件路径默认是 `~/.openclaw/openclaw.json`。
2. 日志页支持三类来源：
   - Gateway 文件日志（优先读取 `logging.file`，否则回退到 `/tmp/openclaw/openclaw-YYYY-MM-DD.log`）。
   - 服务标准输出日志（`$OPENCLAW_STATE_DIR/logs/gateway.log`，未设置时回退 `~/.openclaw/logs/gateway.log`）。
   - 服务错误日志（`$OPENCLAW_STATE_DIR/logs/gateway.err.log`，未设置时回退 `~/.openclaw/logs/gateway.err.log`）。
3. Skills 页面遵循官方语义：
   - `allowBundled` 仅影响 Bundled Skills。
   - `skills.entries.<skill>.enabled/apiKey/env` 用于单 Skill 开关与环境配置。
4. Tools 与 Skills 配置修改后，通常需要重启网关生效（界面会提示）。
5. 关闭窗口时可选择“最小化到托盘”或“直接退出”，并记住偏好。

## 已知限制

1. 当前配置读取使用严格 JSON 解析；如果 `openclaw.json` 包含 JSON5 注释或尾逗号，界面会加载失败。
2. Workspace 编辑器当前仅展示和编辑 `.md` 文件。
3. 某些 Channel 配置是否可热生效取决于 OpenClaw 运行时能力；界面会给出“需重启网关”的提示。

## 参考文档

1. 本地官方文档：`/Users/williamsandy/code/openclaw/docs`
2. 官方站点：<https://docs.openclaw.ai>
