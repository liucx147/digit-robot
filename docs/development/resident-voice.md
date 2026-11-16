# 常驻模型与分句语音接口

原服务不变；新服务在独立发布目录使用 `python -m digit_robot.server --resident --config config/voice-4090.json --output-dir runs/resident --port 8003`。三个Python环境分别常驻ASR、LLM、Qwen3-TTS，通过JSONL进程协议通信。模型在本机既有目录读取，采用离线加载，不上传权重。启动加载一次，推理请求复用进程；`runs/resident/workers/ready.json`记录PID、加载次数和显存。

`POST /v1/sessions` 的新增字段 `sentence_streaming:true` 表示支持分句模式。缺少该字段时页面继续使用旧v1整段流程。v1接口保留；resident模式下v1回复限80字，仍整段返回，可供阶段对照。

`POST /v2/sessions/{session_id}/text` 请求体与v1一致；`POST /v2/sessions/{session_id}/audio`使用PCM WAV和`X-Session-Epoch`。响应为 `application/x-ndjson`，UTF-8逐行JSON：`start → transcript → meta → sentence → audio_ready → … → done`。失败为显式`error`事件，可能发生在HTTP200之后；连接结束但缺少done同样按失败处理。已经说出的片段不能撤回，部分播放后的失败不算整轮成功。

所有事件携带session_id、utterance_id、session_epoch和server_elapsed_ms。sentence/audio_ready另含从0递增的segment_index；audio_ready含已校验的text、user_emotion、expression_intent及audio元信息。URL为 `/v2/sessions/{session_id}/turns/{utterance_id}/segments/{segment_index}/audio`。停止/重置沿用v1接口，推进epoch，旧音频返回410；浏览器立即停播并清空队列，断开未完成流也会取消该轮。

LLM先返回完整可校验的meta记录，再流式返回1至3句完整中文，总长度<=80字，首句<=24字，后续每句<=36字。队列最多暂存两条LLM记录；默认一个TTS进程顺序合成。`--tts-workers 2`可启用两个常驻TTS进程，在前一句合成时提前合成后一句；每轮最多三个合成任务，事件和播放仍按segment_index顺序交付。浏览器收到audio_ready后立即下载并解码，播放队列直接使用已解码的后续句子。LLM生成、合成、下载解码和当前句播放可以重叠，首句无需等待整段生成。

双TTS模式在本项目RTX4090D实测占用约20.3GiB（采样值），增加一个约4GiB权重副本及运行开销；启动前应确认显存容量和空闲情况。CLI默认仍为1，可用单TTS命令回退。Qwen3-TTS仍是整句WAV返回，这不是模型内部PCM流式生成。取消后的TTS输出被丢弃；底层不支持合作取消时，当前短句可能继续计算到完成，但不允许恢复播放。

done.timings_ms分开记录first_token_ms、first_sentence_ms、first_audio_ready_ms、llm_done_ms、all_audio_ready_ms/total_ms、asr_ms、llm_ms和累计tts_ms。audio_ready另含synth_started_ms、synth_finished_ms和synth_ms，前两个相对轮次开始，便于验证两句合成确实重叠。分句目录resident-tts.json另含worker与worker_pid。并行阶段耗时不能简单相加当总延迟。首音频ready是服务器时间，不能当作用户已听到。

页面播放记录增加segments、每帧segment_index、server_timings_ms和client_timings_ms；后者含first_audio_start_ms、first_reply_activity_ms、generation_done_observed_ms、total_playback_ms和segment_gaps_ms。浏览器使用自身单调时钟和实际媒体播放位置；首句语音活动是能量观测，不是物理扬声器测量。只有最后一段实际播放结束，才显示整轮播放完成。

新旧服务不应同时执行GPU推理。回退时先核对并停止新服务及其拥有的常驻进程（单TTS三个、双TTS四个），释放显存，再使用原8002服务；无需改动旧部署。新发布不修改原服务的配置、代码或模型文件。双TTS和浏览器预解码的真实对比见[句间停顿报告](../../reports/sentence-gaps/2026-11-16/README.md)，其中保留了浏览器起播抖动的异常样本。
