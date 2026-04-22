/**
 * Cash Ledger — canonical source/direction types.
 *
 * Every physical cash movement through the drawer is posted as a
 * CashLedgerEntry. The `source` code tells downstream reports what kind of
 * event produced the entry (used to tag totals on the EOD reconciliation
 * dashboard). `direction` is strictly IN or OUT — a positive amount. Anything
 * that doesn't move physical cash MUST NOT post here (card swipes, credit
 * invoicing, bank transfers, etc. stay out of this ledger).
 */

export type CashDirection = 'IN' | 'OUT';

export type CashSource =
  | 'SALE'              // Cash fuel/non-fuel sale (POS or backdated finalize)
  | 'CREDIT_RECEIPT'    // Credit customer cash payment against AR
  | 'ADVANCE_DEPOSIT'   // Customer advance deposit (cash only — card/IBFT do not post here)
  | 'PSO_TOPUP'         // Customer cash → PSO card top-up
  | 'EXPENSE'           // Cash paid out for an expense account
  | 'DRIVER_HANDOUT'    // Cash given to a customer's driver against their advance
  | 'COUNTER_VARIANCE'  // EOD reconciliation variance (over = IN, short = OUT)
  | 'MANUAL_ADJUSTMENT'; // Supervisor manual correction

export interface CashLedgerPostInput {
  organizationId: string;
  branchId: string;
  businessDate: Date; // Truncated to day
  shiftInstanceId?: string | null;
  direction: CashDirection;
  source: CashSource;
  sourceId?: string | null;
  amount: number;
  memo?: string | null;
  createdBy?: string | null;
}

export interface CashLedgerDaySummary {
  businessDate: string; // YYYY-MM-DD
  branchId: string;
  inflows: {
    total: number;
    bySource: Array<{ source: CashSource; total: number; count: number }>;
  };
  outflows: {
    total: number;
    bySource: Array<{ source: CashSource; total: number; count: number }>;
  };
  net: number;
  entries: Array<{
    id: string;
    createdAt: Date;
    direction: CashDirection;
    source: CashSource;
    sourceId: string | null;
    amount: number;
    memo: string | null;
    createdBy: string | null;
  }>;
}
