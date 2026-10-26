---
description: 通读项目并刷新 AGENTS.md / README.md，使其与当前代码一致，收尾清理临时文件
---

请重新初始化本项目文档，让 `AGENTS.md` 与 `README.md` 准确反映**当前代码的真实状态**。

## 步骤

1. **通读代码建立事实基础**（不要凭记忆或旧文档写）
   - `package.json` 的 scripts（实际可执行命令、依赖版本）
   - `src/pages.json` / `src/manifest.json`（页面清单、路由基准、主题色、SDK 配置）
   - `src/config.js`（openId 占位、`apiProxy`、地图 BYOK）
   - `src/utils/*.js` 每个模块的职责与关键陷阱（`api.js` / `busId.js` / `md5.js` / `geo.js` / `asset.js` / `osrm.js`…）
   - `src/pages/*/*.vue` 页面间的传参与交互约定
   - `scripts/*`，区分两类：真正的测试（`test-*.mjs`，可用作 CI）与一次性探针/调试脚本（`probe-*.mjs` 等，依赖 dev server）
   - `deploy/*`、`.gitignore`、git 远端与分支模型（`git remote -v`、`git branch -a`）

2. **核对现有文档，找出所有与代码不符之处**（路径、页面数、命令、配色、部署方式、已废弃的做法）

3. **更新 `AGENTS.md`**
   - 面向"接手写代码的 AI"：命令、接口铁律、架构要点、渲染坑、文档可信度
   - 只写代码里看不出来、容易做错的东西；能从代码直接读到的不要复述
   - **必须如实标注已验证/已否定**：比如"某方案实测无效，不要重试"这类一手结论要保留，避免后来者重复踩坑
   - 若文档与代码冲突，**以代码为准**，并在文中明确

4. **更新 `README.md`**
   - 面向"使用者/维护者"：项目简介、启动方式、目录结构、部署、常用命令
   - 目录树与命令表必须与仓库实际一致
   - 删除已不存在的文件/命令，补上新增的

5. **保持既有风格**
   - 中文、简洁、表格优先；不擅自添加 badge、徽章、emoji 装饰
   - 不修改无关章节，不做纯措辞润色

## 收尾（每次处理完毕后必须执行）

- **清理本次产生的所有临时文件**：探针脚本的产物（`.openchamber/geom-*.json`、`.openchamber/screenshots/*`）、截图、日志、构建中间产物（`.pages-stage`、`.git/pages-tmp-index`）、临时脚本等
- 只保留有长期价值的文件；**不要删除**用户已有的源码、文档、或 `probe-*.mjs` 这类可复用探针脚本本身
- 清理后运行 `git status --short` 确认工作区只剩**本次预期修改的文档文件**
- 最后用 `git diff --stat` 汇报改了哪些文件，并简述每处修改的原因
