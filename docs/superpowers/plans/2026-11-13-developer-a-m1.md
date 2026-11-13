# Developer A M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在实际 4090 D 上交付开发者 A 的首批离线模型基线和可复用文本对话入口。

**Architecture:** Python JSONL 文本交互入口隔离模型边界。LLM、ASR、TTS 分别在独立环境逐个核验；语音 smoke 与数字人全链验收分开记录。

**Tech Stack:** Python 3.12、PyTorch CUDA、Transformers、Qwen3.5-4B、Qwen3-ASR-0.6B、Qwen3-TTS-12Hz-1.7B-CustomVoice。

**Spec:** `.scratch/digital-human-emotion/spec.md` v1.1 和任务 02；附件三份 DOCX 与原 deliverables 完全相同，仅作为旧范围参考。用户本次指定实际 4090 服务器。

## Global Constraints

- 当前服务器实测 RTX 4090 D、24564 MiB；不把原 5090 假设当实测结果。
- 数字人优先；不实现实体映射、串口、舵机、B 的三维页面或视觉模块。
- 模型准备后只从本地目录加载；不训练 ASR/TTS，不调用教师或其他付费 API。
- 七类用户情绪与独立表达意图区分；非法模型输出最多尝试两次，保留原始失败。
- 当前任务不证明 30 分钟/20 轮、200ms 同步或 500ms 界面停止通过。

## Review Focus

- 非对象、非法 JSON、非有限数字不得崩溃或悄悄通过校验。
- 重置之后不能携带旧上下文；旧代次的输出不得被标记为当前会话。
- 模型解析失败及回退必须对调用方可见，不能当正确分类。
- 模型加载与运行不隐式下载文件或依赖远程服务。
- 合成语音识别仅为 smoke；不是人工语音准确率或研究收益证明。

### Task 1: 文本对话公开入口

**Files:** `src/digit_robot/`、`tests/test_dialogue_cli.py`、`pyproject.toml`。

**Interfaces:** `python -m digit_robot --model-dir <LOCAL_PATH>`；stdin 为 `message`/`reset` JSONL，stdout 为结果 JSONL。模型为可替换的外部边界，自动化测试仍走同一公开入口。

- [ ] 写一个公开入口失败测试，运行确认红灯，再实现对应最小行为，逐个推进。
- [ ] 验证七类情绪、独立 style/intensity、连续两轮、reset、错误输入和有限回退。
- [ ] 定期运行单文件 pytest 和 mypy；保存实际原始学生运行证据。

### Task 2: 真实模型与离线基线

**Files:** `scripts/speech_baseline.py`、`requirements/`、`reports/m1/`。

**Interfaces:** 语音 CLI `--task asr|tts --model-dir <LOCAL_PATH> --audio|--text --output-dir`。

- [ ] 按官方代码/权重来源核验版本和许可证，隔离不兼容的依赖。
- [ ] 数据盘保存环境和权重；固定 revision 与下载清单。
- [ ] 分别运行真实中文 LLM、固定音色 TTS、ASR；逐个驻卡并记录时间、显存及原始产物。
- [ ] 设置 offline 标志并实际执行；明确记录未验证的完整系统指标。

### Task 3: 交接与审查

**Files:** `README.md`、`docs/development/`、`reports/m1/`。

- [ ] 记录服务器路径、启动方式、消息字段及 B 可复用样例。
- [ ] 完成全量测试、类型检查和真实离线复验。
- [ ] 以实现前文档基线为固定点，并行执行 Standards / Spec 两轴代码审查，修复有效问题。
- [ ] 提交本轮源码和可复现证据到当前 main 分支，不自动推送或发布现有任务。
