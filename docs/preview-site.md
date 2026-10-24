# 固定协作预览站点

2026-10-24：前端已发布到独立预览站点，持有链接即可访问。朋友维护的正式站点未更改。

- 固定地址：https://pawletter-preview.g1251020624.chatgpt.site
- 救助站登录：https://pawletter-preview.g1251020624.chatgpt.site/?mode=online&role=station
- 救助站示例：https://pawletter-preview.g1251020624.chatgpt.site/?mode=online&role=station&examples=1

此前本地检查遇到预览域名未进入 API 白名单的问题。后续协作分支的联调记录见 [同事分支与接口联调](team-collaboration.md)。本次整合只合并并验证源码，没有重新部署或验证云端。示例入口不能作为真实登录和 API 联通的证明。

## 协作顺序

采用“本地修改 → 发布固定预览链接 → 线上验收 → 推送 GitHub 功能分支 → PR 合并到 main”的顺序。

1. 开始功能前，保存当前工作并同步最新 `main`；两人各用自己的功能分支。
2. 在本地修改、检查和测试，可以先做本地提交。前端继续从 `frontend/dist` 开发。
3. 将待验收的前端版本发布到本页固定预览站点，记录对应源码提交或快照。Sites 的源码保存与共享 GitHub 仓库的推送是独立动作。
4. 从固定链接验收本次功能及相关 API 路径。有问题就继续本地修复、更新同一链接并复验。
5. 验收通过后，再把对应版本推送到自己的 GitHub 功能分支并创建 PR。若随后合入朋友的代码或继续修改，需重新检查、发布和验收受影响的部分，再推送更新。GitHub 检查及评审通过后合并到 `main`，正式发布由朋友负责。

固定链接展示最近一次成功发布的版本；需要轮流验收时，先协调发布时间，避免另一人的发布替换正在验收的版本。

## 测试环境范围

目前这是独立的**前端预览环境**，仍连接原有云端 API，没有建立独立测试后端或测试数据库。白名单打通后，真实操作仍会访问原有数据，模型和语音功能仍使用原有服务额度。

发布这个站点只更新前端静态文件。后端代码改动必须由朋友部署到明确的后端环境后，才能从这个链接做真实联调；前端发布和页面验收不能证明新的后端代码已经生效。独立测试后端及其配置尚未就绪，后续涉及后端上线时再明确部署对象。

本地预览仍可用于界面、示例和隔离测试，端口可以固定为 `4178`。此前本地访问云端 API 的阻碍是来源白名单，不是本地地址必然变化。涉及云端 API 的浏览器验收统一使用上述固定预览链接。

## 后端白名单交接

保留原有 `FRONTEND_ORIGIN`，追加以下变量：

```text
FRONTEND_ADDITIONAL_ORIGINS=https://pawletter-preview.g1251020624.chatgpt.site
```

设置前先确认已部署的后端支持此变量。早期版本仅支持一个 `FRONTEND_ORIGIN`，不能直接套用整合版的多来源配置。

整合后的代码让 CORS 与注册、访谈、画像汇总、录音转写四个匿名接口使用同一份精确白名单。兼容 `FRONTEND_ORIGIN` 的逗号分隔来源列表及 `FRONTEND_ADDITIONAL_ORIGINS` 追加列表，两者合并去重。建议配置为 scheme://host[:port]，不使用路径或通配符。域名不会赋予跨站权限，账号或密码错误仍需另行核对。

朋友部署前先核对云端当前版本，避免覆盖其他新改动；原白名单改动本身不需要数据库迁移；当前整合版另含跨站权限及补充记录的 schema 更新，不能沿用“不需要迁移”的旧结论。若单独发布白名单修订，仅更新对应镜像和追加来源变量，并保留其余运行配置及原站点主域名。更新后的 `backend/scripts/deploy.ps1` 虽支持 `-AdditionalOrigins`，仍包含迁移和其他运行配置更新，不应直接作为本次仅修改白名单的命令执行。新镜像部署完成后，也可通过 Cloud Run 的变量设置界面追加上述变量。

如果使用 gcloud 在新镜像上设置本次单个追加域名：

```sh
gcloud run services update pawletter-api --project=pawletter-adoption --region=asia-east1 --update-env-vars=FRONTEND_ADDITIONAL_ORIGINS=https://pawletter-preview.g1251020624.chatgpt.site
```

如果云端已经存在其他追加域名，先读取并保留它们，再一起更新该变量。此命令更新整个追加变量的值，不是自动追加。

发布后验收：

1. 原正式站点仍能读取公开目录、正常登录。
2. 新预览域名能读取公开目录；使用已核实的站点账号登录后查看本站宠物。
3. 两个允许来源的 OPTIONS 响应分别返回各自的 `Access-Control-Allow-Origin`；其他来源不获许可。
4. 真实语音和模型调用另行验收，需使用获准的测试数据和额度。

本机已通过后端静态检查和 37 项测试，包括两域名、近似恶意域名及四个匿名接口的来源检查。未执行 Google Cloud 部署；本机缺少 PowerShell/gcloud，因此部署脚本仅做静态核对。两个构建忽略文件同时补入已有 `fixtures/`，使它与 Dockerfile 的 `COPY fixtures` 保持一致。

## 后续更新同一个链接

业务源码继续在 `Pawletter/frontend/dist` 开发。此次 Sites 发布副本位于同级 `Pawletter-preview`，只用于打包发布，不作为第二套业务源码。

之后发布预览时，同步最新前端到发布副本，并继续保存、部署下面这个 Site，不要创建新站点，也不要改动原有 `frontend/.openai/hosting.json` 中朋友的 Site ID。

- 预览 Site ID：`appgprj_6adc596438a08191bec9b127786bac16`
- 首次版本：1，部署状态 `succeeded`
- 首次部署 ID：`appgdep_6adc59a1c12081919e0ea1ebb9ed3304`
- Sites 源码提交：`87b40db917a6c81d295d462fa3b894def44ba75e`
- 对应业务前端快照：Pawletter `fa5d6a102aff6e1804fd000697af9bc0364976e0`

固定链接会展示最近一次成功发布的版本。GitHub 推送与 Sites 发布目前是两个独立动作，没有配置自动发布；两人可以打开同一个链接查看同一发布版本。
