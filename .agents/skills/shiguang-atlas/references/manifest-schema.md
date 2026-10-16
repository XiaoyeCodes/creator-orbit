# 确定性脚本、记录格式和验收边界

脚本只做 prepare / validate / commit，不调用图像API、不生成或修改成品图片、不发布帖子。需要 Python 3.10+；validate 和 commit 另需 Pillow（官方 PyPI 包，安装时遵守宿主软件安装权限）。没有其他第三方依赖。

## 命令

```bash
python scripts/workflow.py prepare --queue /path/topics.md --output-root /path/文案 --date 2026-10-16
python scripts/workflow.py prepare --queue /path/topics.md --output-root /tmp/atlas-test --date 2026-10-16 --test-mode
python scripts/workflow.py validate --manifest /path/project/raw_generated/manifest.json
python scripts/workflow.py commit --manifest /path/project/raw_generated/manifest.json
python -m unittest discover -s scripts -p 'test_workflow.py' -v
```

`--date` 缺省用 Asia/Shanghai 当前日期。宿主定时调用可追加 `--slot 2026-10-16T14:00+08:00`，同一个稳定slot不得被当作不同的新任务重复执行。手动调用自动记录稳定的 manual 内容标识。

prepare 读取 UTF-8 Markdown 表格的第一个 TODO；表头须有 Status、Topic、Category。支持单横线或多横线分隔行、UTF-8 BOM、CRLF及单元格内转义的 `\|`。完成状态是“已生成”。它不改源队列内容。

输出目录：

- 生产：`<output-root>/Published-YYYY-M-D/<完整安全主题>/`
- 测试：`<output-root>/_test_runs/Published-YYYY-M-D/<完整安全主题>/`
- 成品图和文案在主题目录顶层；所有过程记录在 `raw_generated/`
- 不安全路径字符会替换，只有文件系统长度溢出才缩短。实际路径以prepare输出为准。

生产prepare会在队列旁写固定的小型占用registry；同一队列尚有in_progress任务时，无论更换日期或输出根，都返回原manifest以恢复，不重新开工。记录包含 content_id、revision、status、slot。测试registry仅写在隔离的 `_test_runs` 下，绝不写源队列旁。不要手改prepared state或snapshot；遇到冲突保留现场再处理。

## 数量计划

prepare不接受固定图数参数；由agent规划后填写：

```json
"content_pages": 4,
"quantity_plan": {
  "basis": "editorial_range",
  "expected": 4,
  "rationale": "四个代表对象及选取理由，说明本次不是穷尽所有水果",
  "evidence_path": "raw_generated/quantity-plan.md"
}
```

- `title_count`：标题明确写“十大”“六大”“八大”“三杰”等时，脚本识别常见中文/阿拉伯数字并硬性核对N。
- `natural_set`：标题虽不写数量但有天然集合。必须写完整成员清单、范围依据与来源；N等于expected，由人工/agent核验语义，脚本不能从文本形状证明集合正确。
- `editorial_range`：普通主题，没有需穷尽的天然集合，N必须为4–8。
- 总图数永远是 N+1；封面不计入内容数量。QA必须实际签核quantity_plan_reviewed。

## manifest总结构

项目内的 `raw_generated/manifest.json` 模板初始没有图片/标签、N为空、所有QA检查为false，必须失败。完成真实工作后再填写。路径默认相对于主题项目根目录。

```json
{
  "schema_version": 1,
  "topic": "与选中队列行完全相同",
  "category": "与选中队列行完全相同",
  "content_pages": 4,
  "quantity_plan": {"basis": "editorial_range", "expected": 4, "rationale": "实际选取依据", "evidence_path": "raw_generated/quantity-plan.md"},
  "caption_path": "<安全主题>_小红书文案.md",
  "sources_path": "raw_generated/sources.md",
  "full_text_path": "raw_generated/full_text.md",
  "tags": {"core": ["核心甲", "核心乙", "核心丙"], "related": ["相关甲", "相关乙", "相关丙", "相关丁", "相关戊"]},
  "images": [],
  "qa": {
    "reviewer": "真实审核者姓名或agent标识",
    "reviewer_type": "agent",
    "reviewed_at": "2026-10-16T14:00:00+08:00",
    "evidence_path": "raw_generated/qa-review.md",
    "attestation": "如实描述实际完成的检查，不得根据脚本通过自动编写",
    "checks": {
      "all_images_visually_reviewed": false,
      "each_reference_attachment_verified": false,
      "actual_tool_inputs_inspected": false,
      "sources_checked": false,
      "full_text_complete": false,
      "caption_and_tags_checked": false,
      "no_postprocessing_or_external_image_api": false,
      "quantity_plan_reviewed": false
    },
    "page_reviews": []
  }
}
```

标签去掉可选的前导#后须互不重复，3个核心加5–10个相关；成品文案中必须实际包含全部标签。来源、完整底文、数量计划、QA文件不能为空。每页copy_path保存该图完整可见文案；文案、完整底文和逐页copy均检查禁词。

## 每张图的记录

images严格按index 0、1…N排列。封面role为cover，文件名 `00_封面_<安全主题>.png`；内容页role为content，文件名 `01_<页主题>.png`、`02_<页主题>.png`等。

```json
{
  "index": 1,
  "role": "content",
  "path": "01_香蕉.png",
  "sha256": "成品文件真实SHA256",
  "copy_path": "raw_generated/page-copy/01.md",
  "reference": {
    "record_id": "fruit-reference",
    "path": "@skill/assets/reference-images/fruit.jpg",
    "sha256": "已有参考图的真实SHA256"
  },
  "generation": {
    "tool": "工具实际标识，例如image_gen.imagegen",
    "host_call_id": null,
    "host_call_id_status": "unavailable",
    "local_evidence_id": "page-01-attempt-01",
    "called_at": "2026-10-16T13:50:00+08:00",
    "execution_observation": "执行agent或人工实际观察到的调用与返回，不是推测",
    "prompt": "实际发送的完整提示词",
    "actual_input": {
      "prompt": "与上面完全相同的实际提示词",
      "referenced_image_paths": ["/真实已存在参考图的绝对路径/fruit.jpg"],
      "transparent_background": false
    },
    "call_evidence_path": "raw_generated/tool-calls/01.json",
    "raw_output_path": "01_香蕉.png",
    "raw_output_sha256": "未经修改的原生输出SHA256"
  }
}
```

内容页必须逐页实传对应参考。reference.path可以是 `@skill/...`、真实绝对路径或项目相对路径。脚本以 `assets/reference-images/checksums.json` 的七图SHA白名单验证，允许把同一参考原样复制到任意本地路径，不接受仅改名的其他图片。同一record_id只能对应同一文件/hash。

封面不强制reference，正常独立生成时完全省略reference字段和actual_input中的图片输入。封面prompt只带三行固定前缀，不能接内容页EDIT BASE句。若封面确有可选参考，须同样如实记录并核对，提示词仍不接EDIT BASE。

每个内容页prompt必须以 `references/prompt-prefix.txt` 三行原文 + 换行 + `references/edit-base-line.txt` 单行原文 + 换行开头，再接本页具体内容；不改写、不在前面加说明。prepare保存精确拼接结果 `raw_generated/required-prompt-header.txt`。封面只用 `raw_generated/required-cover-prompt-prefix.txt`。源文件结尾换行在拼接前剔除，这两个references文件是唯一规范源。

actual_input保存完整原始工具实参，允许其中有其他宿主支持的参数，不可为迎合schema而改写真实调用。当前helper验证本机路径型的内置image_gen接口，接受含image_gen的真实命名空间标识，要求referenced_image_paths里有且只有该页真实绝对参考路径；不依赖num_last_images_to_include。如果另一宿主只有等效附件ID而没有该路径参数，必须先显式适配该宿主的证据映射，当前helper会诚实失败，不声称自动支持所有宿主。不要伪造路径参数或把外部API改名伪装成内置工具。

如果宿主提供真实call ID，填host_call_id并设status为available；如果宿主没有暴露，填null和unavailable，不得冒用输出文件UUID或自行编造ID。local_evidence_id只标识本地记录，每页不同，不等于宿主call ID。真实调用的观察说明和QA在两种情况下都不可省略。

调用时间也必须如实记录。若有真实观测的精确时间，called_at填带时区ISO值；若宿主没有提供，且执行者未记录精确时刻，可以填写下列替代字段，并在call_evidence_path的JSON中原样保存同一组字段：

```json
"called_at": null,
"called_at_unavailable_reason": "宿主没有返回调用时间；执行时未另取精确时刻，下面仅为实际会话可证的时间窗",
"observed_time_window": {
  "start": "2026-10-16T06:26:07Z",
  "end": "2026-10-16T06:29:30Z"
}
```

上面日期只是格式示例，不能当作任何实际运行的证据。start和end必须来自实际会话或其他已知观察，两者包含时区且start不晚于end；缺原因、缺窗口、无时区或逆序都会失败。execution_observation中注明窗口依据。不可调用当前时间冒充过去的调用时间，不可把下界假装为精确秒级时间。脚本只能检查结构及一致性，不能认证时间窗真实性。

raw_output_path指向真实未经修改的生成文件（支持绝对路径），或仅经过字节不变的复制/改名后的成品路径；其hash必须等于成品hash。严禁缩放、裁切、拼接、重排、重绘等补救尺寸或版式错误。

## 调用证据文件

每页call_evidence_path的JSON如下，字段必须与该页generation和reference逐一一致。它是实际调用观察记录，不是可认证的服务端遥测。

```json
{
  "tool": "image_gen.imagegen",
  "host_call_id": null,
  "host_call_id_status": "unavailable",
  "local_evidence_id": "page-01-attempt-01",
  "called_at": "2026-10-16T13:50:00+08:00",
  "execution_observation": "实际执行观察，写清参考输入与原生返回",
  "input": {"prompt": "完整实际prompt", "referenced_image_paths": ["/absolute/reference.jpg"], "transparent_background": false},
  "raw_output_sha256": "原始输出hash",
  "reference_sha256": "本页实际参考hash；独立封面填null"
}
```

## 逐页人工/agent检查

每页page_reviews记录对应的最终图hash，修改图片或换参考后必须重做检查：

```json
{
  "index": 1,
  "image_sha256": "实际检查的最终图hash",
  "reference_record_id": "fruit-reference",
  "reference_sha256": "实际检查的参考hash",
  "verdict": "pass",
  "notes": "本页具体观察：字形、引线、版式对应、事实与瑕疵，不能只写脚本通过",
  "checks": {
    "chinese_text_legible": false,
    "reference_layout_preserved": false,
    "facts_checked": false,
    "no_unwanted_artifacts": false
  }
}
```

独立封面不填reference_record_id/reference_sha256，将reference_layout_preserved替换为original_cover_layout_reviewed。其余页检查和全局检查都必须实际完成后才改为true。qa.reviewed_at须包含时区；generation.called_at有值时须包含时区，无精确时间时按前述observed_time_window规则记录。

## 脚本能证明与不能证明的事

脚本用Pillow verify再重新打开load，实际解码PNG；严格检查1086×1448、非动画、N+1张不同输出、顺序/文件名/hash、已有参考七图白名单、精确prompt头、记录与实参一致、标签数量、来源和完整底文、绑定成品hash的显式签核。截断图、改扩展名伪装PNG、缺参考、假默认QA都不能过。

脚本不能认证一个JSON确由真实工具调用产生，不能仅从文字证明附件已送达，不能逐字从像素读取中文，不能保证自然集合完整或科学事实正确。执行agent或人工必须实际检查工具调用、附图、最终像素和来源。不要伪造证据，也不要根据脚本通过自动把QA设true。单元测试中的合成像素/模拟记录仅用于结构测试，不是生图或视觉质量证明。

## commit、冲突和中断恢复

commit每次重新完整validate，不信旧通过记录。生产模式校验原队列SHA与prepare快照相同，并核对仍为同一个first TODO，只把该状态单元格改为“已生成”，保留其余字节、BOM及换行。使用同目录临时文件、fsync、排他helper锁和原子os.replace。失败验收、冲突、已有锁或格式错误时不改队列。

锁协调本helper的prepare/commit；任意外部编辑器可能不守锁，提交期间不要编辑队列。末次hash比较能发现replace前观察到的外部变动，不声称跨任意编辑器的数据库事务。

若上次已完成队列replace但来不及写state/receipt，prepare仍返回原任务，commit重新验证全部产物，并且只有当前整份队列hash精确等于快照只改本行后的预期hash时才重建state/receipt，不再次改队列。其他hash变化仍当作冲突。进程被强杀留下锁时，须先确认原进程已结束，再处理陈旧锁；不能删除仍活跃的锁。

测试commit只校验并改项目内queue.test.md，绝不改生产队列；同时报告原生产队列是否仍与快照一致，生产正常并发变化不会阻止隔离测试副本提交。已有commit receipt阻止误重复提交。如果queue已更新但receipt写失败，会报告已提交及记录警告，不能误称未改队列。
