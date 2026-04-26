import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Loader2,
  Plus,
  Trash2,
  Eye,
  Save,
  Download,
  FileText,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { creditApi } from '@/api/credit';
import { customersApi, branchesApi } from '@/api';
import { banksApi } from '@/api/banks';
import { useAuthStore } from '@/store/auth';
import { useEffectiveBranchId, useOnOrgSwitch } from '@/hooks/useEffectiveBranch';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { CashHandoutPanel } from '@/components/CashHandoutPanel';

// ── Utility Functions ─────────────────────────────────────────────────────────

const fmtPKR = (n: number) => n.toLocaleString('en-PK', { maximumFractionDigits: 0 });

/**
 * Check if user is a superuser (admin or accountant)
 * Superusers can select any branch; others are locked to their assigned branch
 */
const isSuperuser = (role?: string): boolean => {
  if (!role) return false;
  return ['admin', 'accountant'].includes(role.toLowerCase());
};

/**
 * Export ledger data to CSV
 */
const formatReportPeriod = (
  ledgerData: any,
  startDate?: string,
  endDate?: string
): string => {
  const fmt = (d: string | Date) => format(new Date(d), 'MMM dd, yyyy');
  if (startDate && endDate) return `${fmt(startDate)} to ${fmt(endDate)}`;
  const entries = ledgerData?.entries || [];
  if (entries.length > 0) {
    const dates = entries.map((e: any) => new Date(e.date).getTime());
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    const base = `${fmt(min)} to ${fmt(max)}`;
    return startDate ? `${fmt(startDate)} to ${fmt(max)}` : endDate ? `${fmt(min)} to ${fmt(endDate)}` : `${base} (all transactions)`;
  }
  if (startDate) return `From ${fmt(startDate)}`;
  if (endDate) return `Up to ${fmt(endDate)}`;
  return 'All transactions';
};

const exportLedgerToCSV = (ledgerData: any, customerName: string, startDate?: string, endDate?: string) => {
  if (!ledgerData) return;

  const rows: string[] = [];
  const reportPeriod = formatReportPeriod(ledgerData, startDate, endDate);

  // Header
  rows.push(`Customer Ledger Export`);
  rows.push(`Customer: ${customerName}`);
  rows.push(`Report Period: ${reportPeriod}`);
  rows.push(`Exported: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`);
  rows.push('');

  // Summary
  rows.push('SUMMARY');
  rows.push(`Opening Balance,${ledgerData.summary.openingBalance}`);
  rows.push(`Total Debit (Invoices),${ledgerData.summary.totalDebit}`);
  rows.push(`Total Credit (Receipts),${ledgerData.summary.totalCredit}`);
  rows.push(`Closing Balance,${ledgerData.summary.closingBalance}`);
  rows.push('');

  // Product-wise breakdown for reporting period
  const productBreakdown = ledgerData.productBreakdown || [];
  if (productBreakdown.length > 0) {
    rows.push('PRODUCT-WISE BREAKDOWN');
    rows.push('Product,Total Quantity,Unit,Total Sales');
    productBreakdown.forEach((p: any) => {
      rows.push(`${p.productType},${Number(p.totalQuantity).toFixed(p.unit === 'L' ? 3 : 0)},${p.unit === 'L' ? 'Liters' : 'Units'},${Number(p.totalAmount).toFixed(2)}`);
    });
    rows.push('');
  }

  // Ledger entries
  rows.push('LEDGER ENTRIES');
  rows.push('Date,Type,Description,Receipt,"Vehicle #","Slip #","Payment Method",Product,Debit,Credit,Balance');

  ledgerData.entries.forEach((entry: any) => {
    rows.push(
      `${format(new Date(entry.date), 'yyyy-MM-dd')},${entry.type},"${entry.description}","${entry.receiptNumber || ''}","${entry.vehicleNumber || ''}","${entry.slipNumber || ''}","${entry.paymentMethod || ''}","${entry.productType || ''}",${entry.debit},${entry.credit},${entry.balance}`
    );
  });

  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `ledger-${customerName}-${format(new Date(), 'yyyy-MM-dd')}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Export ledger data to PDF (print-friendly HTML → browser print dialog)
 */
const exportLedgerToPDF = (ledgerData: any, customerName: string, startDate?: string, endDate?: string) => {
  if (!ledgerData) return;

  const reportPeriod = formatReportPeriod(ledgerData, startDate, endDate);

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Ledger-${customerName}-${format(new Date(), 'yyyy-MM-dd')}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.4; }
        h1 { margin-bottom: 5px; font-size: 16px; }
        .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
        .summary { margin-bottom: 20px; }
        .summary-item { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #eee; }
        .summary-label { font-weight: bold; }
        .summary-value { text-align: right; font-family: monospace; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
        th { background: #f0f0f0; border: 1px solid #ddd; padding: 8px; text-align: left; font-weight: bold; }
        td { border: 1px solid #ddd; padding: 6px 8px; }
        td.number { text-align: right; font-family: monospace; }
        @media print {
          body { margin: 0; }
          .no-print { display: none; }
          table { page-break-inside: avoid; }
        }
      </style>
    </head>
    <body>
      <h1>Customer Ledger Report</h1>
      <div class="meta">
        <strong>Customer:</strong> ${customerName}<br>
        <strong>Date:</strong> ${format(new Date(), 'MMM dd, yyyy HH:mm:ss')}<br>
        <strong>Report Period:</strong> ${reportPeriod}
      </div>

      <div class="summary">
        <div class="summary-item">
          <span class="summary-label">Opening Balance:</span>
          <span class="summary-value">${ledgerData.summary.openingBalance.toLocaleString('en-PK', { maximumFractionDigits: 2 })}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Total Debit (Invoices):</span>
          <span class="summary-value">${ledgerData.summary.totalDebit.toLocaleString('en-PK', { maximumFractionDigits: 2 })}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Total Credit (Receipts):</span>
          <span class="summary-value">${ledgerData.summary.totalCredit.toLocaleString('en-PK', { maximumFractionDigits: 2 })}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label" style="font-size: 13px; color: #000;">Closing Balance:</span>
          <span class="summary-value" style="font-size: 13px; font-weight: bold;">${ledgerData.summary.closingBalance.toLocaleString('en-PK', { maximumFractionDigits: 2 })}</span>
        </div>
      </div>

      ${(ledgerData.productBreakdown || []).length > 0 ? `
        <h3>Product-wise Breakdown</h3>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th style="text-align: right;">Total Quantity</th>
              <th style="text-align: right;">Total Sales (PKR)</th>
            </tr>
          </thead>
          <tbody>
            ${ledgerData.productBreakdown
              .map((p: any) => `
                <tr>
                  <td><strong>${p.productType}</strong></td>
                  <td class="number">${Number(p.totalQuantity).toLocaleString('en-PK', { minimumFractionDigits: p.unit === 'L' ? 3 : 0, maximumFractionDigits: p.unit === 'L' ? 3 : 0 })} ${p.unit === 'L' ? 'Liters' : 'Units'}</td>
                  <td class="number">${Number(p.totalAmount).toLocaleString('en-PK', { maximumFractionDigits: 2 })}</td>
                </tr>
              `)
              .join('')}
            <tr>
              <td><strong>TOTAL</strong></td>
              <td class="number">—</td>
              <td class="number"><strong>${ledgerData.productBreakdown
                .reduce((s: number, p: any) => s + Number(p.totalAmount || 0), 0)
                .toLocaleString('en-PK', { maximumFractionDigits: 2 })}</strong></td>
            </tr>
          </tbody>
        </table>
      ` : ''}

      <h3>Ledger Entries</h3>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Description</th>
            <th>Receipt</th>
            <th>Vehicle #</th>
            <th>Slip #</th>
            <th>Payment Method</th>
            <th>Product</th>
            <th style="text-align: right;">Debit</th>
            <th style="text-align: right;">Credit</th>
            <th style="text-align: right;">Balance</th>
          </tr>
        </thead>
        <tbody>
          ${ledgerData.entries
            .map(
              (entry: any) => `
            <tr>
              <td>${format(new Date(entry.date), 'MMM dd, yy')}</td>
              <td><strong>${entry.type}</strong></td>
              <td>${entry.description}</td>
              <td style="font-family: monospace; font-size: 10px;">${entry.receiptNumber || '—'}</td>
              <td>${entry.vehicleNumber || '—'}</td>
              <td>${entry.slipNumber || '—'}</td>
              <td>${entry.paymentMethod || '—'}</td>
              <td>${entry.productType || '—'}</td>
              <td class="number">${entry.debit > 0 ? entry.debit.toLocaleString('en-PK', { maximumFractionDigits: 2 }) : '—'}</td>
              <td class="number">${entry.credit > 0 ? entry.credit.toLocaleString('en-PK', { maximumFractionDigits: 2 }) : '—'}</td>
              <td class="number"><strong>${entry.balance.toLocaleString('en-PK', { maximumFractionDigits: 2 })}</strong></td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>

      <div style="margin-top: 30px; color: #999; font-size: 11px; text-align: center;">
        <p>This is a system-generated report. No signature required.</p>
      </div>
    </body>
    </html>
  `;

  const printWindow = window.open('', '', 'width=1000,height=600');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 250);
  }
};

// ── Component ─────────────────────────────────────────────────────────────────

export function Credit() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  // ── Tabs & Context State ────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'receipts' | 'ledger' | 'cash-handout'>('receipts');
  const [selectedCustomerId] = useState('');
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [showOpenItemsModal, setShowOpenItemsModal] = useState(false);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [receiptFilters, setReceiptFilters] = useState({
    customerId: '',
    startDate: '',
    endDate: '',
    limit: 50,
    offset: 0,
  });

  const [ledgerFilters, setLedgerFilters] = useState({
    customerId: '',
    startDate: '',
    endDate: '',
    limit: 100,
    offset: 0,
  });

  // ── Receipt Form State ──────────────────────────────────────────────────────
  const [receiptForm, setReceiptForm] = useState<{
    customerId: string;
    branchId: string;
    receiptDatetime: string;
    amount: string;
    paymentMethod: 'cash' | 'cheque' | 'bank_transfer' | 'online' | 'pso_card';
    bankId: string;
    referenceNumber: string;
    notes: string;
    allocationMode: 'FIFO' | 'MANUAL';
  }>({
    customerId: '',
    branchId: '',
    receiptDatetime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    amount: '',
    paymentMethod: 'cash',
    bankId: '',
    referenceNumber: '',
    notes: '',
    allocationMode: 'FIFO',
  });

  const [allocations, setAllocations] = useState<Array<{ sourceId: string; sourceType: 'BACKDATED_TRANSACTION' | 'SALE'; amount: string }>>([]);

  // ── Queries ──────────────────────────────────────────────────────────────────

  // Bank list for the receipt form's "Deposit Bank" selector. Shown only
  // when paymentMethod != 'cash' — per spec Scenario 8 Option B
  // (bank transfer / IBFT / cheque / online / card → specific bank).
  const { data: banks = [] } = useQuery({
    queryKey: ['banks-list'],
    queryFn: async () => {
      const res = await banksApi.getAll();
      // Backend already filters inactive banks (banks.service.ts isActive:true).
      // The previous .filter((b) => b.active) was dropping every bank because
      // the API response shape exposes neither `active` nor `is_active`.
      return res.banks || [];
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const result = await customersApi.getAll({ size: 500 });
      return result.items;
    },
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const result = await branchesApi.getAll({ size: 500 });
      return result.items;
    },
  });

  // Auto-prefill branchId from the active org/branch context (top-bar
  // switcher) or, for single-org users, the JWT branch.
  const effectiveBranchId = useEffectiveBranchId();
  useEffect(() => {
    if (effectiveBranchId && !receiptForm.branchId) {
      setReceiptForm((prev) => ({ ...prev, branchId: effectiveBranchId }));
    }
  }, [effectiveBranchId, receiptForm.branchId]);
  // Clear the form branch when org switches so the prefill effect picks the
  // new org's branch.
  useOnOrgSwitch(() => setReceiptForm((prev) => ({ ...prev, branchId: '' })));

  const { data: receiptsData, isLoading: receiptsLoading, refetch: refetchReceipts } = useQuery({
    queryKey: ['credit-receipts', receiptFilters],
    queryFn: () =>
      creditApi.getReceipts({
        customerId: receiptFilters.customerId || undefined,
        // Convert date-only strings to UTC datetime (start of day UTC)
        startDate: receiptFilters.startDate ? new Date(receiptFilters.startDate + 'T00:00:00Z').toISOString() : undefined,
        // Convert date-only strings to UTC datetime (end of day UTC)
        endDate: receiptFilters.endDate ? new Date(receiptFilters.endDate + 'T23:59:59.999Z').toISOString() : undefined,
        limit: receiptFilters.limit,
        offset: receiptFilters.offset,
      }),
    enabled: activeTab === 'receipts',
  });

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery({
    queryKey: ['credit-ledger', ledgerFilters],
    queryFn: () =>
      creditApi.getCustomerLedger(ledgerFilters.customerId, {
        // Convert date-only strings to UTC datetime (start of day UTC)
        startDate: ledgerFilters.startDate ? new Date(ledgerFilters.startDate + 'T00:00:00Z').toISOString() : undefined,
        // Convert date-only strings to UTC datetime (end of day UTC)
        endDate: ledgerFilters.endDate ? new Date(ledgerFilters.endDate + 'T23:59:59.999Z').toISOString() : undefined,
        limit: ledgerFilters.limit,
        offset: ledgerFilters.offset,
      }),
    enabled: activeTab === 'ledger' && !!ledgerFilters.customerId,
  });

  const { data: creditCheckResult } = useQuery({
    queryKey: ['credit-check', selectedCustomerId],
    queryFn: () => creditApi.getCustomerBalance(selectedCustomerId),
    enabled: activeTab === 'ledger' && !!selectedCustomerId,
  });

  const { data: openInvoices = [] } = useQuery({
    queryKey: ['credit-open-invoices', receiptForm.customerId],
    queryFn: () => creditApi.getOpenInvoices(receiptForm.customerId),
    enabled: !!receiptForm.customerId && receiptForm.allocationMode === 'MANUAL',
  });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createReceiptMutation = useMutation({
    mutationFn: () => {
      const totalAmount = parseFloat(receiptForm.amount);
      if (isNaN(totalAmount) || totalAmount <= 0) {
        throw new Error('Amount must be a positive number');
      }

      // Spec Scenario 8 Option B: non-cash / non-PSO receipts must deposit
      // to a specific bank so QB can post Dr <bank> / Cr A/R.
      const needsBank =
        receiptForm.paymentMethod !== 'cash' && receiptForm.paymentMethod !== 'pso_card';
      if (needsBank && !receiptForm.bankId) {
        throw new Error('Deposit bank is required for Bank Transfer / Cheque / Online receipts');
      }

      const allocationMode = receiptForm.allocationMode as 'FIFO' | 'MANUAL';
      const requestData: Parameters<typeof creditApi.createReceipt>[0] = {
        customerId: receiptForm.customerId,
        branchId: receiptForm.branchId,
        receiptDatetime: new Date(receiptForm.receiptDatetime).toISOString(),
        amount: totalAmount,
        paymentMethod: receiptForm.paymentMethod,
        bankId: receiptForm.bankId || undefined,
        referenceNumber: receiptForm.referenceNumber || undefined,
        notes: receiptForm.notes || undefined,
        allocationMode,
      };

      // Add allocations if in MANUAL mode
      if (allocationMode === ('MANUAL' as const) && allocations.length > 0) {
        requestData.allocations = allocations.map((a) => ({
          sourceType: a.sourceType,
          sourceId: a.sourceId,
          amount: parseFloat(a.amount),
        }));
      }

      return creditApi.createReceipt(requestData);
    },
    onSuccess: () => {
      toast.success('Receipt created successfully');
      setShowReceiptDialog(false);
      resetReceiptForm();
      queryClient.invalidateQueries({ queryKey: ['credit-receipts'] });
      refetchReceipts();
    },
    onError: (error) => {
      toast.error(`Failed to create receipt: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const deleteReceiptMutation = useMutation({
    mutationFn: (receiptId: string) => creditApi.deleteReceipt(receiptId),
    onSuccess: () => {
      toast.success('Receipt deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['credit-receipts'] });
      refetchReceipts();
    },
    onError: (error) => {
      toast.error(`Failed to delete receipt: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const resetReceiptForm = () => {
    setReceiptForm({
      customerId: '',
      branchId: '',
      receiptDatetime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      amount: '',
      paymentMethod: 'cash',
      bankId: '',
      referenceNumber: '',
      notes: '',
      allocationMode: 'FIFO',
    });
    setAllocations([]);
  };

  const handleAddAllocation = () => {
    setAllocations([...allocations, { sourceId: '', sourceType: 'SALE', amount: '' }]);
  };

  const handleRemoveAllocation = (index: number) => {
    setAllocations(allocations.filter((_, i) => i !== index));
  };

  const handleAllocationChange = (index: number, field: string, value: unknown) => {
    const newAllocations = [...allocations];
    newAllocations[index] = { ...newAllocations[index], [field]: value };
    setAllocations(newAllocations);
  };

  const handleAddAllocationFromItem = (item: any) => {
    setAllocations([
      ...allocations,
      {
        sourceId: item.id,
        sourceType: item.sourceType,
        amount: item.openAmount.toString(),
      },
    ]);
    setShowOpenItemsModal(false);
  };

  const handleCreateReceipt = async () => {
    if (!receiptForm.customerId || !receiptForm.branchId || !receiptForm.amount) {
      toast.error('Please fill in all required fields');
      return;
    }

    const isManualMode = receiptForm.allocationMode === ('MANUAL' as const);
    if (isManualMode && allocations.length === 0) {
      toast.error('Please add at least one allocation for MANUAL mode');
      return;
    }

    if (isManualMode) {
      const totalAllocated = allocations.reduce((sum, a) => sum + parseFloat(a.amount || '0'), 0);
      const receiptAmount = parseFloat(receiptForm.amount);
      if (Math.abs(totalAllocated - receiptAmount) > 0.01) {
        toast.error(`Allocations total (${totalAllocated}) must equal receipt amount (${receiptAmount})`);
        return;
      }
    }

    await createReceiptMutation.mutateAsync();
  };

  // ── Derived State ────────────────────────────────────────────────────────────

  const hasWriteAccess = user?.role === 'admin' || user?.role === 'accountant';

  // ── Render: Receipts Tab ────────────────────────────────────────────────────

  const renderReceiptsTab = () => (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Input
          placeholder="Filter by customer"
          type="text"
          value={receiptFilters.customerId}
          onChange={(e) => {
            setReceiptFilters({ ...receiptFilters, customerId: e.target.value, offset: 0 });
          }}
          className="w-64"
        />
        <Input
          placeholder="Start date (YYYY-MM-DD)"
          type="date"
          value={receiptFilters.startDate}
          onChange={(e) => {
            setReceiptFilters({ ...receiptFilters, startDate: e.target.value, offset: 0 });
          }}
          className="w-48"
        />
        <Input
          placeholder="End date (YYYY-MM-DD)"
          type="date"
          value={receiptFilters.endDate}
          onChange={(e) => {
            setReceiptFilters({ ...receiptFilters, endDate: e.target.value, offset: 0 });
          }}
          className="w-48"
        />
        {hasWriteAccess && (
          <Button onClick={() => setShowReceiptDialog(true)} className="ml-auto">
            <Plus className="h-4 w-4 mr-2" /> New Receipt
          </Button>
        )}
      </div>

      {receiptsLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !receiptsData?.receipts || receiptsData.receipts.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">No receipts found</div>
      ) : (
        <>
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Receipt #</th>
                  <th className="px-4 py-2 text-left font-semibold">Customer</th>
                  <th className="px-4 py-2 text-left font-semibold">Date</th>
                  <th className="px-4 py-2 text-right font-semibold">Amount</th>
                  <th className="px-4 py-2 text-left font-semibold">Payment</th>
                  <th className="px-4 py-2 text-left font-semibold">Mode</th>
                  <th className="px-4 py-2 text-center font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {receiptsData.receipts.map((receipt) => {
                  const customer = customers.find((c) => c.id === receipt.customerId);
                  const customerDisplay = customer?.name || (receipt.customerId ? receipt.customerId.slice(0, 8) : 'Unknown');
                  return (
                    <tr key={receipt.id} className="border-b hover:bg-muted/50">
                      <td className="px-4 py-2 font-mono text-xs">{receipt.receiptNumber}</td>
                      <td className="px-4 py-2">{customerDisplay}</td>
                      <td className="px-4 py-2">{format(new Date(receipt.receiptDatetime), 'MMM dd, yyyy HH:mm')}</td>
                      <td className="px-4 py-2 text-right font-semibold">{fmtPKR(receipt.amount)}</td>
                      <td className="px-4 py-2">
                        <Badge variant="outline" className="text-xs">
                          {receipt.paymentMethod}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={receipt.allocationMode === ('FIFO' as const) ? 'default' : 'secondary'} className="text-xs">
                          {receipt.allocationMode}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-center space-x-2">
                        <Button size="sm" variant="ghost">
                          <Eye className="h-4 w-4" />
                        </Button>
                        {hasWriteAccess && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteReceiptMutation.mutate(receipt.id)}
                            disabled={deleteReceiptMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {receiptsData.pagination.total > receiptFilters.limit && (
            <div className="flex gap-2 justify-center">
              <Button
                variant="outline"
                size="sm"
                disabled={receiptFilters.offset === 0}
                onClick={() => setReceiptFilters({ ...receiptFilters, offset: Math.max(0, receiptFilters.offset - receiptFilters.limit) })}
              >
                Previous
              </Button>
              <span className="px-3 py-1 text-sm">
                Page {Math.floor(receiptFilters.offset / receiptFilters.limit) + 1} of {Math.ceil(receiptsData.pagination.total / receiptFilters.limit)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={receiptFilters.offset + receiptFilters.limit >= receiptsData.pagination.total}
                onClick={() => setReceiptFilters({ ...receiptFilters, offset: receiptFilters.offset + receiptFilters.limit })}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );

  // ── Render: Ledger Tab ──────────────────────────────────────────────────────

  const renderLedgerTab = () => (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Select value={ledgerFilters.customerId} onValueChange={(value) => setLedgerFilters({ ...ledgerFilters, customerId: value, offset: 0 })}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select customer" />
          </SelectTrigger>
          <SelectContent>
            {customers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder="Start date (YYYY-MM-DD)"
          type="date"
          value={ledgerFilters.startDate}
          onChange={(e) => setLedgerFilters({ ...ledgerFilters, startDate: e.target.value, offset: 0 })}
          className="w-48"
        />
        <Input
          placeholder="End date (YYYY-MM-DD)"
          type="date"
          value={ledgerFilters.endDate}
          onChange={(e) => setLedgerFilters({ ...ledgerFilters, endDate: e.target.value, offset: 0 })}
          className="w-48"
        />
      </div>

      {!ledgerFilters.customerId ? (
        <div className="text-center py-8 text-muted-foreground">Select a customer to view ledger</div>
      ) : ledgerLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !ledgerData ? (
        <div className="text-center py-8 text-muted-foreground">No ledger data found</div>
      ) : (
        <>
          {/* ─ Customer Summary Cards ─ */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="p-4 border rounded-lg bg-card">
              <div className="text-xs text-muted-foreground mb-1">Opening Balance</div>
              <div className="text-lg font-semibold">{fmtPKR(ledgerData.summary.openingBalance)}</div>
            </div>
            <div className="p-4 border rounded-lg bg-card">
              <div className="text-xs text-muted-foreground mb-1">Total Debit (Invoices)</div>
              <div className="text-lg font-semibold text-red-600">{fmtPKR(ledgerData.summary.totalDebit)}</div>
            </div>
            <div className="p-4 border rounded-lg bg-card">
              <div className="text-xs text-muted-foreground mb-1">Total Credit (Receipts)</div>
              <div className="text-lg font-semibold text-green-600">{fmtPKR(ledgerData.summary.totalCredit)}</div>
            </div>
            <div className="p-4 border rounded-lg bg-card">
              <div className="text-xs text-muted-foreground mb-1">Closing Balance</div>
              <div className={cn('text-lg font-semibold', ledgerData.summary.closingBalance > 0 ? 'text-red-600' : 'text-green-600')}>
                {fmtPKR(ledgerData.summary.closingBalance)}
              </div>
            </div>
          </div>

          {/* ─ Credit Limit Card ─ */}
          {creditCheckResult && (
            <div className={cn('p-4 border rounded-lg', creditCheckResult.creditLimit ? (creditCheckResult.utilizationPct > 80 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200') : 'bg-gray-50')}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Credit Limit</div>
                  <div className="text-lg font-semibold">{creditCheckResult.creditLimit ? fmtPKR(creditCheckResult.creditLimit) : 'Not set'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Current Balance</div>
                  <div className="text-lg font-semibold">{fmtPKR(creditCheckResult.currentBalance)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Utilization</div>
                  <div className="text-lg font-semibold">
                    {creditCheckResult.creditLimit ? `${creditCheckResult.utilizationPct.toFixed(1)}%` : 'N/A'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─ Quick Ledger Export ─ */}
          <div className="flex gap-2 mb-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const customerName = customers.find((c) => c.id === ledgerFilters.customerId)?.name || 'customer';
                exportLedgerToCSV(ledgerData, customerName, ledgerFilters.startDate, ledgerFilters.endDate);
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const customerName = customers.find((c) => c.id === ledgerFilters.customerId)?.name || 'customer';
                exportLedgerToPDF(ledgerData, customerName, ledgerFilters.startDate, ledgerFilters.endDate);
              }}
            >
              <FileText className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
          </div>

          {/* ─ Ledger Entries Table ─ */}
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Date</th>
                  <th className="px-4 py-2 text-left font-semibold">Type</th>
                  <th className="px-4 py-2 text-left font-semibold">Description</th>
                  <th className="px-4 py-2 text-left font-semibold">Receipt</th>
                  <th className="px-4 py-2 text-left font-semibold">Vehicle #</th>
                  <th className="px-4 py-2 text-left font-semibold">Slip #</th>
                  <th className="px-4 py-2 text-left font-semibold">Payment Method</th>
                  <th className="px-4 py-2 text-left font-semibold">Product</th>
                  <th className="px-4 py-2 text-right font-semibold">Debit</th>
                  <th className="px-4 py-2 text-right font-semibold">Credit</th>
                  <th className="px-4 py-2 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledgerData.entries.map((entry) => {
                  const isAdvance =
                    entry.type === 'ADVANCE_DEPOSIT' || entry.type === 'ADVANCE_HANDOUT';
                  const badgeVariant =
                    entry.type === 'INVOICE'
                      ? 'default'
                      : entry.type === 'RECEIPT'
                      ? 'secondary'
                      : 'outline';
                  const badgeLabel =
                    entry.type === 'ADVANCE_DEPOSIT'
                      ? 'ADV IN'
                      : entry.type === 'ADVANCE_HANDOUT'
                      ? 'ADV OUT'
                      : entry.type;
                  return (
                  <tr
                    key={entry.id}
                    className={cn(
                      'border-b hover:bg-muted/50',
                      isAdvance && 'bg-amber-50/40'
                    )}
                  >
                    <td className="px-4 py-2">{format(new Date(entry.date), 'MMM dd, yyyy')}</td>
                    <td className="px-4 py-2">
                      <Badge
                        variant={badgeVariant}
                        className={cn(
                          'text-xs',
                          isAdvance && 'border-amber-500 text-amber-700'
                        )}
                      >
                        {badgeLabel}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">{entry.description}</td>
                    <td className="px-4 py-2 text-xs font-mono">
                      {entry.receiptNumber || '-'}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {entry.vehicleNumber || '-'}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {entry.slipNumber || '-'}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {entry.paymentMethod || '-'}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <Badge variant="outline" className="text-xs">
                        {entry.productType || '-'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-right">{entry.debit > 0 ? fmtPKR(entry.debit) : '-'}</td>
                    <td className="px-4 py-2 text-right">{entry.credit > 0 ? fmtPKR(entry.credit) : '-'}</td>
                    <td className={cn('px-4 py-2 text-right font-semibold', entry.balance > 0 ? 'text-red-600' : 'text-green-600')}>
                      {fmtPKR(entry.balance)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ─ Vehicle Breakdown ─ */}
          {ledgerData.vehicleBreakdown.length > 0 && (
            <div className="p-4 border rounded-lg bg-card">
              <div className="text-sm font-semibold mb-3">Vehicle Breakdown</div>
              <div className="space-y-2">
                {ledgerData.vehicleBreakdown.map((vehicle) => (
                  <div key={vehicle.vehicleNumber} className="flex justify-between text-sm">
                    <span>{vehicle.vehicleNumber || 'Walk-in'}</span>
                    <div className="space-x-4">
                      <span>{vehicle.transactionCount} txns</span>
                      <span className="font-semibold">{fmtPKR(vehicle.totalAmount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  // ── Render: Main UI ────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Credit Management</h1>
      </div>

      {/* ─ Tabs ─ */}
      <div className="flex border-b gap-6">
        {(
          [
            { id: 'receipts', label: 'Receipts' },
            { id: 'ledger', label: 'Ledger' },
            { id: 'cash-handout', label: 'Cash Handout' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={cn('pb-3 px-1 font-semibold transition-colors border-b-2', activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─ Tab Content ─ */}
      {activeTab === 'receipts' && renderReceiptsTab()}
      {activeTab === 'ledger' && renderLedgerTab()}
      {activeTab === 'cash-handout' && <CashHandoutPanel />}

      {/* ─ Receipt Create Dialog ─ */}
      <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Receipt</DialogTitle>
            <DialogDescription>Record a payment receipt with flexible allocation options</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* ─ Customer & Branch ─ */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold mb-2 block">Customer *</label>
                <Select value={receiptForm.customerId} onValueChange={(value) => setReceiptForm({ ...receiptForm, customerId: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold mb-2 block">Branch *</label>
                {isSuperuser(user?.role) ? (
                  // Superuser: show dropdown to select any branch
                  <Select value={receiptForm.branchId} onValueChange={(value) => setReceiptForm({ ...receiptForm, branchId: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name || b.code || b.id.slice(0, 8)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  // Non-superuser: show read-only branch name
                  <div className="px-3 py-2 border border-gray-300 rounded text-sm bg-gray-50">
                    {branches.find((b) => b.id === receiptForm.branchId)?.name || receiptForm.branchId.slice(0, 8) || 'Not assigned'}
                  </div>
                )}
              </div>
            </div>

            {/* ─ Receipt Details ─ */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold mb-2 block">Receipt Date *</label>
                <Input
                  type="datetime-local"
                  value={receiptForm.receiptDatetime}
                  onChange={(e) => setReceiptForm({ ...receiptForm, receiptDatetime: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-semibold mb-2 block">Amount *</label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={receiptForm.amount}
                  onChange={(e) => setReceiptForm({ ...receiptForm, amount: e.target.value })}
                />
              </div>
            </div>

            {/* ─ Payment Method ─ */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold mb-2 block">Payment Method *</label>
                <Select
                  value={receiptForm.paymentMethod}
                  onValueChange={(value) => setReceiptForm({
                    ...receiptForm,
                    paymentMethod: value as any,
                    // Clear bank selection when switching to cash / pso_card
                    bankId: value === 'cash' || value === 'pso_card' ? '' : receiptForm.bankId,
                  })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="online">Online / Debit or Credit Card</SelectItem>
                    <SelectItem value="pso_card">PSO Card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold mb-2 block">Reference Number</label>
                <Input placeholder="Cheque/txn number" value={receiptForm.referenceNumber} onChange={(e) => setReceiptForm({ ...receiptForm, referenceNumber: e.target.value })} />
              </div>
            </div>

            {/* ─ Deposit Bank (shown only for non-cash / non-PSO channels) ─
                Scenario 8 Option B: Bank Transfer / IBFT / Cheque / Online /
                Debit or Credit Card — posts Dr <specific bank> / Cr A/R in QB,
                so the cashier must pick which bank received the funds. */}
            {receiptForm.paymentMethod !== 'cash' && receiptForm.paymentMethod !== 'pso_card' && (
              <div>
                <label className="text-xs font-semibold mb-2 block">Deposit Bank *</label>
                <Select
                  value={receiptForm.bankId}
                  onValueChange={(value) => setReceiptForm({ ...receiptForm, bankId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select bank where funds were received" />
                  </SelectTrigger>
                  <SelectContent>
                    {banks.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!receiptForm.bankId && (
                  <div className="text-xs text-red-600 mt-1">
                    Required — QB posts Dr {'{'}bank{'}'} / Cr A/R (Scenario 8 Option B)
                  </div>
                )}
              </div>
            )}

            {/* ─ Allocation Mode ─ */}
            <div>
              <label className="text-xs font-semibold mb-2 block">Allocation Mode *</label>
              <Select value={receiptForm.allocationMode} onValueChange={(value) => setReceiptForm({ ...receiptForm, allocationMode: value as 'FIFO' | 'MANUAL' })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIFO">FIFO (Auto-allocate)</SelectItem>
                  <SelectItem value="MANUAL">Manual Allocation</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground mt-1">
                {receiptForm.allocationMode === ('FIFO' as const)
                  ? 'Payment will be automatically applied to oldest unpaid invoices first'
                  : 'You must manually select which invoices to allocate payment to'}
              </div>
            </div>

            {/* ─ Manual Allocations ─ */}
            {receiptForm.allocationMode === ('MANUAL' as const) && (
              <div className="border rounded-lg p-4 bg-muted/50 space-y-3">
                <div className="font-semibold text-sm">Manual Allocations</div>

                {/* Open Items Quick Preview */}
                {openInvoices.length > 0 && (
                  <div className="bg-white p-3 border rounded text-xs">
                    <div className="font-semibold mb-2">Available open items: {openInvoices.length}</div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {openInvoices.map((item) => (
                        <div key={item.id} className="flex justify-between text-muted-foreground py-1 border-b">
                          <span className="truncate flex-1">{item.description}</span>
                          <span className="font-mono font-semibold text-foreground ml-2">{item.openAmount.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setShowOpenItemsModal(true)} className="w-full mt-2">
                      <Eye className="h-3 w-3 mr-2" />
                      Browse All Open Items
                    </Button>
                  </div>
                )}

                {allocations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No allocations added yet</p>
                ) : (
                  <div className="space-y-2">
                    {allocations.map((alloc, idx) => (
                      <div key={idx} className="flex gap-2 items-end">
                        <Input
                          placeholder="Source ID (UUID)"
                          value={alloc.sourceId}
                          onChange={(e) => handleAllocationChange(idx, 'sourceId', e.target.value)}
                          className="flex-1"
                        />
                        <Select value={alloc.sourceType} onValueChange={(value) => handleAllocationChange(idx, 'sourceType', value)}>
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="SALE">Sale</SelectItem>
                            <SelectItem value="BACKDATED_TRANSACTION">Backdated Txn</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          placeholder="Amount"
                          value={alloc.amount}
                          onChange={(e) => handleAllocationChange(idx, 'amount', e.target.value)}
                          className="w-32"
                        />
                        <Button size="sm" variant="ghost" onClick={() => handleRemoveAllocation(idx)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Button size="sm" variant="outline" onClick={handleAddAllocation} className="w-full">
                  <Plus className="h-4 w-4 mr-2" /> Add Allocation
                </Button>
              </div>
            )}

            {/* ─ Notes ─ */}
            <div>
              <label className="text-xs font-semibold mb-2 block">Notes</label>
              <Input placeholder="Additional notes" value={receiptForm.notes} onChange={(e) => setReceiptForm({ ...receiptForm, notes: e.target.value })} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReceiptDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateReceipt} disabled={createReceiptMutation.isPending}>
              {createReceiptMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Create Receipt
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─ Open Items Modal (for MANUAL allocation) ─ */}
      <Dialog open={showOpenItemsModal} onOpenChange={setShowOpenItemsModal}>
        <DialogContent className="max-w-4xl max-h-96">
          <DialogHeader>
            <DialogTitle>Open Items - Select to Allocate</DialogTitle>
            <DialogDescription>
              Click on an item to add it to allocations (set amount to open amount or adjust as needed)
            </DialogDescription>
          </DialogHeader>

          {openInvoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No open items available for this customer</div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted border-b">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Date</th>
                    <th className="px-3 py-2 text-left font-semibold">Type</th>
                    <th className="px-3 py-2 text-left font-semibold">Reference</th>
                    <th className="px-3 py-2 text-right font-semibold">Original Amt</th>
                    <th className="px-3 py-2 text-right font-semibold">Allocated</th>
                    <th className="px-3 py-2 text-right font-semibold">Open Amt</th>
                    <th className="px-3 py-2 text-center font-semibold">Status</th>
                    <th className="px-3 py-2 text-center font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {openInvoices.map((item) => {
                    const status = item.allocatedAmount > 0 ? 'PARTIAL' : 'UNSETTLED';
                    return (
                      <tr key={item.id} className="border-b hover:bg-muted/50">
                        <td className="px-3 py-2">{format(new Date(item.date), 'MMM dd, yy')}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-xs">
                            {item.sourceType === 'SALE' ? 'SALE' : 'BDTX'}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{item.slipNumber || item.vehicleNumber || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono">{item.totalAmount.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono">{item.allocatedAmount.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">{item.openAmount.toFixed(2)}</td>
                        <td className="px-3 py-2 text-center">
                          <Badge variant={status === 'PARTIAL' ? 'secondary' : 'outline'} className="text-xs">
                            {status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Button size="sm" variant="ghost" onClick={() => handleAddAllocationFromItem(item)}>
                            <Plus className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOpenItemsModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
