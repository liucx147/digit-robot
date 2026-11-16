# A 后端执行记录

- 共同基线：f17443cc8178e6b611d0d9c832a6dca06945d065。独立A分支codex/a-engineering-backend，沿用既有resident-sentence-voice工作树，不改原main的用户文件。
- 契约先行提交ffab18c已推送。B会话链接由用户给出，但桌面跨主机会话工具无法定位，未宣称投递成功；已通过Git读取B分支fd57db9交接，核对共同完整SHA。B的07界面仍等待A契约。
- 使用writing-plans与executing-plans按任务执行，行为变更按TDD。契约选择和SQLite实现由用户详细执行提示授权，不重复请求设计批准。
- Profiles首次5项测试因API不存在404而失败；实现后包括v1/v2共7项通过。真实SQLite重启、exclusive写锁失败原子性、跨档案、更新/清空历史失效及在途取消均覆盖。
- 真实TCP v1断连红灯：客户端关闭后状态仍generating；补请求归属取消后转绿，新轮次成功。ASR/LLM/TTS各阶段的v1/v2停止和失败恢复12项通过。
- 外部CPU进程fixture中，进程被kill后无恢复方法先红灯；下一轮单role重载转绿。ready元数据写失败留下子进程先红灯；构造清理修复后转绿。fixture不作为GPU真实推理证据。
- 初次A全量Python58 passed、30 subtests passed；mypy17源文件通过。后续增加no-store断言先红灯，待最终复测。
- A初次浏览器全量88/91：三个失败分别为迟到play回执、旋转中短音频自然结束、Stop失败用例按钮已disabled。相关web源码与测试相对f17443c完全未变；保留原失败日志，未修改B文件掩盖失败。B新分支已把默认渲染改为GPU，需在集成分支按实际renderer复验。
- 用户临时要求先合并已验收语音分支，并明确跳过剩余验证直接推送；main已从7251b70快进到f17443c，未包含A未提交功能或B新分支。合并工作树的Python36+30子测试及mypy16通过；剩余浏览器按用户要求停止。临时工作树受桌面主工作区保护未能归档，原始测试产物已保存到D盘工具临时目录。
- 4090只读快照：8003仍f17443c、API511071和ASR/LLM/TTS/TTS-next四个worker存活，GPU约20751MiB、utilization0%。这只是单点快照，尚未重启或部署A功能。
- Ruling: profile修改通过同一pipeline锁协调数据库提交与会话失效；DB写失败不改epoch。匿名旧入口继续可用，偏好作为JSON数据快照进入提示，不写进权重。
- Ruling: profile是实验室手动上下文选择，不是账户认证；真实档案数据不放公开隧道，A真实验证使用受控端口和合成档案。
- Token工具未提供精确累计计数，不能声称已精确计量80k预算。每阶段以测试和证据完成为准。

- no-store中间件曾干扰v1断连检测，专项复现后改为档案路由响应依赖，避免包装语音receive通道；38项相关测试转绿。

- Standards发现框架405无no-store，已新增405/404红灯并改为只包装ASGI send的响应头处理，保持receive原样，v1断连回归通过。Spec审阅指出活进程挂起无法恢复，新增不合作CPU外部进程红灯，超时标记unhealthy、下轮终止并重载后通过。Spec代理因服务用量限制未完成最终全量结论，不能写成两轴均0。
- 修复后Python59 passed、30 subtests passed，mypy17通过。原始A/B集成6e78db5的默认GPU浏览器93/93通过；此后只改后端缓存头和worker超时恢复，需在更新后的集成版本复验相关边界。
- 用户追加要求B分支也直接推main；main已从f17443c更新fd57db9，未包含A13f3d01及后续修复。A/B集成分支不等于main。
