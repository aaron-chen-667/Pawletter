# 爪爪来信 · Pawletter

公益流浪猫狗领养 H5 与服务端统一代码仓库。前端和后端分目录维护，分别部署，不需要另外建立前端仓库。

| 目录 | 内容 | 当前状态 |
| --- | --- | --- |
| `frontend/` | 手机 H5、救助站工作台、领养者界面和测试 | 保留原本地体验，新增 `?mode=online` 云端登录与资料问答链路 |
| `backend/` | API、账号权限、录音转写、宠物资料库、Agent 问答、部署文件和测试 | 首批模块已部署到 Cloud Run；云端账号与 H5 接入 |
| `docs/` | 云端接入与部署交接 | 包含权限核验和部署记录 |

线上前端：https://pawletter-adoption-h5.chenaaron668.chatgpt.site/?v=6

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
- **真实入口**：使用 `?mode=online`。页面以服务端账号确定角色，使用实际宠物 ID、登录会话与异步整理状态；原有 localStorage 演示记录不会上传。两种角色的测试账号仅通过本地忽略文件交付，不提交仓库。
- **后端地址**：https://pawletter-api-446222711695.asia-east1.run.app 。2026-10-21 已补齐构建权限、执行数据库迁移并部署业务镜像，Scheduler 每分钟处理队列。普通业务接口需要登录，内部处理接口需要 OIDC 身份。

GitHub Actions 只执行前后端检查和测试，不自动部署或修改 Google Cloud 资源。部署密钥使用 Google Secret Manager；不要把 API Key、数据库密码、服务账号 JSON、录音或身份资料提交到仓库。

## 已验证及限制

前端 29 项业务及 DOM 交互测试，后端 15 项集成/适配器测试通过；本地后端测试运行实际 PostgreSQL SQL（PGlite），AI 和存储使用测试替身。云端另行验证 Cloud SQL、私有 GCS 读写删除、第三方模型提取与带引用问答、合成中文录音转写与提取，以及 Scheduler 认证调用。真实 API 业务链路通过专用测试账号验证，手机真机录音与新页面视觉 QA 尚未完成。

完整产品需求不等于本批后端范围：注册实名、领养者访谈、匹配、申请、回访、评价和公共主页的线上 API 尚未全部实现。详细范围见各目录 README。
