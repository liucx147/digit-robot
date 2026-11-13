# 数字人：开发者 A 的离线模型基线

实施依据为 `.scratch/digital-human-emotion/spec.md` v1.1。本轮建立文本对话入口及独立 ASR/TTS smoke，供后续数字人与研究使用。当前服务器为 RTX 4090 D 24GB，区别于旧文档的 5090 32GB 规划。

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
