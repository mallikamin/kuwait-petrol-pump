import { useEffect, useMemo, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  CalendarClock, Save, CheckCircle, Plus, Trash2, Copy, Search,
  Loader2, ChevronDown, ChevronUp, RefreshCw, AlertCircle, Users,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { apiClient } from '@/api/client';
import { branchesApi, customersApi, meterReadingsApi, productsApi } from '@/api';
import { banksApi } from '@/api/banks';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MeterReadingCapture, type MeterReadingData } from '@/components/MeterReadingCapture';

// ── Types (local, matches API contract) ─────────────────────────────────────
interface Transaction {
  id?: string;
  nozzleId?: string;
  customerId?: string;
  customerName?: string;
  fuelCode: 'HSD' | 'PMG' | 'OTHER' | '';
  vehicleNumber?: string;
  slipNumber?: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  paymentMethod: 'cash' | 'credit_card' | 'bank_card' | 'pso_card' | 'credit_customer';
  bankId?: string;
  _localStatus?: 'draft' | 'saved';
  createdBy?: string;
  createdByUser?: { id: string; fullName: string; username: string } | null;
  updatedBy?: string;
  updatedByUser?: { id: string; fullName: string; username: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

// ── Utilities ────────────────────────────────────────────────────────────────
const toNumber = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const p = parseFloat(v); return Number.isFinite(p) ? p : 0; }
  return 0;
};
const fmtL = (n: number) => { if (n === 0) return '0'; return (Math.round(n * 1000) / 1000).toFixed(3).replace(/\.?0+$/, ''); };
const fmtPKR = (n: number) => n.toLocaleString('en-PK', { maximumFractionDigits: 0 });


// ── Component ────────────────────────────────────────────────────────────────
export function BackdatedEntries2() {
  const queryClient = useQueryClient();

  // ── Context state ──────────────────────────────────────────────────────────
  const [businessDate, setBusinessDate] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get('date') || format(new Date(), 'yyyy-MM-dd');
  });
  const [selectedBranchId, setSelectedBranchId] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get('branchId') || '';
  });

  // ── Transaction state ──────────────────────────────────────────────────────
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [deletedTransactionIds, setDeletedTransactionIds] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [syncMessage, setSyncMessage] = useState('');
  const justSavedRef = useRef(false);
  const hydratingRef = useRef(false);
  const initializedRef = useRef(false);
  const setLoadedKey = (k: string) => sessionStorage.setItem('backdated2_loaded_key', k);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(null);
  const [meterExpanded, setMeterExpanded] = useState(false);
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '' });
  const [isSubmittingCustomer, setIsSubmittingCustomer] = useState(false);

  // Meter reading dialog
  const [meterDialogOpen, setMeterDialogOpen] = useState(false);
  const [selectedMeterNozzle, setSelectedMeterNozzle] = useState<any>(null);
  const [selectedReadingType, setSelectedReadingType] = useState<'opening' | 'closing'>('opening');
  const [editingReadingId, setEditingReadingId] = useState<string | null>(null);
  const [modalPreviousReading, setModalPreviousReading] = useState<number | null>(null);
  const [selectedShiftId, setSelectedShiftId] = useState('');

  // Finalize dialog
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);
  const [finalizeResult, setFinalizeResult] = useState<any>(null);

  // ── URL sync ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (businessDate) params.set('date', businessDate);
    if (selectedBranchId) params.set('branchId', selectedBranchId);
    else params.delete('branchId');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
    window.history.replaceState({}, '', next);
  }, [businessDate, selectedBranchId]);

  // ── Cache invalidation on context change ───────────────────────────────────
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['backdated-entries-daily'] });
  }, [businessDate, selectedBranchId, queryClient]);

  // ── Queries (same keys as BackdatedEntries → shared cache) ─────────────────
  const { data: branchesData } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await branchesApi.getAll()).items,
  });

  // Nozzle query (shared cache key with BackdatedEntries, data used by meter reading dialogs)
  useQuery({
    queryKey: ['branches', selectedBranchId, 'nozzles'],
    queryFn: async () => {
      if (!selectedBranchId) return [];
      const branches = await branchesApi.getAll();
      const branch = branches.items.find((b: any) => b.id === selectedBranchId);
      return branch && (branch as any).dispensingUnits
        ? (branch as any).dispensingUnits.flatMap((u: any) => u.nozzles || [])
        : [];
    },
    enabled: !!selectedBranchId,
  });

  const { data: customersData, refetch: refetchCustomers } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => (await customersApi.getAll()).items,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: async () => (await productsApi.getAll({ size: 1000 })).items,
  });

  const { data: banksData } = useQuery({
    queryKey: ['quickbooks', 'banks'],
    queryFn: async () => (await banksApi.getAll()).banks,
  });

  const { data: fuelPricesData } = useQuery({
    queryKey: ['fuel-prices', 'for-date', businessDate],
    enabled: !!businessDate,
    queryFn: async () => {
      if (!businessDate) return [];
      return (await apiClient.get('/api/fuel-prices/for-date', { params: { date: businessDate } })).data || [];
    },
  });

  // Shift queries (shared cache keys with BackdatedEntries)
  useQuery({
    queryKey: ['shift-templates', selectedBranchId],
    enabled: !!selectedBranchId,
    queryFn: async () => {
      const res = await apiClient.get('/api/shifts', { params: { branchId: selectedBranchId } });
      return (res.data?.items || []) as Array<{ id: string; name: string; shiftNumber: number; startTime: string; endTime: string }>;
    },
  });

  useQuery({
    queryKey: ['shift-instances-for-date', selectedBranchId, businessDate],
    enabled: !!selectedBranchId && !!businessDate,
    queryFn: async () => {
      const res = await apiClient.get('/api/shifts/instances-for-date', {
        params: { branchId: selectedBranchId, businessDate },
      });
      return (res.data?.shiftInstances || []) as Array<{
        id: string; shiftId: string; date: string;
        shift?: { name?: string; shiftNumber?: number; startTime?: string; endTime?: string };
      }>;
    },
  });

  const { data: dailySummaryData, refetch: refetchDailySummary, isLoading: isDailySummaryLoading } = useQuery({
    queryKey: ['backdated-entries-daily', selectedBranchId, businessDate],
    enabled: !!selectedBranchId && !!businessDate,
    staleTime: 0,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
    retry: 1,
    queryFn: async () => {
      const res = await apiClient.get('/api/backdated-entries/daily', {
        params: { branchId: selectedBranchId, businessDate },
      });
      return res.data?.data;
    },
  });

  const { data: backdatedMeterReadingsData, refetch: refetchMeterReadings, isError: backdatedReadingsError } = useQuery({
    queryKey: ['backdated-meter-readings-daily', selectedBranchId, businessDate],
    enabled: !!selectedBranchId && !!businessDate,
    refetchInterval: 15000,
    queryFn: async () => {
      if (!selectedBranchId || !businessDate) return null;
      return await meterReadingsApi.getDailyBackdatedReadings({ branchId: selectedBranchId, businessDate });
    },
  });

  // ── Computed ───────────────────────────────────────────────────────────────
  const customerGroups = useMemo(() => {
    const grouped = new Map<string, { indices: number[]; txns: Transaction[] }>();
    transactions.forEach((txn, idx) => {
      const key = txn.customerId || '__walkin__';
      if (!grouped.has(key)) grouped.set(key, { indices: [], txns: [] });
      grouped.get(key)!.indices.push(idx);
      grouped.get(key)!.txns.push(txn);
    });
    return Array.from(grouped.entries())
      .map(([customerId, { indices, txns }]) => ({
        customerId,
        customerName: customerId === '__walkin__' ? 'Walk-in Sales' : (txns[0].customerName || 'Unknown'),
        indices,
        transactions: txns,
        totalLiters: txns.reduce((s, t) => s + toNumber(t.quantity), 0),
        totalAmount: txns.reduce((s, t) => s + toNumber(t.lineTotal), 0),
        firstIndex: indices[0],
      }))
      .sort((a, b) => b.firstIndex - a.firstIndex);
  }, [transactions]);

  const nonFuelProductOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; unitPrice?: number; isLegacy?: boolean }>();
    (productsData || []).forEach((p: any) => {
      if (!p?.name) return;
      map.set(p.name, { id: p.id || p.name, name: p.name, unitPrice: p.unitPrice, isLegacy: false });
    });
    transactions.forEach((t) => {
      if (t.fuelCode !== 'OTHER') return;
      const name = (t.productName || '').trim();
      if (!name || map.has(name)) return;
      map.set(name, { id: `legacy-${name}`, name, isLegacy: true });
    });
    return Array.from(map.values());
  }, [productsData, transactions]);

  // HSD/PMG from dailySummary
  const hsd = dailySummaryData?.meterTotals?.hsdLiters || 0;
  const hsdPosted = dailySummaryData?.postedTotals?.hsdLiters || 0;
  const hsdRemain = dailySummaryData?.remainingLiters?.hsd || 0;
  const pmg = dailySummaryData?.meterTotals?.pmgLiters || 0;
  const pmgPosted = dailySummaryData?.postedTotals?.pmgLiters || 0;
  const pmgRemain = dailySummaryData?.remainingLiters?.pmg || 0;
  const hsdPct = hsd > 0 ? Math.round((hsdPosted / hsd) * 100) : 0;
  const pmgPct = pmg > 0 ? Math.round((pmgPosted / pmg) * 100) : 0;

  // Payment breakdown from transactions
  const paymentBreakdown = useMemo(() => {
    const bd = { cash: 0, credit_card: 0, bank_card: 0, pso_card: 0, credit_customer: 0 };
    transactions.forEach(t => { bd[t.paymentMethod] = (bd[t.paymentMethod] || 0) + toNumber(t.lineTotal); });
    return bd;
  }, [transactions]);
  const totalPKR = useMemo(() => transactions.reduce((s, t) => s + toNumber(t.lineTotal), 0), [transactions]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customersData || [];
    const q = customerSearch.toLowerCase();
    return (customersData || []).filter((c: any) =>
      c.name?.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)
    );
  }, [customersData, customerSearch]);

  // ── Hydration from API ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedBranchId || !businessDate || isDailySummaryLoading) return;
    const currentKey = `${selectedBranchId}_${businessDate}_all`;
    const loadedKey = sessionStorage.getItem('backdated2_loaded_key');
    if (justSavedRef.current) { justSavedRef.current = false; return; }
    if (isDirty && loadedKey === currentKey) return;

    if (dailySummaryData?.transactions?.length > 0) {
      const hydrated = dailySummaryData.transactions.map((txn: any): Transaction => ({
        id: txn.id,
        nozzleId: txn.nozzle?.id || '',
        customerId: txn.customer?.id || '',
        customerName: txn.customer?.name || '',
        fuelCode: (txn.fuelCode || '') as any,
        vehicleNumber: txn.vehicleNumber || '',
        slipNumber: txn.slipNumber || '',
        productName: txn.productName || '',
        quantity: toNumber(txn.quantity).toString(),
        unitPrice: toNumber(txn.unitPrice).toFixed(2),
        lineTotal: toNumber(txn.lineTotal).toFixed(2),
        paymentMethod: txn.paymentMethod,
        bankId: txn.bankId || '',
        createdBy: txn.createdBy,
        createdByUser: txn.createdByUser,
        updatedBy: txn.updatedBy,
        updatedByUser: txn.updatedByUser,
        createdAt: txn.createdAt,
        updatedAt: txn.updatedAt,
      }));
      hydratingRef.current = true;
      setTransactions(hydrated);
      setSyncMessage(`Loaded ${hydrated.length} transactions.`);
      setLoadedKey(currentKey);
    } else {
      hydratingRef.current = true;
      setTransactions([]);
      setSyncMessage('No existing transactions.');
      setLoadedKey(currentKey);
    }
  }, [selectedBranchId, businessDate, dailySummaryData, isDailySummaryLoading]);

  // Dirty tracking
  useEffect(() => {
    if (!initializedRef.current) { initializedRef.current = true; return; }
    if (hydratingRef.current) { hydratingRef.current = false; return; }
    setIsDirty(true);
  }, [transactions]);

  // Auto-save (2 min)
  useEffect(() => {
    if (!isDirty || (transactions.length === 0 && deletedTransactionIds.length === 0) || !selectedBranchId || isDailySummaryLoading) return;
    const t = setTimeout(async () => {
      try { await saveDraftMut.mutateAsync(undefined); } catch {}
    }, 120000);
    return () => clearTimeout(t);
  }, [isDirty, transactions, deletedTransactionIds, selectedBranchId, isDailySummaryLoading]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const getCreditValidationError = (txn: Transaction): string | null => {
    if (txn.paymentMethod !== 'credit_customer') return null;
    if (!txn.customerId?.trim() || !txn.vehicleNumber?.trim() || !txn.slipNumber?.trim())
      return `Credit customer requires customer, vehicle#, and slip# (row with ${txn.quantity}L)`;
    return null;
  };

  const saveDraftMut = useMutation({
    mutationFn: async (override?: { transactions?: Transaction[]; deletedTransactionIds?: string[]; partialSave?: boolean }) => {
      const txns = override?.transactions ?? transactions;
      const dels = override?.deletedTransactionIds ?? deletedTransactionIds;
      const partial = override?.partialSave ?? false;
      if (!selectedBranchId) throw new Error('Please select a branch');
      if (txns.length === 0 && dels.length === 0) throw new Error('No transactions to save');
      for (const t of txns) { const e = getCreditValidationError(t); if (e) throw new Error(e); }
      const payload = txns.map(t => ({
        id: t.id || undefined, nozzleId: t.nozzleId || undefined, customerId: t.customerId || undefined,
        fuelCode: t.fuelCode || undefined, vehicleNumber: t.vehicleNumber?.trim() || undefined,
        slipNumber: t.slipNumber?.trim() || undefined, productName: t.productName,
        quantity: toNumber(t.quantity), unitPrice: toNumber(t.unitPrice), lineTotal: toNumber(t.lineTotal),
        paymentMethod: t.paymentMethod, bankId: t.bankId || undefined,
      }));
      const res = await apiClient.post('/api/backdated-entries/daily', {
        branchId: selectedBranchId, businessDate, partialSave: partial,
        transactions: payload, deletedTransactionIds: dels,
      });
      return res.data.data;
    },
    onSuccess: () => {
      toast.success('Draft saved');
      setLastSaved(new Date());
      setIsDirty(false);
      justSavedRef.current = true;
      setLoadedKey('');
      setDeletedTransactionIds([]);
      refetchDailySummary();
    },
    onError: (err: any) => {
      const isNetwork = !err?.response && (err.message?.includes('ERR_') || err.message?.includes('Network Error'));
      toast.error(isNetwork ? 'Network error - draft kept locally' : `Save failed: ${err?.response?.data?.error || err.message}`);
    },
  });

  const finalizeMut = useMutation({
    mutationFn: async () => {
      if (!selectedBranchId) throw new Error('Please select a branch');
      const res = await apiClient.post('/api/backdated-entries/daily/finalize', { branchId: selectedBranchId, businessDate });
      return res.data.data;
    },
    onSuccess: (data: any) => {
      setIsDirty(false);
      setFinalizeResult({
        type: 'success', message: data?.message || 'Finalized!', alreadyFinalized: data?.alreadyFinalized,
        salesCreated: data?.postedSalesCount || data?.details?.salesCreated || 0,
        transactionsProcessed: data?.details?.transactionsProcessed || 0,
        paymentBreakdown: data?.paymentBreakdown || null,
        cashGapWarning: data?.cashGapWarning,
      });
      setFinalizeDialogOpen(true);
      queryClient.invalidateQueries({ predicate: (q) => { const k = q.queryKey?.[0]; return k === 'sales' || k === 'sales-summary'; } });
      refetchDailySummary();
    },
    onError: (err: any) => {
      const payload = err?.response?.data;
      let blockers: Array<{ message: string }> = [];
      if (Array.isArray(payload?.details) && payload.details.length > 0)
        blockers = payload.details.map((d: any) => ({ message: d?.message || 'Unknown blocker' }));
      setFinalizeResult({ type: 'error', message: payload?.error || 'Failed to finalize', blockers: blockers.length > 0 ? blockers : undefined, metrics: payload?.metrics });
      setFinalizeDialogOpen(true);
    },
  });

  const saveMeterMut = useMutation({
    mutationFn: async (p: { nozzleId: string; shiftId: string; readingType: string; meterValue: number; imageUrl?: string; ocrConfidence?: number; attachmentUrl?: string; ocrManuallyEdited?: boolean }) => {
      const res = await apiClient.post('/api/backdated-meter-readings/daily', {
        branchId: selectedBranchId, businessDate, ...p,
      });
      return res.data;
    },
    onSuccess: () => { toast.success('Meter reading saved'); setMeterDialogOpen(false); refetchMeterReadings(); refetchDailySummary(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to save meter reading'),
  });

  const deleteMeterMut = useMutation({
    mutationFn: async (id: string) => {
      if (!id || id.length < 10) throw new Error('Invalid reading ID');
      return (await apiClient.delete(`/api/backdated-meter-readings/daily/${id}`)).data;
    },
    onSuccess: () => { toast.success('Meter reading deleted'); refetchMeterReadings(); refetchDailySummary(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to delete'),
  });

  const updateMeterMut = useMutation({
    mutationFn: async (p: { readingId: string; meterValue: number; attachmentUrl?: string; ocrManuallyEdited?: boolean }) => {
      if (!p.readingId || p.readingId.length < 10) throw new Error('Invalid reading ID');
      return (await apiClient.patch(`/api/backdated-meter-readings/daily/${p.readingId}`, {
        meterValue: p.meterValue, attachmentUrl: p.attachmentUrl, ocrManuallyEdited: p.ocrManuallyEdited,
      })).data;
    },
    onSuccess: () => { toast.success('Meter reading updated'); setMeterDialogOpen(false); refetchMeterReadings(); refetchDailySummary(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to update'),
  });

  // ── Handlers ───────────────────────────────────────────────────────────────
  const addTransactionToCustomer = (customerId: string, customerName: string) => {
    setTransactions(prev => [...prev, {
      id: crypto.randomUUID(), customerId: customerId === '__walkin__' ? '' : customerId,
      customerName: customerId === '__walkin__' ? '' : customerName,
      fuelCode: '' as const, productName: '', quantity: '', unitPrice: '', lineTotal: '0',
      paymentMethod: customerId === '__walkin__' ? 'cash' as const : 'credit_customer' as const,
      _localStatus: 'draft' as const,
    }]);
    setActiveCustomerId(customerId);
  };

  const duplicateLastInGroup = (groupIndices: number[]) => {
    if (groupIndices.length === 0) return;
    const last = transactions[groupIndices[groupIndices.length - 1]];
    setTransactions(prev => [...prev, { ...last, id: crypto.randomUUID(), quantity: '', lineTotal: '0', _localStatus: 'draft' as const }]);
  };

  const removeTransaction = (index: number) => {
    const txn = transactions[index];
    const nextTxns = transactions.filter((_, i) => i !== index);
    const nextDels = txn?.id ? (deletedTransactionIds.includes(txn.id) ? deletedTransactionIds : [...deletedTransactionIds, txn.id]) : deletedTransactionIds;
    setTransactions(nextTxns);
    setDeletedTransactionIds(nextDels);
    if (txn?.id && selectedBranchId) {
      saveDraftMut.mutate({ transactions: nextTxns, deletedTransactionIds: nextDels }, {
        onSuccess: () => toast.success('Deleted and synced'),
        onError: (e: any) => toast.error(e?.response?.data?.error || 'Sync failed'),
      });
    }
  };

  const updateTransaction = (index: number, field: keyof Transaction, value: any) => {
    setTransactions(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      // Nozzle-fuel consistency guard
      if (field === 'fuelCode' && updated[index].nozzleId) {
        const map = (dailySummaryData?.nozzleStatuses || []).reduce((m: any, ns: any) => { m[ns.nozzleId] = ns.fuelType; return m; }, {});
        if (map[updated[index].nozzleId] && map[updated[index].nozzleId] !== value) updated[index].nozzleId = '';
      }
      // Auto-fill product + price
      if (field === 'fuelCode') {
        const fp = (fuelPricesData || []).find((f: any) => f.fuelType?.code === value);
        if (value === 'HSD') { updated[index].productName = 'High Speed Diesel'; updated[index].unitPrice = fp?.pricePerLiter?.toString() || '340'; }
        else if (value === 'PMG') { updated[index].productName = 'Premium Motor Gasoline'; updated[index].unitPrice = fp?.pricePerLiter?.toString() || '458'; }
        else if (value === 'OTHER') { updated[index].productName = ''; updated[index].unitPrice = fp?.pricePerLiter?.toString() || '0.00'; }
      }
      // Auto-calc line total
      if (field === 'quantity' || field === 'unitPrice' || field === 'fuelCode') {
        updated[index].lineTotal = (toNumber(updated[index].quantity) * toNumber(updated[index].unitPrice)).toFixed(2);
      }
      // Auto-fill customer name
      if (field === 'customerId') {
        const c = customersData?.find((c: any) => c.id === value);
        if (c) updated[index].customerName = c.name;
      }
      return updated;
    });
  };

  const saveRow = async (index: number) => {
    const row = transactions[index];
    const err = getCreditValidationError(row);
    if (err) { toast.error(err); return; }
    const updated = [...transactions];
    updated[index] = { ...updated[index], _localStatus: 'saved' };
    setTransactions(updated);
    try {
      await saveDraftMut.mutateAsync({ transactions: [row], partialSave: true, deletedTransactionIds: [] });
    } catch (e: any) {
      updated[index]._localStatus = 'draft';
      setTransactions(updated);
    }
  };

  const handleFinalize = async () => {
    if (isDailySummaryLoading) { toast.error('Wait for data to load'); return; }
    if (!selectedBranchId) { toast.error('Select a branch'); return; }
    if (isDirty) { toast.error('Save draft first'); return; }
    if (transactions.length === 0) { toast.error('No transactions'); return; }
    try { await finalizeMut.mutateAsync(); } catch {}
  };

  const handleAddNewCustomer = async () => {
    if (!newCustomer.name.trim()) { toast.error('Name required'); return; }
    setIsSubmittingCustomer(true);
    try {
      const customer = await customersApi.create({
        name: newCustomer.name.trim(), phone: newCustomer.phone.trim() || undefined, email: newCustomer.email.trim() || undefined,
      });
      toast.success('Customer added');
      setAddCustomerOpen(false);
      setNewCustomer({ name: '', phone: '', email: '' });
      refetchCustomers();
      if (customer?.id && customer?.name) {
        setTimeout(() => { addTransactionToCustomer(customer.id, customer.name); setAddGroupOpen(false); }, 100);
      }
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Failed'); }
    finally { setIsSubmittingCustomer(false); }
  };

  const openMeterDialog = async (nozzle: any, type: 'opening' | 'closing', shift?: any, reading?: any) => {
    const norm = { ...nozzle, id: nozzle?.id || nozzle?.nozzleId, name: nozzle?.name || nozzle?.nozzleName,
      nozzleNumber: nozzle?.nozzleNumber || nozzle?.nozzleNo || nozzle?.nozzleCode,
      fuelType: nozzle?.fuelType || { name: nozzle?.fuelTypeName || 'Unknown' } };
    setSelectedMeterNozzle(norm);
    setSelectedReadingType(type);
    setEditingReadingId(reading ? reading.id : null);
    setSelectedShiftId(shift?.shiftId || '');
    const nozzleId = norm?.id;
    if (shift?.shiftId && nozzleId) {
      try {
        const prev = await meterReadingsApi.getModalPreviousReading({ branchId: selectedBranchId, businessDate, shiftId: shift.shiftId, nozzleId, readingType: type });
        setModalPreviousReading(prev?.value ?? null);
      } catch { setModalPreviousReading(null); }
    }
    setMeterDialogOpen(true);
  };

  const handleMeterCapture = async (data: MeterReadingData) => {
    if (!selectedMeterNozzle) { toast.error('No nozzle selected'); return; }
    const nozzleId = selectedMeterNozzle.nozzleId || selectedMeterNozzle.id;
    if (!nozzleId) { toast.error('Invalid nozzle'); return; }
    const meterValue = Number(data.currentReading);
    if (!Number.isFinite(meterValue) || meterValue < 0) { toast.error('Invalid value'); return; }
    try {
      if (editingReadingId) {
        await updateMeterMut.mutateAsync({ readingId: editingReadingId, meterValue, attachmentUrl: data.referenceAttachmentUrl, ocrManuallyEdited: data.isManualReading && data.ocrConfidence !== undefined });
      } else {
        await saveMeterMut.mutateAsync({ nozzleId, shiftId: selectedShiftId, readingType: selectedReadingType, meterValue, imageUrl: data.imageUrl, ocrConfidence: data.ocrConfidence, attachmentUrl: data.referenceAttachmentUrl, ocrManuallyEdited: data.isManualReading && data.ocrConfidence !== undefined });
      }
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Failed'); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* ── HEADER BAR ──────────────────────────────────────────────────── */}
      <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center gap-4 flex-shrink-0">
        <CalendarClock className="h-4 w-4 text-blue-300" />
        <span className="text-sm font-semibold">Backdated Entry Posting</span>
        <Badge variant="outline" className="text-amber-400 border-amber-500 text-[10px]">V2 WIP</Badge>
        <div className="flex items-center gap-2 ml-4">
          <Input type="date" value={businessDate} onChange={e => setBusinessDate(e.target.value)}
            max={format(new Date(), 'yyyy-MM-dd')} className="h-7 w-36 text-xs bg-slate-700 border-slate-600 text-white" />
          <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
            <SelectTrigger className="h-7 w-44 text-xs bg-slate-700 border-slate-600 text-white">
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              {(branchesData || []).map((b: any) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* HSD/PMG mini bars */}
          {selectedBranchId && businessDate && (
            <>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-blue-300">HSD</span>
                <div className="w-16 h-1.5 bg-slate-600 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400 transition-all" style={{ width: `${Math.min(hsdPct, 100)}%` }} />
                </div>
                <span className="font-mono">{hsdPct}%</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-green-300">PMG</span>
                <div className="w-16 h-1.5 bg-slate-600 rounded-full overflow-hidden">
                  <div className="h-full bg-green-400 transition-all" style={{ width: `${Math.min(pmgPct, 100)}%` }} />
                </div>
                <span className="font-mono">{pmgPct}%</span>
              </div>
            </>
          )}
          <div className="h-4 w-px bg-slate-600" />
          {syncMessage && <span className="text-[10px] text-slate-400">{syncMessage}</span>}
          {isDirty && <Badge className="bg-amber-600 text-[10px]">Unsaved</Badge>}
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => saveDraftMut.mutateAsync(undefined)}
            disabled={saveDraftMut.isPending || !selectedBranchId}>
            {saveDraftMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
            Save
          </Button>
          <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={handleFinalize}
            disabled={finalizeMut.isPending || isDirty || !selectedBranchId}>
            {finalizeMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle className="h-3 w-3 mr-1" />}
            Finalize
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-400" onClick={() => { refetchDailySummary(); refetchMeterReadings(); }}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* ── 3-PANEL BODY ────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT: Customer Groups ──────────────────────────────────────── */}
        <div className="w-56 border-r flex flex-col bg-muted/30 flex-shrink-0">
          <div className="p-2 border-b flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-7 text-[11px] flex-1" onClick={() => setAddGroupOpen(true)}>
              <Plus className="h-3 w-3 mr-1" /> Add Group
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => addTransactionToCustomer('__walkin__', 'Walk-in Sales')}>
              Walk-in
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {customerGroups.length === 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground">
                {!selectedBranchId ? 'Select a branch to start' : isDailySummaryLoading ? 'Loading...' : 'No transactions yet'}
              </div>
            )}
            {customerGroups.map(g => (
              <button key={g.customerId}
                className={cn(
                  'w-full text-left px-3 py-2 border-b text-xs hover:bg-accent/50 transition-colors',
                  activeCustomerId === g.customerId && 'bg-accent border-l-2 border-l-primary'
                )}
                onClick={() => {
                  setActiveCustomerId(g.customerId);
                  document.getElementById(`group-${g.customerId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                <div className="font-medium truncate">{g.customerName}</div>
                <div className="flex items-center gap-2 text-muted-foreground mt-0.5">
                  <span>{g.transactions.length} txn</span>
                  <span>{fmtL(g.totalLiters)}L</span>
                  <span className="ml-auto font-mono">{fmtPKR(g.totalAmount)}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Meter readings mini-section */}
          <div className="border-t">
            <button className="w-full px-3 py-2 text-[11px] font-medium flex items-center gap-1 text-muted-foreground hover:bg-accent/50"
              onClick={() => setMeterExpanded(!meterExpanded)}>
              {meterExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Meter Readings
              {(backdatedMeterReadingsData as any)?.shifts?.length ? (
                <Badge variant="outline" className="ml-auto text-[9px] h-4">{(backdatedMeterReadingsData as any).shifts.length} shifts</Badge>
              ) : null}
            </button>
            {meterExpanded && (
              <div className="px-2 pb-2 max-h-60 overflow-y-auto space-y-1">
                {backdatedReadingsError && <div className="text-[10px] text-destructive p-1">Failed to load readings</div>}
                {(backdatedMeterReadingsData as any)?.shifts?.map((shift: any) => (
                  <div key={shift.shiftId}>
                    <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider pt-1 pb-0.5 border-b">
                      {shift.shiftName}
                    </div>
                    {shift.nozzles?.map((nozzle: any) => {
                      const op = nozzle.opening?.value;
                      const cl = nozzle.closing?.value;
                      const sales = op != null && cl != null ? (cl - op) : null;
                      return (
                        <div key={`${shift.shiftId}-${nozzle.nozzleId}`} className="flex items-center gap-1 py-0.5 border-b last:border-b-0 text-[10px]">
                          <span className="w-16 truncate">{nozzle.nozzleName || `N-${nozzle.nozzleNumber}`}</span>
                          <span className={cn('w-8 text-center', nozzle.fuelTypeName === 'HSD' || nozzle.fuelType === 'HSD' ? 'text-blue-600' : 'text-green-600')}>
                            {nozzle.fuelTypeName || nozzle.fuelType}
                          </span>
                          <button className={cn('flex-1 text-right font-mono', op != null ? 'text-foreground' : 'text-muted-foreground')}
                            onClick={() => openMeterDialog(nozzle, 'opening', shift, nozzle.opening?.id ? nozzle.opening : null)}>
                            {op != null ? op.toFixed(0) : '—'}
                          </button>
                          <span className="text-muted-foreground">→</span>
                          <button className={cn('flex-1 text-right font-mono', cl != null ? 'text-foreground' : 'text-muted-foreground')}
                            onClick={() => openMeterDialog(nozzle, 'closing', shift, nozzle.closing?.id ? nozzle.closing : null)}>
                            {cl != null ? cl.toFixed(0) : '—'}
                          </button>
                          <span className="w-12 text-right font-mono text-muted-foreground">
                            {sales != null ? `${sales.toFixed(0)}L` : ''}
                          </span>
                          <div className="flex gap-0.5 ml-0.5">
                            {nozzle.opening?.id && (
                              <button className="text-destructive/60 hover:text-destructive" title="Delete opening"
                                onClick={() => { if (confirm('Delete opening reading?')) deleteMeterMut.mutate(nozzle.opening.id); }}>
                                <Trash2 className="h-2.5 w-2.5" />
                              </button>
                            )}
                            {nozzle.closing?.id && (
                              <button className="text-destructive/60 hover:text-destructive" title="Delete closing"
                                onClick={() => { if (confirm('Delete closing reading?')) deleteMeterMut.mutate(nozzle.closing.id); }}>
                                <Trash2 className="h-2.5 w-2.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                {(!(backdatedMeterReadingsData as any)?.shifts || (backdatedMeterReadingsData as any).shifts.length === 0) && !backdatedReadingsError && (
                  <div className="text-[10px] text-muted-foreground p-1">No nozzle readings found</div>
                )}
                {(backdatedMeterReadingsData as any)?.summary && (
                  <div className="mt-1 pt-1 border-t text-[9px] text-muted-foreground flex justify-between">
                    <span>{(backdatedMeterReadingsData as any).summary.totalReadingsEntered}/{(backdatedMeterReadingsData as any).summary.totalReadingsExpected} readings</span>
                    <span>{(backdatedMeterReadingsData as any).summary.completionPercent}% complete</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── CENTER: Transactions ───────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-background">
          {!selectedBranchId && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select a branch and date to begin
            </div>
          )}
          {selectedBranchId && isDailySummaryLoading && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading...
            </div>
          )}
          {selectedBranchId && !isDailySummaryLoading && customerGroups.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <Users className="h-8 w-8 text-muted-foreground/50" />
              <span className="text-sm">No transactions yet</span>
              <Button size="sm" variant="outline" onClick={() => setAddGroupOpen(true)}>
                <Plus className="h-3 w-3 mr-1" /> Add Customer Group
              </Button>
            </div>
          )}
          {selectedBranchId && !isDailySummaryLoading && customerGroups.map(group => (
            <div key={group.customerId} id={`group-${group.customerId}`} className="border-b last:border-b-0">
              {/* Group header */}
              <div className={cn(
                'px-4 py-2 bg-muted/40 flex items-center gap-3 sticky top-0 z-10',
                activeCustomerId === group.customerId && 'bg-primary/5 border-l-2 border-l-primary'
              )} onClick={() => setActiveCustomerId(group.customerId)}>
                <span className="text-sm font-semibold">{group.customerName}</span>
                <Badge variant="secondary" className="text-[10px]">{group.transactions.length} txn</Badge>
                <span className="text-xs text-muted-foreground ml-auto">
                  {fmtL(group.totalLiters)}L | {fmtPKR(group.totalAmount)} PKR
                </span>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]"
                  onClick={e => { e.stopPropagation(); duplicateLastInGroup(group.indices); }}>
                  <Copy className="h-3 w-3 mr-1" /> Dup
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]"
                  onClick={e => { e.stopPropagation(); addTransactionToCustomer(group.customerId, group.customerName); }}>
                  <Plus className="h-3 w-3 mr-1" /> Add
                </Button>
              </div>
              {/* Transaction rows */}
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/20">
                    <th className="text-left px-2 py-1.5 w-20 font-medium text-muted-foreground">Fuel</th>
                    {group.customerId !== '__walkin__' && (
                      <>
                        <th className="text-left px-2 py-1.5 w-24 font-medium text-muted-foreground">Slip#</th>
                        <th className="text-left px-2 py-1.5 w-24 font-medium text-muted-foreground">Vehicle#</th>
                      </>
                    )}
                    <th className="text-right px-2 py-1.5 w-20 font-medium text-muted-foreground">Qty (L)</th>
                    <th className="text-right px-2 py-1.5 w-20 font-medium text-muted-foreground">Price/L</th>
                    <th className="text-right px-2 py-1.5 w-24 font-medium text-muted-foreground">Total</th>
                    <th className="text-left px-2 py-1.5 w-28 font-medium text-muted-foreground">Payment</th>
                    {(group.transactions.some(t => t.paymentMethod === 'credit_card' || t.paymentMethod === 'bank_card')) && (
                      <th className="text-left px-2 py-1.5 w-28 font-medium text-muted-foreground">Bank</th>
                    )}
                    <th className="px-2 py-1.5 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {group.indices.map(idx => {
                    const txn = transactions[idx];
                    if (!txn) return null;
                    const showBank = txn.paymentMethod === 'credit_card' || txn.paymentMethod === 'bank_card';
                    const groupShowsBank = group.transactions.some(t => t.paymentMethod === 'credit_card' || t.paymentMethod === 'bank_card');
                    return (
                      <tr key={txn.id || idx} className={cn('border-b hover:bg-accent/30', txn._localStatus === 'draft' && 'bg-blue-50/50')}>
                        <td className="px-2 py-1">
                          <Select value={txn.fuelCode} onValueChange={v => updateTransaction(idx, 'fuelCode', v)}>
                            <SelectTrigger className="h-7 text-[11px] w-full"><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="HSD">HSD</SelectItem>
                              <SelectItem value="PMG">PMG</SelectItem>
                              <SelectItem value="OTHER">Other</SelectItem>
                            </SelectContent>
                          </Select>
                          {txn.fuelCode === 'OTHER' && (
                            <Select value={txn.productName} onValueChange={v => {
                              const prod = nonFuelProductOptions.find(p => p.name === v);
                              updateTransaction(idx, 'productName', v);
                              if (prod?.unitPrice) updateTransaction(idx, 'unitPrice', prod.unitPrice.toString());
                            }}>
                              <SelectTrigger className="h-6 text-[10px] mt-0.5"><SelectValue placeholder="Product" /></SelectTrigger>
                              <SelectContent>
                                {nonFuelProductOptions.map(p => (
                                  <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                        {group.customerId !== '__walkin__' && (
                          <>
                            <td className="px-2 py-1">
                              <Input value={txn.slipNumber || ''} onChange={e => updateTransaction(idx, 'slipNumber', e.target.value)}
                                className="h-7 text-[11px]" placeholder="Slip#" />
                            </td>
                            <td className="px-2 py-1">
                              <Input value={txn.vehicleNumber || ''} onChange={e => updateTransaction(idx, 'vehicleNumber', e.target.value)}
                                className="h-7 text-[11px]" placeholder="Vehicle#" />
                            </td>
                          </>
                        )}
                        <td className="px-2 py-1">
                          <Input type="number" value={txn.quantity} onChange={e => updateTransaction(idx, 'quantity', e.target.value)}
                            className="h-7 text-[11px] text-right font-mono" placeholder="0" />
                        </td>
                        <td className="px-2 py-1">
                          <Input type="number" value={txn.unitPrice} onChange={e => updateTransaction(idx, 'unitPrice', e.target.value)}
                            className="h-7 text-[11px] text-right font-mono" placeholder="0" />
                        </td>
                        <td className="px-2 py-1 text-right font-mono font-medium">
                          {fmtPKR(toNumber(txn.lineTotal))}
                        </td>
                        <td className="px-2 py-1">
                          <Select value={txn.paymentMethod} onValueChange={v => updateTransaction(idx, 'paymentMethod', v)}>
                            <SelectTrigger className="h-7 text-[11px] w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">Cash</SelectItem>
                              <SelectItem value="credit_card">Credit Card</SelectItem>
                              <SelectItem value="bank_card">Bank Card</SelectItem>
                              <SelectItem value="pso_card">PSO Card</SelectItem>
                              <SelectItem value="credit_customer">Credit</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        {groupShowsBank && (
                          <td className="px-2 py-1">
                            {showBank ? (
                              <Select value={txn.bankId || ''} onValueChange={v => updateTransaction(idx, 'bankId', v)}>
                                <SelectTrigger className="h-7 text-[11px] w-full"><SelectValue placeholder="Bank" /></SelectTrigger>
                                <SelectContent>
                                  {(banksData || []).map((b: any) => (
                                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                        )}
                        <td className="px-2 py-1">
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-emerald-600" onClick={() => saveRow(idx)}
                              title="Save row">
                              <Save className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => removeTransaction(idx)}
                              title="Delete">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* ── RIGHT: Stats Panel ─────────────────────────────────────────── */}
        <div className="w-64 border-l flex-shrink-0 overflow-y-auto bg-muted/10 p-3 space-y-3">
          {/* Fuel Recon */}
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Fuel Reconciliation</div>
            {/* HSD */}
            <div className="space-y-1 mb-3">
              <div className="flex justify-between text-[11px]"><span className="font-medium text-blue-700">HSD (Diesel)</span><span className="font-mono">{hsdPct}%</span></div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.min(hsdPct, 100)}%` }} /></div>
              <div className="grid grid-cols-3 text-[10px] text-muted-foreground">
                <div>Meter<br /><span className="font-mono text-foreground">{fmtL(hsd)}</span></div>
                <div className="text-center">Posted<br /><span className="font-mono text-blue-600">{fmtL(hsdPosted)}</span></div>
                <div className="text-right">Remain<br /><span className="font-mono text-orange-600 font-semibold">{fmtL(hsdRemain)}</span></div>
              </div>
            </div>
            {/* PMG */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]"><span className="font-medium text-green-700">PMG (Petrol)</span><span className="font-mono">{pmgPct}%</span></div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-green-500 transition-all" style={{ width: `${Math.min(pmgPct, 100)}%` }} /></div>
              <div className="grid grid-cols-3 text-[10px] text-muted-foreground">
                <div>Meter<br /><span className="font-mono text-foreground">{fmtL(pmg)}</span></div>
                <div className="text-center">Posted<br /><span className="font-mono text-green-600">{fmtL(pmgPosted)}</span></div>
                <div className="text-right">Remain<br /><span className="font-mono text-orange-600 font-semibold">{fmtL(pmgRemain)}</span></div>
              </div>
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Payment Breakdown */}
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Payments</div>
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between"><span>Cash</span><span className="font-mono">{fmtPKR(paymentBreakdown.cash)}</span></div>
              <div className="flex justify-between"><span>Credit Card</span><span className="font-mono">{fmtPKR(paymentBreakdown.credit_card)}</span></div>
              <div className="flex justify-between"><span>Bank Card</span><span className="font-mono">{fmtPKR(paymentBreakdown.bank_card)}</span></div>
              <div className="flex justify-between"><span>PSO Card</span><span className="font-mono">{fmtPKR(paymentBreakdown.pso_card)}</span></div>
              <div className="flex justify-between"><span>Credit Cust.</span><span className="font-mono">{fmtPKR(paymentBreakdown.credit_customer)}</span></div>
              <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Total</span><span className="font-mono">{fmtPKR(totalPKR)} PKR</span></div>
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Transaction summary */}
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Summary</div>
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between"><span>Groups</span><span className="font-mono">{customerGroups.length}</span></div>
              <div className="flex justify-between"><span>Transactions</span><span className="font-mono">{transactions.length}</span></div>
              <div className="flex justify-between"><span>Total Liters</span><span className="font-mono">{fmtL(transactions.reduce((s, t) => s + toNumber(t.quantity), 0))}</span></div>
              {lastSaved && (
                <div className="flex justify-between"><span>Last saved</span><span className="text-muted-foreground">{format(lastSaved, 'HH:mm')}</span></div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── DIALOGS ─────────────────────────────────────────────────────── */}

      {/* Add Customer Group Dialog */}
      <Dialog open={addGroupOpen} onOpenChange={setAddGroupOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Customer Group</DialogTitle>
            <DialogDescription>Select a customer or add walk-in sales</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Button variant="outline" className="w-full justify-start" onClick={() => { addTransactionToCustomer('__walkin__', 'Walk-in Sales'); setAddGroupOpen(false); }}>
              <Users className="h-4 w-4 mr-2" /> Walk-in Sales (Cash)
            </Button>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search customers..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} className="pl-8" />
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredCustomers.map((c: any) => (
                <button key={c.id} className="w-full text-left px-3 py-2 rounded hover:bg-accent text-sm"
                  onClick={() => { addTransactionToCustomer(c.id, c.name); setAddGroupOpen(false); setCustomerSearch(''); }}>
                  <div className="font-medium">{c.name}</div>
                  {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                </button>
              ))}
            </div>
            <Button variant="outline" className="w-full" onClick={() => setAddCustomerOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add New Customer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add New Customer Dialog */}
      <Dialog open={addCustomerOpen} onOpenChange={setAddCustomerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New Customer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Customer name *" value={newCustomer.name} onChange={e => setNewCustomer(p => ({ ...p, name: e.target.value }))} />
            <Input placeholder="Phone" value={newCustomer.phone} onChange={e => setNewCustomer(p => ({ ...p, phone: e.target.value }))} />
            <Input placeholder="Email" value={newCustomer.email} onChange={e => setNewCustomer(p => ({ ...p, email: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCustomerOpen(false)}>Cancel</Button>
            <Button onClick={handleAddNewCustomer} disabled={isSubmittingCustomer}>
              {isSubmittingCustomer ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Add & Create Transaction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Meter Reading Capture Dialog */}
      <Dialog open={meterDialogOpen} onOpenChange={open => { if (!open) { setMeterDialogOpen(false); setSelectedMeterNozzle(null); setEditingReadingId(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingReadingId ? 'Edit' : 'Enter'} Meter Reading</DialogTitle>
            <DialogDescription>
              {selectedMeterNozzle ? `${selectedMeterNozzle.name || `Nozzle ${selectedMeterNozzle.nozzleNumber || '-'}`} (${selectedMeterNozzle.fuelType?.name || 'Unknown'}) — ${selectedReadingType}` : ''}
            </DialogDescription>
          </DialogHeader>
          {selectedMeterNozzle && (
            <MeterReadingCapture
              nozzleId={selectedMeterNozzle.id}
              nozzleName={`${selectedMeterNozzle.name || `Nozzle ${selectedMeterNozzle.nozzleNumber || '-'}`} (${selectedMeterNozzle.fuelType?.name || 'Unknown'})`}
              previousReading={modalPreviousReading ?? undefined}
              onCapture={handleMeterCapture}
              onCancel={() => { setMeterDialogOpen(false); setSelectedMeterNozzle(null); setEditingReadingId(null); }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Finalize Result Dialog */}
      <Dialog open={finalizeDialogOpen} onOpenChange={setFinalizeDialogOpen}>
        <DialogContent className="max-w-md">
          {finalizeResult?.type === 'success' ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-emerald-700">
                  {finalizeResult.alreadyFinalized ? 'Day Already Finalized' : 'Successfully Finalized!'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <p>{finalizeResult.message}</p>
                {finalizeResult.salesCreated > 0 && <p>Sales created: <strong>{finalizeResult.salesCreated}</strong></p>}
                {finalizeResult.transactionsProcessed > 0 && <p>Transactions processed: <strong>{finalizeResult.transactionsProcessed}</strong></p>}
                {finalizeResult.cashGapWarning && (
                  <div className="bg-amber-50 border border-amber-200 rounded p-2 text-amber-800 text-xs">
                    Cash variance: PKR {Math.abs(finalizeResult.cashGapWarning.amount).toFixed(2)}
                  </div>
                )}
              </div>
              <DialogFooter><Button onClick={() => setFinalizeDialogOpen(false)}>Close</Button></DialogFooter>
            </>
          ) : finalizeResult?.type === 'error' ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-orange-700">Finalize Blocked</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <p>{finalizeResult.message}</p>
                {finalizeResult.blockers?.map((b: any, i: number) => (
                  <div key={i} className="bg-red-50 border border-red-200 rounded p-2 text-red-800 text-xs flex gap-2">
                    <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    {b.message}
                  </div>
                ))}
                {finalizeResult.metrics && (
                  <div className="text-xs text-muted-foreground">
                    {finalizeResult.metrics.hsdGap != null && <div>HSD Gap: {finalizeResult.metrics.hsdGap.toFixed(1)}L</div>}
                    {finalizeResult.metrics.pmgGap != null && <div>PMG Gap: {finalizeResult.metrics.pmgGap.toFixed(1)}L</div>}
                    {finalizeResult.metrics.cashGap != null && <div>Cash Gap: PKR {finalizeResult.metrics.cashGap.toFixed(2)}</div>}
                  </div>
                )}
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setFinalizeDialogOpen(false)}>Close</Button></DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
