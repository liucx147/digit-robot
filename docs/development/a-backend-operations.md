# A 后端部署准备与验证边界

基础版本：f17443c（已合入main）。A后端分支codex/a-engineering-backend。B分支codex/b-engineering-ui的交接文档已核对，其共同基线也为完整f17443cc8178e6b611d0d9c832a6dca06945d065；B记录未启动远端模型或占GPU，实际物理采集未完成。

## 启动前检查

1. 获取确定的代码SHA；只读核对发布目录、git status、部署manifest、HTTP health和nvidia-smi。不得按旧PID直接停止进程。
2. 用API环境运行RuntimeConfig.from_file校验本地路径；分别用ASR/LLM/TTS环境读取Python和依赖版本。运行环境和模型权重沿用已冻结配置，不下载替代模型。
3. 检查Qwen3.5-4B、Qwen3-ASR-0.6B、Qwen3-TTS-12Hz-1.7B-CustomVoice本地配置、权重和来源/许可记录。只检查已有文件，不打印配置中的无关字段或环境变量。
4. 准备显式持久路径，例如runs/private/profiles.sqlite3；确认父目录可写、空间足够。API启动失败会清理自己已启动的resident workers。不要将数据库、WAL/SHM、用户音画加入Git。
5. 核对原服务命令、cwd和进程归属，保存回退清单。双TTS观测约20.3GiB；不能在原resident组仍占卡时再加载一整组。

## 启动示例（仅受控本地接口）

```bash
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_DATASETS_OFFLINE=1 \
PYTHONPATH=src /root/autodl-tmp/digit-robot-envs/api/bin/python -m digit_robot.server \
  --resident --tts-workers 2 --config config/voice-4090.json \
  --output-dir runs/a-engineering --profiles-db runs/private/profiles.sqlite3 --port 8004
```

8004仅绑定远端127.0.0.1；如需本机测试，使用独立的18004→8004 SSH隧道，不改原18000与公开入口。档案选择不是账户认证；使用合成档案验证，不向未设访问控制的公开入口放个人数据。

## 冷启动、恢复与资源记录

- 分开计时：服务启动至health可用、第一轮推理、暖机推理、首音频ready、首语音活动和整轮播放。加载时间不能混入或藏在暖机指标内。
- 保存workers/ready.json的PID、load_count、restart_count、软件及模型版本。连续采集nvidia-smi后才能报告本次窗口的采样峰值；单点显存读数不称全程峰值。
- 重启同一服务时复用profiles-db，重新建会话并显式绑定档案。内存会话和聊天历史不会恢复；档案和明确偏好应恢复。B页面需要按404 session_not_found重建，而非补播旧音频。
- 单个模型进程退出后，或进程仍存活但超过阶段超时而被标为unhealthy时，本轮错误可见；下一轮首次使用该role时最多尝试重新加载一次。对超时的自有进程先终止再加载，避免向活着但挂起的worker不断排队。ready元数据记录新PID和restart_count，其他模型不重载。若资源或配置使重载失败，继续明确失败，禁止云端回退。
- v1请求实际断开时失效化本请求拥有的轮次；v2断流沿用原取消边界。停止与档案mutation均不要求GPU计算500ms内结束，迟到结果必须不可交付。
- 离线试验采用受控的验证进程网络隔离，保留SSH管理通道。本次4090远端推理/Windows浏览器不能写成单5090同主机断网验收。

## 回退

核对并停止本次8004服务及自有workers，确认显存释放；按保存的原命令恢复8003的f17443c服务。保留8000/8001/8002与原发布目录，保留失败证据。数据库不随代码回退删除；本功能未交付前的服务不会读取它。

## 仍需双方完成

真人麦克风、物理500ms停播、40事件独立音画校准/标注、单主机断网、冻结版本30分钟/20轮与档案页面联调均不是后端单元测试可以替代的条件。05/06/07/10/11须在对应完整证据进入最终集成版本后再关闭。
