import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Calendar, DollarSign, AlertCircle, Plus, Trash2, Save, CheckCircle } from 'lucide-react';
import { apiClient } from '@/api/client';
import { branchesApi, customersApi, meterReadingsApi } from '@/api';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Transaction {
  id?: string;
  customerId?: string;
  customerName?: string;
  vehicleNumber?: string;
  slipNumber?: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  paymentMethod: 'cash' | 'credit_card' | 'bank_card' | 'pso_card' | 'credit_customer';
}

interface BackdatedEntryResponse {
  id: string;
  shiftId?: string | null;
  openingReading: number | string;
  closingReading: number | string;
  notes?: string | null;
  transactions?: Array<{
    id: string;
    customerId?: string | null;
    customer?: { name?: string | null } | null;
    vehicleNumber?: string | null;
    slipNumber?: string | null;
    productName?: string | null;
    quantity: number | string;
    unitPrice: number | string;
    lineTotal: number | string;
    paymentMethod: Transaction['paymentMethod'];
  }>;
}

interface MeterReadingRow {
  id: string;
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
  const [selectedNozzleId, setSelectedNozzleId] = useState('');
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [openingReading, setOpeningReading] = useState('');
  const [closingReading, setClosingReading] = useState('');
  const [notes, setNotes] = useState('');

  // Transaction fields
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [currentEntryId, setCurrentEntryId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState('');

  const queryClient = useQueryClient();

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

  // Fetch existing backdated entry for selected day/nozzle/(optional)shift
  const { data: existingEntriesData } = useQuery({
    queryKey: ['backdated-entries', selectedBranchId, selectedNozzleId, businessDate, selectedShiftId],
    enabled: !!selectedBranchId && !!selectedNozzleId && !!businessDate,
    queryFn: async () => {
      const res = await apiClient.get('/api/backdated-entries', {
        params: {
          branchId: selectedBranchId,
          nozzleId: selectedNozzleId,
          businessDateFrom: businessDate,
          businessDateTo: businessDate,
          shiftId: selectedShiftId || undefined,
        },
      });
      return (res.data?.data || []) as BackdatedEntryResponse[];
    },
  });

  // Fetch meter readings for selected day/nozzle/(optional)shift for deterministic prefill
  const { data: meterReadingsData } = useQuery({
    queryKey: ['meter-readings', selectedNozzleId, selectedShiftId, businessDate],
    enabled: !!selectedNozzleId && !!businessDate,
    queryFn: async () => {
      const res = await meterReadingsApi.getAll({
        size: 300,
        nozzle_id: selectedNozzleId,
        shift_id: selectedShiftId || undefined,
        date: businessDate,
      });
      return (res.items || []) as MeterReadingRow[];
    },
  });

  // Get selected nozzle details
  const selectedNozzle = nozzlesData?.find((n: any) => n.id === selectedNozzleId);
  const fuelTypeId = selectedNozzle?.fuelTypeId;

  // Auto-fill unit price when nozzle selected (mock - replace with API call)
  const defaultUnitPrice = selectedNozzle?.fuelType?.code === 'HSD' ? '287.33' : '290.50';

  // Calculate meter variance
  const meterLiters = closingReading && openingReading
    ? toNumber(closingReading) - toNumber(openingReading)
    : 0;

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

  const varianceLiters = meterLiters - transactionTotals.liters;
  const varianceAmount = varianceLiters * toNumber(defaultUnitPrice);
  const meterSalesAmount = meterLiters * toNumber(defaultUnitPrice);
  const knownNonCashAmount =
    transactionTotals.creditCard +
    transactionTotals.bankCard +
    transactionTotals.psoCard +
    transactionTotals.creditCustomer;
  // Reconciliation formula: expected cash is derived after posting all known non-cash methods.
  const backTracedCashAmount = meterSalesAmount - knownNonCashAmount;
  const postedCashAmount = transactionTotals.cash;
  const cashGapAmount = backTracedCashAmount - postedCashAmount;

  const mappedShiftOptions = useMemo(
    () =>
      (shiftInstancesData || []).map((instance) => ({
        id: instance.id,
        label: instance.shift?.name || `Shift ${instance.shift?.shiftNumber || ''}`.trim(),
      })),
    [shiftInstancesData]
  );

  useEffect(() => {
    if (!selectedBranchId || !selectedNozzleId || !businessDate) {
      setCurrentEntryId(null);
      setOpeningReading('');
      setClosingReading('');
      setNotes('');
      setTransactions([]);
      setSyncMessage('');
      return;
    }

    const matchedEntry = (existingEntriesData || []).find((entry) => {
      if (selectedShiftId) return entry.shiftId === selectedShiftId;
      return true;
    });

    if (matchedEntry) {
      setCurrentEntryId(matchedEntry.id);
      setOpeningReading(toNumber(matchedEntry.openingReading).toString());
      setClosingReading(toNumber(matchedEntry.closingReading).toString());
      setNotes(matchedEntry.notes || '');
      setTransactions(
        (matchedEntry.transactions || []).map((txn) => ({
          id: txn.id,
          customerId: txn.customerId || '',
          customerName: txn.customer?.name || '',
          vehicleNumber: txn.vehicleNumber || '',
          slipNumber: txn.slipNumber || '',
          productName: txn.productName || 'Fuel',
          quantity: toNumber(txn.quantity).toString(),
          unitPrice: toNumber(txn.unitPrice).toFixed(2),
          lineTotal: toNumber(txn.lineTotal).toFixed(2),
          paymentMethod: txn.paymentMethod,
        }))
      );
      setSyncMessage('Loaded existing backdated entry for selected context.');
      return;
    }

    const readings = (meterReadingsData || []).filter((reading) => {
      if (selectedShiftId && reading.shift_id !== selectedShiftId) return false;
      return true;
    });

    if (readings.length > 0) {
      const ordered = [...readings].sort((a, b) => {
        const aTs = new Date(a.recorded_at || a.created_at || 0).getTime();
        const bTs = new Date(b.recorded_at || b.created_at || 0).getTime();
        return aTs - bTs;
      });

      const opening = ordered.find((reading) => reading.reading_type === 'opening');
      const closing = [...ordered].reverse().find((reading) => reading.reading_type === 'closing');

      setCurrentEntryId(null);
      setOpeningReading(opening ? toNumber(opening.meter_value ?? opening.reading_value).toString() : '');
      setClosingReading(closing ? toNumber(closing.meter_value ?? closing.reading_value).toString() : '');
      setNotes('');
      setTransactions([]);
      setSyncMessage('Prefilled meter readings from recorded shift/day data.');
      return;
    }

    setCurrentEntryId(null);
    setOpeningReading('');
    setClosingReading('');
    setNotes('');
    setTransactions([]);
    setSyncMessage('No existing backdated entry or meter readings found for this selection.');
  }, [
    selectedBranchId,
    selectedNozzleId,
    businessDate,
    selectedShiftId,
    existingEntriesData,
    meterReadingsData,
  ]);

  // Add transaction row
  const addTransaction = () => {
    setTransactions([
      ...transactions,
      {
        productName: selectedNozzle?.fuelType?.name || 'Fuel',
        quantity: '',
        unitPrice: defaultUnitPrice,
        lineTotal: '0',
        paymentMethod: 'cash',
      },
    ]);
  };

  // Remove transaction row
  const removeTransaction = (index: number) => {
    setTransactions(transactions.filter((_, i) => i !== index));
  };

  // Update transaction field
  const updateTransaction = (index: number, field: keyof Transaction, value: any) => {
    const updated = [...transactions];
    updated[index] = { ...updated[index], [field]: value };

    // Auto-calculate line total when quantity or unit price changes
    if (field === 'quantity' || field === 'unitPrice') {
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

  // Duplicate last row
  const duplicateLastRow = () => {
    if (transactions.length > 0) {
      const lastRow = transactions[transactions.length - 1];
      setTransactions([
        ...transactions,
        {
          ...lastRow,
          id: undefined,
          quantity: '',
          lineTotal: '0',
        },
      ]);
    }
  };

  // Create backdated entry mutation
  const createEntryMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBranchId || !selectedNozzleId || !openingReading || !closingReading) {
        throw new Error('Please fill in all required entry fields');
      }

      if (openingReading.trim().length < 7 || closingReading.trim().length < 7) {
        throw new Error('Meter readings must be at least 7 digits');
      }

      if (toNumber(closingReading) < toNumber(openingReading)) {
        throw new Error('Closing reading must be greater than or equal to opening reading');
      }

      const res = await apiClient.post('/api/backdated-entries', {
        branchId: selectedBranchId,
        businessDate,
        nozzleId: selectedNozzleId,
        shiftId: selectedShiftId || undefined,
        openingReading: toNumber(openingReading),
        closingReading: toNumber(closingReading),
        notes,
      });

      return res.data.data;
    },
    onSuccess: (data) => {
      setCurrentEntryId(data.id);
      toast.success('Backdated entry created - now add transactions');
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error.message || 'Failed to create entry';
      toast.error(errorMsg);
    },
  });

  // Create transaction mutation
  const createTransactionMutation = useMutation({
    mutationFn: async ({ entryId, transaction }: { entryId: string; transaction: Transaction }) => {
      if (!entryId) {
        throw new Error('Create entry first');
      }

      // Validate credit customer requirements
      if (transaction.paymentMethod === 'credit_customer') {
        if (!transaction.customerId || !transaction.vehicleNumber || !transaction.slipNumber) {
          throw new Error('Credit customer requires customer, vehicle, and slip number');
        }
      }

      const res = await apiClient.post(`/api/backdated-entries/${entryId}/transactions`, {
        customerId: transaction.customerId || undefined,
        vehicleNumber: transaction.vehicleNumber || undefined,
        slipNumber: transaction.slipNumber || undefined,
        fuelTypeId: fuelTypeId || undefined,
        productName: transaction.productName,
        quantity: toNumber(transaction.quantity),
        unitPrice: toNumber(transaction.unitPrice),
        lineTotal: toNumber(transaction.lineTotal),
        paymentMethod: transaction.paymentMethod,
        transactionDateTime: `${businessDate}T12:00:00+05:00`,
      });

      return res.data.data;
    },
    onSuccess: () => {
      toast.success('Transaction added');
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error.message || 'Failed to create transaction';
      toast.error(errorMsg);
    },
  });

  // Save all transactions
  const handleSaveAll = async () => {
    let entryId = currentEntryId;
    if (!entryId) {
      const createdEntry = await createEntryMutation.mutateAsync();
      entryId = createdEntry.id;
      setCurrentEntryId(entryId);
    }

    if (!entryId) return;

    for (const txn of transactions) {
      if (!txn.id && toNumber(txn.quantity) > 0) {
        await createTransactionMutation.mutateAsync({ entryId, transaction: txn });
      }
    }

    toast.success('All transactions saved');
    queryClient.invalidateQueries({ queryKey: ['backdated-entries'] });
  };

  const resetForm = () => {
    setBusinessDate(format(new Date(), 'yyyy-MM-dd'));
    setSelectedBranchId('');
    setSelectedNozzleId('');
    setSelectedShiftId('');
    setOpeningReading('');
    setClosingReading('');
    setNotes('');
    setTransactions([]);
    setCurrentEntryId(null);
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
          <strong>Transaction-First Approach:</strong> Create daily entry (meter readings), then add individual customer transactions. Credit customers require vehicle# and slip#.
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
                Daily Entry (Meter Readings)
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
                  <Label>Nozzle *</Label>
                  <Select value={selectedNozzleId} onValueChange={setSelectedNozzleId} disabled={!selectedBranchId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select nozzle" />
                    </SelectTrigger>
                    <SelectContent>
                      {nozzlesData?.map((nozzle: any) => (
                        <SelectItem key={nozzle.id} value={nozzle.id}>
                          {nozzle.name || `Nozzle ${nozzle.nozzleNumber}`} - {nozzle.fuelType?.code || 'Unknown'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

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

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Opening Reading *</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={openingReading}
                    onChange={(e) => setOpeningReading(e.target.value)}
                    placeholder="1234567"
                    className="font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Closing Reading *</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={closingReading}
                    onChange={(e) => setClosingReading(e.target.value)}
                    placeholder="1235000"
                    className="font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Meter Liters</Label>
                  <Input
                    value={meterLiters.toFixed(3)}
                    readOnly
                    className="bg-blue-50 font-semibold text-blue-700 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes"
                />
              </div>
            </CardContent>
          </Card>

          {/* Transactions Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Transactions ({transactions.length})
                </CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={duplicateLastRow} disabled={transactions.length === 0}>
                    Duplicate Last
                  </Button>
                  <Button size="sm" onClick={addTransaction}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Transaction
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <DollarSign className="mx-auto h-12 w-12 mb-3 opacity-30" />
                  <p>No transactions yet</p>
                  <p className="text-sm">Click "+ Add Transaction" to start</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[150px]">Customer</TableHead>
                        <TableHead className="w-[100px]">Vehicle#</TableHead>
                        <TableHead className="w-[80px]">Slip#</TableHead>
                        <TableHead className="w-[120px]">Product</TableHead>
                        <TableHead className="w-[100px]">Qty (L)</TableHead>
                        <TableHead className="w-[100px]">Price (PKR/L)</TableHead>
                        <TableHead className="w-[120px]">Total (PKR)</TableHead>
                        <TableHead className="w-[140px]">Payment</TableHead>
                        <TableHead className="w-[60px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.map((txn, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <Select
                              value={txn.customerId || '__walkin__'}
                              onValueChange={(value) => updateTransaction(index, 'customerId', value === '__walkin__' ? '' : value)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Walk-in" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__walkin__">Walk-in (Cash)</SelectItem>
                                {customersData?.map((customer: any) => (
                                  <SelectItem key={customer.id} value={customer.id}>
                                    {customer.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>

                          <TableCell>
                            <Input
                              className="h-8 text-xs font-mono"
                              value={txn.vehicleNumber || ''}
                              onChange={(e) => updateTransaction(index, 'vehicleNumber', e.target.value)}
                              placeholder="ABC-123"
                            />
                          </TableCell>

                          <TableCell>
                            <Input
                              className="h-8 text-xs font-mono"
                              value={txn.slipNumber || ''}
                              onChange={(e) => updateTransaction(index, 'slipNumber', e.target.value)}
                              placeholder="SLP-001"
                            />
                          </TableCell>

                          <TableCell>
                            <Input
                              className="h-8 text-xs"
                              value={txn.productName}
                              onChange={(e) => updateTransaction(index, 'productName', e.target.value)}
                              readOnly
                            />
                          </TableCell>

                          <TableCell>
                            <Input
                              className="h-8 text-xs font-mono text-right"
                              type="number"
                              step="0.001"
                              value={txn.quantity}
                              onChange={(e) => updateTransaction(index, 'quantity', e.target.value)}
                              placeholder="0.000"
                            />
                          </TableCell>

                          <TableCell>
                            <Input
                              className="h-8 text-xs font-mono text-right"
                              type="number"
                              step="0.01"
                              value={txn.unitPrice}
                              onChange={(e) => updateTransaction(index, 'unitPrice', e.target.value)}
                            />
                          </TableCell>

                          <TableCell>
                            <Input
                              className="h-8 text-xs font-mono text-right font-semibold"
                              value={txn.lineTotal}
                              readOnly
                            />
                          </TableCell>

                          <TableCell>
                            <Select
                              value={txn.paymentMethod}
                              onValueChange={(value: any) => updateTransaction(index, 'paymentMethod', value)}
                            >
                              <SelectTrigger className="h-8 text-xs">
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

                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeTransaction(index)}
                              className="h-8 w-8 p-0"
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {transactions.length > 0 && (
                <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
                  <Button variant="outline" onClick={resetForm}>
                    Cancel
                  </Button>
                  <Button onClick={handleSaveAll} disabled={createEntryMutation.isPending || createTransactionMutation.isPending}>
                    <Save className="h-4 w-4 mr-2" />
                    {currentEntryId ? 'Save Transactions' : 'Create Entry & Save Transactions'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Reconciliation Panel */}
        <div className="space-y-6">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="text-base">Reconciliation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {/* Meter Readings */}
              <div>
                <div className="font-semibold mb-2">Meter Readings</div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Opening:</span>
                    <span className="font-mono">{openingReading || '-'} L</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Closing:</span>
                    <span className="font-mono">{closingReading || '-'} L</span>
                  </div>
                  <div className="flex justify-between font-semibold pt-1 border-t">
                    <span>Liters:</span>
                    <span className="font-mono text-blue-600">{meterLiters.toFixed(3)} L</span>
                  </div>
                </div>
              </div>

              {/* Transaction Totals */}
              <div className="pt-2 border-t">
                <div className="font-semibold mb-2">Transaction Totals</div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Liters:</span>
                    <span className="font-mono">{transactionTotals.liters.toFixed(3)} L</span>
                  </div>
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
                    <span className="text-muted-foreground">Amount:</span>
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
