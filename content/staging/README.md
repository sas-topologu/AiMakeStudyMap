# AI 内容暂存区（staging）

AI 生成/待审核的知识卡放在本目录，**不要直接放进 `content/cards/`**。

工作流：

1. AI 产出知识卡 JSON → 放本目录
2. 只校验不写库（并入主库现有节点做图检测，前置引用主库节点也能通过）：

   ```bash
   node content/tools/import.js --dir content/staging --check --with-db server/data/starmap.db
   ```

3. 人工/AI 审核通过后，把卡移入 `content/cards/`，再正式导入：

   ```bash
   npm run import
   ```

4. 导入自动迭代 `content_version` 并写更新日志（`GET /api/changelog` 可见）。
