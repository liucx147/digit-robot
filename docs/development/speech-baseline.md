# 开发者 A：M1 离线语音基线

依据当前 `.scratch/digital-human-emotion/spec.md` 的数字人首期范围，验证预训练 ASR/TTS 的本地加载及单样例推理。没有训练语音模型，也不接入实体设备。本轮服务器是 RTX 4090 D 24GB；原规格的 5090 配置尚不能视为在本机验证通过。

## 实现与环境

入口为 `scripts/speech_baseline.py`。仅接受存在的本地模型目录与本地音频文件；导入模型包前强制启用 `HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1`，模型使用 `local_files_only=True`。BF16、SDPA、单样例推理，未安装 vLLM 或 FlashAttention。

官方依赖锁定不同 Transformers 版本，因此使用两个独立 Python 3.12 venv，以 `--system-site-packages` 复用服务器的 `torch==2.8.0+cu128`，不改全局环境：

| 任务 | 虚拟环境 | 安装清单 | 核心版本 |
| --- | --- | --- | --- |
| TTS | `/root/autodl-tmp/digit-robot-envs/speech-tts` | `requirements/speech-tts.txt` | qwen-tts 0.1.1、Transformers 4.57.3、torchaudio 2.8.0 |
| ASR | `/root/autodl-tmp/digit-robot-envs/speech-asr` | `requirements/speech-asr.txt` | qwen-asr 0.0.6、Transformers 4.57.6 |

安装包准备阶段使用网络；基线推理只使用本地资源。默认 HTTP pip 镜像曾超时，实际安装改用 `https://pypi.tuna.tsinghua.edu.cn/simple`。权重通过 Qwen 官方 ModelScope 仓库下载，先用 `git ls-remote` 固定提交，再按提交下载：

| 模型 | ModelScope revision |
| --- | --- |
| `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` | `54dfa57e196341bfa4994c97ad1f0f874964eeab` |
| `Qwen/Qwen3-ASR-0.6B` | `4ce9cc728b473a5aedbe7b6e1ea45646316824dc` |

模型位于 `/root/autodl-tmp/models/<模型名>/`。每个目录保留原始 README、模型配置及权重，另有 `speech-source.json`（来源、revision、逐文件 SHA-256）与 `speech-model-info.json`（官方模型元数据及许可声明）。后者是报告中 `license_source_path` 指向的本地证据；元数据许可声明不替代对预置音色及使用场景的独立审查。

两个固定 revision 的 README front matter 均标注 `license: apache-2.0`，与官方模型元数据一致。已下载资源共计 TTS 4,520,218,344 字节（含 682MB speech tokenizer）和 ASR 1,880,618,978 字节，字节数包含各目录的配置及保留元数据，不是 GPU 占用量。下载工具使用 `modelscope==1.40.3`；各环境完整版本快照见下方 freeze 文件。

## 公开 CLI

```bash
/root/autodl-tmp/digit-robot-envs/speech-tts/bin/python scripts/speech_baseline.py \
  --task tts \
  --model-dir /root/autodl-tmp/models/Qwen3-TTS-12Hz-1.7B-CustomVoice \
  --text "你好，我在这里，愿意认真听你说。" \
  --speaker Vivian --instruct "用温柔、关切、平静的语气说话。" \
  --output-dir reports/m1/speech-tts

/root/autodl-tmp/digit-robot-envs/speech-asr/bin/python scripts/speech_baseline.py \
  --task asr \
  --model-dir /root/autodl-tmp/models/Qwen3-ASR-0.6B \
  --audio reports/m1/speech-tts/speech-tts.wav \
  --output-dir reports/m1/speech-asr
```

报告包含模型来源与许可证据路径、软件版本、GPU、原始公开 API 输出、模型加载和推理耗时、CUDA 峰值已分配/预留显存；TTS 保存 PCM WAV、采样率、时长和文件哈希，ASR 保存输入音频属性及转写文本。失败返回非零退出码并写 `status: error` 与实际错误；不能把替身或空结果视作模型成功。

## 2026-11-13 实机结果

两项按顺序在 RTX 4090 D 上独立运行，退出码均为 0。测试时在导入模型包前用验证启动器拒绝 Python `AF_INET`/`AF_INET6` 的 `socket.connect` 和 `connect_ex`；两项均没有连接尝试。该证据范围是本次 Python 推理进程，并非整机物理断网测试。容器不允许 `unshare -n`，因此未宣称完成内核网络命名空间隔离。

| 实测项 | TTS | ASR |
| --- | --- | --- |
| 模型加载耗时 | 5.816s | 6.842s |
| 单样例推理及产物记录耗时 | 4.947s | 1.027s |
| 总运行耗时 | 12.386s | 9.471s |
| CUDA 峰值 allocated | 4,280,701,440 字节 | 1,876,073,984 字节 |
| CUDA 峰值 reserved | 4,339,007,488 字节 | 1,897,922,560 字节 |
| 结果 | 24kHz、单声道、4.32s PCM WAV | `你好，我在这里，愿意认真听你说。` |

TTS 输入即 `你好，我在这里，愿意认真听你说。`，使用 Vivian 固定音色和温柔关切指令。ASR 输入是该次 TTS 产物，原始采样率 24kHz；未加载 ForcedAligner，时间戳为 null。这些是单次新进程启动样例，不是吞吐、人工语音准确率或情感听感评测。运行日志中的 SoX 可执行文件缺失、FlashAttention 未安装及非采样 temperature 提示未阻止本次真实生成/转写；当前仅验证了所用 CustomVoice 和 Transformers 路径。

证据文件：

- [TTS 原始报告](../../reports/m1/speech-tts/speech-tts-report.json)、[ASR 原始报告](../../reports/m1/speech-asr/speech-asr-report.json)。报告中的绝对路径指向服务器原始产物。
- [合成语音样例](../../samples/m1-speech-tts.wav)，SHA-256 为 `79971ffd455dc3c56a193cd1d6b7ad4936f874d62166345e0ad2768256cf0817`；ASR 输入哈希与其一致。
- [TTS 环境 freeze](../../reports/m1/speech-tts/speech-tts-freeze.txt)、[ASR 环境 freeze](../../reports/m1/speech-asr/speech-asr-freeze.txt)。
- 两个报告目录各保留 `speech-source.json`、`speech-model-info.json`、固定 revision 的 `README.md` 及真实运行日志；可核对模型与许可来源、文件 SHA-256、脚本 SHA-256 和网络 guard 的限定证据。
- `reports/m1/speech-offline-smoke-launcher.py` 保留本次 TTS/ASR 实测启动器；`SPEECH_BASELINE_TASK=tts` 或 `asr` 选择任务。另提供 `speech-network-guard.py --network-report <路径> <目标脚本> <原CLI参数...>` 供其他基线复用同一 socket 阻断机制，并独立保存 guard 证据。其 `--help` 透传与 `connect` / `connect_ex` 拒绝探针已通过，见 `speech-guard-selftest-report.json`。

## 验证边界

- TTS 样例使用官方预置固定音色和明确情绪指令；是否满足人工听感要求仍需听审。
- 用该合成 WAV 驱动 ASR，仅证明离线 TTS→ASR 管线可运行，不是人工语音准确率、噪声鲁棒性或流式端点评测。
- 此项不证明全部模型常驻并发、用户完整交互、浏览器音频同步、500ms 停止或 30 分钟稳定性达标。
- 模型错误、依赖缺失、未完成下载或未运行均应如实保留，不能替换为成功记录。

## 官方依据

- [Qwen3-TTS README](https://github.com/QwenLM/Qwen3-TTS)：CustomVoice 的 `generate_custom_voice`、固定 speaker 与 instruct 用法。
- [Qwen3-TTS pyproject](https://github.com/QwenLM/Qwen3-TTS/blob/main/pyproject.toml)：qwen-tts 0.1.1 及依赖约束。
- [Qwen3-ASR README](https://github.com/QwenLM/Qwen3-ASR)：Transformers 后端 `from_pretrained` 与 `transcribe`，流式需独立验证。
- [Qwen3-ASR pyproject](https://github.com/QwenLM/Qwen3-ASR/blob/main/pyproject.toml)：qwen-asr 0.0.6 及依赖约束。
- [官方 TTS 模型仓库](https://modelscope.cn/models/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)、[官方 ASR 模型仓库](https://modelscope.cn/models/Qwen/Qwen3-ASR-0.6B)：权重及许可元数据来源。
