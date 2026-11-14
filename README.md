# 数字人：离线情感语音服务

实施依据为 `.scratch/digital-human-emotion/spec.md` v1.1。当前提供 ASR→情感对话→TTS 的本地 HTTP 服务 v0.2，以及独立文本入口和模型基线。服务器为 RTX 4090 D 24GB。

## B 从这里开始

- [HTTP 接口、隧道与播放规则](docs/development/b-voice-api.md)
- [浏览器 fetch 与停止样例](examples/b-client.js)
- [OpenAPI 契约](docs/api/voice-openapi.json)
- [真实语音链路验证](reports/voice-chain/chain-report.json)

服务默认监听服务器 `127.0.0.1:8000`；B 通过 SSH `-L 18000:127.0.0.1:8000` 访问。输入支持文本和 PCM WAV，提供状态、停止、重置及音频下载。安装 API 依赖使用 `pip install -e '.[api,dev]'`。三维页面及实际播放/动画仍由 B 接入。

## 安装与检查

```bash
python -m venv --system-site-packages .venv
source .venv/bin/activate
pip install -e '.[dev]'
pytest
mypy src
```

Windows 使用 `.venv\Scripts\Activate.ps1` 激活。模型运行环境与普通测试环境分开；服务器具体环境与实测证据见 `docs/development/developer-a-m1.md`。

## 文本交互

在已准备权重和 LLM 环境的主机上：

```bash
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 python -m digit_robot --model-dir /root/autodl-tmp/models/Qwen3.5-4B
```

每行输入一个 JSON，stdout 每行返回一个 JSON；启动与诊断信息写入 stderr：

```json
{"type":"message","text":"我今天考试没考好，很难过。"}
{"type":"message","text":"你觉得我下一步能做什么？"}
{"type":"reset"}
```

消息字段与 B 的接入说明见 `docs/development/developer-a-m1.md`。回复包含七类 `user_emotion`、独立的 `expression_intent`、`utterance_id`、`session_epoch` 以及 `status` 和原始尝试记录。`fallback` 必须按模型失败处理；不能当有效研究预测。`reset` 清空本次上下文并推进代次；重启进程创建全新会话。

## 重现真实基线

LLM 下载和执行分别进行；下载阶段需要网络，运行阶段使用本地权重：

```bash
python scripts/prepare_llm.py --model-dir /root/autodl-tmp/models/Qwen3.5-4B --output reports/m1/llm-source.json
python scripts/run_llm_baseline.py --model-dir /root/autodl-tmp/models/Qwen3.5-4B --output-dir reports/m1
```

ASR 和 TTS 的官方依赖锁定不同 Transformers 版本，各用独立环境，安装清单及用法见 `docs/development/speech-baseline.md`。三个环境逐个使用 GPU。模型不进入 Git；固定来源、文件校验值和实测报告进入 `reports/m1/`。
