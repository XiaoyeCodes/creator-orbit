# Codex 按正文规划：一对象一图

新任务使用 `single-subject-v1`，由 Codex 在核实来源、完成正文后决定 **1–11 张总图**。不要先定页数再裁剪正文，也不要沿用旧的 4–8 张上限把多个对象合并。

这里的规划依据是 `full_text_path` 完整底稿。`reader-narrative-v2` 发布短文可以选择重点案例，但不能据此减少原选题必须覆盖的对象或图片；数量计划引用完整底稿，而非短文案例列表。

- 单图：一张完整介绍图兼封面，`content_pages: 0`，不能只交付空泛封面。
- 多图：一张独立封面＋1–10 张内容图，每张内容图只完整介绍一个独立对象。
- “中国古代十大哲学流派”：一张封面＋十张流派介绍，共十一张。儒家、墨家、道家等各自一页，不能写成“儒家与墨家”合并页。
- 同一个对象的特点、来源、结构、代表人物、影响可以同页分区展示。其他独立对象不能成为并列介绍、对照卡、拼图或合集。封面可以概览目录，但不能代替内页。
- 标题承诺的数量与天然集合都须完整覆盖。超过十个必须介绍的独立对象时，停止并说明需要分篇，不擅自删项、改题或合并。

第一张图生成前，保存 `raw_generated/quantity-plan.md`，说明正文中的独立对象、数量理由及逐页分配。同步 manifest：`content_pages` 与 `quantity_plan.expected` 只计算独立封面以外的内容页，总图数始终为 N+1。

以下是两对象计划的结构示例，不是固定数量模板：

```json
{
  "content_pages": 2,
  "quantity_plan": {
    "basis": "single_subject",
    "expected": 2,
    "rationale": "正文分别介绍两个独立对象，各占一页，另设封面。",
    "evidence_path": "raw_generated/quantity-plan.md",
    "subjects": ["儒家", "墨家"],
    "pages": [
      {
        "index": 1,
        "title": "儒家",
        "summary": "只介绍儒家的核心主张、代表人物与影响。",
        "source_excerpt": "此处须替换为正文中包含儒家的原文，至少八个字符。",
        "covered_items": ["儒家"]
      },
      {
        "index": 2,
        "title": "墨家",
        "summary": "只介绍墨家的核心主张、代表人物与影响。",
        "source_excerpt": "此处须替换为正文中包含墨家的原文，至少八个字符。",
        "covered_items": ["墨家"]
      }
    ]
  }
}
```

`subjects` 必须是正文中真实出现且不重复的独立对象名称，不能把“儒家与墨家”伪装成一个对象。每个对象恰好对应一页，`covered_items` 必须恰好包含当前对象；标题与正文引用也须包含该名称。引用须逐字出现在 `full_text_path` 的正文中。天然集合的完整性仍需结合来源进行语义审查，不能仅凭数量相等判断。

**单图例外**：`content_pages` 和 `expected` 都为 0，但 `subjects` 和 `pages` 仍各有一项；该页 `index: 0`，对应兼作完整介绍的封面。图片继续使用原封面文件名及 `role: "cover"`。多图的计划页索引从 1 连续到 N，索引 0 的独立封面不计入 `subjects`。

每张介绍图（单图任务包含封面）的实际生图提示词必须原样包含 `config/image-planning.json` 中的 `prompt`，并独立写下面一行，再换行继续提示词，对象名与计划完全一致：

```text
本图唯一介绍对象：儒家
```

一次生图调用只生成当前这一张图，不能把多页缩在同一张图中。参考图仅借鉴质感和布局；参考图里的多对象排版必须改为当前对象自己的细节。每张输出需实际查看，发现合并对象则重做该页；对应 `qa.page_reviews[].checks.single_subject_per_page` 须在真实审查后置为 `true` 并描述观察，不能批量自动填充。多图任务的目录封面豁免这一单对象检查。

```powershell
python scripts/workflow_bridge.py validate --manifest "<任务 manifest 路径>" --dimension-policy prompt-strong --image-count-policy single-subject-v1
```

宿主还会传入所选风格与标记策略。来源、参考输入、实际工具输入、原图 SHA256、逐页视觉检查与发布验收继续保留。程序检查计划和证据的一致性，不能代替对实际画面的语义审查。

既有 `content-adaptive` 任务继续使用 [旧数量计划](adaptive-image-plan-legacy.md)，无策略标记的更早任务继续使用 Skill 原规则。历史作品保持原样，新规则从新建任务开始生效。
