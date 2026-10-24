# 固定协作预览站点

2026-10-24：前端已发布到独立预览站点，持有链接即可访问。朋友维护的正式站点未更改。

- 固定地址：https://pawletter-preview.g1251020624.chatgpt.site
- 救助站登录：https://pawletter-preview.g1251020624.chatgpt.site/?mode=online&role=station
- 救助站示例：https://pawletter-preview.g1251020624.chatgpt.site/?mode=online&role=station&examples=1

真实接口尚未打通：当前线上 API 仍只允许正式站点来源。示例入口使用已有示例数据，不能作为真实登录和 API 联通的证明。

## 后端白名单交接

保留原有 `FRONTEND_ORIGIN`，追加以下变量：

```text
FRONTEND_ADDITIONAL_ORIGINS=https://pawletter-preview.g1251020624.chatgpt.site
```

必须先部署包含本次修改的后端镜像，再设置此变量。旧代码不会读取它；也不能把多个域名直接塞进旧的 `FRONTEND_ORIGIN` 字符串。

本次代码让 CORS 与注册、访谈、画像汇总、录音转写四个匿名接口使用同一份精确白名单。多个追加域名以英文逗号分隔，不带末尾斜杠、路径或通配符。登录、角色和站点数据权限保持不变，账号或密码错误仍需另行核对。

朋友按现有 `backend/README.md` 流程构建新镜像并部署。更新后的 `backend/scripts/deploy.ps1` 支持 `-AdditionalOrigins`；未传这个参数时保留云端已有的来源配置。也可在新镜像部署完成后，通过 Cloud Run 的变量设置界面追加上述变量。不要替换或删除原站点的主域名。

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
