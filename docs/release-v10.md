# v10 发布记录 · 2026-10-22

- 线上地址：https://pawletter-adoption-h5.chenaaron668.chatgpt.site/?v=10
- Site 项目：`appgprj_6ad74703604c8191b8a635268a5cc24f`，保留 public 访问范围。
- 前端源码：`acf58d17847c539d506af6f827a6aa3139765859`。
- 保存版本：`appgprj_6ad74703604c8191b8a635268a5cc24f~appgver_ab48933ca9cc81918706a9695e01985c`，版本号 10。
- 前端发布：`appgdep_6ad8f9a454f881919671ce4063a392c2`，状态 succeeded。
- 后端构建：`96979af7-d15a-43ee-9992-0056b73f8e6d`。
- 数据库迁移：`pawletter-migrate-mgvbk`，成功。
- Cloud Run 修订：`pawletter-api-00010-jsg`，100% 流量。

## 验收结果

前端 38 项、后端 21 项测试通过，33 个浏览器状态通过 390×844 和 360×640 两种手机尺寸检查。页面测试使用隔离接口夹具；正式接口测试另行执行。

实际服务闭环完成：创建内部宠物 → 建立分身与表达偏好 → 合成中文音频上传、转写与自动归档 → 领养者获得带来源回答 → 更正喜欢的玩具后回答变化 → 撤回后不再引用。真实申请可进入站点，状态通知使用宠物第一人称，实名待核验会阻止最后交接。验收宠物下架、记录撤回、申请终止，会话注销。

最终 `verify-registration-live.js` 返回：ready=true；interview=200；summary=200 且结构有效；registration=201 且 verification=pending、consent=true；profile=true；logoutRevoked=true；login=true；asr=200 且有转写文字。

此前遇到画像结构错误，修复为更精简、明确的输出约束，严格校验并仅对结构错误自动再生成一次；没有本地伪造画像。此前也观察到语音供应商 429，因此这次通过不等于供应商永不限流，保留录音与显式重试仍是必要交互。

完整反馈映射与尚未接入的服务见 [验收清单](acceptance-v10.md)。
