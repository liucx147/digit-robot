# B 页面与测量验证记录（2026-11-16）

共同基线 `f17443cc8178e6b611d0d9c832a6dca06945d065`；实现提交 `34f78d4`（当前头部测量）、`bd5b256`（麦克风占用恢复）。后续证据目录修正将与本文一并提交。

## 实际验证

Windows，Chrome 157.0.0.0 headless，Node内置test runner；默认渲染实测为 `ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)`，WebGL2。软件诊断另设 `BROWSER_RENDERER=swiftshader`，1项通过，绝不算默认GPU样本。没有GPU模型推理；API实际版本未查询成功：18000未启动，操作者已确认。A同SHA确认及真实模型联调未完成。

以下均实际执行；运行前设置：

```powershell
$env:PLAYWRIGHT_MODULE='C:\Users\30415\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:PYTHON_EXE='E:\digital robot\_work\voice-dev-py311\Scripts\python.exe'
```

| 命令 | 实际结果 |
|---|---|
| `node --test --test-concurrency=1 web/tests/measurement-page.test.cjs web/tests/solid-head-public.test.cjs web/tests/microphone-public.test.cjs web/tests/sentence-public.test.cjs` | 46/46通过，169.79秒；浏览器套件串行 |
| `node --test --test-concurrency=1 --test-name-pattern='occupied microphone\|default measurement' web/tests/microphone-public.test.cjs web/tests/measurement-current-head.test.cjs` | 两个新增用例2/2通过（真实使用参数中竖线没有反斜线） |
| `node --test web/tests/measurement-current-head.test.cjs` | 最终证据目录修正后1/1通过，保存原始WebM和对应清单 |
| `& 'E:\digital robot\_work\voice-dev-py311\Scripts\python.exe' -m pytest tests/measurement -q`（PYTHONPATH=src） | 9 passed，11 subtests passed；含固定40分母、重复/缺失/模糊与±199/200/201ms边界 |
| `git diff --check` | 通过 |

新用例先复现旧页面显示VRM而非solid-v1，再修复后通过。设备占用先因缺少中文占用提示失败，修复后重试可录音，停止释放音轨，未上传伪造成功输入。最初未提权浏览器运行遇本机网络访问限制；允许本机测试后才取得实际产品断言，不把环境失败当产品红灯。

## 软件证据

最终短采集在忽略目录 `artifacts/b-engineering/default/<尝试时间>/` 保存 `capture.webm` 与 `current-head-capture-manifest.json`；可按清单SHA核验。它验证当前资产、采集流程和renderer记录，提前结束时仍在前导静音内，明确不完整且无活动声音。旧的自动化脚本诊断仍在 `artifacts/measurement/`；其中长录制属于显式legacy VRM，不能替代solid-v1物理同步结论。

46项中首句提前起播、后句提前解码与乱序完成顺序播放、迟到结果与停止、录音权限/格式/释放、头部旋转仍可停止均属于公开页面和外部媒体/API seam 的自动化。它们不证明真实模型、物理500ms停止、95%/200ms或30分钟20轮。

## 审阅与交接

两个独立只读审阅轴（实现标准、规格）均未发现可执行缺陷；指出交接文档需一并提交，已纳入。未因软件通过关闭04/09，其他工单仍由A维护。档案契约缺失不做自创API。原始真人采集、档案数据库及模型不上传。

先按分支顺序审阅测量修复、麦克风恢复、文档/证据补充；不直接合main。具体缺口和操作者清单见 [交接说明](b-engineering-handoff.md)。

## 第二批：分句故障恢复与页面本地资源

修复提交 `1950c97`。先通过公开页面复现两个永久等待：服务已建立连接但不再输出事件；生成结束后音频下载一直不完成。修复后流在15秒没有有效事件时取消，每段音频下载必须在15秒内完成；失败通过既有Stop路径推进代次并清队列。两个期限是连接/下载保护，不是整轮首响保证，不代表三秒目标达标。原有短回复与提前下载/解码不变。

实际执行（沿用上述环境）：

- `node --test --test-name-pattern='stalled stream' web/tests/sentence-public.test.cjs`：修复前因一直等待失败，修复后1/1通过。
- `node --test --test-name-pattern='completed generation cannot' web/tests/sentence-public.test.cjs`：修复前音频下载无限等待，修复后在完整套件通过。
- `node --test --test-concurrency=1 web/tests/sentence-public.test.cjs web/tests/voice-api.test.cjs web/tests/voice-public.test.cjs`：41/41通过，64.84秒。
- `node --test web/tests/offline-page-public.test.cjs`：2/2通过，3.09秒。

新增八种故障：流停滞、下载停滞、无done提前结束、显式错误、网络断开、HTTP下载失败、损坏WAV、播放设备拒绝。每种均验证失败可见、恢复新轮、再次停止；实际使用浏览器音频与页面，模型/网络故障在外部边界受控注入，不能等同真实模型/物理验收。

页面本地资源测试在新页面阻断全部非本机请求，当前头部和本地样例可加载、播放、停止；缺少solid-head.js时明确资源失败且不替换成历史头部。没有连接模型服务，没有证明ASR/TTS/视觉的整机离线启动。第二批两个独立审阅轴均未发现可执行缺陷。

A远端分支再次获取仍是f17443c，档案契约仍缺失。现有v2客户端上限为3句/80字，与早期2句/60字约定存在差异，需A统一契约和生成约束；B未单方面修改跨端字段或上限。真人麦克风、物理停止/同步、档案和整机稳定性验收继续保持待执行。
