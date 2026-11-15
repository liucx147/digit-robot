# 实体三维头部独立审查

审查日期：2026-11-15。工作树：`E:\digital robot\.worktrees\b-voice-integration`；基线：`5f2e28ec68cc5809514ce31fb036b71dfd6d279a`；对象包括未提交差异及新增头部、视角、设计和测试文件。

已读取当前工作树 AGENTS.md、issue-tracker.md、domain.md、当前 spec.md，以及 solid-head-design.md。外观要求以最新修正为准：原卡通和参考机械头均不采用，显示原创素色实体三维头部。没有修改实现，没有运行浏览器或 GPU。

## 有依据的问题

### [P2] 独立运行语音套件前应创建其新增产物目录

位置：`web/tests/voice-public.test.cjs:62`（前提在第 33 行）。

新增的 `frame-pixel-timing.json` 写入 `artifacts/solid-head/`，但此文件自己的 before 只创建 `artifacts/`。因此干净工作树单独运行 voice-public.test.cjs 时，写入会报 ENOENT；它隐含依赖另一个套件先建立该子目录，或者机器已有旧产物。将本套件的 mkdir 指向 `artifacts/solid-head` 并保留 recursive 即可解除依赖。主任务已确认此问题并计划修复；审查者最后一次读取时该修复尚未落入文件。本结论来自可直接确认的文件系统前提，未另起浏览器复现。

## 其余核查结论

没有发现其余足以提交的功能缺陷；不以风格建议补充问题数。

- 在 CPU 上加载项目现有 Three.js 和实际 createSolidHead/FaceController，确认 jawOpen 绑定头部及上下唇共三张 mesh，smile 同样绑定三张 mesh；头部开口影响 3096 个顶点，最大位移约 0.12，顶点均为有限数值。双眼 Bone 的四元数随 gaze 实际改变；blink 的可见眼球缩放由 applyFace 回调执行。
- avatar-view.js 只改 camera 和呈现，不写音频、播放代次或面部参数；具有 Pointer 取消/失去捕获处理、键盘操作、缩放限位及触屏可用的缩放按钮。仅静态确认接口，不声称已经完成移动设备实测。
- solid-head.js 的实际 SHA256 为 `5589660f42f67e7d5bd6e13b8248216ecbeaaaa14607da84cecced3a7e5afad6`，与默认清单一致。加载及模块导入异常进入现有可见资源失败路径，音频入口在成功加载后才启用。
- measurement.html 明确声明历史 VRM 范围，并以 `measurementFixture=vrm1` 选用独立旧清单。旧资产哈希和原镜头分支保持对应；新默认记录使用 solid-v1 及新哈希。未把历史测量认作新实体头部的同步通过证据。

本报告不替代主任务串行执行的公开浏览器回归，也不证明实际声画时延或完整离线工程验收。

## Resolved verification

The suite now creates artifacts/solid-head recursively in its own before hook. Root moved all pre-existing solid-head artifacts to a checked sibling backup, then ran the affected text case alone: 1/1 pass (7058ms), with a newly created directory. The original finding is preserved above; no unresolved findings remain.
