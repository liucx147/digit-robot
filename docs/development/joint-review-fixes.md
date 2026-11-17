# 联合审阅修复与B交接

源版本6a487c9。A/B核心与页面常规联调证据齐备，本次审阅发现两个原专项没有覆盖的边界。用户随后明确授权当前集成会话完成这两处最小修复；已应用到web/voice-client.js及web/tests/profile-real-api.test.cjs。保留原补丁供B审阅，不要对已修复版本重复应用。

## 生成中切换/退出档案

补丁：patches/profile-epoch.patch。
已加入回归：tests/test_profile_client_contract.py（原建议副本已移入正式测试）。

真实后端v1/v2在请求断开时会推进epoch，原client.invalidate中断后马上bindProfile会把旧epoch发给服务器。已有UI替身没有在abort时推进epoch，因此常规绿色用例遗漏该时序。新增真实HTTP后端＋原JS客户端两例（切到B/退出匿名）均因stale_epoch失败。

补丁仅对明确stale_epoch执行一次GET当前会话，验证sid及新epoch，然后重试同一次显式绑定一次。保留generation/sid/epoch迟到保护，本地立即停播不变，不降低后端CAS检查，不无限重试。副本验证后，正式源码的两例真实HTTP回归也通过；原失败、副本和正式验证分别保留。

## 自动报告版本标识

补丁：patches/profile-report-provenance.patch。原测试允许B_PROFILE_BACKEND_SRC任意源却总写26c6b9，今后复跑会错误标识版本。正式修复记录realpath与所有digit_robot/*.py的SHA256；无法可靠声明Git版本时a_source_sha=null，避免把常量当实际版本。

## 复验与版本边界

正式修复已通过两例真实HTTP回归、Python全套67项/42子测试、mypy17源码；浏览器和自动报告最终结果见集成报告。代码/规格两轴复审均确认原P2已解决，新增可执行发现0。6a487c9的30分钟长稳仍属于原冻结版本，不标成补丁版本的新一次长稳。公开8003仍为已恢复的原服务，本次最小修复没有重新占用4090或替换线上部署。
