# 爪爪来信 · Pawletter

公益流浪猫狗领养 H5 与服务端统一代码仓库。前端和后端分目录维护，分别部署，不需要另外建立前端仓库。

| 目录 | 内容 | 当前状态 |
| --- | --- | --- |
| `frontend/` | 手机 H5、救助站工作台、领养者界面和测试 | 默认真实公开目录与领养者注册；角色切换进入救助站登录 |
| `backend/` | API、账号权限、录音转写、宠物资料库、Agent 问答、部署文件和测试 | Cloud Run 正式 API，含真实账号、生活画像、申请与站点审核 |
| `docs/` | 云端接入与部署交接 | 包含权限核验和部署记录 |

线上前端：https://pawletter-adoption-h5.chenaaron668.chatgpt.site/

最新反馈逐项落实和能力边界见 [v10 验收清单](docs/acceptance-v10.md)。发布版本、构建和修订号见 [v10 发布记录](docs/release-v10.md)。

本次导入对应前端版本提交 `5a88d53eb7e9705f276c42f304a6a826db5647eb` 的源码快照。原托管仓库的提交历史保留在原处，本仓库从这份快照开始记录前后端共同迭代。

## 本地开发

使用 Node.js 22 或更高版本。前端为原生 ES 模块，无运行依赖；后端依赖锁定于 `backend/package-lock.json`。

```sh
npm --prefix backend ci
npm --prefix frontend ci
npm run check
npm test
npm run dev:frontend
```

打开 http://localhost:4178 。后端环境与数据库初始化参见 [backend/README.md](backend/README.md)。数据库和 AI 配置未提供时，不要直接运行 backend start。

## 部署与接入

- **前端**：部署产物为 `frontend/dist`。现有 Sites 绑定信息保留在 `frontend/.openai/hosting.json`；推送 GitHub 本身不会自动更新现有线上站点。后续发布继续使用已有 Sites 发布流程，或明确配置新的前端流水线。
- **后端**：在 `backend/` 目录运行 Cloud Build，再执行迁移与 Cloud Run 更新。参见其中的部署说明和 `scripts/deploy.ps1`。
- **真实入口**：默认首页可匿名浏览公开宠物，喜欢/聊天/申请引导注册；“我的 → 切换身份 → 救助站”进入 `?mode=online&role=station`。服务端账号确定角色，原有 localStorage 演示记录不会上传或当成已核验账号。服务端凭据仅存放在 Secret Manager 或本地忽略文件，不提交仓库。
- **后端地址**：https://pawletter-api-446222711695.asia-east1.run.app 。2026-10-21 已补齐构建权限、执行数据库迁移并部署业务镜像，Scheduler 每分钟处理队列。普通业务接口需要登录，内部处理接口需要 OIDC 身份。

GitHub Actions 只执行前后端检查和测试，不自动部署或修改 Google Cloud 资源。部署密钥使用 Google Secret Manager；不要把 API Key、数据库密码、服务账号 JSON、录音或身份资料提交到仓库。

## 已验证及限制

前端 38 项、后端 21 项测试通过；本地后端测试运行 PostgreSQL SQL（PGlite），AI 和存储使用测试替身。33 个浏览器页面状态完成手机尺寸检查。云端另行通过合成中文录音完成宠物建档、分身设定、转写归档、引用回答、更正后回答变化、撤回、申请审核与待核验阻止交接的闭环。手机真机麦克风、权限和网络仍需现场验收。

账号注册、访谈与画像、宠物档案与问答、申请审核已经连接真实服务。短信/实名服务未开通，身份保持待核验；自动回访、评分、照片视频上传、跨设备收藏同步仍未完成。实时字幕依赖浏览器能力，最终转写走服务端 ASR，上游限流时保留录音并允许重试。详细边界见验收清单，不能以旧原型模块推断正式后端能力。
