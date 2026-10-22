# v12：救助站拍摄建档、语音追问与示例

- 正式入口：https://pawletter-adoption-h5.chenaaron668.chatgpt.site/?mode=online&role=station&v=12
- 独立示例：https://pawletter-adoption-h5.chenaaron668.chatgpt.site/?mode=online&role=station&examples=1&v=12
- Sites 源码：`25acf49c0239826609f8d6d6964c99648d6e8f27`
- 保存版本：`appgprj_6ad74703604c8191b8a635268a5cc24f~appgver_c0d1532874c48191a0579e4e97f00acf`
- 部署：`appgdep_6ad9e0edd52c81918376898884d7a7d8`，succeeded，保留 public。
- API 镜像：`asia-east1-docker.pkg.dev/pawletter-adoption/pawletter/api:3fdd53da-fee4-4482-94b1-61e2796a6173`；先迁移数据库，再更新服务。

## 体验与真实数据

首次空站点引导拍摄第一位伙伴；工作台、宠物、申请三个底部入口，常用“补充日常”固定右下，“录入新伙伴”为次级操作。补充默认带入当前或上次宠物，录音松开归档、上滑取消，上传前统一转换为 WAV。

新建档案按拍摄／相册 → 语音口述与转写确认 → AI 整理并逐项追问 → 最终确认保存。年龄、健康等缺项可继续语音回答；不清楚可以跳过或先确认现有草稿。实际调用已配置的视觉语言模型和转写服务，失败保留当前草稿或录音。每次追问使用累计已确认口述，不把未知变成事实。

支持最多3张照片、1段30秒且10MB以内的 MP4/WebM 视频、1张 OCR 材料图。视频用两帧辅助识别，原视频保存；不做连续视频行为理解。图片等比例缩放。照片和视频保存在私有 `pawletter-archive-media`，没有30天临时录音生命周期；`ARCHIVE_GCS_BUCKET` 已加入环境样例与部署脚本。

原始口述、材料 OCR 文字仅本站可读；不自动把材料隐私写入公开简介。照片不能决定年龄、健康或性格。救助者确认的档案和观察才会进入对应宠物分身的事实来源；表达风格独立。新建默认私有，明确勾选才公开照片、视频和档案。使用幂等键防止重试创建重复宠物，未确认的保存结果锁定同一份提交内容。

救助站示例包含11个可切换场景：工作台、首次进入、拍摄建档、补充日常、长期档案、分身表达、问答、申请列表、申请详情、整理失败、私有观察。示例存独立 sessionStorage，使用明确标记的预设回答，不调用正式 API，不污染 aaron.station 账号。

## 验证

- 前端40项单元/DOM回归通过；最终脚本语法检查通过。
- 后端22项测试通过，包含权限、私有照片、OCR原文隔离、幂等保存、分身创建、观察写入。
- 浏览器11个救助站场景、拍照示例→追问→不清楚→确认建档通过，0浏览器异常、0正式API请求。
- 领养者14个示例场景回归通过。
- 真实云端：合成WAV成功转写；猫照片+明确标注的合成材料成功整理，OCR读出3.2 kg；年龄未知保留空值，Agent自然追问健康情况；回答未知后仍保留不确定性。
- 真实云端：确认创建内部私有档案、保存原文与图片、匿名读取图片被拒绝、观察自动归档、宠物分身依据档案回答逗猫棒喜好，全部通过。使用既有内部验收账号，未改动用户救助站。
- 桌面浏览器文件选择与录入链路已验证；手机原生相机、麦克风权限和设备兼容需真机体验。线上页面以 Sites 成功发布结果确认；此前 Cloudflare 阻止自动化浏览器复访，未绕过该限制。

## 运维参考

Cloud Run任务 PATCH 不接受 updateMask，服务 PATCH 接受；更新保留现有配置。参考官方接口文档：https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/patch 与 https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/patch 。
