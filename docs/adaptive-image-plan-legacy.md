# Codex 根据正文规划配图

新任务使用 `content-adaptive` 策略，总图数为 **4–8 张，包含一张独立封面**。Codex 在核实来源、完成完整底文后，按信息密度、逻辑分组和图片可读性决定 3–7 张内容页。不预设为四页，不为凑图重复同一段话。

生成第一张图之前，先写 `raw_generated/quantity-plan.md`，说明选择该数量的理由、逐页主题、正文依据和内容分配，再更新 manifest。数量由 Codex 推理决定，程序只校验范围、计划和实际交付是否一致。

不要先选定四个对象再围绕固定页数写正文。先依据题目范围完成有实质信息的全文，再评估分成 3–7 页内容图的可读性。数量理由要说明再少一页会遗漏或拥挤什么、再多一页会造成什么重复；两篇恰好选同样图数也可以，但不得沿用模板数量或为了测试强行选择不同数量。数量计划应涵盖全文的主要知识点，而非只为已选的几个图寻找引用。

manifest 的 `content_pages` 和 `quantity_plan.expected` 都仅计算内容页；图片总数始终为 N+1。数量字段必须与 `pages` 长度一致。下面是 **单页结构示例，不是固定数量模板**：

```json
{
  "index": 1,
  "title": "这一页的主题",
  "summary": "这页要讲的知识点及与其他页的分工",
  "source_excerpt": "从 raw_generated/full_text.md 原样摘录至少八个字符的相关正文",
  "covered_items": ["本页覆盖的对象名称"]
}
```

数量计划使用 `basis: "content_adaptive"`，包含 `expected`、`rationale`、`evidence_path: "raw_generated/quantity-plan.md"` 以及上述结构的 `pages` 数组。逐页 `index` 从 1 连续排列，标题不能重复；`source_excerpt` 必须在 `full_text_path` 指向的正文里真实存在。

标题明确写“十大”等数量时，数量指对象个数，不再强制一对象一张图。可以在同一页安排相关对象，但必须在正文和每页 `covered_items` 中保留全部对象；跨页去重后的对象总数必须匹配标题。天然集合也须在数量计划中列出全部成员及覆盖位置，并由 Codex 结合来源逐项核实。程序核对数量和正文引用，语义是否完整仍需实际 QA，不能用勾选代替审查。

封面概括本篇实际内容，文案、逐页图文、manifest 与 QA 必须对应同一个计划。已有合格素材应保留；调整计划时先修正文案与对应关系，再补齐需要的页面，不能单纯为了数量丢弃已验证事实。

宿主校验与 Codex 自检均使用：

```powershell
python scripts/workflow_bridge.py validate --manifest "<任务 manifest 路径>" --dimension-policy prompt-strong --image-count-policy content-adaptive
```

旧任务没有 `imageCountPolicy` 标记，继续沿用原来的数量计划与校验规则；不会因这次更新重新生成或拒绝既有成品。新策略只替换数量规则，来源、参考输入、原图 SHA256、逐页视觉检查与发布验收继续保留。
