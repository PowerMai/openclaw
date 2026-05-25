# ClaWorks 生产上线 — 人工签收清单

> **状态（2026-05-25）**：P2 生产交付 **代码与文档已完成**；Studio React 编辑器 **不在范围**。  
> 剩余四项均需 **人工凭证 / 审批 / 现场硬件**，自动化无法代劳。

**分支**：`local/claworks-product`  
**关联**：[`WIP_INVENTORY.md`](../../WIP_INVENTORY.md) · [`RELEASE-CHECKLIST.md`](../RELEASE-CHECKLIST.md) · [`SIGNOFF-SNAPSHOT.md`](../SIGNOFF-SNAPSHOT.md)

---

## 上线前自动化验收（维护者本地）

在人工步骤前，确认以下命令全绿：

```bash
pnpm claworks:smoke                              # 27/27
pnpm claworks:release:preflight                  # runtime + smoke + OT dry-run + git clean
pnpm claworks:npm-publish-checklist --verify     # @claworks/runtime + claworks CLI dry-run
pnpm claworks:ot-dry-run                         # 无实机 OT 模拟
pnpm test test/scripts/claworks-feishu-live-e2e-gate.test.ts
pnpm test test/scripts/claworks-apply-branch-protection.test.ts
pnpm claworks:branch-protection                  # dry-run 打印计划
```

---

## 人工签收清单

按顺序勾选；每项链接详细 runbook。

| #   | 项                           | 状态 | 维护者动作                                                                           | 详细文档                                                             |
| --- | ---------------------------- | ---- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 1   | **GitHub branch protection** | 阻塞 | repo **admin** 在 **ClaWorks 目标仓库**（非上游 fork 默认）应用 required checks      | [`docs/GITHUB-BRANCH-PROTECTION.md`](../GITHUB-BRANCH-PROTECTION.md) |
| 2   | **npm 公开发布**             | 阻塞 | `@claworks` org 审批 + CI token；维护者执行 `npm publish --access public --tag beta` | [`docs/claworks/npm-publish.md`](npm-publish.md)                     |
| 3   | **Feishu 完整回环**          | 阻塞 | 配置 `FEISHU_*` + webhook；Gateway 运行后 live 探针                                  | [`docs/claworks/feishu-live-e2e.md`](feishu-live-e2e.md)             |
| 4   | **OT 连接器实机**            | 阻塞 | 现场 broker/PLC；`simulate: false` 联调                                              | [`docs/claworks/ot-live.md`](ot-live.md)                             |

---

## 1. GitHub branch protection

**脚本**：`pnpm claworks:branch-protection`  
**配置模板**：`.github/branch-protection/claworks-main.json`  
**Required checks**：`smoke`、`weak_model_regression`、`evolution_chain_smoke`

```bash
# 列出目标仓库最近 check 名称（需 gh 已登录）
pnpm claworks:branch-protection --list-checks

# 指定 ClaWorks 产品仓库（勿默认指向上游 openclaw/openclaw）
pnpm claworks:branch-protection --repo YOUR_ORG/claworks --list-checks

# dry-run（默认）
pnpm claworks:branch-protection --repo YOUR_ORG/claworks

# 应用（需该仓库 admin）
pnpm claworks:branch-protection --repo YOUR_ORG/claworks --apply
```

**已知阻塞**：

- 沙箱 / 未登录 `gh` → `Post "https://api.github.com/graphql": Forbidden`  
  → 维护者本机执行 `gh auth login`，再重试。
- 默认 `gh repo view` 指向上游 `openclaw/openclaw` 且无 admin → `--apply` 返回 **404 Not Found**  
  → 使用 `--repo YOUR_ORG/claworks`，或在 Settings → Branches UI 手动勾选上述 checks。

---

## 2. npm 公开发布

**预检**（不实际上传）：

```bash
pnpm claworks:npm-publish-checklist --verify
pnpm claworks:runtime:publish:dry-run
pnpm claworks:publish:dry-run
```

**人工阻塞**：

- npm org `@claworks` 所有权与 CI publish token
- `LICENSE-COMMERCIAL.md` 商业签收
- CHANGELOG / release notes（维护者 landing 时更新）

**发布**（审批后）：

```bash
cd packages/claworks-runtime && npm publish --access public --tag beta
# 根 CLI 见 docs/design/REBRAND-TO-CLAWORKS.md
```

---

## 3. Feishu live E2E

**无凭证时**：CI gate 单测 + smoke 进程内 ingress 已覆盖。

```bash
pnpm test test/scripts/claworks-feishu-live-e2e-gate.test.ts
```

**Live 探针**（需凭证 + 运行中 Gateway）：

```bash
cp contrib/examples/feishu-live-e2e.env.example contrib/examples/feishu-live-e2e.env
# 编辑 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_TEST_CHAT_ID
set -a; source contrib/examples/feishu-live-e2e.env; set +a
pnpm claworks:feishu:live-e2e
```

详见 [`feishu-live-e2e.md`](feishu-live-e2e.md)。

---

## 4. OT 连接器实机

**无硬件时**：

```bash
pnpm claworks:ot-dry-run
pnpm claworks:ot-live-checklist    # 只读清单
```

**现场**：

```bash
pnpm claworks:ot-live-checklist --verify
# 合并 production overlay，关闭 simulate
# 见 contrib/examples/claworks-personal-production.env.example
```

详见 [`ot-live.md`](ot-live.md)。

---

## 签收完成标准

- [ ] 目标仓库 `main` branch protection 已启用三项 required checks
- [ ] `@claworks/runtime` beta 已发布（或客户约定私有 registry 已推送）
- [ ] Feishu live 探针 PASS（若启用飞书渠道）
- [ ] OT 实机 checklist PASS（若部署 OT 连接器）
- [ ] [`SIGNOFF-SNAPSHOT.md`](../SIGNOFF-SNAPSHOT.md) 维护者更新日期与证据链接

---

## 明确不在 P2 范围

| 项                  | 说明                                                            |
| ------------------- | --------------------------------------------------------------- |
| Studio React 编辑器 | 跳过；不阻塞生产签收                                            |
| KB import 脚本      | 单独批次；见 [`oriosearch-kb-setup.md`](oriosearch-kb-setup.md) |
