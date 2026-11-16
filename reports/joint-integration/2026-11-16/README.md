# A/B 最新集成与软件长稳

冻结版本：`6a487c9718d7d04debc83464dbf42ab4f1f62690`，包含A后端`7b888c0`与B`6112f87`的功能和证据。没有直接推main。原PR #1通过集成分支更新，main仍是此前用户要求合入的fd57db9。

共同起点为`f17443cc8178e6b611d0d9c832a6dca06945d065`。长稳后的最小修复提交为`dbfe3229da7ca2c61b52eeb4e503369cc4ea814c`，当前分支`codex/engineering-integration`；本报告之后的文档提交不改变受测产品源码。

## 当前集成回归

- Python65项、42子测试及mypy17源码通过。
- 浏览器全套123通过、1条件跳过；显式设置当前集成的B_PROFILE_BACKEND_SRC/B_PROFILE_WEB_ROOT后，真实HTTP/SQLite重启页面联调单独1/1通过，不伪称单次124/124。
- 上述SQLite页面验证使用明确标注的合成模型；A已有真实4090六个档案用例。用户本轮确认“那边07已经联调通过了”，本轮没有重新宣称07页面真实Qwen全链实测。
- B继承测试报告硬编码旧A版本26c6b9，本轮用actual-profile-test.json记录实际6a487c9、源码路径与文件SHA，并明确披露该旧字段。

## 至少30分钟/20轮软件稳定性

用户授权约35分钟独占GPU窗口后，独立受控8004部署完整模型与页面；单次初始试运行后20轮暖机均成功。暖机按95秒起点间隔执行，第一至最后暖机起点相隔1805.016秒；实测暖机窗口1850.438秒，即30分50.438秒，不以结束后空等凑时长。

源为既有固定合成中文录音，SHA256 `0f65021e44c5cb922e0b4c7a47ebf7eb66875c063d1a8fea79e86304094a4a4e`，每轮新会话。真实Chromium麦克风边界、MediaRecorder、ASR、LLM、Qwen3-TTS、实际浏览器播放和三维呈现均执行，未替换模型结果。20轮只代表这一固定输入、新会话场景，不是多话题或真人麦克风稳定性。

远端推理为RTX4090D，本机Chrome157.0.8103.51实际renderer为NVIDIA RTX4060 Laptop / ANGLE D3D11。所有轮次转写正确、回复38字/3句，实际非零WAV、发言与代次关联、顺序播放和最终闭口均检查通过。记录了原始NDJSON、PCM、WAV、面部帧和选定画面。

| 暖机20轮指标 | P50 | P95 |
| --- | ---: | ---: |
| ASR | 0.339s | 0.402s |
| 服务器首音频ready | 5.722s | 5.808s |
| 服务器全部音频ready | 7.784s | 7.871s |
| 浏览器首回复语音活动 | 8.964s | 9.435s |
| 浏览器播放结束 | 17.085s | 17.535s |
| 播放器额外句间间隔 | 16.0ms | 21.5ms |

最大额外句间间隔28.4ms，不含WAV自己的自然停顿。P95是固定输入的20次最近秩统计，不推广为任意中文的总体P95。首语音活动是软件能量观测，不是物理扬声器计时；本轮0/20在3秒内，三秒优化目标未达到。

API及四个常驻worker前后PID/加载记录完全一致，没有测试中重启。GPU运行阶段1913次约1秒采样，20343–20743MiB；这是采样范围，不是连续瞬时峰值。

末尾附加软件停止测试：pause观测2.3ms，旧音频410，6秒后仍未恢复。它不证明全部固定场景的物理500ms停播，也不替代40事件95%/200ms独立音画验收。

## 恢复与原始证据

远端独立监督进程在测试结束收到停止标记后关闭自有8004，按保存命令恢复原8003。恢复PID644043、health正常、无restore_failure。监督进程另有35分钟安全截止，SSH/本地脚本中断时也会按截止恢复。原18000隧道保留，本次额外18004隧道已关闭；没有变更密钥或模型，数据库和用户录音未上传。

原始浏览器数据在本报告目录soak-6a487c9/；完整运行GPU采样与测试驱动快照在raw/，仅保留本地。远端原件在/root/autodl-tmp/joint-soak-control-6a487c9/及独立joint-soak-6a487c9发布目录。公开Git只提交摘要、测试日志、实际版本记录和哈希，不提交整套音频/数据库。

结束后再次只读核验：原PID644043及四个子进程存活，8003的/v1/health正常，8004不再监听；本机18000的健康接口正常、页面返回200。具体检查时间与元数据见service-after.json。SHA256.json记录报告和本地原始证据的字节哈希，原始音频仍仅保留本地。

## 审阅问题与正式修复

两轴审阅新增两项具体问题，未用全绿基线测试掩盖：

1. 生成中切换/退出档案：中断HTTP使服务器先推进epoch，绑定可能携带旧epoch返回409。真实HTTP＋原客户端的新增两例均复现。最小副本补丁只在明确stale_epoch后确认当前会话并重试同一次绑定一次，真实HTTP两例通过；没有放松服务器epoch校验。
2. 继承的profile-real-api测试自动报告硬编码旧SHA。补丁改为记录实际源码路径与Python文件哈希，没有可靠Git版本时写未知；副本的真实API/SQLite重启页面测试1/1通过。

用户随后明确授权当前集成会话修复这两个B文件。正式修复dbfe322已应用，真实HTTP回归在tests/test_profile_client_contract.py；原补丁保留在docs/development/patches/供B审阅，不要重复应用。API契约追加了明确stale_epoch的一次重试规则。

修复后验证：真实HTTP两例通过；Python全套67项/42子测试、mypy17源码通过；串行浏览器全套124/124，0失败、0跳过，包含真实HTTP/SQLite重启页面测试。新自动报告a_source_sha=null，实际源码路径及14个Python文件SHA256逐一核验一致。首次并行执行为121通过/1失败，失败是Windows拒绝临时测试端口49980绑定（WinError10013），未隐藏该失败或修改端口分配代码；串行重跑完整通过。对应日志为fixed-*.log，报告为fixed-profile-report.json，源码与命令为fixed-validation.json。代码/规格两轴复审均确认原P2解决，新增可执行发现0。

07依据既有A真实模型、B页面、用户联调确认和本轮正式修复回归在当前集成分支关闭。30分钟长稳仍属于原冻结6a487c9，不冒充dbfe322的新一次长稳；当前8003也没有替换为该修复版。

## 交给B与部署边界

改动范围：web/voice-client.js的切档重试、web/tests/profile-real-api.test.cjs的源码标识；新增tests/test_profile_client_contract.py；更新docs/development/profile-api.md、07/11状态及本报告。后端模型代码没有为本次回归改变。

B继续使用[档案API契约](../../../docs/development/profile-api.md)。具备profile_memory:true的候选服务调用示例：POST /v1/profiles，body为{"display_name":"合成演示"}；PATCH /v1/profiles/{返回ID}/preferences，body为{"preferred_name":"合成称呼","communication_style":"简短"}；POST /v1/sessions可携带{"profile_id":"返回ID"}，随后使用其session_id/session_epoch调用既有v1/v2对话。切换或退出前立即停本地队列，绑定携带当前epoch；只有明确stale_epoch才验证同会话后重试一次，删除/修改以affected_sessions更新代次。

原服务目录/root/autodl-tmp/digit-robot-releases/resident-voice和8000/8001/8002回退版本保留。此次临时8004已清理，原8003从监督进程保存的原命令恢复；18000保持指向8003。后续部署应先选择明确集成提交、复用同一个私有--profiles-db、核对当前监听进程归属，按docs/development/resident-voice.md及A运维准备操作；不能按本报告历史PID直接kill。回退选择原发布目录及保存命令，再核验/v1/health和18000页面；本轮没有要求用户额外执行回退。

后续集成顺序：B同步当前集成分支并确认接口；在新测试窗口部署冻结候选；完成真人麦克风、全部固定停止/恢复与独立40事件音画采集；受控单主机离线验收后，再收口11并决定是否将草稿PR合入main。

04/05/06/09/10/11仍有真人、物理声画、单主机离线或最终混合验收缺口。当前远端4090+Windows浏览器不能当原单5090同机断网；整套工程未宣称验收通过，研究12–18没有启动。
