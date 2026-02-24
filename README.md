# OpenClaw 管理器

OpenClaw 的桌面配置管理工具，提供可视化界面来管理 OpenClaw 的各项配置，替代手动编辑配置文件。

## 功能

- **Agent 模型配置** - 为每个 Agent 选择和切换使用的模型
- **Provider 管理** - 添加、编辑、删除模型供应商及其 API 密钥
- **Agent 身份文件编辑** - 内置编辑器，编辑 Agent 的 system prompt 等身份文件，支持实时预览
- **网关管理** - 查看网关运行状态，执行启动、停止、重启操作
- **路由绑定** - 配置请求路由规则，将不同路径绑定到对应的 Agent
- **Channel 管理** - 添加和管理通信渠道
- **Agent 高级配置** - 调整 Agent 的高级参数
- **Tools 配置** - 管理 Agent 可用的工具集

## 使用方式

### 直接运行

```
npm install
npm start
```

### 打包为安装程序

```
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

打包产物在 `dist` 目录下。

## 说明

- 配置文件位于用户目录下的 `.openclaw/openclaw.json`
- 关闭窗口时可选择最小化到系统托盘或直接退出，选择会被记住
