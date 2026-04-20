import { prisma } from '../../config/database';
import { normalizePaymentMethod, isCashSale } from './qb-shared';

export interface EnqueueSaleParams {
  saleId: string;
  organizationId: string;
  saleDate: Date;
  paymentMethod: string;
  totalAmount: number;
  customerId?: string | null;
  bankId?: string | null;
  lineItems: Array<{
    itemLocalId: string;
    itemName: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
}

/**
 * Shared QB enqueue helper for POS sales. Callable from both the direct
 * REST path (SalesService.createFuelSale / createNonFuelSale) and the
 * offline-first sync path (SyncService.syncSales). Never throws — the
 * sale must not be rolled back if QB enqueue fails.
 */
export async function enqueueQbSaleSync(params: EnqueueSaleParams): Promise<void> {
  try {
    const connection = await prisma.qBConnection.findFirst({
      where: { organizationId: params.organizationId, isActive: true },
      select: { id: true },
    });
    if (!connection) return;

    let normalized: ReturnType<typeof normalizePaymentMethod>;
    try {
      normalized = normalizePaymentMethod(params.paymentMethod);
    } catch (err: any) {
      console.warn(
        `[QB enqueue][sale ${params.saleId}] Skipping enqueue: ${err?.message || err}`
      );
      return;
    }

    const jobType = isCashSale(normalized) ? 'create_sales_receipt' : 'create_invoice';
    const txnDate = new Date(params.saleDate).toISOString().slice(0, 10);

    await prisma.qBSyncQueue.createMany({
      data: [
        {
          connectionId: connection.id,
          organizationId: params.organizationId,
          jobType,
          entityType: 'sale',
          entityId: params.saleId,
          priority: 5,
          status: 'pending',
          approvalStatus: 'approved',
          idempotencyKey: `qb-sale-${params.saleId}`,
          payload: {
            saleId: params.saleId,
            organizationId: params.organizationId,
            customerId: params.customerId || undefined,
            bankId: params.bankId || undefined,
            txnDate,
            paymentMethod: params.paymentMethod,
            lineItems: params.lineItems.map((li) => ({
              fuelTypeId: li.itemLocalId,
              fuelTypeName: li.itemName,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              amount: li.amount,
            })),
            totalAmount: params.totalAmount,
          },
        },
      ],
      skipDuplicates: true,
    });
  } catch (err: any) {
    console.warn(
      `[QB enqueue][sale ${params.saleId}] Enqueue failed: ${err?.message || err}. ` +
      `Sale is persisted; QB sync will need a manual replay.`
    );
  }
}
