# index.js 重构计划

## 重构结果
- `src/main/index.js` 从 **1243 行** 缩减到 **209 行**
- 拆分为 12 个文件，职责清晰，每个文件 < 300 行

## 完成状态

- [x] 第1步：提取工具函数 → `src/main/utils.js` (233行)
- [x] 第2步：提取配置安全检查 → `src/main/config-guard.js` (56行)
- [x] 第3步：提取 openclaw 路径解析 → `src/main/resolve-openclaw.js` (61行)
- [x] 第4步：提取 openclaw 命令执行 → `src/main/openclaw-runner.js` (103行)
- [x] 第5步：提取托盘图标生成 → `src/main/tray-icon.js` (55行)
- [x] 第6步：提取日志读取 → `src/main/ipc/logs.js` (171行)
- [x] 第7步：提取 workspace 文件操作 → `src/main/ipc/workspace.js` (63行)
- [x] 第8步：提取远程模型获取 → `src/main/ipc/models.js` (64行)
- [x] 第9步：提取 skills 列表 → `src/main/ipc/skills.js` (67行)
- [x] 第10步：提取 agent 管理 → `src/main/ipc/agents.js` (294行)
- [x] 第11步：提取 config 读写 → `src/main/ipc/config.js` (38行)

## 重构后目录结构
```
src/main/
├── index.js              (209行，主入口 + app生命周期)
├── preload.js            (不变)
├── utils.js              (纯工具函数 + 常量)
├── config-guard.js       (配置安全检查)
├── resolve-openclaw.js   (openclaw路径解析)
├── openclaw-runner.js    (命令执行封装)
├── tray-icon.js          (托盘图标生成)
└── ipc/
    ├── config.js         (配置读写)
    ├── agents.js         (agent管理 + gateway控制)
    ├── logs.js           (日志读取)
    ├── workspace.js      (workspace文件操作)
    ├── models.js         (远程模型获取)
    └── skills.js         (skills列表)
```

## 未改动的文件
- `src/main/preload.js` —— 无需改动
- `src/renderer/*` —— 无需改动
- 所有 IPC channel 名称保持不变

## 验证方式
- 用户手动启动应用确认功能正常
