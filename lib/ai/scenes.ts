import 'server-only';

/**
 * 本地商家代运营四大 AI 场景的定义与提示词模板。
 * 每个场景有：id、名称、系统提示词、构建用户提示词的函数。
 * 覆盖餐饮、美业、零售、教培等本地生活行业，兼顾小程序与私域运营场景。
 */

export type AiSceneId =
  | 'copywriting'
  | 'marketing'
  | 'customer_service'
  | 'analytics';

export type AiScene = {
  id: AiSceneId;
  name: string;
  description: string;
  featureKey: 'featureCopywriting' | 'featureMarketing' | 'featureCustomerService' | 'featureAnalytics';
  quotaKey: 'quotaCopiesMonthly' | 'quotaCampaignsMonthly' | 'quotaServiceSessionsMonthly' | null;
  systemPrompt: string;
};

export const AI_SCENES: Record<AiSceneId, AiScene> = {
  copywriting: {
    id: 'copywriting',
    name: 'AI 文案创作',
    description: '门店介绍、项目卖点、小程序详情、朋友圈与短视频文案批量生成',
    featureKey: 'featureCopywriting',
    quotaKey: 'quotaCopiesMonthly',
    systemPrompt:
      '你是本地商家（餐饮、美业、零售、教培等）的资深内容创作专家，精通小程序详情、朋友圈、社群与短视频平台的文案规则。你的文案要求：\n' +
      '1. 突出项目/商品的核心卖点与到店理由，有画面感和转化力。\n' +
      '2. 贴近本地生活语境，口语化、可信，不使用夸大或违禁表述。\n' +
      '3. 提供多个备选版本，便于商家筛选。\n4. 语言简洁有力，避免空泛套话。',
  },
  marketing: {
    id: 'marketing',
    name: 'AI 营销策划',
    description: '开业/节日活动方案、社群裂变、朋友圈素材、短视频脚本',
    featureKey: 'featureMarketing',
    quotaKey: 'quotaCampaignsMonthly',
    systemPrompt:
      '你是本地商家的营销策划专家，擅长开业活动、节日大促、社群裂变、老客召回、私域转化等玩法。你的方案要求：\n' +
      '1. 目标明确、策略可落地、有节奏安排。\n2. 给出可直接复用的文案话术与物料清单。\n' +
      '3. 结合门店所在商圈与目标客群画像。\n4. 兼顾到店转化与门店口碑。',
  },
  customer_service: {
    id: 'customer_service',
    name: 'AI 智能客服',
    description: '门店预约/营业咨询、售前售后答疑、自动回复、多轮对话',
    featureKey: 'featureCustomerService',
    quotaKey: 'quotaServiceSessionsMonthly',
    systemPrompt:
      '你是本地商家的专业客服，负责预约咨询、到店指引与售后处理。你的回复要求：\n' +
      '1. 语气亲切、专业、有耐心，第一时间安抚情绪。\n2. 准确回答营业时间、地址导航、预约改期、项目/商品信息等问题。\n' +
      '3. 不知道的信息不编造，引导用户提供更多信息。\n4. 涉及纠纷时给出合规的处理建议并引导联系人工。',
  },
  analytics: {
    id: 'analytics',
    name: '经营数据洞察',
    description: '客流/销售/项目数据解读、会员复购分析、经营诊断建议',
    featureKey: 'featureAnalytics',
    quotaKey: null,
    systemPrompt:
      '你是本地商家的经营数据分析师，擅长从客流、销售、会员、项目等数据中发现机会与问题。你的分析要求：\n' +
      '1. 先总结核心结论，再展开数据支撑。\n2. 给出可执行的经营优化建议与优先级。\n' +
      '3. 发现异常波动时指出可能原因。\n4. 结论客观，避免过度解读。',
  },
};

export function getScene(scene: AiSceneId): AiScene {
  return AI_SCENES[scene];
}

export function isAiSceneId(v: string): v is AiSceneId {
  return v in AI_SCENES;
}

/**
 * 构建文案创作场景的用户提示词。
 */
export function buildCopywritingPrompt(input: {
  productTitle: string;
  productInfo?: string;
  keywords?: string;
  tone?: string;
  count?: number;
}): string {
  const count = input.count ?? 3;
  return (
    `请为以下门店项目/商品生成 ${count} 条营销文案：\n` +
    `项目/商品名称：${input.productTitle}\n` +
    (input.productInfo ? `项目/商品信息：${input.productInfo}\n` : '') +
    (input.keywords ? `核心关键词：${input.keywords}\n` : '') +
    (input.tone ? `文案风格：${input.tone}\n` : '') +
    `请输出：吸引眼球的标题、核心卖点提炼、以及一段 100 字左右、可直接用于小程序详情或朋友圈的项目描述。`
  );
}

/**
 * 构建营销活动场景的用户提示词。
 */
export function buildMarketingPrompt(input: {
  campaignGoal: string;
  targetAudience?: string;
  channel?: string;
  budget?: string;
}): string {
  return (
    `请为以下门店营销活动策划方案：\n` +
    `活动目标：${input.campaignGoal}\n` +
    (input.targetAudience ? `目标人群：${input.targetAudience}\n` : '') +
    (input.channel ? `触达渠道（小程序/社群/朋友圈等）：${input.channel}\n` : '') +
    (input.budget ? `预算：${input.budget}\n` : '') +
    `请输出：活动主题、核心玩法、执行节奏、私域推广话术、以及预期效果指标。`
  );
}

/**
 * 构建客服场景的用户提示词（带入商品上下文）。
 */
export function buildCustomerServicePrompt(input: {
  customerQuestion: string;
  productContext?: string;
  orderContext?: string;
  language?: string;
}): string {
  return (
    (input.productContext ? `商品信息：${input.productContext}\n` : '') +
    (input.orderContext ? `订单信息：${input.orderContext}\n` : '') +
    `客户问题：${input.customerQuestion}\n` +
    (input.language && input.language !== 'zh'
      ? `请用 ${input.language} 语言回复。\n`
      : '') +
    `请给出专业、亲切的客服回复。`
  );
}

/**
 * 构建数据分析场景的用户提示词（带入结构化数据）。
 */
export function buildAnalyticsPrompt(input: {
  dataSummary: string;
  question?: string;
}): string {
  return (
    `以下是门店/商品的数据概览：\n${input.dataSummary}\n\n` +
    (input.question
      ? `请重点回答：${input.question}\n`
      : `请分析：核心结论、异常波动、优化建议。\n`)
  );
}
