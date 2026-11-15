# 数字人：离线情感语音服务

实施依据为 `.scratch/digital-human-emotion/spec.md` v1.1。当前提供 ASR→情感对话→TTS 的本地 HTTP 服务 v0.2，以及独立文本入口和模型基线。服务器为 RTX 4090 D 24GB。

## B 从这里开始

- [HTTP 接口、隧道与播放规则](docs/development/b-voice-api.md)
- [浏览器 fetch 与停止样例](examples/b-client.js)
- [OpenAPI 契约](docs/api/voice-openapi.json)
- [真实语音链路验证](reports/voice-chain/chain-report.json)

服务默认监听服务器 `127.0.0.1:8000` 并在根路径提供 `web/` 页面；通过 SSH `-L 18000:127.0.0.1:8000` 后可打开本机18000端口。输入支持文本和 PCM WAV，提供状态、停止、重置及音频下载。安装 API 依赖使用 `pip install -e '.[api,dev]'`。B 的文本、麦克风和三维播放已接入，使用方法见 [页面语音说明](web/README-voice.md)。

## 安装与检查

```bash
python -m venv --system-site-packages .venv
source .venv/bin/activate
pip install -e '.[api,dev]'
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

## 开发者 B：浏览器说话头与同步测量

共同仓库为 [liucx147/digit-robot](https://github.com/liucx147/digit-robot)。A 的文本对话入口和模型代码保持在 `src/digit_robot/`；B 的浏览器页面位于 `web/`，独立测量工具位于 `src/digital_human/`。文本和固定中文录音已贯通 ASR → LLM → TTS → 数字人链路，实际麦克风和最终整机指标仍待验收。默认外观已改为可旋转/缩放的中性实体头部。接入契约见 [A 交接说明](docs/development/developer-a-m1.md)，B 的运行与实际状态见 [B 运行指南](docs/development/developer-b.md)。

B的历史导入与后续集成记录分别保留在任务文件。`codex/b-voice-integration` 已合入 `main`；实际中文录音、模型上下文问答失败和软件计时详见 `reports/b-microphone/2026-11-15/`。新实体头部的物理声画同步、完整停止、离线整机和持续运行继续按票验证。

从项目根目录启动本地页面：

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory web
```

浏览器打开 <http://127.0.0.1:8765/>，载入中文录音示例后播放，也可选择本地音频。页面使用仓库内的资源；摄像头权限由用户在浏览器中开启。01 的本地音频说话头和 08 的人脸位置注视已有独立功能验收记录。模型和语音基线仍按上文各自的环境运行，不能以静态页面启动证明完整模型链路完成。

测量页面为 <http://127.0.0.1:8765/measurement.html>。冻结输入、采集、独立标注与报告命令见 [测量说明](web/README-measurement.md)，当前证据和缺口见 [09 验证记录](docs/development/ticket-09-validation.md)。09 已提供工具和边界验证，仍需独立校准的实际屏幕与扬声器采集及全部 40 个事件的独立标注，达到 95% / 200ms 门槛后才能关闭。浏览器软件采集、合成测试和未标注的报告均不能代替此验收；完整系统 30 分钟 / 20 轮、停止和离线等指标另按任务验证。

合并后的普通 Python 检查可用现有开发环境运行，不需要下载模型：

```powershell
$env:PYTHONPATH='src'
python -m pytest -q
python -m unittest discover -s tests/measurement -v
python -m mypy src
python -m digit_robot --help
python -m digital_human.measurement_cli --help
```

浏览器回归的依赖配置和命令见 [Web 说明](web/README.md)。素材来源、再分发许可和校验值保留在 `web/` 内，使用时一并保留。B 的运行不需要用户把自己的音视频、私钥、模型权重或凭据提交到仓库。

新事项按仓库的 GitHub 跟踪规则维护；现有 18 张任务继续保留在 [本地索引](.scratch/digital-human-emotion/issues-index.md)，尚未迁移，不重复发布。既有任务的 `Status` 是分诊标签，`State` 单独表示 open / closed 生命周期，详见 [跟踪约定](docs/agents/issue-tracker.md)。
