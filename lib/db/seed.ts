import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from './drizzle';
import {
  users,
  teams,
  teamMembers,
  shops,
  products,
  orders,
  knowledgeEntries,
  plans
} from './schema';

/**
 * 为付费档位创建 Stripe 产品与价格，并把 price id 回写到 plans.stripePriceId。
 * 产品名必须与 mapPlanNameToTier 的识别规则一致（Pro / Business / Enterprise）。
 */
async function createStripeProducts() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.log('跳过 Stripe 产品创建（未配置 STRIPE_SECRET_KEY，本地演示不受影响）。');
    return;
  }

  const { stripe } = await import('../payments/stripe');

  console.log('Creating Stripe products and prices...');

  const allPlans = await db.select().from(plans);

  for (const plan of allPlans) {
    if (plan.priceMonthlyCents <= 0) continue;

    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description ?? `${plan.name} subscription plan`,
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.priceMonthlyCents,
      currency: 'cny',
      recurring: {
        interval: 'month',
        trial_period_days: 14,
      },
    });

    await db
      .update(plans)
      .set({ stripePriceId: price.id, updatedAt: new Date() })
      .where(eq(plans.id, plan.id));

    console.log(`Stripe product created for plan ${plan.name} (${price.id}).`);
  }

  console.log('Stripe products and prices created successfully.');
}

async function seed() {
  const email = 'test@test.com';
  const password = 'admin123';
  const passwordHash = await hash(password, 10);

  const [user] = await db
    .insert(users)
    .values([
      {
        email: email,
        passwordHash: passwordHash,
        platformRole: "admin",
      },
    ])
    .returning();

  console.log('Initial user created.');

  const [team] = await db
    .insert(teams)
    .values({
      name: '示例商家·时光机门店',
    })
    .returning();

  await db.insert(teamMembers).values({
    teamId: team.id,
    userId: user.id,
    role: 'owner',
  });

  // 电商演示数据：店铺 + 商品
  await seedEcommerceData(team.id);
  console.log('E-commerce demo data created.');

  await createStripeProducts();
}
async function seedEcommerceData(teamId: number) {
  const [shop] = await db
    .insert(shops)
    .values({
      teamId,
      name: '时光机·示例门店',
      platform: 'miniprogram',
      domain: 'miniprogram://demo',
      category: '美业',
      currency: 'CNY',
    })
    .returning();

  const insertedProducts = await db
    .insert(products)
    .values([
      {
        teamId,
        shopId: shop.id,
        title: '洗剪吹造型',
        description: '资深发型师一对一设计，含洗发、造型，适合日常与约会。',
        category: '剪发',
        price: '68.00',
        sku: 'HAIR-001',
        attributes: { 适合人群: ['男士', '女士'], 时长: '45 分钟' },
      },
      {
        teamId,
        shopId: shop.id,
        title: '单人烫染护理套餐',
        description: '进口染膏，含烫/染 + 深层护理，交付前免费造型。',
        category: '烫染',
        price: '288.00',
        sku: 'HAIR-002',
        attributes: { 时长: '180 分钟', 含: ['烫/染', '护理'] },
      },
      {
        teamId,
        shopId: shop.id,
        title: '面部深层补水护理',
        description: '敏感肌适用，深层清洁 + 补水导入，改善干燥暗沉。',
        category: '美容',
        price: '198.00',
        sku: 'SKIN-003',
        attributes: { 时长: '60 分钟', 适用肤质: '敏感肌' },
      },
    ])
    .returning();

  // 订单演示数据（近 14 天，供数据分析图表）
  const orderTemplates = [
    { productId: insertedProducts[0].id, amount: '68.00', status: 'paid' },
    { productId: insertedProducts[0].id, amount: '68.00', status: 'paid' },
    { productId: insertedProducts[1].id, amount: '288.00', status: 'shipped' },
    { productId: insertedProducts[2].id, amount: '198.00', status: 'paid' },
    { productId: insertedProducts[0].id, amount: '136.00', status: 'paid', quantity: 2 },
    { productId: insertedProducts[1].id, amount: '288.00', status: 'refunded' },
    { productId: insertedProducts[2].id, amount: '198.00', status: 'paid' },
    { productId: insertedProducts[0].id, amount: '68.00', status: 'shipped' },
    { productId: insertedProducts[1].id, amount: '576.00', status: 'paid', quantity: 2 },
    { productId: insertedProducts[2].id, amount: '198.00', status: 'paid' },
    { productId: insertedProducts[0].id, amount: '68.00', status: 'paid' },
    { productId: insertedProducts[1].id, amount: '288.00', status: 'shipped' },
  ];

  const orderRows = orderTemplates.map((t, i) => {
    const orderedAt = new Date();
    orderedAt.setDate(orderedAt.getDate() - (orderTemplates.length - 1 - i));
    orderedAt.setHours(9 + (i % 8), (i * 7) % 60, 0, 0);
    return {
      teamId,
      shopId: shop.id,
      productId: t.productId,
      orderNo: `DEMO-${String(1001 + i)}`,
      amount: t.amount,
      quantity: t.quantity ?? 1,
      status: t.status,
      customerId: `CUST-${String(100 + i)}`,
      orderedAt,
    };
  });

  await db.insert(orders).values(orderRows);

  // 客服知识库示例数据
  await db.insert(knowledgeEntries).values([
    {
      teamId,
      shopId: shop.id,
      question: '营业时间是几点到几点？',
      answer: '门店营业时间为每天 10:00 - 21:00，节假日正常营业，节假日高峰期建议提前预约。',
      category: '营业',
    },
    {
      teamId,
      shopId: shop.id,
      question: '怎么预约到店？',
      answer: '可在小程序「预约」入口选择项目、发型师与到店时间，也可直接联系客服代为预约。预约后凭小程序订单核销即可。',
      category: '预约',
    },
    {
      teamId,
      shopId: shop.id,
      question: '不满意可以退款吗？',
      answer: '服务完成后如对效果不满意，可在 24 小时内联系门店免费返工一次；未到店核销的订单支持随时全额退款。',
      category: '售后',
    },
    {
      teamId,
      shopId: shop.id,
      question: '门店可以停车吗？',
      answer: '门店所在商圈提供地下停车场，消费满 100 元可凭小程序订单到前台领取 2 小时免费停车券。',
      category: '到店',
    },
  ]);
}

seed()
  .catch((error) => {
    console.error('Seed process failed:', error);
    process.exit(1);
  })
  .finally(() => {
    console.log('Seed process finished. Exiting...');
    process.exit(0);
  });
