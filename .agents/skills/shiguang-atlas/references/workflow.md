# 队列、恢复与状态

## 配置解释

config.example.json 是供 Codex 读取的运行配置范例，不是自动启动程序。复制到用户工作区后改成实际路径；CLI助手参数由Codex按配置传入，不假定脚本自动读取全部字段。`schedule_intent`只描述用户想要的时段，enabled也不意味着宿主任务已经注册。只有实际配置宿主并回读确认后才可报告定时已启用。

参考根相对技能目录，queue_path/output_root相对配置所在目录。不可把技能安装目录作为每次生产结果目录。技能资产只读；用户工作区持有自己的队列和输出。

## 首条 TODO 与测试隔离

主题队列为Markdown表，包含 Status、Topic、Category；保留其他列、注释、顺序、原有已生成行。取第一条状态为TODO的数据行。已有已生成不是待补发。全队列无TODO时先查本任务未交付资产，不能自动假定全部交付。

测试必须复制队列到独立测试目录，并明确记录来源与摘要。在副本取第一TODO，完整测试后可改副本状态以测试提交逻辑；原生产队列、台账、自动任务和云盘不变。测试成品不得混进生产输出。

生产每次读取最新队列与状态，不能用随包快照覆盖。开始前记录content_id、revision、选中行、原始队列SHA256、状态generating、起始时间和产物目录。运行中恢复同一篇，不为了绕开失败去下一主题。

若存在宿主时段，generation_slot使用Asia/Shanghai的YYYY-MM-DD:morning/noon/evening，同slot最多交付一篇，不追补旧slot。无宿主调度的单次手动调用使用独立manual请求标识，不伪造定时触发。

## 提交边界

在完整资产、文案与QA均通过且持久保存前保持TODO。提交前重新核对队列摘要与选中行；冲突则重新读取、核对是否已由其他运行完成，不能用旧副本全文件覆盖新进度。锁、临时文件写入、原子替换只能保护实际共享的存储；不同机器各拿一份文件不能依靠本机锁防并发，须用共享存储的版本条件写入或限定单写者。

成功只改当前主题Status为已生成，另外状态记录status=generated。失败保留status=generating或failed及具体阻碍、已经存在的资产、下次恢复位置。若生成完整但交付失败，保留生成完成事实，恢复交付，不重画所有页。若用户指定Library或Drive作为持久状态源，需从该源读取最新版本并使用其乐观版本条件；纯本地模式在用户持久工作区保存即可。

所有状态都不包含或推断小红书发布成功；用户手动发布不影响本技能生成下一篇。

## 确定性助手

本包脚本仅负责队列准备、文件/尺寸/记录校验与受条件保护的提交，不负责生图、事实查证或替代视觉审稿。读取 [manifest-schema.md](manifest-schema.md) 获得完整清单与真实调用证据格式；使用前运行 `python scripts/workflow.py --help`。流程为prepare→真实制作→validate→commit。

```bash
python scripts/workflow.py prepare --queue /实际路径/topics.md --output-root /实际路径/文案 --test-mode
python scripts/workflow.py validate --manifest /返回的项目目录/raw_generated/manifest.json
python scripts/workflow.py commit --manifest /返回的项目目录/raw_generated/manifest.json
```

命令在技能目录下执行；其他工作目录可使用脚本绝对路径。去掉 `--test-mode` 才是生产提交。`--date YYYY-MM-DD` 可显式指定本地运行日期，省略时按Asia/Shanghai；宿主真正定时运行时另传 `--slot YYYY-MM-DD:noon` 等稳定标识。prepare返回实际项目路径与空白manifest；空白模板的检查项必须保持失败，直到真实工作完成后填写。production队列旁的共享登记记录用于防重入；test登记隔离在测试根。脚本验证成功并不自动授权云盘写入或安装宿主定时任务。
