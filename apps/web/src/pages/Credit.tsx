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
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { creditApi } from '@/api/credit';
import { customersApi, branchesApi } from '@/api';
import { useAuthStore } from '@/store/auth';
import { toast } from 'sonner';
import { format } from 'date-fns';

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

// ── Component ─────────────────────────────────────────────────────────────────

export function Credit() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  // ── Tabs & Context State ────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'receipts' | 'ledger' | 'reports'>('receipts');
  const [selectedCustomerId] = useState('');
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);

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
    paymentMethod: 'cash';
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

  // Auto-prefill branchId from user's assigned branch (for non-superusers)
  useEffect(() => {
    if (user?.branch_id && !receiptForm.branchId) {
      setReceiptForm((prev) => ({ ...prev, branchId: user.branch_id || '' }));
    }
  }, [user?.branch_id, receiptForm.branchId]);

  const { data: receiptsData, isLoading: receiptsLoading, refetch: refetchReceipts } = useQuery({
    queryKey: ['credit-receipts', receiptFilters],
    queryFn: () =>
      creditApi.getReceipts({
        customerId: receiptFilters.customerId || undefined,
        startDate: receiptFilters.startDate || undefined,
        endDate: receiptFilters.endDate || undefined,
        limit: receiptFilters.limit,
        offset: receiptFilters.offset,
      }),
    enabled: activeTab === 'receipts',
  });

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery({
    queryKey: ['credit-ledger', ledgerFilters],
    queryFn: () =>
      creditApi.getCustomerLedger(ledgerFilters.customerId, {
        startDate: ledgerFilters.startDate || undefined,
        endDate: ledgerFilters.endDate || undefined,
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

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createReceiptMutation = useMutation({
    mutationFn: () => {
      const totalAmount = parseFloat(receiptForm.amount);
      if (isNaN(totalAmount) || totalAmount <= 0) {
        throw new Error('Amount must be a positive number');
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

          {/* ─ Ledger Entries Table ─ */}
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Date</th>
                  <th className="px-4 py-2 text-left font-semibold">Type</th>
                  <th className="px-4 py-2 text-left font-semibold">Description</th>
                  <th className="px-4 py-2 text-left font-semibold">Vehicle/Slip</th>
                  <th className="px-4 py-2 text-right font-semibold">Debit</th>
                  <th className="px-4 py-2 text-right font-semibold">Credit</th>
                  <th className="px-4 py-2 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledgerData.entries.map((entry) => (
                  <tr key={entry.id} className="border-b hover:bg-muted/50">
                    <td className="px-4 py-2">{format(new Date(entry.date), 'MMM dd, yyyy')}</td>
                    <td className="px-4 py-2">
                      <Badge variant={entry.type === 'INVOICE' ? 'default' : 'secondary'} className="text-xs">
                        {entry.type}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">{entry.description}</td>
                    <td className="px-4 py-2 text-xs">
                      {entry.vehicleNumber && <div>{entry.vehicleNumber}</div>}
                      {entry.slipNumber && <div className="text-muted-foreground">Slip: {entry.slipNumber}</div>}
                    </td>
                    <td className="px-4 py-2 text-right">{entry.debit > 0 ? fmtPKR(entry.debit) : '-'}</td>
                    <td className="px-4 py-2 text-right">{entry.credit > 0 ? fmtPKR(entry.credit) : '-'}</td>
                    <td className={cn('px-4 py-2 text-right font-semibold', entry.balance > 0 ? 'text-red-600' : 'text-green-600')}>
                      {fmtPKR(entry.balance)}
                    </td>
                  </tr>
                ))}
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
        {['receipts', 'ledger', 'reports'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as typeof activeTab)}
            className={cn('pb-3 px-1 font-semibold transition-colors border-b-2', activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* ─ Tab Content ─ */}
      {activeTab === 'receipts' && renderReceiptsTab()}
      {activeTab === 'ledger' && renderLedgerTab()}
      {activeTab === 'reports' && <div className="text-center py-8 text-muted-foreground">Reports feature coming soon</div>}

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
                <Select value={receiptForm.paymentMethod} onValueChange={(value) => setReceiptForm({ ...receiptForm, paymentMethod: value as any })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold mb-2 block">Reference Number</label>
                <Input placeholder="Cheque/txn number" value={receiptForm.referenceNumber} onChange={(e) => setReceiptForm({ ...receiptForm, referenceNumber: e.target.value })} />
              </div>
            </div>

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
              <div className="border rounded-lg p-4 bg-muted/50">
                <div className="font-semibold text-sm mb-3">Manual Allocations</div>
                {allocations.length === 0 ? (
                  <p className="text-xs text-muted-foreground mb-3">No allocations added yet</p>
                ) : (
                  <div className="space-y-2 mb-3">
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
    </div>
  );
}
