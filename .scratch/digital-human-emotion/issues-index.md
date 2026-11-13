# 数字人优先任务索引

发布日期：2026年11月10日。已按用户确认的划分发布18张独立任务票。

[父规格](spec.md)为本轮范围依据。01至11为数字人工程，12至17为研究流程，18为冻结候选接入。工程验收不等待研究达标。

下表是发布时的直接阻塞关系快照。每张票的正文、验收和状态统一维护在独立文件中；后续以各票字段为准。本索引不替代任务票。

| 票号 | 独立任务 | 直接阻塞 |
| --- | --- | --- |
| 01 | [本地音频驱动可见三维说话头](issues/01-local-audio-talking-head.md) | 无 |
| 02 | [本地原始学生完成连续中文文本对话](issues/02-local-student-text-dialogue.md) | 无 |
| 03 | [浏览器输入文本得到情感语音和表情](issues/03-text-to-expressive-avatar.md) | 01、02 |
| 04 | [麦克风中文发言贯通数字人回应](issues/04-microphone-turn-dialogue.md) | 03 |
| 05 | [停止当前回应并拒绝迟到结果](issues/05-stop-and-invalidate-stale-results.md) | 03 |
| 06 | [异常可见且恢复不补播历史回应](issues/06-visible-failure-and-recovery.md) | 04、05 |
| 07 | [手动档案和跨会话偏好增查改删](issues/07-manual-profiles-and-preferences.md) | 03 |
| 08 | [人脸位置驱动数字人注视](issues/08-face-driven-digital-gaze.md) | 01 |
| 09 | [测量并达到可见嘴部同步门槛](issues/09-measurable-mouth-sync.md) | 01 |
| 10 | [单5090主机断网启动完整数字人](issues/10-offline-single-gpu-launch.md) | 04、08 |
| 11 | [冻结版本并完成数字人工程验收](issues/11-digital-human-engineering-acceptance.md) | 06、07、09、10 |
| 12 | [封存可审计的七类研究数据版本](issues/12-auditable-emotion-data-release.md) | 无 |
| 13 | [复现原始学生开发集基线](issues/13-original-student-dev-baseline.md) | 02、12 |
| 14 | [累计100元内生成并审核教师材料](issues/14-budgeted-teacher-data-generation.md) | 12 |
| 15 | [首轮单卡LoRA训练与开发集对照](issues/15-first-single-gpu-distillation.md) | 13、14 |
| 16 | [有界追加实验并冻结终评候选](issues/16-bounded-dev-iterations-and-freeze.md) | 15 |
| 17 | [统一留出终评并交付研究结论](issues/17-independent-final-research-evaluation.md) | 16 |
| 18 | [接入冻结学生候选并复验数字人](issues/18-candidate-integration-and-regression.md) | 11、17 |

发布时可立即开始：01、02、12。实际按两人和单卡资源排班；训练与交互分时运行。

下游任务须等待阻塞票完成；ready-for-agent表示任务规格可供接手，并不表示阻塞条件已经解除。发布任务不代表已开始开发、已有运行证据或研究已经达标。
