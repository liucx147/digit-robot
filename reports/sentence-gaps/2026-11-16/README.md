# 句间停顿优化与 4090 实测

双 TTS 预合成与浏览器提前解码已部署到现有 8003 服务，入口仍为 http://127.0.0.1:18000/ 。代码版本 `0c65ae7`，分支 `codex/resident-sentence-voice`。刷新页面并重新连接服务可加载新播放器。模型与密钥未修改，权重未上传，8000/8001/8002 原服务保留。

## 原因与改动

实际运行元数据中，某轮第二句合成需要 5.956 秒，第一句音频只有 3.680 秒；只有一个 TTS 时，下一句来不及准备。该轮边缘静音约 80–90ms 开头、20–70ms 结尾，无法解释秒级等待。未导出用户这几轮的对话原文。

1. `ResidentModels` 增加可选第二个常驻 TTS 进程，两个进程读取同一份既有本地 Qwen3-TTS 权重。`--tts-workers 2` 启用，CLI 默认仍为 1。
2. `SentencePipeline` 在 LLM 验证完一句后立即提交合成；至多两个并发任务、每轮至多三句。合成可乱序完成，事件与播放严格按原句序交付；停止仍使旧轮次和音频失效。
3. 浏览器收到后续音频就下载并解码，当前句结束后直接取准备好的数据；首句不等待整段、不额外蓄积整轮音频。

没有修改语速、裁剪静音或用缓存回复代替模型推理。仍为逐句 WAV，而非 Qwen 模型内部 PCM 流式生成。

## 同条件前后对照

固定合成测试录音经真实 Chromium 麦克风边界、MediaRecorder、ASR、LLM、Qwen3-TTS 和数字人页面播放。音频输入 SHA256：`0f65021e44c5cb922e0b4c7a47ebf7eb66875c063d1a8fea79e86304094a4a4e`。各轮建立新会话，回复均为 38 字、3 句、总音频 8.080 秒。没有替换 API 或模型结果。

旧版 `c65b39f` 单 TTS 与新版双 TTS 各 5 轮热运行，均强制 SwiftShader 软件绘制三维页面。每组另外保留一轮 pilot；脚本旧字段 `cold-inference` 不能理解为这次真的重新加载冷模型。样本量有限，以下用中位数与最大值，不作总体 P95 承诺。

| 指标 | 单 TTS，5 轮 | 双 TTS，5 轮 |
| --- | ---: | ---: |
| 服务器首音频 ready，中位数 | 5.665s | 5.760s |
| 服务器整轮音频 ready，中位数 | 11.344s | 7.874s |
| 浏览器首句语音活动，中位数 | 9.237s | 9.282s |
| 浏览器整轮播放结束，中位数 | 19.630s | 17.451s |
| 播放器句间间隔，中位数，10 个边界 | 443.75ms | 33.25ms |
| 播放器句间间隔，最大值 | 900.90ms | **2185.00ms** |
| 成功轮次 | 5/5 | 5/5 |

合成完成明显提前，首句时延基本持平；不能据这组中位数声称所有尾部停顿都改善。双 TTS 最后两轮出现浏览器起播抖动；额外 3 轮 SwiftShader 补测也复现，中位句间间隔 500.65ms、最大 587.80ms，首句语音活动中位数 10.036s、整轮播放中位数 21.662s。服务器合成仍约 7.8s 完成。

播放时间线显示异常主要在 `play-request` 到实际 `playing` 之间；补测页面出现 191 个长任务，最长 293ms。这些观测支持浏览器负载也是停顿来源，但不证明所有抖动都有相同原因。

## 默认 GPU 渲染复核

移除强制 SwiftShader 参数后，实测 renderer 为本机 `ANGLE / NVIDIA GeForce RTX 4060 Laptop GPU / Direct3D11`；远端推理仍用 RTX 4090 D。另测 3 轮热运行及一轮 pilot，全部通过：

| 指标 | 双 TTS + 默认 GPU 渲染，3 轮 |
| --- | ---: |
| 播放器额外句间间隔，中位数 / 范围 | **19.15ms / 11.00–36.20ms** |
| 首句语音活动，中位数 / 最大值 | 8.991s / 9.052s |
| 整轮播放结束，中位数 / 最大值 | 17.115s / 17.189s |
| 服务器首音频 / 整轮音频 ready，中位数 | 5.785s / 7.834s |

这是不同渲染条件的追加复核，**没有配套单 TTS GPU 渲染对照**，不能将渲染收益全部归于双 TTS。`scripts/benchmark_sentence_voice.py --native-renderer` 可选择默认渲染并记录实际 renderer；原软件渲染默认保留以复现旧测量。

这里的间隔是前一句 `ended` 到后一句实际 `playing`，不含 WAV 自带的标点停顿。固定测试音频的开头静音约 90ms，三句结尾约 50/110/20ms（10ms RMS 窗口阈值 0.008）；所以听感中仍会有自然句间停顿。没有承诺任意长度回复、网络状况或高负载浏览器下完全零间隔。计时是软件观测，未通过物理扬声器回录验收。

## 常驻、停止与证据

部署目录 `/root/autodl-tmp/digit-robot-releases/resident-voice`，新日志目录 `runs/gap-dual/`。API PID 511071；ASR 511073，LLM 511336，TTS 511412 / 511677。测试后 PID 未变，ready 的 load_count 均为 1。观察到显存约 20.3GiB / 24GiB，属采样值而非全程峰值。第二个 TTS 额外加载约 4GiB 权重及运行开销，单卡资源不足时使用一个 TTS。

每句 `audio_ready` 的 `synth_started_ms` / `synth_finished_ms` 表明真实合成重叠；`segment-N/resident-tts.json` 的 worker 与 worker_pid 证明两个常驻进程均参与。`evidence-checks.json` 核对固定测试各轮服务器接收 PCM、生成 WAV 与浏览器上传/下载文件逐字节相同。

四组停止测试均通过：软件停止延迟分别 89.5 / 47.8 / 48.1 / 1.1ms；旧音频返回 410，随后 6 秒未恢复播放。新旧服务不应同时在 GPU 上推理。

服务器原始日志位置：

- `runs/gap-dual/api.log`、`runs/gap-dual/workers/{asr,llm,tts,tts-next}/`。
- `runs/gap-dual/<session_id>/<utterance_id>/events.jsonl`、`result.json`、`resident-asr.json`、`llm-output.ndjson`。
- 同轮 `segment-N/resident-tts.json`、`reply.wav`。
- 原单 TTS 对照在 `runs/resident/<session_id>/<utterance_id>/`；仅提取本次固定输入测试的白名单轮次。

原始 PCM/WAV、完整浏览器帧、截图、服务器白名单证据包保存在本报告目录，已被本目录 `.gitignore` 排除；公开 Git 仅提交说明、汇总与校验信息。未打包其他用户会话、配置密钥或模型文件。

## 验证与回退

- Python 全套：36 passed、30 subtests passed；测量 CLI 9 项通过；mypy 显式检查 src 的 16 个文件通过（`--follow-imports=skip`，不递归检查外部 Torch）。
- 浏览器/客户端全套：91/91；其中分句播放 9 项，包含后句提前解码、乱序准备保持顺序、停止不复活、错误流不算成功等。
- 先红后绿：双合成测试强制同时启动、第二句先完成，验证有重叠且 HTTP 顺序正确；播放测试给下一句解码额外 500ms，验证在上一句 ended 前就开始解码。
- Standards 审阅：0 项可操作缺陷；Spec 审阅：0 项具体缺陷。新增渲染选择与记录也分别复审为 0。

`--tts-workers 1` 可用当前代码回退到单 TTS；远端 Git 分支 `fallback/single-c65` 保留旧版精确代码。旧启动命令记录于 `runs/gap-dual/previous-deployment.json`。切换前核对并停止本部署进程及其子进程、确认显存释放，再启动选定模式；避免仅换端口就同时启动两个完整模型组。原 8002 仍健康，可按此前流程回退。

代码入口：`src/digit_robot/resident.py`（常驻池）、`src/digit_robot/sentence_pipeline.py`（有界合成与顺序交付）、`src/digit_robot/server.py`（启动参数）、`web/main.js`（预解码与播放计时）。
