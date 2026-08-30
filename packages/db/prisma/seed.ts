import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Справочник стадий РД по умолчанию (ТЗ, Секция Е):
// ПД → РД (выпуск 1) → РД (выпуск 2) → Рабочая документация завершена → Корректировка
export const DEFAULT_RD_STAGES = [
  'ПД',
  'РД (выпуск 1)',
  'РД (выпуск 2)',
  'Рабочая документация завершена',
  'Корректировка',
] as const;

async function main() {
  // Tenant по умолчанию (одна компания — ТЗ Раздел 2)
  const tenant = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'РОСТ',
    },
  });

  // ─── Суперадмин (bootstrap, ТЗ 4.6) ───────────────────────
  const superadminEmail = process.env.SUPERADMIN_EMAIL;
  if (!superadminEmail) {
    throw new Error('SUPERADMIN_EMAIL не задан в .env');
  }

  const superadmin = await prisma.user.upsert({
    where: { email: superadminEmail },
    update: {}, // не трогаем существующего
    create: {
      tenantId: tenant.id,
      email: superadminEmail,
      passwordHash: '',              // пусто → активируется через bootstrap
      role: 'superadmin',
      accessScope: 'global',
      displayName: 'Суперадмин',
      mustChangePassword: true,      // ТЗ 4.6: первый вход = смена пароля
    },
  });

  console.log(`✅ Seed: суперадмин "${superadmin.email}" (${superadmin.id})`);
  console.log(`ℹ️  Пароль пустой — активируйте через POST /bootstrap/:token`);
  console.log(`ℹ️  BOOTSTRAP_TOKEN берётся из .env`);

  console.log(`✅ Seed: tenant "${tenant.name}" (${tenant.id})`);
  console.log(`ℹ️  Стадии РД по умолчанию подставляются при создании проекта:`);
  console.log(`   ${DEFAULT_RD_STAGES.join(' → ')}`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());