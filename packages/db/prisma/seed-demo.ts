import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '10000000-0000-4000-8000-000000000002';
const PROJECT_ID = '10000000-0000-4000-8000-000000000003';
const CONTRACTOR_ID = '10000000-0000-4000-8000-000000000004';
const REPORT_ID = '10000000-0000-4000-8000-000000000005';
const DEMO_EMAIL = 'demo.admin@example.test';
const DEMO_PASSWORD = 'DemoPassword123!';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function main() {
  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  await prisma.$transaction(async (tx) => {
    await tx.project.deleteMany({ where: { id: PROJECT_ID } });

    const tenant = await tx.tenant.upsert({
      where: { id: TENANT_ID },
      update: { name: 'Демо-организация' },
      create: { id: TENANT_ID, name: 'Демо-организация' },
    });

    await tx.user.upsert({
      where: { email: DEMO_EMAIL },
      update: {
        tenantId: tenant.id,
        passwordHash,
        role: 'superadmin',
        accessScope: 'global',
        displayName: 'Демо-администратор',
        isActive: true,
        mustChangePassword: false,
      },
      create: {
        id: USER_ID,
        tenantId: tenant.id,
        email: DEMO_EMAIL,
        passwordHash,
        role: 'superadmin',
        accessScope: 'global',
        displayName: 'Демо-администратор',
        isActive: true,
        mustChangePassword: false,
      },
    });

    await tx.project.create({
      data: {
        id: PROJECT_ID,
        tenantId: tenant.id,
        name: 'Демонстрационный логистический комплекс',
        address: 'г. Примерск, Промышленная улица, 1',
        customer: 'ООО «Заказчик-Демо»',
        contractor: 'ООО «Генподрядчик-Демо»',
        techCustomer: 'ООО «Технический заказчик-Демо»',
        generalDesigner: 'ООО «Проектное бюро-Демо»',
        planStart: date('2026-01-12'),
        planFinish: date('2027-06-30'),
        budget: 1_250_000_000n,
        tepArea: 85_000,
        tepPower: '42 МВт',
        tepExtra: [{ key: 'Площадь участка', value: '18,6 га' }],
        expertiseConclusion: 'Демо-заключение от 15.12.2025',
        buildPermit: 'Демо-разрешение от 10.01.2026',
        technicalConditions: [
          { kind: 'Электроснабжение', org: 'АО «Энергосеть-Демо»' },
          { kind: 'Водоснабжение', org: 'МУП «Водоканал-Демо»' },
        ],
        projectStage: 'Строительство',
        rdStages: [
          'ПД',
          'РД (выпуск 1)',
          'РД (выпуск 2)',
          'Рабочая документация завершена',
          'Корректировка',
        ],
        scheduleReportMode: 'manual',
      },
    });

    const contractor = await tx.contractor.create({
      data: {
        id: CONTRACTOR_ID,
        projectId: PROJECT_ID,
        name: 'ООО «Генподрядчик-Демо»',
        contactPerson: 'Алексей Примеров',
        phone: '+7 000 000-00-00',
      },
    });

    const sections = await Promise.all([
      tx.section.create({ data: { id: '20000000-0000-4000-8000-000000000001', projectId: PROJECT_ID, contractorId: contractor.id, code: '1', name: 'Подготовка территории', sortOrder: 1, planStart: date('2026-01-12'), planFinish: date('2026-03-31'), factStart: date('2026-01-12'), factFinish: date('2026-03-28'), percentDone: 100 } }),
      tx.section.create({ data: { id: '20000000-0000-4000-8000-000000000002', projectId: PROJECT_ID, contractorId: contractor.id, code: '2', name: 'Фундаменты и подземная часть', sortOrder: 2, planStart: date('2026-03-01'), planFinish: date('2026-09-30'), factStart: date('2026-03-05'), percentDone: 82 } }),
      tx.section.create({ data: { id: '20000000-0000-4000-8000-000000000003', projectId: PROJECT_ID, contractorId: contractor.id, code: '3', name: 'Каркас и ограждающие конструкции', sortOrder: 3, planStart: date('2026-06-01'), planFinish: date('2027-01-31'), factStart: date('2026-06-10'), percentDone: 48 } }),
      tx.section.create({ data: { id: '20000000-0000-4000-8000-000000000004', projectId: PROJECT_ID, contractorId: contractor.id, code: '4', name: 'Инженерные системы', sortOrder: 4, planStart: date('2026-08-01'), planFinish: date('2027-04-30'), factStart: date('2026-08-12'), percentDone: 25 } }),
    ]);

    const report = await tx.report.create({
      data: {
        id: REPORT_ID,
        projectId: PROJECT_ID,
        weekFriday: date('2026-08-28'),
        status: 'draft',
        version: 1,
      },
    });

    await tx.sectionProgress.createMany({
      data: sections.map((section, index) => ({
        reportId: report.id,
        sectionId: section.id,
        percentDone: [100, 82, 48, 25][index],
        factStart: index === 0 ? date('2026-01-12') : index === 1 ? date('2026-03-05') : index === 2 ? date('2026-06-10') : date('2026-08-12'),
        factFinish: index === 0 ? date('2026-03-28') : null,
        comment: index === 1 ? 'Выполняется армирование фундаментной плиты.' : null,
        isCritical: false,
      })),
    });

    await tx.issue.createMany({
      data: [
        {
          id: '30000000-0000-4000-8000-000000000001',
          reportId: report.id,
          description: 'Требуется согласовать замену отделочного материала.',
          status: 'yellow',
          action: 'Подготовить сравнительную ведомость и направить заказчику.',
          responsible: 'Проектное бюро-Демо',
          dueDate: date('2026-09-04'),
        },
        {
          id: '30000000-0000-4000-8000-000000000002',
          reportId: report.id,
          description: 'Отставание поставки вентиляционного оборудования.',
          status: 'red',
          action: 'Подтвердить ускоренный график поставки.',
          responsible: 'Генподрядчик-Демо',
          dueDate: date('2026-09-02'),
        },
      ],
    });

    await tx.prescription.create({ data: { reportId: report.id, issuedTotal: 18, resolvedTotal: 12 } });
    await tx.budgetWeekly.create({
      data: {
        reportId: report.id,
        spentTotal: 465_000_000n,
        paidGp: 420_000_000n,
        worksAccepted: 465_000_000n,
        rdStage: 'РД (выпуск 2)',
        comment: 'Все значения являются вымышленными демонстрационными данными.',
        optionalFields: [{ name: 'Авансы выданные', amount: 95_000_000 }],
      },
    });
    await tx.rdDevelopment.create({ data: { reportId: report.id, volumesTotal: 64, handedToCustomer: 41, onReview: 8, issuedVpr: 29, inProgress: 15, withRemarks: 6 } });
    await tx.resourcesWeekly.create({ data: { reportId: report.id, itr: 12, workers: 146, machinery: 23, comment: 'Демонстрационные значения.' } });

    await tx.workLog.createMany({
      data: [
        { reportId: report.id, contractorId: contractor.id, sectionId: sections[1].id, description: 'Армирование фундаментной плиты', percentDone: 82 },
        { reportId: report.id, contractorId: contractor.id, sectionId: sections[2].id, description: 'Монтаж металлического каркаса', percentDone: 48 },
        { reportId: report.id, contractorId: contractor.id, sectionId: sections[3].id, description: 'Монтаж магистральных инженерных сетей', percentDone: 25 },
      ],
    });

    await tx.scheduleItem.createMany({
      data: [
        { projectId: PROJECT_ID, code: '1', name: 'Подготовительный период', planStart: date('2026-01-12'), planFinish: date('2026-03-31'), delayDays: 0, percentDone: 100, weekGrowth: 0, sortOrder: 1 },
        { projectId: PROJECT_ID, code: '2', name: 'Основной период строительства', planStart: date('2026-03-01'), planFinish: date('2027-04-30'), delayDays: 4, percentDone: 51, weekGrowth: 3, sortOrder: 2 },
        { projectId: PROJECT_ID, code: '2.1', name: 'Фундаменты и подземная часть', planStart: date('2026-03-01'), planFinish: date('2026-09-30'), delayDays: 2, percentDone: 82, weekGrowth: 4, sortOrder: 3 },
        { projectId: PROJECT_ID, code: '2.2', name: 'Каркас и ограждающие конструкции', planStart: date('2026-06-01'), planFinish: date('2027-01-31'), delayDays: 4, percentDone: 48, weekGrowth: 5, sortOrder: 4 },
        { projectId: PROJECT_ID, code: '2.3', name: 'Инженерные системы', planStart: date('2026-08-01'), planFinish: date('2027-04-30'), delayDays: 1, percentDone: 25, weekGrowth: 6, sortOrder: 5 },
        { projectId: PROJECT_ID, code: '3', name: 'Пусконаладочные работы', planStart: date('2027-03-01'), planFinish: date('2027-06-30'), delayDays: 0, percentDone: 0, weekGrowth: 0, sortOrder: 6 },
      ],
    });
  });

  console.log('Демонстрационные данные созданы.');
  console.log(`Вход: ${DEMO_EMAIL}`);
  console.log(`Пароль: ${DEMO_PASSWORD}`);
  console.log('Эти реквизиты предназначены только для локального демо.');
}

main()
  .catch((error) => {
    console.error('Не удалось создать демонстрационные данные:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
