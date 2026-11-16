# B 档案页面接入计划与验证边界

2026-11-16。继续在 `codex/b-engineering-ui` 交付；本轮起点 `2910553`。

A新发布 `codex/a-engineering-backend` 的 `26c6b995c165d14753612aed4dad8dc78cedbaad` 已读取。契约 `ffab18c` 的 `docs/development/profile-api.md` 是唯一生产接口依据；A执行记录已核对双方共同完整基线 `f17443cc8178e6b611d0d9c832a6dca06945d065`。契约与后端文件归A，B不复制修改契约、不直接合main。

## 实施

1. 单独页面模块负责档案创建/列表/选择/退出/改名和两个明确偏好的增查改删，数据从A接口读取。浏览器可记住选中ID，不保存姓名、偏好或聊天副本。
2. 所有切换或修改请求前停止本地播放、录音、动画和下载队列。请求未确认时禁发新轮；采用返回的当前会话新epoch，失败可见并确认有效会话后恢复，防止旧档案结果复活。
3. 页面重载和服务重启后建立新会话，从真实服务端读取有效档案并显式绑定；已删除ID提示重新选择。匿名及旧后端兼容，不用API替身假装旧后端支持档案。
4. 用公开页面和有状态HTTP边界逐项红绿；浏览器套件串行。真实SQLite/API联调用A已发布源代码的独立本机CPU服务，模型与声音明确为合成，不占远端GPU、不修改部署。
5. 补停止时排队下载、解码、播放确认的迟到竞态，验证新轮成功且旧epoch不复活。代码与规格双轴审阅后提交B分支，07仍由A根据双方证据维护生命周期。

## 真实API软件联调

B的 `web/tests/profile-api-fixture.py` 只创建本机测试进程，使用A的真实FastAPI/SQLite及独立合成数据库。使用时先将指定A SHA的 `src/digit_robot/` 通过 `git archive` 提取到忽略的 `_work/a-profile-verification/`，将PYTHONPATH指向该目录的src；不改变B生产后端版本。

```powershell
$env:PYTHONPATH='<本地验证目录>/src'
& '<已安装Python>' web/tests/profile-api-fixture.py --web-root web --state-dir _work/a-profile-verification/state --port 18707
```

该进程health实际显示 `profile_memory:true`、`api_version:0.2.0`、`sentence_streaming:false`。模型回复固定为软件联调说明，声音为合成音调。此环境只能验证客户端契约、SQLite持久性、重启读取和页面行为，不能证明真实LLM偏好遵循、ASR、Vivian或工程音画验收。

真人麦克风、独立物理音画、实际500ms停止、完整离线及30分钟20轮仍保留原采集清单，不因档案软件联调关闭。
