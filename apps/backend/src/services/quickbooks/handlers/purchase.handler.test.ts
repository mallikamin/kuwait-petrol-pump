/**
 * Tests for QuickBooks Purchase (Bill) handler — S9, S10.
 *
 * Critical invariant: Bill lines must use ItemBasedExpenseLineDetail with
 * ItemRef pointing at the mapped Inventory item. AccountBasedExpenseLineDetail
 * is the pre-fix shape and is NOT allowed here — it bypasses QB's perpetual
 * inventory cycle (Dr Inventory Asset / Cr A/P) and leaves stock counts stale.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { handlePurchaseCreate, PurchasePayload } from './purchase.handler';
import { QBSyncQueue } from '@prisma/client';
import * as encryption from '../encryption';
import * as safetyGates from '../safety-gates';
import * as auditLogger from '../audit-logger';
import * as companyLock from '../company-lock';
import * as entityMapping from '../entity-mapping.service';

jest.mock('../../../config/database', () => ({
  prisma: {
    qBConnection: { findFirst: jest.fn() },
    purchaseOrder: { update: jest.fn() },
  },
}));
jest.mock('../encryption');
jest.mock('../safety-gates');
jest.mock('../audit-logger');
jest.mock('../company-lock');
jest.mock('../entity-mapping.service');

global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
import { prisma } from '../../../config/database';

const mockConnection = {
  id: 'conn-1', organizationId: 'org-1', realmId: 'realm-1',
  accessTokenEncrypted: 'x', refreshTokenEncrypted: 'y',
  accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000), isActive: true,
};

const mockJob: QBSyncQueue = {
  id: 'job-1', connectionId: 'conn-1', organizationId: 'org-1',
  jobType: 'create_bill', entityType: 'purchase_order', entityId: 'po-1',
  priority: 5, status: 'pending', payload: null as any, result: null,
  errorMessage: null, errorCode: null, errorDetail: null, httpStatusCode: null,
  retryCount: 0, maxRetries: 3, nextRetryAt: null,
  startedAt: null, completedAt: null, durationMs: null,
  idempotencyKey: null, batchId: null, checkpointId: null,
  approvalStatus: 'approved', approvedBy: null, approvedAt: null,
  replayableFromBatch: null, createdAt: new Date(), updatedAt: new Date(),
} as QBSyncQueue;

function basePayload(overrides: Partial<PurchasePayload> = {}): PurchasePayload {
  return {
    purchaseOrderId: 'po-1',
    organizationId: 'org-1',
    supplierId: 'supplier-pso',
    supplierName: 'PSO',
    txnDate: '2026-04-19',
    lineItems: [
      {
        itemType: 'fuel',
        fuelTypeId: 'fuel-HSD',
        fuelTypeName: 'HSD',
        quantity: 10000,
        costPerUnit: 260,
        amount: 2_600_000,
      },
    ],
    totalAmount: 2_600_000,
    poNumber: 'PO-001',
    ...overrides,
  };
}

describe('Purchase handler (S9, S10) — ItemBasedExpenseLineDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (safetyGates.checkKillSwitch as jest.MockedFunction<typeof safetyGates.checkKillSwitch>).mockResolvedValue(undefined);
    (safetyGates.checkSyncMode as jest.MockedFunction<typeof safetyGates.checkSyncMode>).mockResolvedValue(undefined as any);
    (companyLock.CompanyLock.validateRealmId as jest.MockedFunction<typeof companyLock.CompanyLock.validateRealmId>).mockResolvedValue(undefined);
    (companyLock.CompanyLock.lockConnectionToOrganization as jest.MockedFunction<typeof companyLock.CompanyLock.lockConnectionToOrganization>).mockResolvedValue(undefined);
    (auditLogger.AuditLogger.log as jest.MockedFunction<typeof auditLogger.AuditLogger.log>).mockResolvedValue(undefined);
    (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>).mockReturnValue('access');
    (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);
    (prisma.purchaseOrder.update as jest.MockedFunction<any>).mockResolvedValue({} as any);
  });

  it('S9: HSD tanker bill line is ItemBasedExpenseLineDetail referencing mapped item', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
      async (_o: string, type: string, id: string) => {
        if (type === 'vendor' && id === 'supplier-pso') return 'QB-VND-PSO';
        if (type === 'item' && id === 'fuel-HSD') return 'QB-ITEM-HSD';
        return null;
      },
    );
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ Bill: { Id: 'QB-BILL-1', DocNumber: 'B-1' } }),
    } as Response);

    const result = await handlePurchaseCreate(mockJob, basePayload());
    expect(result.success).toBe(true);

    const body = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
    expect(body.VendorRef.value).toBe('QB-VND-PSO');
    expect(body.Line).toHaveLength(1);
    // Critical: Item-based, not Account-based.
    expect(body.Line[0].DetailType).toBe('ItemBasedExpenseLineDetail');
    expect(body.Line[0].ItemBasedExpenseLineDetail.ItemRef.value).toBe('QB-ITEM-HSD');
    expect(body.Line[0].ItemBasedExpenseLineDetail.Qty).toBe(10000);
    expect(body.Line[0].ItemBasedExpenseLineDetail.UnitPrice).toBe(260);
    expect(body.Line[0].AccountBasedExpenseLineDetail).toBeUndefined();
  });

  it('S10: non-fuel (product) bill line references mapped product item', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
      async (_o: string, type: string, id: string) => {
        if (type === 'vendor' && id === 'supplier-pso') return 'QB-VND-PSO';
        if (type === 'item' && id === 'prod-oil-4L') return 'QB-ITEM-OIL';
        return null;
      },
    );
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ Bill: { Id: 'QB-BILL-2' } }),
    } as Response);

    await handlePurchaseCreate(mockJob, basePayload({
      lineItems: [{
        itemType: 'product',
        productId: 'prod-oil-4L',
        productName: 'DEO 8000 4L',
        quantity: 20,
        costPerUnit: 3500,
        amount: 70_000,
      }],
      totalAmount: 70_000,
    }));

    const body = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
    expect(body.Line[0].DetailType).toBe('ItemBasedExpenseLineDetail');
    expect(body.Line[0].ItemBasedExpenseLineDetail.ItemRef.value).toBe('QB-ITEM-OIL');
  });

  it('fails fast when fuel item mapping is missing', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
      async (_o: string, type: string) => (type === 'vendor' ? 'QB-VND' : null),
    );
    await expect(handlePurchaseCreate(mockJob, basePayload())).rejects.toThrow(
      /Item mapping not found for purchase line: localId=fuel-HSD/,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails fast when vendor mapping is missing', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(async () => null);
    await expect(handlePurchaseCreate(mockJob, basePayload())).rejects.toThrow(/Vendor mapping not found/);
  });

  it('updates PurchaseOrder.qbBillId on success (for downstream BillPayment linking)', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
      async (_o: string, type: string) => (type === 'vendor' ? 'QB-VND' : 'QB-ITEM'),
    );
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ Bill: { Id: 'QB-BILL-88' } }),
    } as Response);

    await handlePurchaseCreate(mockJob, basePayload());
    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po-1' },
      data: { qbBillId: 'QB-BILL-88', qbSynced: true },
    });
  });
});
