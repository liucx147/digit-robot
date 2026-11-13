# 开发者 A：开始阶段交付与接入说明

本轮依据现行数字人规格 v1.1 和任务 02，实现原始学生文本对话，并分别建立 ASR/TTS 单样例基线。用户本次指定的三份 Word 与既有 deliverables 的同名文件 SHA-256 完全相同，属于含实体映射的旧范围；当前仍按数字人优先推进。

## 实际服务器与环境

```text
ssh -p 43903 root@connect.westb.seetacloud.com
项目：/root/autodl-tmp/digit-robot
LLM 环境：/root/autodl-tmp/digit-robot-envs/llm
ASR 环境：/root/autodl-tmp/digit-robot-envs/speech-asr
TTS 环境：/root/autodl-tmp/digit-robot-envs/speech-tts
权重：/root/autodl-tmp/models/
```

实测 GPU 为 NVIDIA GeForce RTX 4090 D、24564 MiB，驱动 580.105.08；Python 3.12.3，PyTorch 2.8.0+cu128。服务器 SSH 非交互 shell 未默认激活 Conda，使用下述绝对 Python 路径。环境、权重和项目均放数据盘；三个模型依次运行，训练未开始。

LLM 使用 Transformers 5.22.2、BF16、SDPA、greedy、关闭 thinking、最多生成 512 token。ASR/TTS 官方包锁定不同 Transformers 版本，因此各用独立 venv，共用系统 CUDA PyTorch。安装清单在 `requirements/`，完整实测依赖在 `reports/m1/`。

## 启动文本对话

```bash
cd /root/autodl-tmp/digit-robot
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  /root/autodl-tmp/digit-robot-envs/llm/bin/python -m digit_robot \
  --model-dir /root/autodl-tmp/models/Qwen3.5-4B
```

stdin 每行一个 JSON，stdout 每行一个结果；诊断写 stderr。输入为 `{"type":"message","text":"中文"}` 或 `{"type":"reset"}`。输入文本限 1–2000 字，回复限 1–500 字。坏输入产生 `type:error,code:invalid_input`，后续行仍可处理。

给 B 的 A 侧消息契约 v0.1：

```json
{
  "type": "response",
  "utterance_id": "本次发言的UUID",
  "session_epoch": 0,
  "user_emotion": "sadness",
  "reply": "听起来这件事让你很难过，我愿意听你说。",
  "expression_intent": {"style": "gentle", "intensity": 0.35},
  "status": "ok",
  "attempts": [{"raw_output": "模型原始JSON文本", "error": null}]
}
```

- `user_emotion`：`happiness/sadness/anger/fear/surprise/disgust/neutral`。
- `expression_intent.style`：`gentle/cheerful/calm/serious`，`intensity` 为 0–1 有限数，拒绝 bool、NaN、Infinity。
- 无效模型输出最多尝试两次；最终回退为 `neutral`、`calm`、强度 0，且 `status:fallback`，所有原始尝试和错误可见。研究不能将回退的中性标签算正确预测。
- `reset` 清除上下文并递增 `session_epoch`；进程重启创建新会话。UUID 用于关联单次发言。当前是轮次 CLI，尚无浏览器停止通道；完整取消、播放队列和 500ms 停止随后续任务实现。
- 七类用户情绪与数字人的表达意图区分。B 根据自身资产定义表情映射，不把用户情绪直接当动作命令。当前契约的长度和 style 枚举是本轮实施选择，后续联调修改时应同步消费者。

## 真实模型结果

LLM 原始证据为 `reports/m1/llm-{source,baseline}.json`、`llm-input.jsonl`、`llm-output.jsonl`；三次回复共用一个会话入口，中间执行 reset。

| 项目 | 本轮观测 |
| --- | --- |
| 学生 | Qwen3.5-4B，未经本项目训练或适配 |
| ModelScope 固定 revision | `ed182e32090db791077e12e0f58d22f3daafa173` |
| 模型加载 | 5.375s |
| 三次回复总生成 | 11.711s |
| PyTorch CUDA allocated 峰值 | 9,335,646,208 字节，约 8.70 GiB |
| 结构输出 | 3 次均 `ok`，解析失败 0 次 |
| 第一轮 | 输入考试失利、难过；输出 `sadness` 与 `gentle`，回应当前感受 |
| 第二轮 | 明确承接“小林”姓名及考试上下文 |
| reset 后 | 代次变为 1，明确表示不知道姓名，没有引用“小林” |

上述语义结论来自对原始输出的代码审阅，不替代独立人工质量评分。原始回复存在“你已经尽力”等未经核实的安慰性假设，后续共情质量评估应保留此观察；本轮未为提高样例表现修改提示或训练。

TTS 生成 24kHz、4.32 秒中文固定音色样例；ASR 对该合成音频返回“你好，我在这里，愿意认真听你说。”。详细时间、显存、来源许可和复现方式见 [语音基线](speech-baseline.md)。样例在 `samples/m1-speech-tts.wav`。

模型运行均使用本地权重和离线标志。另以验证启动器阻断 Python Internet socket，记录在 `reports/m1/llm-network-denied/` 及语音报告；其范围是验证进程，不是内核隔离或整机物理断网验收。

## 验证、许可与下一步

自动测试经公开文本入口替换外部模型边界，覆盖上下文、重置、字段校验、有限重试、回退、深层 JSON 错误后恢复。真实模型报告与替身测试分别保存。规范与规格两轴审查见 `reports/m1/code-review.md`。

权重来源、固定版本、逐文件 SHA-256 和上游许可声明已保存。LLM 上游模型卡与语音官方元数据声明 Apache-2.0；音色、三维资产、后续数据和完整依赖的使用场景仍应分别核查。教师 API 本轮调用为 0、费用为 0，未开始蒸馏或准确率评测。

后续联合开发以 B 的任务 01（本地音频驱动可见三维头部）为前置，推进任务 03 的文本→情感语音→表情；再接入麦克风、停止和异常恢复。本轮三个模型分别可运行，不据此宣称全模型常驻、完整系统 30 分钟/20 轮、200ms 同步或 500ms 界面停止达标。
