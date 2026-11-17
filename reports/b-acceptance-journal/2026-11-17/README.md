# B：页面验收记录工具交付

## 1. 共同基线与提交

- 共同基线：`f17443cc8178e6b611d0d9c832a6dca06945d065`。
- B 分支：`codex/b-engineering-ui`。本轮产品代码：`837d4b04ae408b987e7c6d4de2e9882f0059469f`；后续证据提交不改变产品代码。
- B 独立功能：`0a522781d2f7473c606991f6ef8c2a53891d10ba`。
- 正常保留 A 集成 `0627fcecf688e0a4fbc6283adb70dfdc78c22f37` 后的候选：`1191f942112aacafcae6ab7aa614e5e7a8dce858`。
- 交接文档：`a9344e044eff00e4772332aaa83dc84988475b79`；集中审阅修复：`837d4b04ae408b987e7c6d4de2e9882f0059469f`。没有直接合入 main，没有部署或占用远端 GPU。

## 2. 任务状态

| 任务 | 状态 | 本次结果及剩余条件 |
| --- | --- | --- |
| 04 | 部分完成，open | 固定录音、权限/释放及页面回归保留；最终真人麦克风贯通仍待执行。 |
| 05/06 | 页面软件已测，真实验收待补 | 保留逐句播放、提前解码、停止与迟到隔离；全部固定场景物理 500ms 停播仍待采集，由 A 维护票。 |
| 07 | A 已在 0627 关闭 | 保留 A 正式切档修复；本轮真实 API/SQLite 仍用合成模型，不另称真实 Qwen 复验。 |
| 09 | 工具已交付，物理待验，open | 用户确认暂无独立原始音画和校准素材，未产生新的 40 事件通过结果。 |
| 10 | 页面离线检查已测，整机待验 | 页面阻断外网与资源缺失提示通过；未证明单主机完整断网运行。 |
| 11 | 采集准备完成，整体验收仍 open | 新增本机分段日志、全轮计数、故障保留、恢复与导出。软件计数候选永远不是工程验收通过。 |

A 的 6a487c9 真实模型、固定合成输入长稳报告单列，不冒充本轮新候选的长稳或真人验收。其暖机 20 轮跨度 1850.438 秒，首活动 P95 为 9.435 秒、0/20 低于 3 秒。来源及具体条件见继承的 `reports/joint-integration/2026-11-16/README.md`；B 本轮只读核对，没有重跑 GPU。

## 3. 变更文件与行为

产品文件：`web/acceptance-journal.js`、`web/main.js`、`web/index.html`、`web/style.css`；测试：`web/tests/acceptance-journal-public.test.cjs`；说明：`web/README-acceptance.md`、根 `README.md`、`docs/development/b-acceptance-journal-plan.md`、`docs/development/b-engineering-handoff.md`。

首页默认折叠、不记录。手动开始后只保存固定字段的非内容时序，不保存发言、转写、回复、名字、档案 ID、偏好、错误原文或音频。整轮全部播完才计一次，分句、重播、本地文件、失败、停止或中途加入不误计完成。每段单独计算观测时长；隐藏、心跳缺口、时钟异常、重启和重载保留复核标记，不能合并 15+15 分钟。

保存或容量失败停止记录并保留内存供下载。Web Locks 限制同源单个草稿写入者；恢复只读，接管在锁内重读最新草稿，第二页不能覆盖或清空活跃所有者记录。清空后旧快照不能复活。浏览器缺少该能力时只禁用验收记录写入，对话、播放和 Stop 照常。原文字/麦克风计时约定保留。

## 4. 实际测试命令与结果

运行环境变量（复现时替换为本机已有路径，无需新装依赖）：

```powershell
$env:PLAYWRIGHT_MODULE='C:\Users\30415\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:B_PROFILE_BACKEND_SRC=Join-Path (Get-Location) 'src'
$env:PYTHON_EXE='E:\digital robot\_work\voice-dev-py311\Scripts\python.exe'
node --test web/tests/acceptance-journal-public.test.cjs
node --test --test-concurrency=1 web/tests/voice-api.test.cjs web/tests/voice-public.test.cjs web/tests/microphone-public.test.cjs web/tests/sentence-public.test.cjs web/tests/profile-public.test.cjs web/tests/profile-real-api.test.cjs web/tests/offline-page-public.test.cjs
node --test web/tests/profile-public.test.cjs
node --test web/tests/offline-page-public.test.cjs
```

| 受测版本/阶段 | 实际结果 | 原始日志 |
| --- | --- | --- |
| 0a 功能最终专项 | 16/16，0 失败/取消/跳过 | `development/14-acceptance-final.log` |
| 1191 合并 A 后七文件串行回归 | 89/89，0 失败/取消/跳过 | `development/15-affected-final.log` |
| 837d 修复后的完整专项 | 20/20，0 失败/取消/跳过 | `review-fix/09-journal-full.log` |
| 修复后档案页面 | 12/12，0 失败/跳过 | `review-fix/10-profile-public.log` |
| 修复后离线页面 | 2/2，0 失败/跳过 | `review-fix/11-offline-public.log` |

这些是分阶段执行结果，不能相加冒充最终版本一次全套测试。837d 只改变记录模块、其测试和说明，没有再改 main、客户端或后端；因此在该修复后重跑完整记录专项及受影响的默认关闭兼容检查，没有重复 GPU 或 A 全套测试。

保留失败：首轮兼容 87/89（`development/10-affected-regression.log`）暴露新增记录误改文字计时，修复主流程后原两例定向通过，再完成 1191 的 89/89；没有放松旧测试。`development/12-acceptance-final.log` 为 15 通过、1 次 90 秒测试超时取消，不算通过。独立阶段诊断正常后只将加速用例的测试时间预算增至 180 秒，最终 16/16 通过；30 分钟工程门槛不变。

审阅修复目录中 01/06 是原版本红例；02/03 虽文件名有 green，实际因 Python 别名/失效默认解释器仍失败；04 是异步状态等待失败，07 为外部测试时钟采样竞态。它们均不算通过，08 才是新增四项最终通过。`review-fix/commands.txt` 是实际历史命令说明，部分本地辅助脚本未作为产品交付；最终可复现入口是上述仓库公开页面测试。

## 5. 浏览器、系统、renderer 与 API

见 `environment.json`：Chrome `157.0.8103.51`，Windows UA 为 `Windows NT 10.0; Win64; x64`，实际 renderer 为 NVIDIA GeForce GTX 1650 Ti / ANGLE Direct3D11，WebGL 2；未强制 SwiftShader。Node `24.18.0`、Python `3.11.9`。不能与 A 的 RTX4060 浏览器长稳或既有 Intel renderer 证据混报。

模型 HTTP 替身使用既有 v1 会话和 v2 逐句协议，未增加生产 API。真实 API/SQLite 测试使用本候选 `src` 和随机本机端口、明确的 SyntheticModels，不调用远端模型。`profile-api-source.json` 的 `a_source_sha` 为 null，按实际 14 个源文件 SHA256 追溯；根工作树逐文件复核 14/14 一致，不沿用旧硬编码 A26 标识。契约为继承的 `docs/development/profile-api.md`，包含 dbfe322 的明确 stale_epoch 一次确认重试规则。

## 6. 自动化证据与物理证据

自动化：公开页面点击、真实 HTMLAudio 播放固定合成音、固定录音输入、浏览器时钟和存储边界、同 BrowserContext 双页面共享草稿、真实 HTTP/SQLite 的合成模型联调。原始日志分别在 `development/`、`review-fix/`。逐文件完整性索引为 `sha256sums.json`，本目录 `-text` 属性保留 Git 原始字节。

物理：本轮没有新增真人录音、独立屏幕/扬声器原始视频、校准或 40 事件标注，也没有新的目标机 30 分钟整机验收。虚拟时钟推进 30 分钟和 20 个音频回合只验证计数逻辑。导出始终 `engineering_acceptance: not-assessed`；无采集、模糊和无法配对事件不能填造通过。没有把真实用户音频、档案数据库或模型上传 Git。

## 7. 未解决条件及复现

- 本机 `http://127.0.0.1:18000/v1/health` 在 `health-check.json` 所记时点无法访问，类型 HttpRequestException；只说明此本机入口探测不可用，不推断远端进程状态。没有重启或部署 A 的服务。
- 真实麦克风贯通、全部固定阶段的物理 500ms 停止、独立校准的 40 事件 95%/200ms、最终混合版本整机离线仍待执行。独立同步素材目前暂无。
- 3 秒首响仍是优化项，A 既有报告未达到；本轮没有新的模型性能测量。
- 跨页草稿问题已由原版同源双页面稳定复现并在 837d 修复，标准/规格复审均无新增可执行问题，详见 `review.md`。

## 8. 交给 A 的顺序与依赖

将 B 最新分支正常合入 A 集成分支；它已包含 0627 历史，不要重复应用 dbfe322 或 patches 中的旧补丁。不直接合 main。按 0a 功能、1191 保留 A 集成、a934 交接更新、837d 所有权修复及后续证据提交顺序审阅即可。

A 管理服务和 GPU 窗口，确认冻结完整 SHA、health、真实模型/音色、统一 profiles-db 和现有 v1/v2 契约，再让操作者运行真实场景。B 未改变后端接口、模型、部署或研究冻结基线。07 保留 A 的 closed；04/09 仍 open；05/06/10/11 由 A 统一收口，不能用本轮工具完成关闭。

## 9. 操作者采集清单

1. A 安排可用服务窗口，冻结完整代码、模型/音色、资产及配置，记录系统、GPU、浏览器实际 renderer、设备和 health。
2. 用全新本地证据目录 `artifacts/b-engineering-private/<冻结SHA>/<条件>/<attempt>/` 保留全部成功、失败与重启；不要上传原始个人材料。首页手动开启验收记录，填写 SHA 与实际条件。
3. 真人开始/结束发言核对 ASR、回复意义、Vivian、表情和嘴部；测权限拒绝、设备占用、空录音、重试与音轨释放。
4. 当前头部混合表情/注视，用独立设备同时采实际屏幕与扬声器，前后独立校准；冻结的 40 事件逐个标注，缺失/模糊计失败。不要以内部参数、canvas 或标签页声音代替物理证据。
5. 逐阶段测停止、迟到隔离、断连与恢复，保留全部原始音画；由校准后的保守区间判断 500ms，勿用本机 pause 软件时间替代。
6. 最终同一冻结组合连续至少 30 分钟、完成至少 20 轮，保留 A 的资源采样。重载/重启/隐藏缺口按段复核，不拼接窗口；结束后先导出再显式清空，并由 A 合并其他验收结论。

本轮未取得精确 token 用量，也未声称改变宿主思考强度。
