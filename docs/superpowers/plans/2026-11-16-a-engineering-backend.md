# A Backend Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 实现可验证的档案偏好后端，补齐停止恢复与部署准备，交B联调。
**Architecture:** SQLite ProfileStore + VoicePipeline统一会话失效化；v1/v2复用当前偏好快照。保留模型常驻和双TTS。
**Tech Stack:** Python、sqlite3、FastAPI、pytest。
**Spec:** .scratch/digital-human-emotion/spec.md；docs/superpowers/specs/2026-11-16-profile-backend-design.md；docs/development/profile-api.md。

## Global Constraints

不改密钥、不上传模型/用户数据；保留原服务；不改B归属源码；未完成物理或跨端验收的票保持open；研究12–18不在范围。

## Review Focus

偏好从历史复活；跨档案污染；修改期间迟到音频；数据库失败与重启；取消/超时后GPU锁释放。

### Task 1: 契约交接
- [x] 提交profile-api.md、设计和本计划；推送A分支，交B共同基线/接口。

### Task 2: SQLite存储与HTTP
- [x] tests/test_profiles.py先验证CRUD、重启、字段校验、失败原子性，观察红灯。
- [x] 新建src/digit_robot/profiles.py；server.py增加受限请求和CRUD，观察绿灯。

### Task 3: 会话与模型隔离
- [x] 增加绑定、更新、删除、在途取消、匿名与v1/v2兼容测试，观察红灯。
- [x] 修改voice.py、dialogue.py、sentence_pipeline.py、resident.py，复用提示快照与代次边界；专项、mypy。

### Task 4: 停止恢复
- [x] 在tests/test_voice_api.py、test_sentence_api.py、test_resident.py补各阶段停止、失败和重试场景；修复可复现缺陷，不扩展无关功能。

### Task 5: 部署准备与交付
- [x] 添加受控离线资源检查/启动说明、资源采样及回退流程；不切断SSH管理通道。
- [x] 全套Python/适当浏览器回归、两轴审阅；合成档案真实4090验证。
- [x] 更新A侧票进展但保留缺物理/页面验收的open状态；交B提交与证据。B尚未交付时不虚构集成或关闭11。
