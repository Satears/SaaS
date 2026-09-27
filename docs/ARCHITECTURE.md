# 时光机AI代运营系统 · 架构设计

> 面向**本地商家**（餐饮、美业、零售、教培等）的多租户 SaaS 解决方案，集成 AI 与小程序能力。
> 由**时光机文化传播有限公司**运营，提供「小程序搭建 + AI 内容创作 + 私域运营」一站式代运营服务。基于 Next.js SaaS Starter 改造扩展。

## 0. 产品定位

**一个商家 = 一个租户**（可管理多门店）。为本地商家提供一站式代运营：

- **小程序搭建**：商城 / 预约 / 会员小程序上线，打通线上线下一体化经营。
- **AI 内容创作**：AI 自动写文案、做客服、发营销，全托管运营。

四大 AI 场景能力通过**多档订阅套餐**变现：

| AI 场景 | 能力 | 典型输出 |
|---|---|---|
| AI 文案创作 | 门店介绍/项目卖点/小程序详情/朋友圈文案 | 多版本营销文案 |
| AI 营销策划 | 开业/节日活动、社群裂变、短视频脚本 | 活动方案 + 话术 |
| AI 智能客服 | 预约/营业咨询、售前售后、多轮对话 | 专业客服回复 |
| 经营数据洞察 | 客流/销售/会员数据解读 | 结论 + 优化建议 |

## 1. 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js 15（App Router）+ React 19 |
| 数据库 | PostgreSQL（Drizzle ORM） |
| 认证 | JWT（jose）+ bcrypt 密码哈希，HttpOnly Cookie |
| 订阅计费 | Stripe（Checkout + Billing Portal + Webhook） |
| AI | Provider 抽象层（OpenAI 兼容 + Mock 回退） |
| UI | shadcn/ui + Tailwind CSS |
| 校验 | Zod |
| 数据获取 | SWR |

## 2. 分层架构

```
┌─────────────────────────────────────────────┐
│  表现层：营销站 / 认证 / Dashboard / AI 控制台 / Admin │
├─────────────────────────────────────────────┤
│  平台能力层：认证 · RBAC · 订阅计费 · 租户隔离 · 配额    │
├─────────────────────────────────────────────┤
│  AI 服务层：Provider 抽象 · 用量计量 · API Key · 限流  │
├─────────────────────────────────────────────┤
│  数据层：PostgreSQL（多租户 + RLS 就绪）               │
└─────────────────────────────────────────────┘
```

## 3. 多租户架构

采用**共享数据库 + 共享 Schema + team_id 行级隔离**（Row-Level Multi-tenancy）。

- **租户 = `teams` 表**（兼容原命名，语义等同 Tenant）。
- **用户是平台级账号**，通过 `team_members` 关联到多个租户。
- **角色分离**：
  - 平台级角色 `users.platform_role`：`admin`（平台管理员）/ `user`。
  - 租户级角色 `team_members.role`：`owner` / `admin` / `member`。

### 租户数据隔离策略

所有租户数据（AI 项目、API Key、用量、活动日志）均通过 `team_id` 外键归属，
查询时**强制携带 `team_id` 作用域**（见 `requireTenant` / `requireTenantApi` 守卫）。

- 租户内查询：`getAiProjectsForTeam(teamId)` 等始终以 `teamId` 过滤。
- 越权防护：按 id 取实体的查询要求同时传入 `teamId`（如 `getShopById(shopId, teamId)`），跨租户访问返回空。
- **客户端传入的外键必须校验归属**：`shopId` 等来自请求体的字段，写入前一律经
  `getShopById(shopId, teamId)` 确认属于当前租户（商品新增 / 批量导入 / AI 场景 / 客服会话）。
- **无 `team_id` 列的子表**（如 `service_messages`）先校验父级归属再读写。
- **角色与团队强绑定**：`getMembershipForUser(userId, teamId)` 必须带 `teamId`，
  避免多团队用户取到其它团队的角色（见 `lib/auth/rbac.ts`）。
- 数据库级 RLS 当前**为关闭状态**（原因见 `docs/RLS.md`），隔离完全依赖上述应用层约束。

## 4. 认证与 RBAC

### 认证流程

1. 邮箱 + 密码注册/登录，密码经 bcrypt（10 轮）哈希存储。
2. 登录成功后签发 JWT（HS256，`AUTH_SECRET`），写入 HttpOnly Cookie。
3. `proxy.ts`（Next 新约定，替代已 deprecated 的 `middleware.ts`）保护 `/dashboard`、`/admin` 路由、滑动续期会话，并下发 CSP。

### RBAC 守卫（`lib/auth/rbac.ts`）

| 守卫 | 作用 |
|---|---|
| `getTenantContext()` | 获取当前用户 + 团队 + 租户角色 |
| `requireTenant()` | 要求已登录且属于某租户 |
| `requireTenantApi()` | API 版本租户守卫，未认证返回 null |
| `requireRole(ctx, minRole)` | 校验租户内角色（owner > admin > member） |
| `requirePlatformAdmin()` | 要求平台级管理员（/admin） |

## 5. 订阅与计费

### 计划模型（`plans` 表）

| 档位 | 月费 | Token/月 | 项目数 | 成员数 | API/日 |
|---|---|---|---|---|---|
| Free | ¥0 | 5 万 | 1 | 1 | 100 |
| Pro | ¥12 | 100 万 | 10 | 5 | 5000 |
| Business | ¥49 | 1000 万 | 50 | 20 | 5 万 |
| Enterprise | ¥199 | 1 亿 | 200 | 100 | 50 万 |

### 计费流程

1. Stripe Checkout 创建订阅 → `checkout/route.ts` 回写 `stripeCustomerId` 等。
2. Stripe Webhook（`subscription.updated/deleted`）→ `handleSubscriptionChange`。
3. 将 Stripe Product Name 映射为 `plan_tier`（`mapPlanNameToTier`）。
4. 配额 = `teams.custom_quota`（覆盖）> `plans` 默认值。

### 配额系统（`lib/billing/quota.ts`）

- `checkQuota`：AI 调用前校验月度 Token 与每日 API 次数。
- `checkProjectQuota` / `checkMemberQuota`：创建项目/邀请成员前校验。
- 超限返回 HTTP 402（Payment Required）。

## 6. AI 能力模块

### Provider 抽象（`lib/ai/provider.ts`）

统一接口 `AiProvider.chatCompletion()`，内置：
- `OpenAiCompatibleProvider`：通过 `AI_BASE_URL` / `AI_API_KEY` 调用任意 OpenAI 兼容端点。
- `MockProvider`：未配置密钥时的本地演示回退。

### 编排服务（`lib/ai/service.ts`）

`runAiCompletion()` 完整链路：
```
鉴权 → 加载项目(system prompt/model) → 配额校验 → Provider 调用 → 用量计量 → 返回
```

### 用量计量（`lib/ai/usage.ts` + `usage_records` 表）

每次调用记录：输入/输出 token、模型、成本（分）、关联项目/API Key。
这是配额扣减与账单的基础。

### API Key（`lib/ai/apikey.ts`）

- 生成 `sk-saas_xxx` 格式密钥，仅明文返回一次，数据库存 SHA-256 哈希。
- `validateApiKey` 校验有效性（含过期时间）。

### 安全护栏（`lib/security/rate-limit.ts`）

- 按租户 / API Key / IP 维度限流（登录、注册、AI 接口、开放 API）。
- 配置 `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` 后走 Upstash Redis REST
  做**分布式计数**（Vercel 多实例共享，限流才真正生效）；未配置或远端异常时
  自动降级为单实例内存计数，保证可用性。

## 7. API 路由

| 路由 | 鉴权 | 说明 |
|---|---|---|
| `POST /api/ai/chat` | Session | 租户内聊天 |
| `POST /api/v1/chat` | API Key | 对外开放（OpenAI 兼容） |
| `/api/ai/projects` | Session + 角色 | 项目 CRUD |
| `/api/ai/keys` | Session + 角色 | API Key 管理 |
| `/api/ai/usage` | Session | 用量/配额查询 |
| `/api/admin/stats` | 平台 admin | 平台统计 |
| `/api/stripe/checkout` | Session + 归属校验 | Checkout 成功回调（GET，Stripe 重定向要求）；校验会话归属当前用户与团队，不再凭 `session_id` 铸造登录态 |
| `/api/stripe/webhook` | Stripe 签名 | 订阅变更；处理 `checkout.session.completed` 与 `customer.subscription.*` |

## 8. 模块边界与目录结构

```
lib/
├── auth/          # 认证（session）与 RBAC（rbac）
├── db/            # 数据层（schema / queries / migrations / seed）
├── payments/      # Stripe 集成
├── billing/       # 配额与计量
├── ai/            # AI 能力（provider / service / usage / apikey）
└── security/      # 限流等安全护栏

app/
├── (dashboard)/dashboard/ai/   # AI 控制台（chat/projects/keys/usage）
├── api/ai/                     # AI 内部 API
├── api/v1/                     # 对外开放 API
├── api/admin/                  # 平台管理 API
└── admin/                      # 平台管理后台
```

## 9. 安全设计

- **密码**：bcrypt（10 轮）哈希，绝不明文。
- **会话**：JWT HttpOnly Cookie，`secure` + `sameSite=lax`。
- **API Key**：SHA-256 哈希存储，明文仅返回一次。
- **输入校验**：所有 API 入口经 Zod schema 校验。
- **租户隔离**：查询强制 `team_id` 作用域 + 客户端外键归属校验（见第 3 节）。
- **速率限制**：登录 / 注册 / AI 接口 / 开放 API 限流，支持 Upstash 分布式计数。
- **CSP**：由 `proxy.ts` 按请求生成 nonce 下发（`script-src` 使用 nonce），
  内联脚本全部带 nonce，外部脚本限同源。
- **响应头**：`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、
  `Permissions-Policy`、`Strict-Transport-Security`（见 `next.config.ts`）。
- **Stripe**：`checkout` 成功回调要求已登录且 `client_reference_id` 属于当前用户；
  webhook 强制验签。
- **软删除**：用户、项目支持软删除（`deletedAt`）。
- **审计日志**：关键操作记录到 `activity_logs`。

## 10. 扩展性

- **Provider 可插拔**：新增模型服务商仅需实现 `AiProvider` 接口。
- **定价可配置**：计划与配额存于 `plans` 表，可运行时调整。
- **限流可扩展**：已支持 Upstash Redis 分布式限流，未配置时自动回落内存实现。
- **RLS 就绪**：共享表 + `team_id` 已为 RLS 铺路。
- **用量即账单**：`usage_records` 为后续用量计费/对账提供基础。

## 11. 商家数据模型（多租户）

租户下的商家实体，均为 `team_id` 隔离，门店是二级隔离单元：

| 表 | 说明 | 关键字段 |
|---|---|---|
| `shops` | 商家门店 | team_id、platform、domain、currency |
| `products` | 商品 | team_id、shop_id、title、price、attributes(jsonb) |
| `orders` | 订单 | team_id、shop_id、product_id、amount、status |
| `ai_contents` | AI 生成内容 | team_id、scene、input、output、tokens |

关系：`teams 1—N shops 1—N products`；`products 1—N orders`。

## 12. 套餐与功能 gating

`plans` 表扩展了电商场景配额与功能开关：

| 字段 | 说明 |
|---|---|
| `quota_shops` / `quota_products` | 门店/商品数量上限 |
| `quota_copies_monthly` | 每月文案生成条数 |
| `quota_campaigns_monthly` | 每月营销方案数 |
| `quota_service_sessions_monthly` | 每月客服会话数 |
| `feature_copywriting` 等 | 四大 AI 场景开关 |

### 档位能力矩阵

| 能力 | Free | Pro | Business | Enterprise |
|---|---|---|---|---|
| AI 文案创作 | ✓ | ✓ | ✓ | ✓ |
| AI 营销策划 | ✗ | ✓ | ✓ | ✓ |
| AI 智能客服 | ✗ | ✓ | ✓ | ✓ |
| 经营数据洞察 | ✗ | ✓ | ✓ | ✓ |
| 门店数 | 1 | 3 | 10 | 100 |

### gating 链路

```
用户访问场景 → /api/plan 拉取能力 → 前端展示「升级解锁」
    ↓
调用 /api/ai/scenes → runSceneCompletion
    ↓
功能开关校验(featureKey) → 场景配额 → Provider 调用 → 记录 ai_contents + usage
```

## 13. 场景化 AI 架构

`lib/ai/scenes.ts` 定义四大场景（系统提示词 + 输入构建函数，面向餐饮/美业/零售/教培等本地商家语境），`lib/ai/ecommerce.ts` 的 `runSceneCompletion` 统一编排。场景系统提示词与通用聊天解耦，便于单独调优每个场景的 prompt。

```
lib/ai/
├── provider.ts      # Provider 抽象（OpenAI 兼容 + Mock）
├── scenes.ts        # 四大电商场景定义与提示词模板
├── ecommerce.ts     # 场景编排（gating → 配额 → 调用 → 记录）
├── service.ts       # 通用 AI 编排
├── usage.ts         # 用量计量
├── apikey.ts        # API Key 管理
└── knowledge.ts     # 客服知识库检索 + 多轮会话
```

## 14. 商品批量导入

`lib/ecommerce/csv.ts` 提供零依赖 CSV 解析器（支持引号包裹、转义、CRLF/LF），
`app/api/ecommerce/products/import/route.ts` 实现批量导入：

- 支持 multipart 文件上传与 JSON 两种方式
- 表头字段映射（title/description/category/price/sku + 自定义属性列）
- 逐行校验（缺失标题、非法价格 → 跳过并记录错误）
- 导入前配额预检，超限返回 402
- 分批写入（每批 200 条）

## 15. 用量计费（超额按量收费）

`lib/billing/usage-billing.ts` 实现订阅配额之外的超额计费：

| 字段 | 说明 |
|---|---|
| `quotaTokenMonthly` | 订阅套餐每月免费 token 配额 |
| 超额 token | 超出部分按 tier 单价计费 |
| `billing_ledger` | 账单明细表（每周期一条 overage 记录） |

计费链路：`recordUsage` 累计用量 → `calculateOverage` 计算超额 → `syncOverageLedger` 生成/更新账单。

## 16. 客服知识库 + 多轮对话

`lib/ai/knowledge.ts` + 三张表（`knowledge_entries` / `service_sessions` / `service_messages`）：

- **知识库**：FAQ 问答对，关键词检索（RAG 预留 `embedding` 字段）
- **多轮会话**：会话上下文持久化，最近 10 条历史 + 知识库命中片段注入提示词
- **检索链路**：`searchKnowledge` 命中 → `knowledgeToContext` 拼装 → 注入客服 system prompt

## 17. 门店 / 小程序接入

`lib/ecommerce/platforms.ts` 定义 `PlatformAdapter` 统一接口：

- `buildAuthUrl` / `handleAuthCallback`：OAuth 授权
- `syncProducts` / `syncOrders`：商品/订单同步
- `miniprogram`（小程序，本地商家默认来源）为占位适配器，由时光机代运营团队协助开通；Shopify 提供参考实现，淘宝/京东/拼多多/抖音/Amazon 亦为占位适配器（清晰报错）

门店表扩展接入字段：`access_token` / `refresh_token` / `external_shop_id` / `sync_status` / `last_synced_at`。

**OAuth state 签名**：授权发起时由 `lib/ecommerce/oauth-state.ts` 用 `AUTH_SECRET` 签发 JWT（含 `shopId` + `teamId`，10 分钟有效）；回调先验签还原归属，再以 `getShopById(shopId, teamId)` 限定查询，防止篡改 state 把凭证写到其他团队的门店上。

## 18. 数据分析可视化

`app/api/ecommerce/analytics` 返回聚合数据，前端零依赖 SVG 图表：

- KPI 卡片（门店/商品/订单/销售额）
- 折线图：近 14 天订单趋势
- 柱状图：商品销量 TOP
- 环形图：商品品类分布

聚合查询（`lib/db/queries.ts`）：`getOrderStatusBreakdown` / `getOrderTrend` / `getTopProducts` / `getCategoryDistribution`。

## 19. 向量化语义检索

`lib/ai/embedding.ts` 提供可插拔 embedding 抽象：

- `LocalHashEmbedder`：零外部依赖的本地哈希向量（中文 bigram + 关键词哈希，无 API Key 降级）
- `OpenAiEmbedder`：调用 OpenAI `text-embedding-3-small`（有 API Key 时自动升级）

`searchKnowledge` 升级为混合检索：向量语义相似度（70%）+ 关键词匹配（30%）加权排序。创建知识条目时自动生成 embedding 存入 `embedding` jsonb 字段。

## 20. Stripe metered billing 对接

`lib/billing/metered.ts` 封装超额用量按量计费：

- `reportOverageToStripe`：上报超额 token 到 Stripe Billing Meter（v2 API）
- `createOverageInvoice`：为团队创建超额发票（send_invoice + 7 天到期）
- `settleOverageLedger`：结算 pending 账单（零费用标记 waived，有费用开票并标记 invoiced）

未配置 meter/customer 时安全降级（仅记录日志，不报错）。

## 21. 路线图

- [x] 多租户架构 + RBAC + 订阅计费
- [x] 商家数据模型（门店/商品/订单）
- [x] 四大 AI 场景（文案/营销/客服/数据）
- [x] 套餐功能 gating 与场景配额
- [x] 商品批量导入（CSV/Excel）
- [x] 客服知识库与多轮对话
- [x] 门店 / 小程序接入（miniprogram 占位 + Shopify 参考实现）
- [x] 用量计费（超额按量收费）
- [x] 数据分析图表可视化
- [x] 向量化检索（本地哈希 + OpenAI embedding）
- [x] Stripe metered billing 对接（超额自动开票）
- [ ] 淘宝/京东等平台 adapter 实现（需开放平台资质）
