<div align="center">

<img src="docs/images/banner.svg" alt="ORBIT · Creator Terminal" width="100%" />

# Creator Orbit

**让创作更专注，让发布更轻松。**

一个运行在本机的 AI 自媒体创作工作台。<br/>
管理选题、生成图文、整理素材，把重复的发布准备交给 ORBIT。

![Windows](https://img.shields.io/badge/Windows-本机工作台-172012?style=flat-square) ![Node.js](https://img.shields.io/badge/Node.js-18%2B-172012?style=flat-square&logo=nodedotjs&logoColor=c0f57e) ![Python](https://img.shields.io/badge/Python-3.10%2B-172012?style=flat-square&logo=python&logoColor=c0f57e) ![Frontend](https://img.shields.io/badge/Frontend-Vanilla_JS-172012?style=flat-square&logo=javascript&logoColor=c0f57e)

[界面预览](#界面预览) · [快速开始](#快速开始) · [创作流程](#创作流程) · [选题配置](#选题配置) · [开发与验证](#开发与验证)

</div>

---

## 为什么做 ORBIT

自媒体创作里，有很多时间花在内容之外：找下一个选题、整理图片、打开发布页面，再来回复制标题、正文和文件路径。

ORBIT 把这些步骤放进一个深色、简约的工作台。当前已打通 **小红书「拾光百科」的本机创作与发布准备流程**：用已登录的 Codex 核实来源、生成文案和图片，完成验收后，打开发布所需的页面与文件。

> **当前能力**：小红书图文生成与发布准备已接入真实流程；微信公众号、视频号、抖音、快手、X 的管理界面目前是演示。上传和最终发布仍由你在平台页面确认。

## 界面预览

### 01 / 创作总览

平台矩阵、内容草稿、发布日历与素材入口，集中在一个工作台。

![ORBIT 深色工作台总览](docs/images/dashboard.png)

<sub>总览中的账号、粉丝数、数据指标和初始内容为演示数据。</sub>

### 02 / 从选题到完整图文

封面、内页、文案与原生尺寸一起预览。只有完整验收通过，才开放发布准备。

![拾光百科真实生成成果：世界水果图鉴](docs/images/creation-studio.png)

<sub>图中为实际生成的「世界水果图鉴」测试成果：1 张封面、4 张内页及配套文案；5 张图片原生尺寸均为 1086 × 1448。测试模式不推进正式选题队列。</sub>

### 03 / 下一篇，由你决定

直接编辑正在使用的 Markdown 配置，调整标题、分类、状态和顺序。保存后，下一篇立即刷新。

![选题配置编辑器](docs/images/topic-editor.png)

<sub>截图来自本机运行界面；配置文件路径仅在截图中做了展示脱敏。</sub>

<details>
<summary><strong>查看手机宽度下的布局</strong></summary>
<br/>
<div align="center">
<img src="docs/images/mobile.png" alt="拾光百科移动端布局" width="320" />
</div>

手机截图展示响应式布局。当前生成与桌面发布助手仍运行在 Windows 本机，服务默认只接受本机访问。

</details>

## 核心功能

| 功能 | 你可以做什么 |
| :--- | :--- |
| **选题队列** | 读取首条 TODO；修改、添加、删除或调整选题顺序；完成后继续下一篇 |
| **Codex 内置生成** | 使用 ChatGPT 登录态运行 Codex，生成文案和真实 PNG；无需配置图像 API Key |
| **参考图与质检** | 使用 Skill 附带参考图，保留提示词、来源、原图哈希与逐页检查记录 |
| **成果预览** | 查看图片、放大细节、读取标题正文、确认实际尺寸 |
| **发布准备** | 打开小红书创作页、素材目录、文案和封面；复制全部图片路径 |
| **恢复与备份** | 中断后保留成果继续；配置保存前备份，外部修改冲突时保留草稿 |
| **隔离测试** | 使用独立队列副本验证流程，不推进正式选题进度 |
| **内容工作台** | 浏览器内草稿编辑、搜索筛选、日历、JSON 导出及多平台 UI 演示 |

### 平台支持范围

| 平台 | 当前状态 |
| :--- | :--- |
| 小红书 | **真实可用**：拾光百科图文生成、验收、本机发布准备 |
| 微信公众号 / 微信视频号 | 管理与内容界面演示 |
| 抖音 / 快手 | 管理与内容界面演示 |
| X（Twitter） | 管理与内容界面演示 |

## 快速开始

### 环境准备

- **Windows 10 / 11**：Explorer、记事本和系统剪贴板用于发布准备。
- **Node.js 18+**：运行本地服务；本项目已在 Node.js 24 上验证。
- **Python 3.10+ 与 Pillow**：读取队列、校验 PNG 和执行 Skill 工作流。
- **Codex CLI**：使用 **ChatGPT 账号登录**，具备内置 `image_gen` 能力及已配置的 Windows 沙箱环境。

内置生图使用登录账户的 Codex 额度，受工具可用性、网络和额度限制。项目不通过外部图像 API 生成图片。

### 安装与启动

```powershell
git clone https://github.com/XiaoyeCodes/creator-orbit.git
cd creator-orbit

# 安装图片校验依赖
python -m pip install Pillow

# 如果 Codex 已加入 PATH，可检查登录状态
codex login status
# 尚未登录时运行：codex login

# 启动本地工作台
npm start
```

打开 **[http://127.0.0.1:4173/#atlas](http://127.0.0.1:4173/#atlas)**。

项目没有 npm 运行时依赖，无需先执行 `npm install`。也可以双击根目录的 **`启动工作台.cmd`**，在后台启动服务并打开浏览器。生成期间请保持本机服务运行。

<details>
<summary><strong>找不到 Codex 或 Python？手动指定路径</strong></summary>

服务会尝试发现 Codex 桌面应用安装目录及 PATH 中的程序。无法找到时，在启动服务的 PowerShell 窗口中设置：

```powershell
$env:ORBIT_CODEX_PATH = 'C:\path\to\codex.exe'
$env:ORBIT_PYTHON_PATH = 'C:\path\to\python.exe'
npm start
```

请替换成机器上的真实路径。修改环境变量后，需要重启本地服务。

</details>

## 创作流程

```mermaid
flowchart LR
    A[读取下一条 TODO] --> B[查证来源与撰写文案]
    B --> C[Codex 内置生图]
    C --> D[逐页检查与独立验收]
    D --> E[预览并准备发布]
    E --> F[你在小红书确认发布]
```

1. **生成下一篇**：进入「拾光百科」，确认顶部主题，选择正式生成或独立测试。未完成的正式任务会优先恢复。
2. **检查图文**：等待来源、文案、图片和质检记录完成。在成果区检查封面、全部内页、标题及正文。
3. **一键准备发布**：点击「一键发布」，打开小红书创作平台、图片文件夹、记事本文案和封面预览，并复制图片路径。
4. **粘贴并确认**：在系统文件选择框按 `Ctrl + V`、回车，一次选中全部图片。再分别复制标题、正文与标签，粘贴到平台并确认发布。

> 「一键发布」是发布准备助手：它不会代替你上传素材或点击最终发布。剪贴板同时包含带引号的绝对路径和 Windows 文件列表，支持中文及带空格的路径。

## 选题配置

唯一正式配置位于 **`data/主题/topics.md`**，第一次启动时从 Skill 附带的快照初始化，之后不会被启动过程覆盖。

```markdown
# Topics

| Status | Topic | Category |
| --- | --- | --- |
| 已生成 | 世界水果图鉴 | 食物饮食 |
| TODO | 世界甜点图鉴 | 食物饮食 |
| TODO | 世界街头美食图鉴 | 食物饮食 |
```

- **下一篇**：读取第一条 `TODO`，与当前浏览的历史成果无关。
- **修改内容**：点击「编辑选题配置」，或用记事本直接修改原文件。
- **调整顺序**：移动整行；标题中的 `|` 使用 `\|` 转义。
- **跳过选题**：把该行状态改为 `已生成`。示例表格仅演示语法，不会自动修改你的进度。
- **保存保护**：保存前备份到 `data/主题/backups/`；版本冲突不覆盖文件。
- **任务一致性**：运行中或存在未提交的正式任务时暂停保存配置，先完成当前任务。

正式手动生成没有每天一篇的限制；独立测试不会改变正式队列。

## 本地数据与实现

```text
creator-orbit/
├── dist/                      # 原生 HTML / CSS / JavaScript 界面
├── lib/                       # Codex 运行器、任务管理、选题读写
├── scripts/                   # Windows 桌面助手、启动与校验适配
├── .agents/skills/shiguang-atlas/
│   ├── assets/                # 参考图与初始选题快照
│   ├── references/            # 生成规范和验收要求
│   └── scripts/               # 原 Skill 的确定性工作流
├── tests/                     # Node / Python 测试
├── docs/                      # 集成说明、验证记录和界面截图
├── data/                      # 本机运行时创建，不提交到 Git
│   ├── 主题/                  # 正式配置与备份
│   ├── 文案/                  # 正式图片与文案
│   ├── 测试结果/              # 隔离测试成果
│   └── jobs/                  # 任务状态
├── server.cjs                 # 仅监听本机的 HTTP 服务
└── 启动工作台.cmd             # Windows 双击启动入口
```

**轻量前端**：原生 HTML、CSS、JavaScript，无框架构建步骤。<br/>
**本机执行**：Node.js 调用 Codex CLI、Python 和固定的 PowerShell 桌面脚本。<br/>
**过程可查**：每篇内容的 `raw_generated/` 保存来源、提示词、检查记录与运行日志。<br/>
**保留原图**：1086 × 1448 / 3:4 作为提示词强要求，展示实际尺寸，不做本地缩放、裁切或补字。<br/>
**数据区分**：拾光百科成果保存为真实本地文件；通用工作台的演示内容保存在浏览器 `localStorage`。

仅托管 `dist/` 可展示在线界面。Codex 生成、文件访问和桌面发布准备需要本机 Node 服务，不能仅靠静态托管执行。

## 开发与验证

```powershell
# JavaScript 语法检查
npm run check

# 任务、配置、接口和发布准备逻辑
npm test

# 原 Skill 与图片尺寸适配
python -m unittest discover -s tests -p test_adapter.py -v
```

| 检查 | 当前验证记录 |
| :--- | :--- |
| Node 自动测试 | 12 项通过 |
| Python 自动测试 | 38 项通过；1 项因 Windows 符号链接权限限制跳过 |
| 浏览器布局与交互 | 1512 / 1024 / 768 / 390 像素宽度通过 |
| 真实生成链路 | 5 张原生 PNG + 文案，验收通过 |
| 真实发布准备 | 页面与文件打开、标题正文复制、5 张图片路径回读通过 |

结构测试使用隔离的模拟素材；真实生成测试另行记录。当前验证不代表已向小红书上传或发布帖子。

- [集成说明与技术边界](docs/integration.md)
- [详细验证记录](docs/verification.md)
- [选题编辑设计](docs/plans/2026-10-16-topic-config-design.md)
- [拾光百科 Skill](.agents/skills/shiguang-atlas/SKILL.md)

---

<div align="center">

**少一点重复操作，多一点创作时间。**

ORBIT · Built for creators, kept on your desktop.

</div>
