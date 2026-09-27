/**
 * 品牌与产品配置（集中管理，改品牌名只需改这里）。
 */
export const brand = {
  /** 产品中文名 */
  name: '时光机AI代运营系统',
  /** 产品简称（用于空间受限处） */
  shortName: '时光机',
  /** 运营主体公司 */
  company: '时光机文化传播有限公司',
  /** 产品英文名（用于 key、日志等） */
  nameEn: 'TimeMachine AI',
  /** 一句话定位 */
  tagline: '本地商家一站式 AI 代运营',
  /** SEO 描述 */
  description:
    '时光机AI代运营系统，为本地商家提供小程序搭建 + AI内容创作 + 私域运营的一站式代运营服务。从商城/预约/会员小程序上线，到 AI 自动写文案、做客服、发营销，全托管运营，让中小商家零技术门槛也能玩转数字化生意。',
  /** 顶部导航（落地页） */
  nav: [
    { href: '/#services', label: '服务' },
    { href: '/#capabilities', label: '能力' },
    { href: '/#process', label: '流程' },
    { href: '/pricing', label: '定价' },
  ],
  /** 联系邮箱（占位） */
  contactEmail: 'hello@timemachine-ai.example',
} as const;

export type Brand = typeof brand;