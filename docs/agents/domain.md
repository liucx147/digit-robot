# Domain docs

## 布局

采用 single-context：根目录 CONTEXT.md 与 docs/adr/。

## 探索前读取

- 读取根目录已存在的 CONTEXT.md，了解业务概念、术语和边界。
- 读取 docs/adr/ 中与当前工作相关的架构决策。
- 文件或目录尚不存在时继续工作；术语和决策明确后，由 domain-modeling 等技能按需创建。

## 使用规则

输出中的领域概念采用 CONTEXT.md 定义的术语，避免使用其明确排除的同义词。
需要的概念尚未定义时，先检查是否引入了项目不使用的概念；确有缺口时，记录给 domain-modeling 后续处理。
与已有 ADR 冲突时明确指出对应决策及重新讨论的理由。
