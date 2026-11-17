# LLM异常后永久gpu_busy：修复及4090验证

## 版本与交付

基线为用户已合入本地main的`0f1c7aa213287522ecf283cd60252aaf3f5833d6`。修复分支`codex/gpu-busy-recovery`：`4e5a430468c5b982d14419c1c6c34266851b611d`修复生产代码；`c215836f320257523c5b4fada53860c2921afa66`增强生产RPC适配器回归。两者的src/web树完全相同。当前远端运行c215836，后续本报告提交不改变受测产品代码；修复另行交付PR，没有自动合入main。

## 根因及最小修复

旧8003运行f17443c。11月17日12:46的请求持续停在generating，LLM输出文件0字节，GPU多次采样0%；前一轮有225字节LLM输出，校验ValueError后记录stream_failed。只读取类型、大小、时间和哈希，未公开原回复内容。

解析异常的traceback可能保留分句生成器及其LLM源；未显式关闭的RPC迭代器继续持有工作进程serial锁。下一轮已取得全局GPU名额，但阻塞在serial获取；原超时从取得serial后才开始，因此不会超时。GPU空闲也会继续向其他轮返回gpu_busy。

改动仅在A拥有的后端与测试：

| 文件 | 行为 |
| --- | --- |
| src/digit_robot/sentence_pipeline.py | 用closing明确关闭LLM源与文件包装迭代器，覆盖解析错误、取消及提前退出，不等待循环GC |
| src/digit_robot/resident.py | 将serial等待纳入阶段deadline，50ms轮询取消；超时沿用已有不健康worker恢复流程 |
| tests/test_gpu_busy_recovery.py | 禁用循环GC后验证错误回复不堵住下一轮；覆盖坏JSON、缺meta、meta后超长句及等待取消/超时 |
| tests/fixtures/resident_protocol.py | 支持生产适配器实际使用的text/done协议 |

正常并发仍保留单卡互斥，没有直接强制解锁GPU、扩大推理并发、添加等待队列或修改B页面。v1/v2、短回复、双TTS及档案契约保持兼容。健康模型不因输出校验错误而重新加载。

B对接仍按docs/development/profile-api.md及resident-voice.md：POST /v1/sessions/{sid}/stop返回新session_epoch；清空本地播放/下载队列后，POST /v2/sessions/{sid}/text携带{"text":"新的请求","session_epoch":新值}。v2成功与失败以NDJSON终态done/error判定，不只看HTTP200；不重发旧代次请求。

## 实际测试及保留失败

| 检查 | 结果及边界 |
| --- | --- |
| 原实现红例 | 4/4按预期失败：两种错误输出需GC才恢复；等待serial的取消/超时失效，red.log |
| 当前Windows全套 | 72 passed、42 subtests，python.log |
| 当前mypy | 17源码通过，mypy.log |
| 浏览器串行全套 | 4e5a430上144/144，0失败/取消/跳过；c215只增强Python测试，src/web一致，browser.log |
| Linux生产适配器专项 | API环境Python3.12.3上5/5通过；linux-adapter.log，原文件名linux-red.log不代表失败 |
| 两轴审阅 | Standards明文违规0、必要smell0；Spec可执行发现0；测试增量复审均0 |

本机Python3.12.7、Node22.16.0、Chrome157.0.8103.51；浏览器实际renderer为RTX4060 Laptop/ANGLE D3D11，远端推理GPU为RTX4090D。完整命令、源码哈希与路径在verification.json。

首轮检查有两个Windows测试错误地将Popen启动器PID等同于子解释器PID，及一个Generator类型标注问题；已改为RPC边界回执/生产适配器验证并修正标注，first-attempt.log保留原失败。首次Linux私有重放使用简化包装器，旧版与候选均未恢复，不能当作生产结论；当时主动拒绝候选并自动恢复原服务。更正为生产ResidentModels.stream_reply后完成下面的有效对照，未追加其他生产改动。初始脚本结果及拒绝/回退状态分别保留initial-simplified-*.json与initial-deployment.json。

## Standards

明文违规0、必要smell0。修复集中在迭代器资源释放与锁等待界限；使用真实CPU子进程验证，不放宽原断言。测试增量使用生产适配器及实际text/done协议，复审未发现可执行问题。

## Spec

可执行发现0。异常、取消及提前退出关闭源迭代器；等待锁允许取消与阶段超时。常驻、短回复、分句顺序与双TTS保持；未用本轮软件证据关闭物理验收。

两轴分别0项，均无最严重问题；审阅未替代根会话实际测试。

## 线上原始错误的有效重放

原225字节输出SHA256为`b75d2c7a3f89c0b6adec83a79dd76e56ca1db16fea47c7050f4edd91898a7911`，原文仅留远端私有诊断目录。通过同一生产ResidentModels.stream_reply和CPU子进程RPC、关闭循环GC进行对照：

| 版本 | 首轮错误后serial | 不依赖GC恢复 | 下一轮 |
| --- | --- | --- | --- |
| 旧f17443c | 仍锁定 | 否，等待1.5秒未结束；手动GC后可继续 | done |
| 修复4e5a430（与c215生产代码相同） | 已释放 | 是，观察约23.5ms | done |

这是CPU子进程重放，不是新的Qwen故障推理或GPU首音频性能数据。元数据见replay-old.json、replay-fixed.json。

## 真实模型、浏览器及停止后恢复

在c215的标准`python -m digit_robot.server`服务运行ASR、LLM与两个TTS常驻进程；没有替换模型或API结果。固定合成录音SHA256为`0f65021e44c5cb922e0b4c7a47ebf7eb66875c063d1a8fea79e86304094a4a4e`，经真实MediaRecorder→ASR→LLM→Qwen3-TTS→HTMLAudio/数字人。1轮初始推理、1轮暖机均成功：

| 观测 | 初始推理 | 暖机单次 |
| --- | ---: | ---: |
| ASR | 1.252s | 0.326s |
| 服务器首音频ready | 7.631s | 5.698s |
| 浏览器首回复语音活动 | 11.102s | 9.352s |
| 浏览器播放结束 | 19.227s | 17.457s |

两轮各38字、3句、8.08秒音频，顺序交付和最终闭口通过。只含一个暖机样本，不将自动脚本输出的单样本P95当作统计性能结论；本次没有证明首响加速或3秒目标，也不是新一次30分钟/20轮稳定性验收。

浏览器播放停止软件观测1.2ms，旧音频410，6秒未复活。另在真实LLM已发meta、尚未交付音频时Stop：旧流以turn_cancelled结束约140ms，同一会话epoch=1的新一轮LLM/TTS完成，3段WAV均非零、gpu_busy错误0。见real-llm-stop.json。这些时间不代替物理500ms停播与95%/200ms独立音画采集。

测试前后API及四worker PID、load_count=1、restart_count=0一致；末尾GPU采样20745MiB、0%利用率，不称瞬时峰值。runtime-proof.json与deployment-status.json记录实际角色、PID、源码目录及active状态。

## 部署、回退和数据

1. 保存原部署命令与版本，按实际PID、cwd、进程组及GPU归属核验后受控重启原服务，清除旧卡住会话；只操作digit_robot.server和其拥有的resident_worker。
2. 独立目录先部署4e5a430。私有重放包装器未给出有效通过依据时拒绝候选，监督进程自动回退原服务；该次未被记为通过。
3. 部署c215独立目录，在15分钟安全截止内完成真实验证后写accept，保留该标准CLI服务运行；验证失败或无人接收则自动回退。原发布目录和8000/8001/8002回退版本保留，模型、密钥不改，没有下载或上传模型权重。

当前服务8003、入口http://127.0.0.1:18000/，发布目录`/root/autodl-tmp/digit-robot-releases/gpu-busy-c215836`。操作元数据、标准CLI命令、PID、私有配置和原回退命令分别在`/root/autodl-tmp/gpu-busy-deploy-c215836/deployment.json`及`rollback.json`。SQLite固定为`/root/autodl-tmp/digit-robot-private/profiles.sqlite3`，跨发布目录复用，未上传数据库。

需要回退时，先协调窗口并重新核对8003实际PID、cwd与上述deployment.json，停止当前自有服务和worker、确认显存释放；然后在原发布目录/root/autodl-tmp/digit-robot-releases/resident-voice按rollback.json保存的command启动，并令PYTHONPATH指向该目录src，核验/v1/health和18000页面。不要按本报告历史PID直接kill。accept后的监督进程已退出，后续touch reject不会触发回退，须按上述保存的部署命令操作。

本轮真实浏览器原始数据仅留本机`D:\tools\codex-tmp\gpu-busy-browser-real-c215836\`，包括固定输入、上传PCM、NDJSON、合成WAV、帧和画面；公开提交只含必要日志、摘要及哈希。原用户回复225字节、原始个人材料、模型、数据库均未上传。

## 当前任务状态与后续

| 事项 | 结果 |
| --- | --- |
| 本次永久gpu_busy路径 | 完成：已复现、修复、回归、原错误生产适配器对照及4090新轮次验证，修复服务active |
| 05/06 | 后端软件证据补充；完整页面故障矩阵与物理验收未齐，保持open |
| 07 | 保留closed，契约不变 |
| 04/09/10/11 | 真人麦克风、独立音画、完整单机离线及新冻结版长稳仍待验，保持open |

下一步由B同步修复分支和接口不变说明，在统一冻结版本及GPU窗口完成剩余验收；研究12–18未启动。Token无法精确计量，本报告不声称精确用量或修改宿主思考强度。
