# 档案 API v1：A/B 对接契约

共同基线 f17443cc8178e6b611d0d9c832a6dca06945d065。本文先冻结接口；发布契约不代表功能已上线。A拥有本文与后端，B拥有页面和浏览器客户端。

## 数据与接口

档案：`{profile_id: UUID, display_name: string, preferences: {preferred_name: string|null, communication_style: string|null}}`。display_name去掉首尾空白后1–80字，完全同名返回409；两个偏好字段分别最多80/500字，空白或null表示删除，不推断或自动保存用户聊天。未知字段与非法类型返回422。

| 方法与路径 | 输入 | 输出 |
| --- | --- | --- |
| GET /v1/profiles | 无 | `{profiles: [档案]}` |
| POST /v1/profiles | `{display_name}` | 档案，201 |
| GET /v1/profiles/{pid} | 无 | 档案 |
| PATCH /v1/profiles/{pid} | `{display_name}` | `{profile:档案, affected_sessions:[会话状态]}` |
| DELETE /v1/profiles/{pid} | 无 | `{deleted:true, affected_sessions:[会话状态]}` |
| GET /v1/profiles/{pid}/preferences | 无 | 两个偏好字段 |
| PATCH /v1/profiles/{pid}/preferences | 一个或两个偏好字段 | `{profile:档案, affected_sessions:[会话状态]}` |
| DELETE /v1/profiles/{pid}/preferences | 无 | 同上，清空两项 |
| POST /v1/sessions/{sid}/profile | `{profile_id: UUID|null, session_epoch: N}` | 最新会话状态 |

POST /v1/sessions继续接受空请求，新增可选JSON `{profile_id: UUID|null}`。状态增加`profile_id`（匿名为null）；health增加`profile_memory:true`。现有v1/v2语音请求与流式事件兼容，仍使用session_epoch。匿名会话无档案偏好。

## 会话失效规则（B必须实现）

显式绑定/切换/退出档案总是取消当前轮次、清空历史、推进epoch、回到idle。偏好更新/清空、档案改名同样失效化所有绑定该档案的内存会话；删除档案还将这些会话改为匿名。写入成功后才失效化；失败不修改会话或偏好。

PATCH档案改名返回`{profile:档案, affected_sessions:[会话状态]}`，与偏好修改保持相同处理方式。

B在发出任何切换或修改请求前立即停止本地音频、动画和下载队列；不要在mutation确认前发送新轮次。成功后采用affected_sessions中当前会话的新epoch，或GET会话状态确认。绑定请求本身检查旧epoch，过期返回409，不进行绑定。其他页面修改时，本页下一次请求仍受epoch校验保护；已经下载到另一页面的音频无法由服务器远程撤回，此阶段不提供多标签页推送。

中断在途HTTP请求也可能先推进服务器epoch。客户端仅在绑定明确返回stale_epoch时，GET确认同一会话的当前代次，再重试同一次显式绑定一次；读取及重试仍受本地generation隔离，重连或新操作后不得采用迟到结果。第二次失败保持可见，不放松服务器的旧代次校验。退出档案使用profile_id:null，同样处理。

reset清空历史并推进epoch，但保留选中档案及其有效偏好；stop推进epoch并停止，保留档案和已完成历史。服务重启保留SQLite档案和偏好，内存会话不持久化；B重新建会话并显式绑定所选profile_id。

## 错误与存储

档案接口响应（含错误）带Cache-Control: no-store。

使用现有VoiceError形状`{type:"error",code,message,...}`：422 invalid_profile_input；404 profile_not_found；409 profile_exists/stale_epoch；503 profile_store_unavailable。旧会话重启后按session_not_found重建。错误反馈不包含SQL、路径、偏好原文或数据库内部异常。

服务启动参数`--profiles-db`显式指定持久SQLite路径，默认output-dir/profiles.sqlite3。生产重启换output-dir时必须复用同一profiles-db。数据库、WAL/SHM与用户数据不进Git。仅持久保存手动提交的档案与偏好，不保存全部聊天。档案选择提供业务上下文隔离，不是账户认证；本阶段在本地受控入口和合成档案下验证，不将个人数据放到公开隧道。

模型每轮只读取当前档案快照，作为有边界的JSON数据加入提示，不能把偏好当作覆盖输出协议的指令。v1和v2均必须生效；修改后真实模型回复是否正确需独立验证，数据库存在记录不足以验收。

## B调用顺序

1. GET profiles；POST创建档案；GET/PATCH preferences。
2. 停止本地播放和队列；POST sessions/{sid}/profile，携带当前epoch。
3. 保存返回的profile_id/epoch，继续使用原text/audio接口。
4. 修改、清空偏好或删除档案时先停本地播放，按affected_sessions更新epoch；错误可见且不继续发送旧请求。
5. 页面重启先创建新会话并绑定有效档案；已删除的ID提示重新选择。
