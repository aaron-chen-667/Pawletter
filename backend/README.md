# Pawletter 服务端：宠物资料与 Agent 问答

> 2026-10-25：救助站建档现在返回真实 AI 承接回复；补充新增 `/v1/pets/:id/observations/analyze` 连续对话接口，确认后才入档。当前验收、接口契约和限制见 [救助站 Agent 联调](../docs/station-agent-integration-2026-10-25.md)；下文按日期保留历史记录。

> 2026-10-22 v10：默认领养者界面已接真实账号、生活画像、公开宠物目录、每宠物分身、长期资料问答与领养申请审核。21 项后端测试通过，正式注册/ASR/画像及宠物记忆更新闭环通过。短信/实名认证、自动回访、评分和照片视频上传仍待接入。以下“第一批”记录保留历史背景，当前范围以 [v10 验收清单](../docs/acceptance-v10.md) 和 [发布记录](../docs/release-v10.md) 为准。

这是爪爪来信独立后端第一批模块，目标是内部联调。2026-10-21 已部署到 Cloud Run，服务地址为 https://pawletter-api-446222711695.asia-east1.run.app 。H5 的 `?mode=online` 入口使用真实账号、宠物和资料库；原有本地体验记录不会上传。

## 本批范围

- 管理员预置测试账号，密码 scrypt 哈希、数据库持久化短期会话、退出撤销；角色和所属站点由服务端决定。
- 救助站创建宠物、上传录音、自由口述补充、自动归档、查看进度、修正和撤回。
- PostgreSQL 保存原始口述、转写、来源、知识条目及审计；GCS 保存私有音频，访问始终经过账号权限校验。
- openai-next 的 `/audio/transcriptions` 与 `/chat/completions` 适配器。配置沿用交接表的 `whisper-1` 和 `gemini-3.8-flash`。模型按编号选择并分类原文句子，服务端保存完整原句，避免整理时改写事实。
- 任务先入库，再由受认证的请求执行；已创建的 Cloud Scheduler 每分钟处理一条，负责页面关闭后的处理与重试。
- Agent 仅接收该宠物已归档且允许共享的资料，返回来源引用；资料不足明确说明。原始录音与站点私有补充不向领养者开放。

仍待实现：照片/视频解析、新宠物 AI 建档、领养者注册访谈与身份核验、申请/回访/评价/公开主页业务 API、偏好记忆与主动匹配。当前不是完整生产后端，不应采集真实身份证材料。

2026-10-22：注册访谈的录音现已接入真实自动转写。`POST /v1/onboarding/transcribe` 在登录前接受音频，限制 6 MiB，校验音频文件头和前端 Origin；数据库共享配额为每分钟 8 次、每天 100 次（按数据库时间窗口），包括失败的供应商调用。Origin 不是身份认证，配额用于限制匿名接口成本。该接口仅在内存中处理音频，服务器不保存访谈录音或文字，不分配账号；浏览器仍需用户核对回答。正式实名、账号创建与画像云端持久化仍未接入。手机录音最长 60 秒，真实设备兼容性待验收。

此更新使用构建 `0265528e-a095-4042-abec-fac6969c85cc`，迁移执行 `pawletter-migrate-nwc92`，Cloud Run 修订 `pawletter-api-00006-v4q`。16 项后端测试通过，合成 WAV 已经匿名注册接口调用真实 ASR 验证通过；未使用用户私人录音进行验证。

## 启动与验证

需要 Node.js 22+ 与 PostgreSQL 17。`npm ci` 安装依赖。环境变量参考 `.env.example`，不要提交真实 `.env`。Cloud Run 使用 Secret Manager 引用，不将密钥写进镜像。

```sh
npm run check
npm test
npm run migrate
npm start
```

15 项集成及适配器测试使用 PGlite 运行 PostgreSQL SQL，不需要云端密钥。测试覆盖站点隔离、重复提交、私有音频、修正/撤回、任务重试与过期租约、推理期间撤回、跨分类检索以及模型输出校验。云端另行验证数据库、GCS、模型和 Scheduler；真实手机录音和多实例负载仍待验证。

`scripts/verify-cloud.js` 在同一应用镜像内使用运行身份验证数据库、私有存储、真实模型提取和问答。可通过 `VERIFY_AUDIO_OBJECT` 提供 `system/verification/` 下的合成 WAV，额外验证转写与提取；脚本只输出检查状态并删除测试文件。2026-10-21 执行 `pawletter-verify-6dtfx` 五项通过。该检查会调用模型并产生少量 API 用量，不等同于手机端全流程验收。

管理员通过 `npm run provision` 的标准输入传入一个 JSON 对象：`username`、`password`（12–128 字符）、`role`（station/adopter）；站点账号还需 `stationId`、`stationName`。运行位置必须能连接数据库。密码不得放入命令行参数、代码、构建配置或日志；脚本仅返回用户 ID，不开放在线自助提权入口。

开发账号可由管理员授予跨站只读权限：先迁移新增 `users.read_all_stations` 列，再部署 API；在能连接数据库的受控环境中运行 `node scripts/set-station-read-access.js`，标准输入传入 `{"username":"gordon.station","enabled":true}`。传 `false` 撤销。变更与审计同事务，现有会话从下一次请求起采用新权限。回滚旧 API 时保留新增列。

该权限只适用于有效的 station 账号，读取所有现有及后续新增站点的宠物、私有档案、影像、申请和回访；`GET /v1/stations` 提供包含空站的列表。账号归属和所有业务写入仍限原站点，别站未公开宠物的聊天不开放。普通救助站和领养者默认无跨站权限。前端的“全部救助站”及筛选使用此服务端权限，`examples=1` 仍是独立浏览器示例。

`FRONTEND_ORIGIN` 支持英文逗号分隔的完整 Origin，CORS 与匿名接口使用同一份精确白名单；不接受路径、凭据、查询参数或通配符。

## 上下游调用

1. 通过 `/v1/auth/login` 登录，取得有效期 8 小时的 Bearer 会话。站点身份以账号数据库记录为准，不能接受前端角色切换充当授权。
2. 选择服务端已有宠物 ID。手机长按录音结束，将 Blob 原样 POST 到 `/v1/pets/:id/audio`，Content-Type 使用录音实际格式。上限 20 MiB，支持 webm、mp4/m4a、mp3、wav、ogg；不把录像当语音上传。
3. POST `/v1/pets/:id/observations`，正文含 `mediaId` 或 `text`，以及 `shareWithAgent`。每次录入创建一个 UUID 作为 `Idempotency-Key`，网络重试沿用同一个 key；修改正文则使用新 key。返回 202 表示原始记录已持久化，尚不代表 AI 整理成功。
4. 调用 `/v1/observations/:id/process` 推进当前记录，同时轮询该宠物 observations。关闭页面后由 Scheduler 每分钟补处理一条。队列规模增大时应改成 Cloud Tasks 并发派发。
5. 状态为 queued/processing 时展示“正在整理”；archived 时展示资料库结果。识别失败保留原始素材并自动重试，四次后 failed，可调用 retry。原始记录等待期间不能被当成已确认事实。
6. 更正时再次提交 observation 并提供 `replacesId`；旧资料立即失效，新资料整理完成后生效。撤回使用 DELETE observation。所有历史保留，但失效记录不进入新问答上下文。
7. 领养者调用 `/v1/pets/:id/chat`，获得 answer 与 citations（原文、站点、记录时间、确定性）。推理期间资料撤回，返回 409 `KNOWLEDGE_CHANGED_RETRY`，由页面重新发起一次问答。

可复用 `client/pawletter-api.js`。token 仅存在客户端实例内，页面刷新后重新登录。不要把真实用户名密码放进 H5 包，也不要把 localStorage 整包上传。先完成登录界面、服务端宠物 ID 映射、状态同步和错误处理再接入线上。

H5 线上模式已接入该适配器。`scripts/verify-live-flow.js` 读取 `.local/pawletter-test-accounts.json` 和合成 `.local/verification.wav`，对真实 API 验证登录、音频上传、去重、自动整理、引用问答、修正和撤回；会创建一只明确标记为虚构的联调宠物。运行前确认这是专门的测试账号，此脚本会使用模型额度，并保留撤回历史。

`scripts/provision-cloud-test.js` 是管理员一次性账号开通工具，在受控 Cloud Run Job 中生成随机密码，经私有 GCS 中转文件交付到本地，下载后删除中转文件。不要重复执行旧的开通 Job；账号已存在时不会覆盖密码。账号文件、录音及运行参数全部在 `.local/`，不进仓库。

`shareWithAgent` 默认 false；只有站点明确将此次内容作为宠物对外资料时才传 true。日期使用服务器记录时间，口述里的“昨天”等仍保留原话；没有自动推断观察日期。一次健康观察不会升级成长期诊断。

## 部署到已准备的 Google Cloud

项目 `pawletter-adoption`，区域 `asia-east1`，Cloud Run `pawletter-api`。

1. 权限：构建提交者须能 actAs 默认构建账号 `446222711695-compute@developer.gserviceaccount.com`，构建账号须有构建、镜像推送、源码读取和日志写入权限。运行账号 `pawletter-run@pawletter-adoption.iam.gserviceaccount.com` 使用数据库、GCS 和 Secret Manager 权限。2026-10-21 已核验权限并成功构建、部署，无需再次授权。
2. 本目录提交构建：

```sh
gcloud builds submit . --project=pawletter-adoption --region=asia-east1 --config=cloudbuild.yaml
```

上传白名单仅含源码、依赖锁文件、Dockerfile 与构建配置，不包含测试记录或环境文件。镜像标签采用构建 ID；不要使用不明来源的 latest。

3. 获取成功构建对应的镜像完整标签后执行 `scripts/deploy.ps1 -Image <完整镜像> -Gcloud <gcloud.cmd路径>`。脚本先部署并等待数据库迁移 Job 完成，然后更新现有 Cloud Run。不会修改现有公开访问/IAM 策略。密钥引用固定为本次已检查的 version 1，轮换后应显式更新。
4. 检查 `/health`、`/ready`，验证登录、站点隔离、真实录音、真实 AI 和撤回，再连接 H5。不能把 HTTP 200 占位 HTML 当成接口成功。
5. 检查是否已有名为 pawletter-observations 的 Scheduler Job；不存在时由有权限账号执行以下命令，已存在则使用 update http 保留同一任务。它调用的是需要校验 Google OIDC 身份的内部接口，不使用查询串密钥。

```sh
gcloud scheduler jobs create http pawletter-observations --project=pawletter-adoption --location=asia-east1 --schedule="* * * * *" --uri="https://pawletter-api-446222711695.asia-east1.run.app/internal/process" --http-method=POST --headers="Content-Type=application/json" --message-body="{}" --oidc-service-account-email="pawletter-run@pawletter-adoption.iam.gserviceaccount.com" --oidc-token-audience="https://pawletter-api-446222711695.asia-east1.run.app" --attempt-deadline=180s
```

Cloud Run 若要求 IAM 调用权限，还需为这个账号授予 run.invoker。公网开放服务仍由应用验证内部接口的 token。没有 WORKER_AUDIENCE 或 WORKER_SERVICE_ACCOUNT 时，内部接口拒绝所有请求。

## 已知运行边界

- 同一请求执行至多一个整理任务；不依赖 Cloud Run 在请求结束后继续分配 CPU。租约、重试和撤回校验均入库，实例重启后可以恢复。
- 现有测试桶会在 30 天后删除媒体。原始录音过期不影响已提取文字，但不能再回听，未完成转写的任务会失败；此保留规则由现有云配置决定。
- 当前频控为实例内频控，登录仍需在公开生产前加入共享频控/验证码、密码重置和正式身份体系；不要宣传为已满足一人一号实名认证。
- LLM 输出通过 JSON 结构、引用 ID 与原文片段边界校验，保留否定与不确定性，但模型回答并非诊断或事实核验系统。
- 一旦后续增加历史聊天读取接口，需继续对已撤回引用做可见性处理；本版无公开聊天历史接口。
- 服务端仅记录错误代码，不输出 provider 响应、SQL 参数、授权头和口述内容。

参考：Google [Cloud SQL 连接说明](https://docs.cloud.google.com/sql/docs/postgres/connect-run)、[构建身份要求](https://docs.cloud.google.com/build/docs/cloud-build-service-account-updates)。
