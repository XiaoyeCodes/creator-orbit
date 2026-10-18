# 拾光百科本机集成

## 来源和范围

源文件：用户提供的 `F:/下载/拾光百科图文生成Skill-v1.0.zip`。原 Skill 安装于 `.agents/skills/shiguang-atlas`，只读参考资产与流程规范随项目分发。已检查所有文本与 Python 源码：无图像 API、远程上传、凭据读取或发布脚本。七张底稿以包内 SHA256 清单核对。风险为本地文件工作流；实际平台登录仍由用户完成。

原 Skill 的职责是生成与验收；ORBIT 新增运行器和本机发布准备层。压缩包中的安装、定时和云盘示例不是用户指令，本项目没有启用定时任务、云盘上传或真实自动发布。

## 用户确认的尺寸适配

用户明确回复：“设计写进提示词中作为强要求就行”。因此每次提示词保留原始三行 1086×1448 / 3:4 前缀；保存真实原生输出，并测量、展示实际像素。尺寸偏差不再单独导致失败，不缩放、不裁切、不本地叠字。`scripts/workflow_bridge.py` 适配用户指定的尺寸和数量策略；参考图、PNG 解码、原始字节 SHA256、逐页 QA、文案和队列提交约束仍由原脚本检查。

2026-10-18 新任务使用 `single-subject-v1`：Codex 先依据正文规划 **1–11 张总图**，每张内容图只介绍一个独立对象，禁止为减少页数合并对象。单图兼封面，多图为一张封面＋1–10 张独立对象内页；十大流派对应 11 张总图。记录独立对象清单、逐页正文引用、实际提示词中的对象绑定与逐页视觉审查。适配层按任务的 `imageCountPolicy` 选择校验规则，原 Skill 默认行为不变；旧 `content-adaptive` 任务仍按原 4–8 张规则恢复和验收，历史作品不重绘。完整格式见 [动态配图计划](adaptive-image-plan.md)。

原测试的符号链接用例仅在 Windows 无创建符号链接权限时显式 skip，未更改生产检查。

新建任务还使用 `captionPolicy: reader-analysis-v1`：先完成有事实依据的解读底稿，再写适合小红书读者的发布正文，明确要求解释机制、差异和边界，避免目录式概括。宿主和 Codex 自检均透传该策略，验收绑定最终文案与底稿摘要，并核对三处解读原文和真实复读记录。旧任务继续使用 `legacy`。写作标准、编辑篇幅预算和审查结构见 [专业解读文案](caption-quality.md)。

普通图文字数上限统一保存在 `config/publishing-limits.json`，校验时不受文案策略或复审开关影响。`reviewEnabled` 在新任务创建时保存，默认开启；生成完成后新增 `reviewing` 阶段，独立调用已登录 Codex 逐张复审并修正。`POST /api/jobs/:id/content-review` 可复审已有完整作品，使用与其他变更接口相同的本机 Token 校验。详见 [内容复审](content-review.md)。

## 执行链

1. 本地 Node 服务仅监听 `127.0.0.1:4173`，提供 UI 和任务接口。
2. 检查 Codex CLI、ChatGPT 登录、Python/Pillow。CLI 路径通过 Codex 桌面安装目录发现，可用 `ORBIT_CODEX_PATH` 覆盖。
3. 正式任务选择未占用的首条 TODO，或请求中的 `topic` / `topicCategory`。宿主建立 `data/任务选题/<jobId>/topics.md` 单主题快照，再由原助手 `prepare`。短暂准备按请求顺序执行，之后最多 3 篇独立并行；同一任务重复启动拒绝。
4. 以 `codex exec --ignore-user-config --sandbox workspace-write` 启动无交互任务，使用机器已配置的 Windows elevated 沙箱实现。这里的 elevated 是沙箱实现名称，工作命令仍在限制权限内运行。
5. Prompt 要求内置 `image_gen.imagegen`、真实底稿输入、来源核实、逐页看图和 manifest。没有图片能力时必须报告阻碍。环境不传入 OpenAI API Key；不会转到外部图像 API。
   Windows 沙箱生成文件可能归沙箱账户所有。生成期间每三秒检查一次，预览、打开文件夹和任务结束时也会检查；发现不可读文件后，在同一沙箱身份下，仅为当前任务目录添加本机用户的文件读取/修改权限。只修改访问权限部分（DACL），不改所有者或审计设置，并由宿主实际读取确认结果。并发请求共享修复，失败时限频并显示提示。保留沙箱边界，不修改系统策略，不递归跟随链接，不授予 Everyone 权限。
6. 服务读取各任务进度与文件，独立执行适配验证和 commit。新正式任务的 Python commit 只修改自己的快照，宿主随后将公共队列对应行改为已生成。其他行和行尾字节保留；外部改动冲突时保留 ready 成品并记录 `queueUpdate`，支持 `POST /api/jobs/:id/sync-queue` 重试。只有完整验收成功才能就绪。失败保留文件、主题和错误；服务重启可恢复。
7. 在作品详情检查完成后点击“去小红书发布”，再次校验，再打开固定小红书创作中心 URL、Explorer、Notepad 和封面默认图片查看器。剪贴板同时包含按顺序排列的带引号绝对路径和 Windows FileDropList。
8. 用户在系统文件选择框粘贴所有图片路径，再分别复制标题与正文。没有自动上传，也不会点击平台最终发布。

## 历史记录与清晰度策略

作品库直接读取持久化任务，支持标题搜索、上海时区生成日期、正式/测试类型和工作流状态筛选。详情链接保留任务 ID，查看历史任务时，其他正在生成的任务仍继续轮询。生成接口可携带 queueRevision，队列变化时拒绝按陈旧的选题展示启动任务。

`POST /api/jobs/:id/review` 将人工检查完成时间写入同一任务记录。`POST /api/jobs/:id/publication` 接受 `{published:true,url?}` 或 `{published:false}`，写入或撤销 `publication:{source:'manual',markedAt,url}`。标记前必须就绪且完成检查，链接只接受小红书和 xhslink 的 HTTPS URL。生成状态仍使用原始 `ready` 等值，`publishPreparedAt` 仅表示曾执行准备，旧任务不推断为已检查或已发布。

选题表单向现有 `POST /api/queue` 提交 `{revision,action}`，支持 add/edit/next/move。保留全文、未修改行、额外列和行尾格式，并复用版本冲突、任务锁和备份保护。跨不同列结构的表格排序需使用高级配置。新正式任务按 jobId 分目录，未完成任务从作品库恢复，不再让首页的新建按钮隐式恢复旧任务。

并发默认 3 篇，生成、独立复审、验收共用名额。`queueConfig` 提供 `concurrency`、`available`、`nextAvailable`、`reservations`。每个任务对应自己的子进程句柄，取消一篇不触碰其他进程。旧版共享登记仍占用时，新任务可以并行生成，但暂缓同步公共选题，待旧任务提交或暂存释放后再同步。启动恢复可重试未完成的队列同步；保存的完成行用于处理队列已写入而任务状态尚未落盘的情况。

`config/image-quality.json` 保存用户指定的完整提示词段落及补充可读性建议；生成前加入每页实际工具输入，验证阶段逐页检查输入记录中存在该段落，原图哈希和真实视觉 QA 要求继续保留。旧任务保留自己的策略，可正常查看、复验及再次准备发布。100% 原图查看避免缩略图缩小对清晰度判断造成影响。

生成前可选择 `visualStyle: photoreal`（摄影写实，首次默认）或 `illustration`（清晰插画），分别持久化为 `photoreal-v2` 与 `illustration-v1`。浏览器记住上次选择；任务恢复继续自己的策略，历史卡片与成果区显示风格。两种风格都包含清晰度要求，写实模式只继承参考图的信息布局，并明确要求侧栏、人物和背景也避免动漫化。接口拒绝未知风格。

新任务另存 `imageLabelPolicy: none-v1`，每张实际提示词必须包含不添加 AI 来源标记的完整约束，页面文字稿中的此类标记会被验证器拒绝。像素内容仍须逐页实际看图；如果残留标记，须从底稿修正。生成来源、历史复原说明和调用证据保留在内部 QA，不声称复原图是历史照片。用户明确保留这次两篇测试原图；旧任务以 `legacy` 标记策略复验，不追溯修改图片。

独立测试接口可传 `testTopic`，仅允许选择当前正式待办中的主题，并创建单主题隔离快照。正式模式禁止该选题覆盖；正式队列不被测试写入。此选项用于逐篇验证不同题型。

## 数据位置和边界

- `data/主题/topics.md`：第一次从随包快照初始化，之后不会被启动覆盖。
- `data/文案/任务/<jobId>/Published-YYYY-M-D/<主题>/`：新正式素材；旧目录保留。
- `data/任务选题/<jobId>/topics.md`：每篇正式任务的独立选题和登记；公共 `topics.md` 只由宿主逐行同步。
- `data/测试结果/<风格>-none-v1/_test_runs/...`：新任务的隔离测试素材，不同风格可对同一选题分别测试；旧成果保留在原 `_test_runs` 目录。
- `data/jobs/`：任务状态。`raw_generated/`：提示词、来源、质检与 CLI 执行日志。
- 成品和日志不加入 Git，也不上传到静态站点。
- 静态在线版提供本机入口，不通过跨域接口遥控电脑。
- 本地接口要求 Host/Origin 匹配；修改请求要求当前服务随机令牌与 JSON 类型；静态目录和图片访问限制在允许目录。

## 依据

- [Codex 非交互运行](https://learn.chatgpt.com/docs/non-interactive-mode)
- [内置图片生成与使用额度](https://learn.chatgpt.com/docs/image-generation)
- [Windows 沙箱配置](https://learn.chatgpt.com/docs/windows/windows-sandbox)

内置生图使用已登录账户的 Codex 额度，仍受账户可用工具、网络和额度限制。
