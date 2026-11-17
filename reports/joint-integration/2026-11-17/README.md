# B 验收记录工具接入 A/B 集成分支

共同基线：`f17443cc8178e6b611d0d9c832a6dca06945d065`。原 A/B 集成提交：`0627fcecf688e0a4fbc6283adb70dfdc78c22f37`。本轮 B 分支 `codex/b-engineering-ui` 最新交付为 `85562c5b1d0ed2ce018c44bab927f9cac241672d`，产品提交 `837d4b04ae408b987e7c6d4de2e9882f0059469f`；855相对837仅增加交付证据。B包含0627完整历史，A已在`codex/engineering-integration`正常快进接入。

随后仅修复一个测试文件的时钟竞态，提交`a6bde0857adf52ae11d58621315971bcf9d65044`；B产品与后端代码保持不变。本报告后的文档提交不改变受测源码。

用户提供的 README(1).md 与远端 B 交付说明在规范换行后完全一致。B的44份证据文件字节哈希及14个后端源码哈希逐一通过；A后端、Python测试和档案API契约相对0627无差异，正式切档修复dbfe322保留。核验元数据见verification.json。

## 新增交付与现状

| 项目 | 本轮结果 | 仍缺的条件 |
| --- | --- | --- |
| 验收记录工具 | 已接入；默认关闭，手动分段记录、故障保留、单页草稿所有权和JSON导出 | 只提供采集准备，不生成完整工程通过结论 |
| 04 | 固定录音及页面软件能力保留，open | 真人物理麦克风完整贯通 |
| 05/06 | 停止、旧结果隔离及恢复软件能力保留，open | 全部固定阶段的物理停播与系统恢复验收 |
| 07 | 保留A已关闭状态 | 本轮不另称新的真实Qwen档案实测 |
| 09 | 测量工具保留，open | 独立原始音画、校准及40事件95%/200ms |
| 10 | 页面离线检查保留，open | 单主机完整断网启动/重启及资源实测 |
| 11 | 采集准备增加，open | 新冻结候选真实30分钟/20轮、物理及离线完整验收 |

新增产品范围为web/acceptance-journal.js及main.js、index.html、style.css最小接点；新增公开测试acceptance-journal-public.test.cjs，操作说明为web/README-acceptance.md。记录不包含发言、回复、姓名、档案ID、偏好、错误原文或音频。软件计数按同一连续段，不能拼接15+15分钟，导出固定engineering_acceptance:not-assessed。

## 当前主机复测

本机Node22.16.0、Python3.12.7、Chrome157.0.8103.51，实际renderer为RTX4060 Laptop/ANGLE D3D11；与B的GTX1650Ti环境分别记录。浏览器及真实HTTP/SQLite用例使用明确合成模型和既有固定合成音，不调用远端Qwen。命令中的解释器及Playwright使用本机已有路径，无需安装或下载模型。

- Python：`python -X utf8 -m pytest -q`，67项、42子测试通过，见python.log。
- 类型：`python -X utf8 -m mypy`，17源码通过，见mypy.log。
- 首次全套：`node --test --test-concurrency=1 web/tests/*.cjs`，143通过/1失败/0跳过，见browser.log。
- 首次失败在新测试第184行：读取页面当前时间后通过另一次RPC调用clock.pauseAt，目标时间可能已过去，报Cannot fast-forward to the past。实际产品没有因此修改。
- 最小补丁在采集开始前暂停到未来时刻，再建立采集基线；保留隐藏400ms、UTC异常和30分钟门槛原断言。副本定向1/1通过，见clock-proposal.log。用户随后明确授权当前会话修改这一个B测试文件；正式修复后的串行全套144/144通过，0失败/取消/跳过，见browser-after-clock-fix.log。没有把分阶段结果相加冒充单次全套。

复现环境变量为PLAYWRIGHT_MODULE=D:\tools\gstack\node_modules\playwright，CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe，PYTHON_EXE=D:\cc-workplace\digital robot\digital robot\.venv\Scripts\python.exe；B_PROFILE_BACKEND_SRC/B_PROFILE_WEB_ROOT分别为本工作树src/web。完整路径和命令见verification.json。当前真实HTTP/SQLite生成的profile-report.json使用a_source_sha:null与14个实际文件哈希，重新逐一核验一致；browser-environment.json保存本机实际renderer。sha256sums.json记录本报告全部文件的字节哈希。

代码/规格两轴静态复审初轮新增可执行发现0；运行测试发现上述时钟竞态后，两轴复审均确认最小补丁保留原验证含义及最小改动原则，新增可执行发现0。原补丁在docs/development/patches/journal-test-clock.patch，正式版本已应用后勿重复apply。

## B 对接与运行边界

本轮不新增生产API；档案仍按docs/development/profile-api.md调用，v1/v2会话与逐句协议保持原约定。B同步集成分支后，操作者展开首页“验收记录”，填写完整冻结SHA和运行条件，再开始本段采集；结束后下载全部成功、失败、中断与重启记录，确认保存后再显式清空。采集中仅允许一个同源页面持有草稿。

本轮只读探测远端8003的/v1/health为200、status:ok；本机18000没有监听且健康请求不可达。启动本机SSH转发被自动审批审查拒绝，仅返回blocked by policy、没有具体原因，因此转发未恢复。没有重启远端服务、占用新GPU测试窗口或部署B候选。当前远端健康不代表已经运行855的新页面。

原8003和回退目录保留，后续部署前重新核对实际监听进程、冻结提交、profiles-db与模型/音色；不要按历史PID操作。恢复入口及候选部署另按原运维流程进行。本次没有修改密钥或上传音频、数据库、模型。

6a487c9在2026-11-16的真实4090D固定输入长稳仍作为独立历史证据：20/20、1850.438秒、首活动P95为9.435秒、0/20低于3秒；不冒充新B候选的长稳。下一步冻结含本轮工具的完整候选，在协调后的服务窗口运行真实组合，并补真人麦克风、物理同步/停止及受控单主机离线验收。研究12–18未启动。
