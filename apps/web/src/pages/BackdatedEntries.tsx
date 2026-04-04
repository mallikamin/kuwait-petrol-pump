import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { CustomerSelector } from '@/components/ui/customer-selector';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Calendar, DollarSign, AlertCircle, Plus, Trash2, Save, CheckCircle, Users, Copy } from 'lucide-react';
import { apiClient } from '@/api/client';
import { branchesApi, customersApi, meterReadingsApi } from '@/api';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Transaction {
  id?: string;
  customerId?: string;
  customerName?: string;
  nozzleId?: string;
  vehicleNumber?: string;
  slipNumber?: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  paymentMethod: 'cash' | 'credit_card' | 'bank_card' | 'pso_card' | 'credit_customer';
}

interface MeterReadingRow {
  id: string;
  nozzle_id?: string;
  shift_id?: string;
  reading_type: 'opening' | 'closing';
  meter_value?: number;
  reading_value?: number;
  created_at?: string;
  recorded_at?: string;
}

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

export function BackdatedEntries() {
  // Entry fields
  const [businessDate, setBusinessDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedShiftId, setSelectedShiftId] = useState('');

  // Transaction fields
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [syncMessage, setSyncMessage] = useState('');

  // Auto-save state
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Fetch branches
  const { data: branchesData } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await branchesApi.getAll();
      return res.items;
    },
  });

  // Fetch nozzles for selected branch
  const { data: nozzlesData } = useQuery({
    queryKey: ['branches', selectedBranchId, 'nozzles'],
    queryFn: async () => {
      if (!selectedBranchId) return [];
      const branches = await branchesApi.getAll();
      const branch = branches.items.find((b: any) => b.id === selectedBranchId);
      if (branch && (branch as any).dispensingUnits) {
        return (branch as any).dispensingUnits.flatMap((unit: any) => unit.nozzles || []);
      }
      return [];
    },
    enabled: !!selectedBranchId,
  });

  // Fetch customers for autocomplete
  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const res = await customersApi.getAll();
      return res.items;
    },
  });

  // Fetch shift instances for selected business date (for optional shift-specific reconciliation)
  const { data: shiftInstancesData } = useQuery({
    queryKey: ['shift-history', selectedBranchId, businessDate],
    enabled: !!selectedBranchId && !!businessDate,
    queryFn: async () => {
      const res = await apiClient.get('/api/shifts/history', {
        params: {
          branchId: selectedBranchId,
          startDate: `${businessDate}T00:00:00.000Z`,
          endDate: `${businessDate}T23:59:59.999Z`,
          limit: 20,
          offset: 0,
        },
      });
      return (res.data?.shifts || []) as Array<{ id: string; shift?: { name?: string; shiftNumber?: number } }>;
    },
  });

  // Fetch daily summary from new consolidated API
  const { data: dailySummaryData, refetch: refetchDailySummary } = useQuery({
    queryKey: ['backdated-entries-daily', selectedBranchId, businessDate, selectedShiftId],
    enabled: !!selectedBranchId && !!businessDate,
    queryFn: async () => {
      const res = await apiClient.get('/api/backdated-entries/daily', {
        params: {
          branchId: selectedBranchId,
          businessDate: businessDate,
          shiftId: selectedShiftId || undefined,
        },
      });
      return res.data?.data;
    },
  });

  // Fetch ALL meter readings for selected date (all nozzles)
  const { data: meterReadingsData } = useQuery({
    queryKey: ['meter-readings-all', selectedBranchId, businessDate],
    enabled: !!selectedBranchId && !!businessDate,
    queryFn: async () => {
      if (!nozzlesData || nozzlesData.length === 0) return [];
      const res = await meterReadingsApi.getAll({
        size: 500,
        date: businessDate,
      });
      return (res.items || []) as MeterReadingRow[];
    },
  });

  // Compute fuel totals from ALL nozzles' meter readings
  const fuelTotals = useMemo(() => {
    const totals = { HSD: 0, PMG: 0, other: 0 };
    (nozzlesData || []).forEach((nozzle: any) => {
      const readings = (meterReadingsData || []).filter((r: any) => r.nozzle_id === nozzle.id);
      if (readings.length === 0) return;
      const opening = readings.find((r: any) => r.reading_type === 'opening');
      const closing = readings.find((r: any) => r.reading_type === 'closing');
      if (!opening || !closing) return;
      const liters = toNumber(closing.meter_value ?? closing.reading_value) - toNumber(opening.meter_value ?? opening.reading_value);
      const fuelCode = nozzle.fuelType?.code;
      if (fuelCode === 'HSD') totals.HSD += liters;
      else if (fuelCode === 'PMG') totals.PMG += liters;
      else totals.other += liters;
    });
    return totals;
  }, [nozzlesData, meterReadingsData]);

  // Compute posted fuel totals from transactions
  const postedByFuel = useMemo(() => {
    const posted = { HSD: 0, PMG: 0, other: 0 };
    transactions.forEach(txn => {
      const nozzle = (nozzlesData || []).find((n: any) => n.id === txn.nozzleId);
      const fuelCode = nozzle?.fuelType?.code;
      const qty = toNumber(txn.quantity);
      if (fuelCode === 'HSD') posted.HSD += qty;
      else if (fuelCode === 'PMG') posted.PMG += qty;
      else posted.other += qty;
    });
    return posted;
  }, [transactions, nozzlesData]);

  // Compute nozzle-level reconciliation for checklist
  const nozzleReconciliation = useMemo(() => {
    return (nozzlesData || []).map((nozzle: any) => {
      const readings = (meterReadingsData || []).filter((r: any) => r.nozzle_id === nozzle.id);
      const opening = readings.find((r: any) => r.reading_type === 'opening');
      const closing = readings.find((r: any) => r.reading_type === 'closing');
      const meterLiters = opening && closing
        ? toNumber(closing.meter_value ?? closing.reading_value) - toNumber(opening.meter_value ?? opening.reading_value)
        : 0;

      const postedLiters = transactions
        .filter(txn => txn.nozzleId === nozzle.id)
        .reduce((sum, txn) => sum + toNumber(txn.quantity), 0);

      const remaining = meterLiters - postedLiters;
      const isReconciled = Math.abs(remaining) < 0.1;

      return {
        nozzleId: nozzle.id,
        nozzleName: nozzle.name || `N${nozzle.nozzleNumber}`,
        fuelCode: nozzle.fuelType?.code || 'Unknown',
        meterLiters,
        postedLiters,
        remaining,
        isReconciled,
      };
    });
  }, [nozzlesData, meterReadingsData, transactions]);

  const transactionTotals = transactions.reduce(
    (acc, txn) => {
      const qty = parseFloat(txn.quantity || '0');
      const total = parseFloat(txn.lineTotal || '0');

      acc.liters += qty;
      acc.amount += total;

      switch (txn.paymentMethod) {
        case 'cash':
          acc.cash += total;
          break;
        case 'credit_card':
          acc.creditCard += total;
          break;
        case 'bank_card':
          acc.bankCard += total;
          break;
        case 'pso_card':
          acc.psoCard += total;
          break;
        case 'credit_customer':
          acc.creditCustomer += total;
          break;
      }

      return acc;
    },
    {
      liters: 0,
      amount: 0,
      cash: 0,
      creditCard: 0,
      bankCard: 0,
      psoCard: 0,
      creditCustomer: 0,
    }
  );

  const totalMeterLiters = fuelTotals.HSD + fuelTotals.PMG + fuelTotals.other;
  const varianceLiters = totalMeterLiters - transactionTotals.liters;

  // Estimated variance amount (using average price from transactions)
  const avgPrice = transactionTotals.liters > 0 ? transactionTotals.amount / transactionTotals.liters : 288;
  const varianceAmount = varianceLiters * avgPrice;

  const meterSalesAmount = totalMeterLiters * avgPrice;
  const knownNonCashAmount =
    transactionTotals.creditCard +
    transactionTotals.bankCard +
    transactionTotals.psoCard +
    transactionTotals.creditCustomer;

  // Reconciliation formula: expected cash is derived after posting all known non-cash methods.
  const backTracedCashAmount = meterSalesAmount - knownNonCashAmount;
  const postedCashAmount = transactionTotals.cash;
  const cashGapAmount = backTracedCashAmount - postedCashAmount;

  // Customer grouping for accordion display
  const customerGroups = useMemo(() => {
    const grouped = new Map<string, { indices: number[]; txns: Transaction[] }>();
    transactions.forEach((txn, idx) => {
      const key = txn.customerId || '__walkin__';
      if (!grouped.has(key)) grouped.set(key, { indices: [], txns: [] });
      grouped.get(key)!.indices.push(idx);
      grouped.get(key)!.txns.push(txn);
    });
    return Array.from(grouped.entries()).map(([customerId, { indices, txns }]) => ({
      customerId,
      customerName: customerId === '__walkin__' ? 'Walk-in Sales' : (txns[0].customerName || 'Unknown'),
      indices,
      transactions: txns,
      totalLiters: txns.reduce((s, t) => s + toNumber(t.quantity), 0),
      totalAmount: txns.reduce((s, t) => s + toNumber(t.lineTotal), 0),
    }));
  }, [transactions]);

  // Add customer group dialog state
  const [isAddGroupOpen, setIsAddGroupOpen] = useState(false);
  const [newGroupCustomerId, setNewGroupCustomerId] = useState('');

  const addTransactionToCustomer = (customerId: string, customerName: string) => {
    setTransactions([
      ...transactions,
      {
        customerId: customerId === '__walkin__' ? '' : customerId,
        customerName: customerId === '__walkin__' ? '' : customerName,
        nozzleId: '',
        productName: '',
        quantity: '',
        unitPrice: '',
        lineTotal: '0',
        paymentMethod: 'cash',
      },
    ]);
  };

  const duplicateLastInGroup = (groupIndices: number[]) => {
    if (groupIndices.length === 0) return;
    const lastIdx = groupIndices[groupIndices.length - 1];
    const lastRow = transactions[lastIdx];
    setTransactions([
      ...transactions,
      { ...lastRow, id: undefined, quantity: '', lineTotal: '0' },
    ]);
  };

  const mappedShiftOptions = useMemo(
    () =>
      (shiftInstancesData || []).map((instance) => ({
        id: instance.id,
        label: instance.shift?.name || `Shift ${instance.shift?.shiftNumber || ''}`.trim(),
      })),
    [shiftInstancesData]
  );

  useEffect(() => {
    if (!selectedBranchId || !businessDate) {
      setTransactions([]);
      setSyncMessage('');
      return;
    }

    if (dailySummaryData?.transactions && dailySummaryData.transactions.length > 0) {
      setTransactions(
        dailySummaryData.transactions.map((txn: any) => ({
          id: txn.id,
          customerId: txn.customer?.id || '',
          customerName: txn.customer?.name || '',
          nozzleId: txn.nozzle?.id || '',
          vehicleNumber: txn.vehicleNumber || '',
          slipNumber: txn.slipNumber || '',
          productName: txn.productName || 'Fuel',
          quantity: toNumber(txn.quantity).toString(),
          unitPrice: toNumber(txn.unitPrice).toFixed(2),
          lineTotal: toNumber(txn.lineTotal).toFixed(2),
          paymentMethod: txn.paymentMethod,
        }))
      );
      setSyncMessage(`Loaded ${dailySummaryData.transactions.length} existing transactions.`);
    } else {
      setTransactions([]);
      setSyncMessage('No existing transactions. Start adding customer groups.');
    }
  }, [
    selectedBranchId,
    businessDate,
    selectedShiftId,
    dailySummaryData,
  ]);

  // Auto-save effect (mark dirty on transaction changes)
  useEffect(() => {
    if (transactions.length > 0) setIsDirty(true);
  }, [transactions]);

  // Auto-save timer (2 minutes)
  useEffect(() => {
    if (!isDirty || transactions.length === 0 || !selectedBranchId) return;
    const timer = setTimeout(async () => {
      try {
        await saveDailyDraftMutation.mutateAsync();
        console.log('Auto-saved draft at', new Date().toLocaleTimeString());
      } catch (error) {
        console.error('Auto-save failed:', error);
      }
    }, 120000); // 2 minutes
    return () => clearTimeout(timer);
  }, [isDirty, transactions, selectedBranchId]);

  // Remove transaction row
  const removeTransaction = (index: number) => {
    setTransactions(transactions.filter((_, i) => i !== index));
  };

  // Update transaction field
  const updateTransaction = (index: number, field: keyof Transaction, value: any) => {
    const updated = [...transactions];
    updated[index] = { ...updated[index], [field]: value };

    // Auto-fill product name and unit price when nozzle selected
    if (field === 'nozzleId') {
      const nozzle = (nozzlesData || []).find((n: any) => n.id === value);
      if (nozzle) {
        updated[index].productName = nozzle.fuelType?.name || 'Fuel';
        updated[index].unitPrice = nozzle.fuelType?.code === 'HSD' ? '287.33' : '290.50';
      }
    }

    // Auto-calculate line total when quantity or unit price changes
    if (field === 'quantity' || field === 'unitPrice' || field === 'nozzleId') {
      const qty = toNumber(updated[index].quantity);
      const price = toNumber(updated[index].unitPrice);
      updated[index].lineTotal = (qty * price).toFixed(2);
    }

    // Auto-fill customer name
    if (field === 'customerId') {
      const customer = customersData?.find((c: any) => c.id === value);
      if (customer) {
        updated[index].customerName = customer.name;
      }
    }

    setTransactions(updated);
  };

  // Save daily draft mutation (new consolidated API)
  const saveDailyDraftMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBranchId) {
        throw new Error('Please select a branch');
      }

      if (transactions.length === 0) {
        throw new Error('No transactions to save');
      }

      // Validate credit customer requirements
      for (const txn of transactions) {
        if (txn.paymentMethod === 'credit_customer') {
          if (!txn.customerId || !txn.vehicleNumber || !txn.slipNumber) {
            throw new Error(`Credit customer transaction requires customer, vehicle#, and slip# (row with ${txn.quantity}L)`);
          }
        }
      }

      const res = await apiClient.post('/api/backdated-entries/daily', {
        branchId: selectedBranchId,
        businessDate,
        shiftId: selectedShiftId || undefined,
        transactions: transactions.map(txn => ({
          customerId: txn.customerId || undefined,
          nozzleId: txn.nozzleId || undefined,
          vehicleNumber: txn.vehicleNumber || undefined,
          slipNumber: txn.slipNumber || undefined,
          productName: txn.productName,
          quantity: toNumber(txn.quantity),
          unitPrice: toNumber(txn.unitPrice),
          lineTotal: toNumber(txn.lineTotal),
          paymentMethod: txn.paymentMethod,
        })),
      });

      return res.data.data;
    },
    onSuccess: () => {
      toast.success('Draft saved successfully');
      setLastSaved(new Date());
      setIsDirty(false);
      refetchDailySummary();
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error.message || 'Failed to save draft';
      toast.error(errorMsg);
    },
  });

  // Finalize day mutation (enqueue QB sync)
  const finalizeDayMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBranchId) {
        throw new Error('Please select a branch');
      }

      const res = await apiClient.post('/api/backdated-entries/daily/finalize', {
        branchId: selectedBranchId,
        businessDate,
      });

      return res.data.data;
    },
    onSuccess: (data: any) => {
      toast.success(data.message || 'Day finalized and queued for QuickBooks sync');
      refetchDailySummary();
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error.message || 'Failed to finalize day';
      toast.error(errorMsg);
    },
  });

  const handleSaveDraft = async () => {
    await saveDailyDraftMutation.mutateAsync();
  };

  const handleFinalizeDay = async () => {
    if (isDirty) {
      toast.error('Please save draft first before finalizing');
      return;
    }
    if (transactions.length === 0) {
      toast.error('No transactions to finalize');
      return;
    }
    await finalizeDayMutation.mutateAsync();
  };

  const resetForm = () => {
    setBusinessDate(format(new Date(), 'yyyy-MM-dd'));
    setSelectedBranchId('');
    setSelectedShiftId('');
    setTransactions([]);
    setSyncMessage('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Backdated Entries</h1>
          <p className="text-muted-foreground">Transaction-level backfill for accountant processing</p>
        </div>
        <Badge variant="outline" className="text-orange-600 border-orange-600">
          PKR Only
        </Badge>
      </div>

      {/* Info Alert */}
      <Alert className="border-orange-200 bg-orange-50">
        <AlertCircle className="h-4 w-4 text-orange-600" />
        <AlertDescription className="text-sm text-orange-900">
          <strong>Transaction-First Approach:</strong> Select branch and date, then add individual customer transactions. Nozzle selection is per-transaction. Credit customers require vehicle# and slip#.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Entry Form + Transactions */}
        <div className="lg:col-span-2 space-y-6">
          {/* Entry Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Daily Entry Context
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Business Date *</Label>
                  <Input
                    type="date"
                    value={businessDate}
                    onChange={(e) => setBusinessDate(e.target.value)}
                    max={format(new Date(), 'yyyy-MM-dd')}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Branch *</Label>
                  <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {branchesData?.map((branch: any) => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Shift (Optional)</Label>
                  <Select value={selectedShiftId || '__none__'} onValueChange={(v) => setSelectedShiftId(v === '__none__' ? '' : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Any shift" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Any shift</SelectItem>
                      {mappedShiftOptions.map((shiftOption) => (
                        <SelectItem key={shiftOption.id} value={shiftOption.id}>
                          {shiftOption.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {syncMessage && (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
                  {syncMessage}
                </div>
              )}
            </CardContent>
          </Card>

          {/* HSD/PMG Dashboard Cards */}
          {selectedBranchId && businessDate && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* HSD Card */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">HSD (Diesel)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Meter Total:</span>
                    <span className="font-mono font-semibold">{fuelTotals.HSD.toFixed(3)} L</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Posted:</span>
                    <span className="font-mono text-blue-600">{postedByFuel.HSD.toFixed(3)} L</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Remaining:</span>
                    <span className="font-mono font-semibold text-orange-600">{(fuelTotals.HSD - postedByFuel.HSD).toFixed(3)} L</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{fuelTotals.HSD > 0 ? Math.round((postedByFuel.HSD / fuelTotals.HSD) * 100) : 0}% Reconciled</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 transition-all"
                        style={{ width: `${fuelTotals.HSD > 0 ? Math.min((postedByFuel.HSD / fuelTotals.HSD) * 100, 100) : 0}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* PMG Card */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">PMG (Petrol)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Meter Total:</span>
                    <span className="font-mono font-semibold">{fuelTotals.PMG.toFixed(3)} L</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Posted:</span>
                    <span className="font-mono text-blue-600">{postedByFuel.PMG.toFixed(3)} L</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Remaining:</span>
                    <span className="font-mono font-semibold text-orange-600">{(fuelTotals.PMG - postedByFuel.PMG).toFixed(3)} L</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{fuelTotals.PMG > 0 ? Math.round((postedByFuel.PMG / fuelTotals.PMG) * 100) : 0}% Reconciled</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 transition-all"
                        style={{ width: `${fuelTotals.PMG > 0 ? Math.min((postedByFuel.PMG / fuelTotals.PMG) * 100, 100) : 0}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Transactions — Customer-Grouped */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Transactions ({transactions.length})
                </CardTitle>
                <Button size="sm" onClick={() => setIsAddGroupOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Customer Group
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="mx-auto h-12 w-12 mb-3 opacity-30" />
                  <p className="font-medium">No transactions yet</p>
                  <p className="text-sm mt-1">Click &quot;Add Customer Group&quot; to start reconciling</p>
                </div>
              ) : (
                <Accordion type="multiple" defaultValue={customerGroups.map(g => g.customerId)} className="space-y-2">
                  {customerGroups.map((group) => (
                    <AccordionItem key={group.customerId} value={group.customerId} className="border rounded-lg">
                      <AccordionTrigger className="hover:no-underline px-4 py-3">
                        <div className="flex items-center justify-between w-full pr-4">
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-base">{group.customerName}</span>
                            <Badge variant="secondary" className="text-xs">
                              {group.transactions.length} txn{group.transactions.length > 1 ? 's' : ''}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-6 text-sm">
                            <span className="text-muted-foreground">
                              <span className="font-mono font-semibold text-blue-600">{group.totalLiters.toFixed(3)}</span> L
                            </span>
                            <span className="font-mono font-semibold">{group.totalAmount.toLocaleString('en-PK', { minimumFractionDigits: 2 })} PKR</span>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30">
                              <TableHead className="w-[160px]">Nozzle</TableHead>
                              <TableHead className="w-[130px]">Vehicle#</TableHead>
                              <TableHead className="w-[110px]">Slip#</TableHead>
                              <TableHead className="w-[130px]">Product</TableHead>
                              <TableHead className="w-[120px] text-right">Qty (L)</TableHead>
                              <TableHead className="w-[120px] text-right">Price/L</TableHead>
                              <TableHead className="w-[140px] text-right">Total (PKR)</TableHead>
                              <TableHead className="w-[160px]">Payment</TableHead>
                              <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.transactions.map((txn, localIdx) => {
                              const globalIdx = group.indices[localIdx];
                              return (
                                <TableRow key={globalIdx}>
                                  <TableCell className="p-2">
                                    <Select
                                      value={txn.nozzleId || '__none__'}
                                      onValueChange={(v) => updateTransaction(globalIdx, 'nozzleId', v === '__none__' ? '' : v)}
                                    >
                                      <SelectTrigger className="h-10 text-sm">
                                        <SelectValue placeholder="Select nozzle" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__none__">No nozzle</SelectItem>
                                        {(nozzlesData || []).map((nozzle: any) => (
                                          <SelectItem key={nozzle.id} value={nozzle.id}>
                                            {nozzle.name || `N${nozzle.nozzleNumber}`} - {nozzle.fuelType?.code}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Input
                                      className="h-10 text-sm font-mono"
                                      value={txn.vehicleNumber || ''}
                                      onChange={(e) => updateTransaction(globalIdx, 'vehicleNumber', e.target.value)}
                                      placeholder="ABC-123"
                                    />
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Input
                                      className="h-10 text-sm font-mono"
                                      value={txn.slipNumber || ''}
                                      onChange={(e) => updateTransaction(globalIdx, 'slipNumber', e.target.value)}
                                      placeholder="SLP-001"
                                    />
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Input className="h-10 text-sm bg-muted/30" value={txn.productName} readOnly />
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Input
                                      className="h-10 text-sm font-mono text-right"
                                      type="number"
                                      step="0.001"
                                      value={txn.quantity}
                                      onChange={(e) => updateTransaction(globalIdx, 'quantity', e.target.value)}
                                      placeholder="0.000"
                                    />
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Input
                                      className="h-10 text-sm font-mono text-right"
                                      type="number"
                                      step="0.01"
                                      value={txn.unitPrice}
                                      onChange={(e) => updateTransaction(globalIdx, 'unitPrice', e.target.value)}
                                    />
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Input
                                      className="h-10 text-sm font-mono text-right font-semibold bg-blue-50 text-blue-700"
                                      value={toNumber(txn.lineTotal).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                                      readOnly
                                    />
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Select
                                      value={txn.paymentMethod}
                                      onValueChange={(v: any) => updateTransaction(globalIdx, 'paymentMethod', v)}
                                    >
                                      <SelectTrigger className="h-10 text-sm">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="cash">Cash</SelectItem>
                                        <SelectItem value="credit_card">Credit Card</SelectItem>
                                        <SelectItem value="bank_card">Bank Card</SelectItem>
                                        <SelectItem value="pso_card">PSO Card</SelectItem>
                                        <SelectItem value="credit_customer">Credit Customer</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Button size="icon" variant="ghost" onClick={() => removeTransaction(globalIdx)}>
                                      <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                        <div className="flex justify-end gap-2 mt-3">
                          <Button size="sm" variant="outline" onClick={() => duplicateLastInGroup(group.indices)}>
                            <Copy className="h-3 w-3 mr-1" /> Duplicate Last
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => addTransactionToCustomer(group.customerId, group.customerName)}>
                            <Plus className="h-3 w-3 mr-1" /> Add Row
                          </Button>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}

              {transactions.length > 0 && (
                <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
                  <Button variant="outline" onClick={resetForm}>Cancel</Button>
                  <Button
                    variant="outline"
                    onClick={handleSaveDraft}
                    disabled={saveDailyDraftMutation.isPending}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save Draft
                    {lastSaved && <span className="text-xs ml-2">({format(lastSaved, 'HH:mm')})</span>}
                  </Button>
                  <Button
                    onClick={handleFinalizeDay}
                    disabled={finalizeDayMutation.isPending || isDirty}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Finalize Day
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add Customer Group Dialog */}
          <Dialog open={isAddGroupOpen} onOpenChange={setIsAddGroupOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add Customer Group</DialogTitle>
              </DialogHeader>
              <div className="py-4">
                <Label className="mb-2 block">Customer</Label>
                <CustomerSelector
                  customers={customersData || []}
                  value={newGroupCustomerId}
                  onChange={setNewGroupCustomerId}
                  placeholder="Search by name, phone, or email..."
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setIsAddGroupOpen(false); setNewGroupCustomerId(''); }}>
                  Cancel
                </Button>
                <Button onClick={() => {
                  const isWalkin = !newGroupCustomerId || newGroupCustomerId === 'none';
                  const customer = customersData?.find((c: any) => c.id === newGroupCustomerId);
                  addTransactionToCustomer(
                    isWalkin ? '__walkin__' : newGroupCustomerId,
                    isWalkin ? 'Walk-in Sales' : (customer?.name || 'Unknown'),
                  );
                  setIsAddGroupOpen(false);
                  setNewGroupCustomerId('');
                }}>
                  <Plus className="h-4 w-4 mr-1" /> Add Group
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Right: Reconciliation Panel */}
        <div className="space-y-6">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="text-base">Reconciliation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {/* Nozzle Checklist */}
              {nozzleReconciliation.length > 0 && (
                <div>
                  <div className="font-semibold mb-2">Nozzle Checklist</div>
                  <div className="space-y-1.5 text-xs">
                    {nozzleReconciliation.map((nozzle: any) => (
                      <div key={nozzle.nozzleId} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${nozzle.isReconciled ? 'bg-green-500' : 'bg-orange-500'}`} />
                          <span className="font-medium">{nozzle.nozzleName}</span>
                          <Badge variant="outline" className="text-[10px] px-1 py-0">{nozzle.fuelCode}</Badge>
                        </div>
                        <span className="font-mono text-xs">
                          {nozzle.postedLiters.toFixed(1)}/{nozzle.meterLiters.toFixed(1)}L
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Fuel Totals */}
              <div className="pt-2 border-t">
                <div className="font-semibold mb-2">Fuel Totals</div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">HSD Meter:</span>
                    <span className="font-mono">{fuelTotals.HSD.toFixed(3)} L</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">HSD Posted:</span>
                    <span className="font-mono text-blue-600">{postedByFuel.HSD.toFixed(3)} L</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">PMG Meter:</span>
                    <span className="font-mono">{fuelTotals.PMG.toFixed(3)} L</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">PMG Posted:</span>
                    <span className="font-mono text-blue-600">{postedByFuel.PMG.toFixed(3)} L</span>
                  </div>
                  <div className="flex justify-between font-semibold pt-1 border-t">
                    <span>Total Liters:</span>
                    <span className="font-mono text-blue-600">{transactionTotals.liters.toFixed(3)} L</span>
                  </div>
                </div>
              </div>

              {/* Transaction Totals */}
              <div className="pt-2 border-t">
                <div className="font-semibold mb-2">Transaction Totals</div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount:</span>
                    <span className="font-mono font-semibold">{transactionTotals.amount.toFixed(2)} PKR</span>
                  </div>
                </div>
              </div>

              {/* Payment Breakdown */}
              <div className="pt-2 border-t">
                <div className="font-semibold mb-2">Payment Breakdown</div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Posted Cash:</span>
                    <span className="font-mono">{postedCashAmount.toFixed(2)} PKR</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Credit Card:</span>
                    <span className="font-mono">{transactionTotals.creditCard.toFixed(2)} PKR</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bank Card:</span>
                    <span className="font-mono">{transactionTotals.bankCard.toFixed(2)} PKR</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">PSO Card:</span>
                    <span className="font-mono">{transactionTotals.psoCard.toFixed(2)} PKR</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Credit Customer:</span>
                    <span className="font-mono">{transactionTotals.creditCustomer.toFixed(2)} PKR</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t">
                    <span className="text-muted-foreground">Back-traced Cash:</span>
                    <span className="font-mono font-semibold">{backTracedCashAmount.toFixed(2)} PKR</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cash Gap:</span>
                    <span className={`font-mono font-semibold ${Math.abs(cashGapAmount) < 0.01 ? 'text-green-600' : 'text-orange-600'}`}>
                      {cashGapAmount > 0 ? '+' : ''}{cashGapAmount.toFixed(2)} PKR
                    </span>
                  </div>
                </div>
              </div>

              {/* Variance */}
              <div className="pt-2 border-t">
                <div className="font-semibold mb-2">Variance</div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Liters:</span>
                    <span className={`font-mono font-semibold ${varianceLiters > 0 ? 'text-orange-600' : varianceLiters < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {varianceLiters > 0 ? '+' : ''}{varianceLiters.toFixed(3)} L
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount (est):</span>
                    <span className={`font-mono font-semibold ${varianceAmount > 0 ? 'text-orange-600' : varianceAmount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {varianceAmount > 0 ? '+' : ''}{varianceAmount.toFixed(2)} PKR
                    </span>
                  </div>
                </div>
              </div>

              {/* Status */}
              {transactions.length > 0 && Math.abs(varianceLiters) < 1 && Math.abs(cashGapAmount) < 0.01 && (
                <div className="pt-2 border-t">
                  <Badge variant="outline" className="w-full justify-center text-green-600 border-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Balanced
                  </Badge>
                </div>
              )}

              {(Math.abs(varianceLiters) >= 1 || Math.abs(cashGapAmount) >= 0.01) && transactions.length > 0 && (
                <div className="pt-2 border-t">
                  <Badge variant="outline" className="w-full justify-center text-orange-600 border-orange-600">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Reconciliation Pending
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
