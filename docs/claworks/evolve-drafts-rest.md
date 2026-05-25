# Evolve Draft REST API（运维速查）

ClaWorks Gateway REST 端点，用于审阅 LLM 生成的 Playbook 草稿与 HITL 晋升。

## GET /v1/evolve/drafts

列出 `evolution_drafts` 命名空间内待审核草稿。

```http
GET /v1/evolve/drafts
```

响应示例：

```json
{
  "status": "ok",
  "count": 1,
  "drafts": [
    {
      "proposal_id": "evolved_123",
      "title": "OEE 查询",
      "status": "pending_review",
      "created_at": "2026-05-25T00:00:00.000Z"
    }
  ]
}
```

## GET /v1/evolve/drafts/:id

读取单个草稿，**含沙盒模拟结果**（`simulation` 字段）。晋升前请先确认 `simulation.passed === true`。

```http
GET /v1/evolve/drafts/evolved_123
```

响应示例：

```json
{
  "status": "ok",
  "draft": {
    "proposal_id": "evolved_123",
    "title": "OEE 查询",
    "status": "pending_review",
    "simulation": {
      "yaml_valid": true,
      "passed": true,
      "status": "ok",
      "duration_ms": 12,
      "step_count": 0,
      "simulated_at": "2026-05-25T01:00:00.000Z"
    }
  }
}
```

草稿不存在时返回 `404`。

## POST /v1/evolve/promote-draft

HITL 批准后将草稿部署到 Pack。**fail-closed**：`approved` 必须为 `true`，且草稿须已通过沙盒模拟（`simulation.passed === true`）。

```http
POST /v1/evolve/promote-draft
Content-Type: application/json

{
  "proposal_id": "evolved_123",
  "approved": true,
  "verify_after_deploy": false
}
```

模拟未通过或缺失时返回 `{ "status": "error", "reason": "...simulation..." }`，不会写入生产 Pack。

## 认证与 RBAC

Gateway 启用 `gateway.auth.api_key` 时，请求须带 `Authorization: Bearer <token>`（或配置中的哈希密钥）。

| 端点                            | 动作 | RBAC 资源                    |
| ------------------------------- | ---- | ---------------------------- |
| `GET /v1/evolve/drafts`         | 读   | `rest.read`（默认 `rest:*`） |
| `GET /v1/evolve/drafts/:id`     | 读   | `rest.read`                  |
| `POST /v1/evolve/promote-draft` | 写   | `evolve:promote_draft`       |

未配置 API Key 时为本地开发模式（`system` 主体，读写均允许）。生产环境请配置 RBAC 策略，仅授予运维角色 `evolve:promote_draft` 写权限。

## 烟测

`pnpm claworks:evolution:smoke` 覆盖 drafts 列表/单条读取与 promote 门禁（见 `scripts/claworks-evolution-chain-smoke.mjs`）。
