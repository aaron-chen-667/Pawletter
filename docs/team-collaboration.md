# 同事分支与接口联调

协作分支：`codex/team-collaboration`，基于已验收的 `36650c0` 创建。

```sh
git fetch origin
git switch --track origin/codex/team-collaboration
```

如果本地已有该分支，使用 `git switch codex/team-collaboration`。多人并行修改时，各自在此基础上创建功能分支，再通过 PR 合入。不要改写已推送的历史。

## 前端与 API

- 正式前端：https://pawletter-adoption-h5.chenaaron668.chatgpt.site/
- 同事前端：https://pawletter-preview.g1251020624.chatgpt.site/
- 共用 API：https://pawletter-api-446222711695.asia-east1.run.app
- 浏览器客户端：`backend/client/pawletter-api.js`

`FRONTEND_ORIGIN` 支持逗号分隔的精确来源列表。上述两个 HTTPS 来源均允许 GET、POST、DELETE、OPTIONS，以及 Authorization、Content-Type、Idempotency-Key 请求头。没有通配符；其他子域名、HTTP 来源不自动放行。注册语音接口采用同一白名单。

浏览器自动设置 Origin，无需前端手动设置。登录返回 Bearer token，客户端封装负责附加 Authorization；使用 `credentials: 'omit'`。CORS 仅解决浏览器跨域，不代替登录与业务权限。

## 数据库增删查改

此分支的同事预览站连接现有正式 API 和数据库，Git 分支不自动创建独立数据库。登录哪个救助站账号，就按该账号的站点权限访问资料；域名不会赋予管理员或跨站权限。数据库密码不放到前端，也不通过这个配置公开 PostgreSQL 端口。

| 操作 | 接口 | 说明 |
| --- | --- | --- |
| 登录 | `POST /v1/auth/login` | username、password；返回登录会话 |
| 创建宠物 | `POST /v1/pets` | 救助站权限；name、profile、published |
| 查询宠物 | `GET /v1/pets`、`GET /v1/pets/:id` | 按账号和公开状态过滤 |
| 修改/下架宠物 | `POST /v1/pets/:id/profile` | 提交 name、完整 profile、published；false 表示取消公开 |
| 新增观察 | `POST /v1/pets/:id/observations` | text、shareWithAgent；Idempotency-Key 使用 UUID |
| 查询观察 | `GET /v1/pets/:id/observations` | 支持 q、status、from、to、order、id |
| 更正观察 | `POST /v1/pets/:id/observations` | 使用新 Idempotency-Key，body 增加 replacesId，旧资料立即失效 |
| 撤回观察 | `DELETE /v1/observations/:id` | 逻辑删除，保留历史，不再用于当前记忆 |
| 查询分身记忆 | `GET /v1/pets/:id/knowledge` | 仅返回当前权限下有效资料 |
| 修改分身语气 | `POST /v1/pets/:id/agent` | 所属救助站；tone、style |

当前没有开放宠物整档物理删除接口。观察撤回、宠物下架与物理删除是不同操作。跨站写入和领养者修改救助档案仍被拒绝。

## 验收

本地 `npm test`：25 项通过，包含原域名、同事域名、伪造后缀域名、HTTP 来源、注册语音来源和既有数据库权限回归。

正式联调脚本：`backend/scripts/verify-collaboration-live.js`。只使用内部 QA 账号和私有测试宠物，检查两域名预检、真实响应 CORS、语音来源、创建/查询/修改宠物、新增/更正/撤回观察，以及领养者越权被拒绝。账号与原始结果保存在忽略目录 `.local`，不提交凭据。

2026-10-24 正式运行：10 项检查全部通过，测试观察已撤回、测试宠物保持私有、会话已退出。语音来源检查使用无效音频验证请求已通过来源校验并进入音频校验，不额外调用转录供应商。

部署镜像：`asia-east1-docker.pkg.dev/pawletter-adoption/pawletter/api:00bb4af4-45ad-4c47-8430-794107f9ad72`；部署操作 `df628e53-ec2d-481a-803d-74dd72a0249e` 已完成。没有修改数据库结构。
