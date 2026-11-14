# B 接入说明：语音链路 API v0.2

代码：https://github.com/liucx147/digit-robot ，分支 main。A 提供 ASR→情感对话→TTS 和会话/音频服务；B 负责麦克风录制、音频实际播放、三维表情及嘴部/注视。三个模型使用已核验的原始本地权重，逐阶段启动和退出，单卡只处理一个轮次。

## 接入现有 4090

服务器项目 `/root/autodl-tmp/digit-robot`，服务仅监听 `127.0.0.1:8000`。B 在自己电脑建立隧道：

```bash
ssh -p 43903 -L 18000:127.0.0.1:8000 root@connect.westb.seetacloud.com
```

API base 为 `http://127.0.0.1:18000`。前端开发来源已允许 `http://localhost:5173` 和 `http://127.0.0.1:5173`；其他来源由服务启动参数 `--allow-origin` 显式添加。SSH 登录权限由项目负责人提供，仓库不含登录密钥。

`GET /v1/health` 检查服务；`GET /openapi.json` 获取机器可读接口。仓库 `docs/api/voice-openapi.json` 保存本轮导出。交互文档没有依赖 CDN；直接使用本文请求示例或导入 OpenAPI。

## 接口

| 方法与路径 | 请求 | 成功结果 |
| --- | --- | --- |
| POST `/v1/sessions` | 无正文 | session_id、session_epoch=0、state |
| GET `/v1/sessions/{sid}` | 无正文 | 当前代次、state、当前发言ID、错误 |
| POST `/v1/sessions/{sid}/text` | JSON：text、session_epoch | 回复和 WAV 元数据 |
| POST `/v1/sessions/{sid}/audio` | 原始 WAV 字节；`Content-Type: audio/wav`、`X-Session-Epoch: 0` | 转写、回复和 WAV 元数据 |
| GET `/v1/sessions/{sid}/turns/{uid}/audio` | 无正文 | WAV；Cache-Control: no-store |
| POST `/v1/sessions/{sid}/stop` | 无正文 | 立即推进代次，取消当前轮次、失效旧音频，保留已完成上下文 |
| POST `/v1/sessions/{sid}/reset` | 无正文 | 同时清空上下文，进入 idle |

文本限 1–2000 字；音频限 6MiB、30 秒，16-bit PCM WAV、单/双声道、8–48kHz。全零、空或截断录音会失败。浏览器 MediaRecorder 常见的 WebM/Opus 需要 B 转成上述 PCM WAV 再提交；本接口不自动接收 WebM。

TTS 使用上游默认采样（talker/subtalker 均启用），记录种子42，单次上限2048 token。独立对照发现强制贪心在133字回复上生成到约164秒上限，不能视为正常语音；相同文本启用采样后为35.92秒。验证脚本对固定样例增加90秒音频时长回归限制，防止再次接受该异常；这不是通用语速或响应时间承诺。

状态依次为 `transcribing`（语音输入）、`generating`、`synthesizing`、`ready`；另有 `idle/stopped/error`。请求直到整个轮次成功才返回 200；期间可轮询状态。当前为单进程、单 GPU 串行服务，正在处理另一轮时返回 409 `gpu_busy`，没有隐式队列。每个模型阶段超时默认 300 秒。服务重启会创建全新内存会话，B 重新 open，不复用旧 session_id。

成功结果中的关键字段：

```json
{
  "type": "response", "state": "ready", "status": "ok",
  "session_id": "会话UUID", "session_epoch": 0, "utterance_id": "发言UUID",
  "transcript": "我今天考试没考好，很难过。",
  "user_emotion": "sadness", "reply": "听起来你很失落，我愿意听你说。",
  "expression_intent": {"style": "gentle", "intensity": 0.4},
  "audio": {"url": "/v1/sessions/会话UUID/turns/发言UUID/audio",
            "mime_type": "audio/wav", "sample_rate_hz": 24000, "channels": 1, "duration_ms": 4320},
  "timings_ms": {"asr_ms": 1000, "llm_ms": 6000, "tts_ms": 10000, "total_ms": 18000},
  "attempts": [{"raw_output": "模型原始结构化输出", "error": null}]
}
```

该 JSON 是字段示意，时长与耗时不是性能承诺；真实记录见 `reports/voice-chain/`。七类 `user_emotion` 不变；style 为 `gentle/cheerful/calm/serious`，TTS 分别使用温和关切、轻快友善、平静清晰、认真沉稳的指令，并传递归一化强度。情绪指令是否达到预期听感仍需人工听审。

## B 的播放与停止规则

1. 使用 `audio.url` 获取真实语音，应用 `expression_intent`，由 `audio.currentTime` 驱动嘴部；`timings_ms` 记录服务端耗时，不是播放时钟。
2. 发言 ID 与会话代次同时匹配才播放或应用动画。旧请求即便迟到返回也丢弃。
3. 点击停止时，B 先立即暂停音频并清空动画/播放队列，再请求 stop；收到新代次后更新本地状态。停止请求失败时保持停播并显示错误，不自动重放。
4. stop/reset 后旧音频 GET 返回 410；旧代次输入返回 409。已在浏览器缓存或正在传输的音频仍由 B 主动停播，不能仅依赖服务端接口。
5. `examples/b-client.js` 提供 fetch、会话、失效迟到响应和本地停播样例。返回 null 表示该回复已过期；取得有效结果后由 B 决定播放并处理浏览器播放权限。

错误体为 `type:error,code,message`，轮次失败还带会话/发言标识。400 为请求字段问题，413 为体积超限，415 为媒体格式不支持，422 为录音或转写无效，409 为繁忙/过期/取消，502 为模型阶段或结构化输出失败，504 为模型阶段超时。失败不返回可播放的成功音频；原始尝试和阶段日志保存在服务器 `runs/voice/`，不会自动上传聊天或录音到公共仓库。

## 启动与验证

```bash
cd /root/autodl-tmp/digit-robot
/root/autodl-tmp/digit-robot-envs/api/bin/python -m digit_robot.server \
  --config config/voice-4090.json --output-dir runs/voice \
  --allow-origin http://localhost:5173 --allow-origin http://127.0.0.1:5173
```

安装服务依赖可使用 `pip install -e '.[api,dev]'`；实际固定版本在 `requirements/api.txt`。三个模型的独立环境和来源沿用 [A 的 M1 交接](developer-a-m1.md)。新机器需要改 `config/voice-4090.json` 中的环境和模型路径，并准备语音模型来源清单；从 Git 克隆不会下载权重。

本轮只交付 A 侧真实语音链路与接口。任务03/04的可见页面、真实麦克风交互、音画同步以及500ms浏览器停播，待 B 接入后联合验收。
