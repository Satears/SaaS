import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  bigint,
  numeric,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * 角色枚举：平台级角色与租户级角色分离。
 * - platform 角色：admin（平台管理员）、user（普通平台用户）
 * - tenant 角色：owner（租户所有者）、admin（租户管理员）、member（成员）
 */
export const userRoleEnum = pgEnum('user_role', ['admin', 'user']);
export const memberRoleEnum = pgEnum('member_role', ['owner', 'admin', 'member']);
export const planTierEnum = pgEnum('plan_tier', ['free', 'pro', 'business', 'enterprise']);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'inactive',
  'active',
  'trialing',
  'past_due',
  'canceled',
  'unpaid',
]);

// ─────────────────────────────────────────────
// 用户（平台级账号，可跨租户，通过 team_members 关联租户）
// ─────────────────────────────────────────────
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  // 平台级角色，用于管理后台访问控制
  platformRole: userRoleEnum('platform_role').notNull().default('user'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

// ─────────────────────────────────────────────
// 租户（Tenant）。原 teams 表保留兼容命名，语义等价于租户。
// ─────────────────────────────────────────────
export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 100 }).unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  // 订阅与计费
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripeProductId: text('stripe_product_id'),
  planName: varchar('plan_name', { length: 50 }),
  planTier: planTierEnum('plan_tier').notNull().default('free'),
  subscriptionStatus: subscriptionStatusEnum('subscription_status')
    .notNull()
    .default('inactive'),
  // 配额覆盖（null 表示使用 plan 默认配额）
  customQuota: jsonb('custom_quota'),
});

// ─────────────────────────────────────────────
// 租户成员关系（含租户内角色）
// ─────────────────────────────────────────────
export const teamMembers = pgTable('team_members', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  role: memberRoleEnum('role').notNull().default('member'),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// 订阅计划（可配置的定价档位与默认配额）
// ─────────────────────────────────────────────
export const plans = pgTable('plans', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 50 }).notNull(),
  tier: planTierEnum('tier').notNull().unique(),
  description: text('description'),
  stripePriceId: text('stripe_price_id'),
  priceMonthlyCents: integer('price_monthly_cents').notNull().default(0),
  // 默认配额，单位：每月 AI token、项目数、成员数、API 调用次数
  quotaTokenMonthly: bigint('quota_token_monthly', { mode: 'number' }).notNull().default(0),
  quotaProjects: integer('quota_projects').notNull().default(1),
  quotaMembers: integer('quota_members').notNull().default(1),
  quotaApiCallsDaily: integer('quota_api_calls_daily').notNull().default(0),
  // 电商场景配额
  quotaShops: integer('quota_shops').notNull().default(1),
  quotaProducts: integer('quota_products').notNull().default(50),
  quotaCopiesMonthly: integer('quota_copies_monthly').notNull().default(0),
  quotaCampaignsMonthly: integer('quota_campaigns_monthly').notNull().default(0),
  quotaServiceSessionsMonthly: integer('quota_service_sessions_monthly').notNull().default(0),
  // 功能开关（AI 场景是否可用）
  featureCopywriting: boolean('feature_copywriting').notNull().default(false),
  featureMarketing: boolean('feature_marketing').notNull().default(false),
  featureCustomerService: boolean('feature_customer_service').notNull().default(false),
  featureAnalytics: boolean('feature_analytics').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// AI 项目（租户内的 AI 工作空间）
// ─────────────────────────────────────────────
export const aiProjects = pgTable('ai_projects', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  model: varchar('model', { length: 100 }).notNull().default('gpt-4o-mini'),
  systemPrompt: text('system_prompt'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

// ─────────────────────────────────────────────
// 商家门店（租户下的二级隔离单元，一个商家可管理多门店）
// ─────────────────────────────────────────────
export const shops = pgTable('shops', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  name: varchar('name', { length: 100 }).notNull(),
  platform: varchar('platform', { length: 30 }).notNull().default('shopify'), // shopify / taobao / jd / pdd / douyin / amazon ...
  domain: varchar('domain', { length: 200 }),
  category: varchar('category', { length: 100 }),
  currency: varchar('currency', { length: 10 }).notNull().default('CNY'),
  // 平台接入（OAuth / API 凭证）
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at'),
  externalShopId: varchar('external_shop_id', { length: 100 }),
  syncStatus: varchar('sync_status', { length: 20 }).notNull().default('disconnected'), // disconnected / connected / syncing / error
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

// ─────────────────────────────────────────────
// 商品（归属门店，AI 文案/营销的输入源）
// ─────────────────────────────────────────────
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  shopId: integer('shop_id')
    .notNull()
    .references(() => shops.id),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 100 }),
  price: numeric('price', { precision: 12, scale: 2 }),
  sku: varchar('sku', { length: 100 }),
  images: jsonb('images'),
  attributes: jsonb('attributes'), // 颜色/尺码/材质等
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

// ─────────────────────────────────────────────
// 订单（用于数据分析洞察）
// ─────────────────────────────────────────────
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  shopId: integer('shop_id')
    .notNull()
    .references(() => shops.id),
  productId: integer('product_id').references(() => products.id),
  orderNo: varchar('order_no', { length: 100 }),
  amount: numeric('amount', { precision: 12, scale: 2 }),
  quantity: integer('quantity').notNull().default(1),
  status: varchar('status', { length: 20 }).notNull().default('paid'), // paid / shipped / refunded ...
  customerId: varchar('customer_id', { length: 100 }),
  orderedAt: timestamp('ordered_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// AI 生成内容记录（文案/营销/客服，供历史复用与审计）
// ─────────────────────────────────────────────
export const aiContents = pgTable('ai_contents', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  shopId: integer('shop_id').references(() => shops.id),
  productId: integer('product_id').references(() => products.id),
  scene: varchar('scene', { length: 30 }).notNull(), // copywriting / marketing / customer_service / analytics
  input: text('input'),
  output: text('output').notNull(),
  model: varchar('model', { length: 100 }),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// AI API Key（供租户对外调用 AI 能力）
// ─────────────────────────────────────────────
export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  name: varchar('name', { length: 100 }).notNull(),
  keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
  keyHash: text('key_hash').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  revokedAt: timestamp('revoked_at'),
});

// ─────────────────────────────────────────────
// 用量记录（计量：token、API 调用，用于配额扣减与账单）
// ─────────────────────────────────────────────
export const usageRecords = pgTable('usage_records', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  projectId: integer('project_id').references(() => aiProjects.id),
  apiKeyId: integer('api_key_id').references(() => apiKeys.id),
  kind: varchar('kind', { length: 30 }).notNull(), // 'chat' | 'completion' | ...
  model: varchar('model', { length: 100 }),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costCents: integer('cost_cents').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// 客服知识库（FAQ 问答对，支持向量化检索预留）
// ─────────────────────────────────────────────
export const knowledgeEntries = pgTable('knowledge_entries', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  shopId: integer('shop_id').references(() => shops.id),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  category: varchar('category', { length: 100 }),
  tags: jsonb('tags'),
  embedding: jsonb('embedding'), // 向量化预留（可存 pgvector 或外部向量库）
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// 客服会话 + 消息（多轮对话上下文）
// ─────────────────────────────────────────────
export const serviceSessions = pgTable('service_sessions', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  shopId: integer('shop_id').references(() => shops.id),
  userId: integer('user_id').references(() => users.id),
  customerName: varchar('customer_name', { length: 100 }),
  status: varchar('status', { length: 20 }).notNull().default('open'), // open / resolved / escalated
  language: varchar('language', { length: 10 }).notNull().default('zh'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const serviceMessages = pgTable('service_messages', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id')
    .notNull()
    .references(() => serviceSessions.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull(), // user / assistant / system
  content: text('content').notNull(),
  tokens: integer('tokens').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// 账单明细（超额用量计费：超出订阅配额的部分按量计费）
// ─────────────────────────────────────────────
export const billingLedger = pgTable('billing_ledger', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  period: varchar('period', { length: 7 }).notNull(), // 账单周期，格式 YYYY-MM
  kind: varchar('kind', { length: 30 }).notNull(), // 'overage' | 'subscription' | 'credit'
  description: text('description'),
  // 超额用量明细
  overageTokens: integer('overage_tokens').notNull().default(0),
  overageCalls: integer('overage_calls').notNull().default(0),
  amountCents: integer('amount_cents').notNull().default(0), // 正数=应收，负数=抵扣
  currency: varchar('currency', { length: 3 }).notNull().default('usd'),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending / invoiced / paid / waived
  stripeInvoiceId: varchar('stripe_invoice_id', { length: 100 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// 活动日志（审计）
// ─────────────────────────────────────────────
export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  userId: integer('user_id').references(() => users.id),
  action: text('action').notNull(),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 }),
});

// ─────────────────────────────────────────────
// 邀请
// ─────────────────────────────────────────────
export const invitations = pgTable('invitations', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(),
  invitedBy: integer('invited_by')
    .notNull()
    .references(() => users.id),
  invitedAt: timestamp('invited_at').notNull().defaultNow(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
});

// ─────────────────────────────────────────────
// 关系定义
// ─────────────────────────────────────────────
export const teamsRelations = relations(teams, ({ many }) => ({
  teamMembers: many(teamMembers),
  activityLogs: many(activityLogs),
  invitations: many(invitations),
  aiProjects: many(aiProjects),
  apiKeys: many(apiKeys),
  usageRecords: many(usageRecords),
  shops: many(shops),
  products: many(products),
  orders: many(orders),
  aiContents: many(aiContents),
  billingLedger: many(billingLedger),
  knowledgeEntries: many(knowledgeEntries),
  serviceSessions: many(serviceSessions),
}));

export const usersRelations = relations(users, ({ many }) => ({
  teamMembers: many(teamMembers),
  invitationsSent: many(invitations),
}));

export const aiProjectsRelations = relations(aiProjects, ({ one, many }) => ({
  team: one(teams, {
    fields: [aiProjects.teamId],
    references: [teams.id],
  }),
  usageRecords: many(usageRecords),
}));

export const shopsRelations = relations(shops, ({ one, many }) => ({
  team: one(teams, {
    fields: [shops.teamId],
    references: [teams.id],
  }),
  products: many(products),
  orders: many(orders),
  aiContents: many(aiContents),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  team: one(teams, {
    fields: [products.teamId],
    references: [teams.id],
  }),
  shop: one(shops, {
    fields: [products.shopId],
    references: [shops.id],
  }),
  orders: many(orders),
  aiContents: many(aiContents),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  team: one(teams, {
    fields: [orders.teamId],
    references: [teams.id],
  }),
  shop: one(shops, {
    fields: [orders.shopId],
    references: [shops.id],
  }),
  product: one(products, {
    fields: [orders.productId],
    references: [products.id],
  }),
}));

export const aiContentsRelations = relations(aiContents, ({ one }) => ({
  team: one(teams, {
    fields: [aiContents.teamId],
    references: [teams.id],
  }),
  shop: one(shops, {
    fields: [aiContents.shopId],
    references: [shops.id],
  }),
  product: one(products, {
    fields: [aiContents.productId],
    references: [products.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  team: one(teams, {
    fields: [apiKeys.teamId],
    references: [teams.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  team: one(teams, {
    fields: [invitations.teamId],
    references: [teams.id],
  }),
  invitedBy: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
  }),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  team: one(teams, {
    fields: [activityLogs.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
}));

// ─────────────────────────────────────────────
// 类型导出
// ─────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type NewActivityLog = typeof activityLogs.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type AiProject = typeof aiProjects.$inferSelect;
export type NewAiProject = typeof aiProjects.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type NewUsageRecord = typeof usageRecords.$inferInsert;
export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type AiContent = typeof aiContents.$inferSelect;
export type NewAiContent = typeof aiContents.$inferInsert;
export type BillingLedgerEntry = typeof billingLedger.$inferSelect;
export type NewBillingLedgerEntry = typeof billingLedger.$inferInsert;
export type KnowledgeEntry = typeof knowledgeEntries.$inferSelect;
export type NewKnowledgeEntry = typeof knowledgeEntries.$inferInsert;
export type ServiceSession = typeof serviceSessions.$inferSelect;
export type NewServiceSession = typeof serviceSessions.$inferInsert;
export type ServiceMessage = typeof serviceMessages.$inferSelect;
export type NewServiceMessage = typeof serviceMessages.$inferInsert;

export type TeamDataWithMembers = Team & {
  teamMembers: (TeamMember & {
    user: Pick<User, 'id' | 'name' | 'email'>;
  })[];
};

export enum ActivityType {
  SIGN_UP = 'SIGN_UP',
  SIGN_IN = 'SIGN_IN',
  SIGN_OUT = 'SIGN_OUT',
  UPDATE_PASSWORD = 'UPDATE_PASSWORD',
  DELETE_ACCOUNT = 'DELETE_ACCOUNT',
  UPDATE_ACCOUNT = 'UPDATE_ACCOUNT',
  CREATE_TEAM = 'CREATE_TEAM',
  REMOVE_TEAM_MEMBER = 'REMOVE_TEAM_MEMBER',
  INVITE_TEAM_MEMBER = 'INVITE_TEAM_MEMBER',
  ACCEPT_INVITATION = 'ACCEPT_INVITATION',
  AI_CALL = 'AI_CALL',
  API_KEY_CREATED = 'API_KEY_CREATED',
  API_KEY_REVOKED = 'API_KEY_REVOKED',
}
