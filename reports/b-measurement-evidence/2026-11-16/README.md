# 09测量证据核验：软件交付记录

基线B `83cf63936ab5f4c6cf24ba4195bfbaf3f48dfeff`。功能核验 `2b5220a72dda9316402dab2aa12d32982c0dc9a7`；清单异步错误修复 `555a861e8090d657cc1ad00cb567bde2f21f3979`；稳定测试素材 `f363081551f0edab3c36714510f801f52f84196d`。未改A后端、原冻结音频/ledger/40事件/95%与200ms规则，也未关闭09。

## 原始验证记录

| 文件 | 实际结果 |
|---|---|
| python-14.log | 14项CLI公开测试通过，含资产不符、缺条件、物理清单绑定、原数值边界。 |
| browser-11-before-review.log | 功能候选受影响测量页面11/11通过；含历史VRM软件录制，不能当当前头部或物理通过。 |
| cli-red.log | 修复前错资产/缺条件仍可40/40的失败回归，修复后保留0/40。 |
| stale-manifest-red.log | 修复前慢读旧坏JSON覆盖新清单的公开页面复现。 |
| page-5-after-review.log | 最终5/5通过，含旧读取异常隔离、当前坏文件可见失败、原始清单关联。 |
| page-existing-targeted.log | 最终旧权限/缺资源入口2/2通过。 |
| video-fixture-timeout.log | 一次现场生成微型视频的初始解码超时保留记录；改为固定已解码软件素材后5项通过。 |
| sha256sums.json | 上述证据及示例包的原始字节哈希。 |

不同版本与阶段的测试分别记录，不合并成一次“最终全量全绿”。最后修复只改清单导入代次保护和测试素材，Python计分器与冻结输入不变；按影响范围定向复测，没有重复无关全套。

## 可重复评分的反例包

`synthetic-bundle/` **不是物理采集**。它含固定纯软件颜色视频、操作者声明格式、40个仍为null的事件、原冻结ledger和fixture副本，以及原始失败报告。`physical-av`在这里仅用于格式/失败路径测试；不能据此声称观察到真实屏幕或扬声器。

在项目根目录设置PYTHONPATH=src后：

```powershell
python -m digital_human.measurement_cli score --ledger reports/b-measurement-evidence/2026-11-16/synthetic-bundle/ledger.json --annotations reports/b-measurement-evidence/2026-11-16/synthetic-bundle/annotations.json --output <新的本地报告.json>
```

最终代码已实际复核该包仍为 **0/40、invalid-capture-evidence**，原report不覆盖。fixture.wav是项目原有CC0公开测试录音副本，非用户录音；来源及许可见 [项目NOTICES](../../../web/assets/NOTICES.md)。ledger保留原字节，其license_notice相对路径记录原始web目录位置，不代表迁移后的目录结构。

## 操作者入口与剩余验收

运行本地静态页面后打开measurement.html：准备冻结输入，载入原始外部视频，选择physical-av，填写操作者与实际条件并明确确认对应关系。完整播放、可听实际声音分别声明，不能默认当成浏览器测量。下载清单，保留原媒体和原始PTS；独立校准仍pending，事件时间仍null，需实际独立复核后填写。音频-only和已知浏览器来源拒绝重标；换文件/范围/声明使过期导出失效。

用户本轮确认暂无真实素材。真实屏幕/扬声器同期视频、独立校准、40事件标注与95%/200ms结论继续待执行；工具完成不解除11的前置依赖。元数据和哈希保留声明及字节，不证明声明真实性。详见 [测量操作说明](../../../web/README-measurement.md) 与 [B交接清单](../../../docs/development/b-engineering-handoff.md)。
