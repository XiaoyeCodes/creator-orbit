# 拾光百科本机集成

## 来源和范围

源文件：用户提供的 `F:/下载/拾光百科图文生成Skill-v1.0.zip`。原 Skill 安装于 `.agents/skills/shiguang-atlas`，只读参考资产与流程规范随项目分发。已检查所有文本与 Python 源码：无图像 API、远程上传、凭据读取或发布脚本。七张底稿以包内 SHA256 清单核对。风险为本地文件工作流；实际平台登录仍由用户完成。

原 Skill 的职责是生成与验收；ORBIT 新增运行器和本机发布准备层。压缩包中的安装、定时和云盘示例不是用户指令，本项目没有启用定时任务、云盘上传或真实自动发布。

## 用户确认的尺寸适配

用户明确回复：“设计写进提示词中作为强要求就行”。因此每次提示词保留原始三行 1086×1448 / 3:4 前缀；保存真实原生输出，并测量、展示实际像素。尺寸偏差不再单独导致失败，不缩放、不裁切、不本地叠字。`scripts/workflow_bridge.py` 仅适配尺寸校验；参考图、PNG 解码、原始字节 SHA256、逐页 QA、文案和队列提交约束仍由原脚本检查。原 `workflow.py` 未修改。

原测试的符号链接用例仅在 Windows 无创建符号链接权限时显式 skip，未更改生产检查。

## 执行链

1. 本地 Node 服务仅监听 `127.0.0.1:4173`，提供 UI 和任务接口。
2. 检查 Codex CLI、ChatGPT 登录、Python/Pillow。CLI 路径通过 Codex 桌面安装目录发现，可用 `ORBIT_CODEX_PATH` 覆盖。
3. 原助手 `prepare` 选取首条 TODO；测试采用独立副本和登记目录；运行中重复请求会拒绝。
4. 以 `codex exec --ignore-user-config --sandbox workspace-write` 启动无交互任务，使用机器已配置的 Windows elevated 沙箱实现。这里的 elevated 是沙箱实现名称，工作命令仍在限制权限内运行。
5. Prompt 要求内置 `image_gen.imagegen`、真实底稿输入、来源核实、逐页看图和 manifest。没有图片能力时必须报告阻碍。环境不传入 OpenAI API Key；不会转到外部图像 API。
   Windows 沙箱生成文件可能归沙箱账户所有，导出阶段会在同一沙箱身份下，仅为当前任务目录添加本机用户的文件读取/修改权限。保留沙箱边界，不修改系统策略，不递归跟随链接，不授予 Everyone 权限。
6. 服务读取进度文件与生成文件，独立执行适配验证和 commit。只有完整验收成功才能就绪。失败保留文件、主题和错误；服务重启可恢复。
7. 点击“一键发布”时再次校验，再打开固定小红书创作中心 URL、Explorer、Notepad 和封面默认图片查看器。剪贴板同时包含按顺序排列的带引号绝对路径和 Windows FileDropList。
8. 用户在系统文件选择框粘贴所有图片路径，再分别复制标题与正文。没有自动上传，也不会点击平台最终发布。

## 数据位置和边界

- `data/主题/topics.md`：第一次从随包快照初始化，之后不会被启动覆盖。
- `data/文案/Published-YYYY-M-D/<主题>/`：正式素材。
- `data/测试结果/_test_runs/...`：隔离测试素材。
- `data/jobs/`：任务状态。`raw_generated/`：提示词、来源、质检与 CLI 执行日志。
- 成品和日志不加入 Git，也不上传到静态站点。
- 静态在线版提供本机入口，不通过跨域接口遥控电脑。
- 本地接口要求 Host/Origin 匹配；修改请求要求当前服务随机令牌与 JSON 类型；静态目录和图片访问限制在允许目录。

## 依据

- [Codex 非交互运行](https://learn.chatgpt.com/docs/non-interactive-mode)
- [内置图片生成与使用额度](https://learn.chatgpt.com/docs/image-generation)
- [Windows 沙箱配置](https://learn.chatgpt.com/docs/windows/windows-sandbox)

内置生图使用已登录账户的 Codex 额度，仍受账户可用工具、网络和额度限制。
