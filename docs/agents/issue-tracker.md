# Issue tracker: GitHub

新发布的需求、PRD 和实施任务使用 GitHub Issues：https://github.com/liucx147/digit-robot/issues。
使用 gh CLI；本地目录尚未关联 Git 远程，所有 gh issue / gh pr 命令显式加 --repo liucx147/digit-robot，API 路径显式指定 repos/liucx147/digit-robot。

## 常用操作

- 创建事项：gh issue create --repo liucx147/digit-robot --title "..." --body-file <正文文件>
- 读取事项及评论：gh issue view <number> --repo liucx147/digit-robot --comments；读取标签可另加 --json number,title,body,labels,comments。
- 列出事项：gh issue list --repo liucx147/digit-robot --state open --json number,title,body,labels；按需使用 --label 和 --state 筛选。
- 评论：gh issue comment <number> --repo liucx147/digit-robot --body-file <评论文件>
- 修改标签：gh issue edit <number> --repo liucx147/digit-robot --add-label "<标签>" / --remove-label "<标签>"
- 关闭事项：gh issue close <number> --repo liucx147/digit-robot
- 多行正文或评论先写入 UTF-8 临时文件，再用 --body-file 传递。
- “发布到跟踪器”指创建并核验 GitHub Issue；“获取事项”指读取对应 Issue 及评论。

## Pull requests as a triage surface

**PRs as a request surface: yes.**

外部贡献者的 PR 使用与 Issue 相同的分诊标签和流程。仓库所有者、成员及协作者的开发中 PR 不纳入外部请求队列。

- 使用 gh api --paginate "repos/liucx147/digit-robot/pulls?state=open&per_page=100" 获取候选 PR，按 author_association 筛选外部贡献者；排除 OWNER、MEMBER、COLLABORATOR。
- 读取 PR：gh pr view <number> --repo liucx147/digit-robot --comments；读取改动：gh pr diff <number> --repo liucx147/digit-robot。
- 使用 gh pr comment / gh pr edit --add-label 或 --remove-label / gh pr close，并显式指定 --repo liucx147/digit-robot。评论使用 --body-file。
- Issue 与 PR 共用编号；仅有 #<number> 时，先用 gh pr view 确认，若该编号不是 PR，再用 gh issue view；权限或网络错误单独处理。

## 当前规格与既有本地记录

- 当前有效规格仍为 .scratch/digital-human-emotion/spec.md，规划或实施前必须读取。
- .scratch/digital-human-emotion/ 下的规格、索引和 18 张任务保留为既有本地记录，尚未迁移到 GitHub；不自动重复发布。
- 既有本地任务继续按原路径读取，保留文件顶部 Status / Category 字段、Parent 和依赖链接；状态与类别含义见 triage-labels.md。以后明确迁移时记录本地文件与 GitHub Issue 的对应关系。
- ready-for-agent 表示规格可供接手；开始实施前仍需确认依赖已完成。
- 现有 Word 和 HTML 保留原范围；当前阶段范围以有效规格为准。

## Wayfinding operations

- GitHub map 为带 wayfinder:map 标签的单个 Issue；子任务使用 wayfinder:<type> 标签（research / prototype / grilling / task），通过 sub-issue 关联；不可用时，在 map 的任务列表链接子任务，并在子任务正文记录 Part of #<map>。
- 阻塞优先使用 GitHub 原生 Issue 依赖；不可用时，在正文记录 Blocked by: #<number>。仅选择未关闭、无未完成依赖且未认领的子任务，按 map 顺序处理。
- 认领时使用 gh issue edit <number> --repo liucx147/digit-robot --add-assignee @me；解决后先评论答案，再关闭子任务，并向 map 的 Decisions-so-far 追加摘要和链接。
- 既有本地 wayfinder 记录仍使用 map.md 和独立子任务；claimed、resolved 是探索任务状态，与五个分诊状态区分。
