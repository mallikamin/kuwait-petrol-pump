/**
 * End-to-end Jan 1-3 POS→QB demo for client review.
 *
 * 1. Create 2 QB customers (for local test credit customers)
 * 2. Seed qb_entity_mappings for them
 * 3. Re-finalize Jan 1, 2, 3 via daily.service.finalizeDay → enqueues 14 sale jobs
 * 4. Manually enqueue the S9 PO TEso191 as a create_bill job
 * 5. Poll queue until all complete or max wait reached
 * 6. Print summary (QB doc ids, statuses, errors)
 *
 * Data is KEPT (not voided) — client reviews the actual QB documents.
 */

const https = require('https');

const ORG_ID = 'feab5ef7-74f5-44f3-9f60-5fb1b65a84bf';
const BRANCH_ID = '9bcb8674-9d93-4d93-b0fc-270305dcbe50';
const DAYS = ['2026-01-01', '2026-01-02', '2026-01-03'];
const PO_TESO191_ID = null; // resolved below

const LOCAL_CUSTOMERS = [
  { localId: '72dd244a-6f06-4a28-a35d-37b2cceac69b', displayName: 'TESTNEWCUSTOMER8th April' },
  { localId: 'dc86149e-5fc2-4054-8ff2-ff7b39bb8e37', displayName: 'TestXYZNew' },
];

function qbRequest(method, realm, pathSuffix, accessToken, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'quickbooks.api.intuit.com',
      path: `/v3/company/${realm}/${pathSuffix}`,
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  const { prisma } = require('/app/apps/backend/dist/config/database');
  const { getValidAccessToken } = require('/app/apps/backend/dist/services/quickbooks/token-refresh');
  const { DailyBackdatedEntriesService } = require('/app/apps/backend/dist/modules/backdated-entries/daily.service');

  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true } });
  const { accessToken } = await getValidAccessToken(ORG_ID, prisma);
  const realm = conn.realmId;

  console.log(`\n======= JAN 1-3 POS→QB DEMO =======`);
  console.log(`realm=${realm} org=${ORG_ID}`);

  // --------- STEP 1: Create QB customers for test local customers ---------
  console.log(`\n[1/6] Creating ${LOCAL_CUSTOMERS.length} QB customer(s)...`);
  for (const c of LOCAL_CUSTOMERS) {
    // Skip if mapping already exists
    const existing = await prisma.qBEntityMapping.findFirst({
      where: { organizationId: ORG_ID, entityType: 'customer', localId: c.localId },
    });
    if (existing) {
      console.log(`  [skip] ${c.displayName} already mapped → QB customer ${existing.qbId}`);
      c.qbId = existing.qbId;
      continue;
    }

    const resp = await qbRequest('POST', realm, 'customer?minorversion=65', accessToken, {
      DisplayName: c.displayName,
      CompanyName: c.displayName,
      Notes: `POS Local UUID: ${c.localId} (auto-created for Jan 1-3 SIT demo)`,
    });

    if (resp.status !== 200 || !resp.body?.Customer) {
      console.error(`  [FAIL] ${c.displayName}: ${JSON.stringify(resp.body).slice(0, 300)}`);
      throw new Error(`Failed to create QB customer ${c.displayName}`);
    }

    c.qbId = resp.body.Customer.Id;
    console.log(`  [OK] Created "${c.displayName}" → QB Customer Id=${c.qbId}`);

    // Seed mapping
    await prisma.qBEntityMapping.create({
      data: {
        organizationId: ORG_ID,
        entityType: 'customer',
        localId: c.localId,
        qbId: c.qbId,
        qbName: c.displayName,
        localName: c.displayName,
        isActive: true,
      },
    });
    console.log(`        Seeded qb_entity_mappings row`);
  }

  // --------- STEP 2: Seed payment_method mappings we'll need ---------
  console.log(`\n[2/6] Ensuring payment_method + bank_account mappings are in place...`);
  // pso_card: its own PaymentMethod mapping. bank_card + credit_card both route
  // to Invoice via bank-card-receivable customer, so no PaymentMethodRef needed.
  const needed = [
    { et: 'payment_method', local: 'pso_card', qb: '55', name: 'PSO Card Receivables' },
  ];
  for (const m of needed) {
    // Check by (entity_type, local_id) AND by (entity_type, qb_id) — both are unique
    const byLocal = await prisma.qBEntityMapping.findFirst({
      where: { organizationId: ORG_ID, entityType: m.et, localId: m.local },
    });
    if (byLocal) { console.log(`  [skip] ${m.et}/${m.local} already mapped → ${byLocal.qbId}`); continue; }
    const byQb = await prisma.qBEntityMapping.findFirst({
      where: { organizationId: ORG_ID, entityType: m.et, qbId: m.qb },
    });
    if (byQb) { console.log(`  [skip] ${m.et} qb=${m.qb} already taken by localId=${byQb.localId}`); continue; }
    await prisma.qBEntityMapping.create({
      data: { organizationId: ORG_ID, entityType: m.et, localId: m.local, qbId: m.qb, qbName: m.name, isActive: true },
    });
    console.log(`  [OK] Seeded ${m.et}/${m.local} → ${m.qb}`);
  }

  // --------- STEP 3: Re-finalize Jan 1, 2, 3 to enqueue sale jobs ---------
  console.log(`\n[3/6] Re-finalizing Jan 1, 2, 3 to enqueue QB sync jobs...`);
  const adminUser = await prisma.user.findFirst({ where: { organizationId: ORG_ID, role: { in: ['admin', 'owner'] } } });
  const svc = new DailyBackdatedEntriesService();
  for (const date of DAYS) {
    try {
      const res = await svc.finalizeDay({ branchId: BRANCH_ID, businessDate: date }, ORG_ID, adminUser.id);
      console.log(`  [OK] Finalized ${date} | salesCreated=${res.salesCreated || 0} transactions=${res.totalTransactions || '?'}`);
    } catch (e) {
      console.warn(`  [WARN] finalize ${date}: ${e.message}`);
    }
  }

  // --------- STEP 4: Manually enqueue the S9 PO (TEso191) ---------
  console.log(`\n[4/6] Enqueueing the S9 PO TEso191...`);
  const po = await prisma.purchaseOrder.findFirst({
    where: { poNumber: 'TEso191', organizationId: ORG_ID },
    include: {
      supplier: { select: { id: true, name: true } },
      items: { include: { fuelType: true, product: true } },
    },
  });
  if (!po) {
    console.warn(`  [WARN] PO TEso191 not found`);
  } else {
    const existingJob = await prisma.qBSyncQueue.findFirst({
      where: { entityId: po.id, entityType: 'purchase_order' },
    });
    if (existingJob) {
      console.log(`  [skip] PO ${po.poNumber} already has queue job (status=${existingJob.status})`);
    } else {
      const lineItems = po.items.map((it) => {
        const received = Number(it.quantityReceived);
        const cost = Number(it.costPerUnit);
        return it.itemType === 'fuel' ? {
          itemType: 'fuel',
          fuelTypeId: it.fuelTypeId,
          fuelTypeName: it.fuelType?.name || it.fuelType?.code || 'FUEL',
          quantity: received,
          costPerUnit: cost,
          amount: Number((received * cost).toFixed(2)),
        } : {
          itemType: 'product',
          productId: it.productId,
          productName: it.product?.name || 'PRODUCT',
          quantity: received,
          costPerUnit: cost,
          amount: Number((received * cost).toFixed(2)),
        };
      });
      const totalAmount = Number(lineItems.reduce((s, li) => s + li.amount, 0).toFixed(2));
      const txnDate = new Date(po.receivedDate || po.orderDate).toISOString().slice(0, 10);

      await prisma.qBSyncQueue.create({
        data: {
          connectionId: conn.id,
          organizationId: ORG_ID,
          jobType: 'create_bill',
          entityType: 'purchase_order',
          entityId: po.id,
          priority: 5,
          status: 'pending',
          approvalStatus: 'approved',
          idempotencyKey: `qb-po-${po.id}`,
          payload: {
            purchaseOrderId: po.id,
            organizationId: ORG_ID,
            supplierId: po.supplierId,
            supplierName: po.supplier?.name || 'PSO',
            txnDate,
            lineItems,
            totalAmount,
            poNumber: po.poNumber,
          },
        },
      });
      console.log(`  [OK] Enqueued PO ${po.poNumber} (id=${po.id}) total=${totalAmount}`);
    }
  }

  // --------- STEP 5: Poll queue ---------
  console.log(`\n[5/6] Polling queue until all jobs complete (max 180s)...`);
  const sinceStart = Date.now();
  while (Date.now() - sinceStart < 180000) {
    const counts = await prisma.qBSyncQueue.groupBy({
      by: ['status'],
      where: {
        organizationId: ORG_ID,
        createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
      },
      _count: { _all: true },
    });
    const summary = counts.map(c => `${c.status}=${c._count._all}`).join(' ');
    const pending = counts.find(c => c.status === 'pending' || c.status === 'processing');
    console.log(`  [poll ${Math.round((Date.now() - sinceStart) / 1000)}s] ${summary}`);
    if (!pending) break;
    await new Promise((r) => setTimeout(r, 5000));
  }

  // --------- STEP 6: Summary ---------
  console.log(`\n[6/6] === FINAL SUMMARY ===\n`);
  const jobs = await prisma.qBSyncQueue.findMany({
    where: {
      organizationId: ORG_ID,
      createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Total jobs in last 30 min: ${jobs.length}\n`);

  for (const j of jobs) {
    const line = `[${j.status.padEnd(10)}] ${j.entityType}/${j.jobType} | entityId=${j.entityId} | qbEntity=${j.result?.qbId || j.result?.qbEntity || 'n/a'} | err=${j.errorMessage?.slice(0, 100) || ''}`;
    console.log(line);
  }

  // Resolve sale→QB doc links from updated sales table
  const syncedSales = await prisma.sale.findMany({
    where: {
      branchId: BRANCH_ID,
      saleDate: { gte: new Date('2026-01-01'), lt: new Date('2026-01-04') },
    },
    select: { id: true, saleDate: true, paymentMethod: true, totalAmount: true, qbInvoiceId: true, qbSynced: true, qbSyncedAt: true },
    orderBy: { saleDate: 'asc' },
  });
  console.log(`\n=== Sales qb_synced status ===`);
  for (const s of syncedSales) {
    console.log(`sale=${s.id.slice(0, 8)} ${s.paymentMethod.padEnd(18)} amt=${s.totalAmount.toString().padStart(10)} | qbSynced=${s.qbSynced} qbInvoiceId=${s.qbInvoiceId || 'n/a'}`);
  }

  const updatedPo = po ? await prisma.purchaseOrder.findUnique({ where: { id: po.id } }) : null;
  if (updatedPo) {
    console.log(`\n=== PO TEso191 ===`);
    console.log(`po=${updatedPo.id} total=${updatedPo.totalAmount} qbBillId=${updatedPo.qbBillId} qbSynced=${updatedPo.qbSynced}`);
  }

  await prisma.$disconnect();
  console.log(`\n=== DONE ===`);
})().catch((e) => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
