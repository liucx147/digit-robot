# 联合审阅最小补丁交接

源版本6a487c9。A/B核心与页面常规联调证据齐备，本次审阅发现两个原专项没有覆盖的边界。原用户分工将web归B；本文件是A提交的可审阅最小补丁，不代表已经修改B源码。

## 生成中切换/退出档案

补丁：patches/profile-epoch.patch。
建议回归：patches/test_profile_client_contract.py.proposed（应用后放入tests/test_profile_client_contract.py）。

真实后端v1/v2在请求断开时会推进epoch，原client.invalidate中断后马上bindProfile会把旧epoch发给服务器。已有UI替身没有在abort时推进epoch，因此常规绿色用例遗漏该时序。新增真实HTTP后端＋原JS客户端两例（切到B/退出匿名）均因stale_epoch失败。

补丁仅对明确stale_epoch执行一次GET当前会话，验证sid及新epoch，然后重试同一次显式绑定一次。保留generation/sid/epoch迟到保护，本地立即停播不变，不降低后端CAS检查，不无限重试。修复副本在真实HTTP两例通过，日志在集成报告目录epoch-proposal-green.log。

## 自动报告版本标识

补丁：patches/profile-report-provenance.patch。原测试允许B_PROFILE_BACKEND_SRC任意源却总写26c6b9，今后复跑会错误标识版本。补丁记录realpath与所有digit_robot/*.py的SHA256；无法可靠声明Git版本时a_source_sha=null，避免把常量当实际版本。修复副本的真实HTTP/SQLite跨重启页面测试1/1通过。

## 应用与复验

确认由B或获授权的集成维护者修改后，git apply这两个patch，将建议Python回归移入tests。先运行两例真实HTTP回归，再跑profile-public和真实API/SQLite页面专项，检查迟到/失联/旧后端兼容，以及报告文件哈希。必要时再跑受影响全套。不要把6a487c9的30分钟长稳直接标成补丁版本的新一次长稳，也不要因用户确认常规联调而隐去新发现。
