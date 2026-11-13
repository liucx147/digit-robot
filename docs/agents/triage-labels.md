# Triage labels

五个分诊角色映射到同名 GitHub 标签；Issue 和纳入分诊的外部 PR 共用此表。

| 角色 | GitHub 标签 | 含义 |
| --- | --- | --- |
| needs-triage | needs-triage | 待评估 |
| needs-info | needs-info | 等待报告者补充信息 |
| ready-for-agent | ready-for-agent | 信息齐全，可由代理接手 |
| ready-for-human | ready-for-human | 需要人工实施 |
| wontfix | wontfix | 不予处理 |

已分诊事项使用一个分诊状态标签和一个类别标签。
类别标签使用 bug 或 enhancement；数字人规格属于 enhancement。
切换分诊状态时移除旧状态标签、添加新状态标签，保留类别和其他无关标签。
ready-for-agent 表示规格完整；开始实施前仍需确认依赖已完成。

既有本地 Markdown 记录继续使用同名 Status 值和 bug / enhancement 的 Category 值；状态变更更新同一个 Status 字段，无需与 GitHub 双向同步。
