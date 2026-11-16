# B 档案与页面软件验证证据

共同基线：`f17443cc8178e6b611d0d9c832a6dca06945d065`。B最终功能修复：`5e940746f138c4082ee00758913f4002f1d87825`。对接A源：`26c6b995c165d14753612aed4dad8dc78cedbaad`。未修改A后端、契约或main；B分支需由A与该后端集成。

| 原始文件 | 对应结果与边界 |
|---|---|
| [full-browser-before-review.log](full-browser-before-review.log) | 候选05ced2d完整串行：113通过、1失败、1条件跳过；失败是send后才注册响应监听的测试竞态。不得称此日志全绿。 |
| [identity-red.log](identity-red.log) | 修复前公开页面确认：绑定乙后偏好读取失败仍开放写入。 |
| [profile-public-green.log](profile-public-green.log) | 集中修复后档案专项12/12通过，含错误隔离、重连、停止、旧记录清除与防误写/删。 |
| [sentence-targeted-green.log](sentence-targeted-green.log) | 监听改在发送前注册后，下载停滞定向1/1通过。 |
| [profile-real-api-green.log](profile-real-api-green.log) | 真实A API/SQLite、合成模型的重启联调1/1通过。 |
| [real-api-report.json](real-api-report.json) | 精确A源、Chrome157.0.8103.51、实际Intel UHD D3D11、重启/读新值/清空/删除的验证边界。 |
| [profile-after-service-restart.png](profile-after-service-restart.png) | 重启后读取另一客户端更新的合成称呼；截图全部为合成档案。 |
| sha256sums.json | 上述原始文件的SHA256核验索引。 |

本轮没有用完整全套重跑覆盖审阅后的微小修复，而是针对受影响档案、下载回归和真实SQLite重新执行。日志不跨版本伪装成单次最终全量通过。

复现参数和命令见 [验证记录](../../../docs/development/b-engineering-validation.md) 与 [档案接入计划](../../../docs/development/b-profile-integration-plan.md)。真实API测试必须显式设置 `B_PROFILE_BACKEND_SRC` 指向冻结A源，否则明确跳过。测试模型输出是固定联调说明，声音是合成音调，不能证明真实Qwen/Vivian或偏好遵循；原始A服务与GPU未动。真人麦克风、物理500ms停止、40事件同步、单机离线和30分钟20轮仍待独立验收。

提交审阅重点顺序：`cf471b3` 档案页面 → `41947a7` 清除旧播放记录 → `5e940746` 身份确认失败隔离。建议将B完整分支合入A的审阅集成分支，保留先前停止/测量修复依赖，不直接合main。
