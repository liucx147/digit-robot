# 06: 异常可见且恢复不补播历史回应

**What to build:** 从完整语音交互中遇到模型超时、音频失败或页面失联后，用户看到明确状态，恢复后可以开始新一轮，历史声音和动画不重放。

**Blocked by:** [04 麦克风中文发言贯通数字人回应](04-microphone-turn-dialogue.md)；[05 停止当前回应并拒绝迟到结果](05-stop-and-invalidate-stale-results.md)

**Status:** ready-for-agent

**State:** open

**Category:** enhancement

**Parent:** [数字人优先的单卡离线情感交互与蒸馏规格 v1.1](../spec.md)

## Acceptance criteria

- [ ] 通过公开交互入口演示模型超时、合成或播放失败、页面失联的可见状态。
- [ ] 失联和失败时不继续消费过期任务，恢复前清理旧结果并确认当前会话代次。
- [ ] 在ASR、生成、合成和播放的迟到或失败场景中，旧发言不能因恢复而重新生效。
- [ ] 恢复后完成一轮新的中文语音对话，不把旧发言补播当新一轮成功。
- [ ] 验证停止期间恢复及恢复后再次停止，保持已约定的取消语义。
- [ ] 保留失败原始证据和恢复过程，测试观察实际声音、画面和状态，不依赖内部函数调用次数。

## User stories

US21、US22


## A阶段进展（2026-11-16）

A后端已完成各阶段失败/超时后恢复、worker退出/挂起/RPC损坏后按role重载；4090真实ASR故障后的新轮次已完成ASR→LLM→TTS。页面完整故障矩阵和物理采集仍待联合验收，且04/05未关闭，本票保持open。 代码与全部成功/失败边界见[A后端验证报告](../../../reports/a-backend/2026-11-16/README.md)，B接口见[档案契约](../../../docs/development/profile-api.md)。本次不以软件测试替代物理验收。

## Comments（LLM异常后永久gpu_busy，2026-11-17）

基于main0f1c7aa修复未关闭的异常LLM源迭代器滞留serial锁、下一轮等待锁绕过超时的问题。4e5a430生产修复、c215836生产适配器测试增强；原225字节回复在生产适配器CPU重放中旧版需GC才恢复，新版无需GC约23.5ms继续。Windows72项/42子测试、mypy17、浏览器144项及Linux5专项通过（版本边界见报告）。

c215已在4090独立目录运行：真实固定录音浏览器两轮成功；真实LLM meta后Stop，旧流turn_cancelled结束，同会话新一轮LLM/TTS成功、无gpu_busy；四worker PID及加载次数保持。初次简化包装器重放误判引发的候选拒绝与回退也保留，没有混作通过。详见[本轮报告](../../../reports/gpu-busy-recovery/2026-11-17/README.md)。本次只补后端软件与真实模型恢复证据，未补齐全部页面/物理故障矩阵，State仍open。
