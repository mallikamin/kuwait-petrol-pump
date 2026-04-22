/**
 * QuickBooks Job Dispatcher
 *
 * Routes queue jobs to handlers based on (entityType, jobType). Covers:
 *   sale                 create_sales_receipt   → fuel-sale handler (cash S1..S3)
 *   sale                 create_invoice         → fuel-sale handler (AR S4..S7)
 *   customer_payment     create_receive_payment → receive-payment handler (S8)
 *   purchase_order       create_bill            → purchase handler (S9, S10)
 *   inventory_adjustment create_journal_entry   → journal-entry handler (S11)
 *   supplier_payment     create_bill_payment    → bill-payment handler
 *   supplier             create_vendor          → vendor handler
 *
 * The fuel-sale handler decides SalesReceipt vs Invoice internally from the
 * payment method — both dispatch routes call into it so the dispatcher stays
 * a thin router.
 */

import { QBSyncQueue } from '@prisma/client';
import { handleFuelSaleCreate, FuelSalePayload } from './handlers/fuel-sale.handler';
import { handleVendorCreate, VendorPayload } from './handlers/vendor.handler';
import { handlePurchaseCreate, PurchasePayload } from './handlers/purchase.handler';
import { handleBillPaymentCreate, BillPaymentPayload } from './handlers/bill-payment.handler';
import { handleReceivePaymentCreate, ReceivePaymentPayload } from './handlers/receive-payment.handler';
import { handleJournalEntryCreate, JournalEntryPayload } from './handlers/journal-entry.handler';
import { handleCashExpenseCreate, CashExpensePayload } from './handlers/cash-expense.handler';
import { handlePsoTopupJournal, PsoTopupPayload } from './handlers/pso-topup.handler';

export interface JobResult {
  success: boolean;
  qbId?: string;
  qbDocNumber?: string;
  qbEntity?: string;
  error?: string;
}

export async function dispatch(job: QBSyncQueue): Promise<JobResult> {
  // Sales — SalesReceipt (cash) and Invoice (AR) both hit fuel-sale handler;
  // the handler branches on payload.paymentMethod after alias normalization.
  if (job.entityType === 'sale' && job.jobType === 'create_sales_receipt') {
    const payload = parsePayload<FuelSalePayload>(job.payload);
    return await handleFuelSaleCreate(job, payload);
  }
  if (job.entityType === 'sale' && job.jobType === 'create_invoice') {
    const payload = parsePayload<FuelSalePayload>(job.payload);
    return await handleFuelSaleCreate(job, payload);
  }

  // AR customer receipts (S8)
  if (job.entityType === 'customer_payment' && job.jobType === 'create_receive_payment') {
    const payload = parsePayload<ReceivePaymentPayload>(job.payload);
    return await handleReceivePaymentCreate(job, payload);
  }

  // Dip-variance gain/loss journal entries (S11)
  if (job.entityType === 'inventory_adjustment' && job.jobType === 'create_journal_entry') {
    const payload = parsePayload<JournalEntryPayload>(job.payload);
    return await handleJournalEntryCreate(job, payload);
  }

  // Cash expenses (petty cash paid from the drawer against an expense
  // account). Posts QB Purchase with AccountBasedExpenseLineDetail.
  if (job.entityType === 'expense' && job.jobType === 'create_cash_expense') {
    const payload = parsePayload<CashExpensePayload>(job.payload);
    return await handleCashExpenseCreate(job, payload);
  }

  // Cash-to-PSO-Card top-up: DR Cash / CR A/P (Entity = PSO vendor).
  if (job.entityType === 'pso_topup' && job.jobType === 'create_pso_topup_journal') {
    const payload = parsePayload<PsoTopupPayload>(job.payload);
    return await handlePsoTopupJournal(job, payload);
  }

  // Vendors / Purchases / Bill payments
  if (job.entityType === 'supplier' && job.jobType === 'create_vendor') {
    const payload = parsePayload<VendorPayload>(job.payload);
    return await handleVendorCreate(job, payload);
  }
  if (job.entityType === 'purchase_order' && job.jobType === 'create_bill') {
    const payload = parsePayload<PurchasePayload>(job.payload);
    return await handlePurchaseCreate(job, payload);
  }
  if (job.entityType === 'supplier_payment' && job.jobType === 'create_bill_payment') {
    const payload = parsePayload<BillPaymentPayload>(job.payload);
    return await handleBillPaymentCreate(job, payload);
  }

  throw new Error(
    `Unsupported dispatch path: entityType=${job.entityType}, jobType=${job.jobType}`
  );
}

function parsePayload<T>(payload: any): T {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as T;
    } catch (parseError) {
      throw new Error(
        `Invalid JSON payload: ${parseError instanceof Error ? parseError.message : 'Malformed JSON string'}`
      );
    }
  } else if (typeof payload === 'object' && payload !== null) {
    return payload as unknown as T;
  } else {
    throw new Error('Invalid payload: must be JSON string or object');
  }
}
