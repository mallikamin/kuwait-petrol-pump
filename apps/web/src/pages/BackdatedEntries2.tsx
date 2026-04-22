import { useEffect, useMemo, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  CalendarClock, Save, CheckCircle, Plus, Trash2, Copy, Search,
  Loader2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  RefreshCw, AlertCircle, Users, Paperclip,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { apiClient } from '@/api/client';
import { branchesApi, customersApi, meterReadingsApi, productsApi } from '@/api';
import { banksApi } from '@/api/banks';
import { useAuthStore } from '@/store/auth';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MeterReadingCapture, type MeterReadingData } from '@/components/MeterReadingCapture';
import {
  buildCustomerGroups,
  computePaymentSummary,
  formatReconciledDateHeader,
  mapApiTxnToLocal,
  type BackdatedTxn as Transaction,
} from './BackdatedEntries2.utils';

// ── Utilities ────────────────────────────────────────────────────────────────
const toNumber = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const p = parseFloat(v); return Number.isFinite(p) ? p : 0; }
  return 0;
};
const fmtL = (n: number) => { if (n === 0) return '0'; return (Math.round(n * 1000) / 1000).toFixed(3).replace(/\.?0+$/, ''); };
const fmtPKR = (n: number) => n.toLocaleString('en-PK', { maximumFractionDigits: 0 });

const openAttachmentInNewTab = (rawUrl?: string | null) => {
  if (!rawUrl) return;
  if (rawUrl.startsWith('data:')) {
    try {
      const [meta, base64] = rawUrl.split(',');
      if (!meta || !base64) return;
      const mimeMatch = meta.match(/data:(.*?);base64/);
      const mime = mimeMatch?.[1] || 'application/octet-stream';
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      return;
    } catch { return; }
  }
  window.open(rawUrl, '_blank', 'noopener,noreferrer');
};


// ── Component ────────────────────────────────────────────────────────────────
export function BackdatedEntries2() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

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
  // Target row id for auto-focus after a new row is added via "Add Group" /
  // "+ Add row" — consumed once by the effect below.
  const pendingFocusRef = useRef<string | null>(null);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(null);
  const [meterExpanded, setMeterExpanded] = useState(true);
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '' });
  const [isSubmittingCustomer, setIsSubmittingCustomer] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

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
  const customerGroups = useMemo(() => buildCustomerGroups(transactions), [transactions]);

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

  // Per-fuel price for the selected business date — drives transaction unit price
  // (non-editable) and the PKR column in the Fuel Reconciliation panel.
  const fuelPriceByCode = useMemo(() => {
    const m: Record<string, number> = {};
    (fuelPricesData || []).forEach((f: any) => {
      const code = f?.fuelType?.code;
      if (code) m[code] = toNumber(f.pricePerLiter);
    });
    return m;
  }, [fuelPricesData]);
  const hsdPrice = fuelPriceByCode['HSD'] || 0;
  const pmgPrice = fuelPriceByCode['PMG'] || 0;

  // Payment breakdown from transactions
  const paymentBreakdown = useMemo(() => {
    const bd = { cash: 0, credit_card: 0, bank_card: 0, pso_card: 0, credit_customer: 0 };
    transactions.forEach(t => { bd[t.paymentMethod] = (bd[t.paymentMethod] || 0) + toNumber(t.lineTotal); });
    return bd;
  }, [transactions]);
  const totalPKR = useMemo(() => transactions.reduce((s, t) => s + toNumber(t.lineTotal), 0), [transactions]);
  const paymentSummary = useMemo(() => computePaymentSummary(transactions), [transactions]);

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
      const hydrated = dailySummaryData.transactions.map(mapApiTxnToLocal);
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

  // Price sync: when fuelPricesData / productsData load (or businessDate changes),
  // lock each row's unitPrice + lineTotal to the master source of truth. If
  // no source value exists (e.g. product not in master list, price not set
  // for date), force "0" — never fall back to a previously-stored price.
  // This is a display+payload correction, not a user edit, so we suppress the
  // dirty flag via hydratingRef.
  useEffect(() => {
    if (transactions.length === 0) return;
    if (!fuelPricesData && !productsData) return;
    let changed = false;
    const next = transactions.map(t => {
      const src = derivePriceFor(t.fuelCode, t.productName) || '0';
      if (toNumber(t.unitPrice) === toNumber(src)) return t;
      changed = true;
      const newLineTotal = (toNumber(t.quantity) * toNumber(src)).toFixed(2);
      return { ...t, unitPrice: src, lineTotal: newLineTotal };
    });
    if (changed) {
      hydratingRef.current = true;
      setTransactions(next);
    }
  }, [fuelPricesData, productsData]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Vehicle# + Slip# are only required for fuel rows (HSD/PMG). Non-fuel
    // credit sales often lack a vehicle/slip (e.g. oil/accessories over the
    // counter), so only enforce customer on those.
    const isFuelRow = txn.fuelCode === 'HSD' || txn.fuelCode === 'PMG';
    if (!txn.customerId?.trim()) {
      return `Credit customer requires customer (row with ${txn.quantity}L)`;
    }
    if (isFuelRow && (!txn.vehicleNumber?.trim() || !txn.slipNumber?.trim())) {
      return `Credit fuel sale requires vehicle# and slip# (row with ${txn.quantity}L)`;
    }
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
    onSuccess: (savedData) => {
      // Use server response immediately to avoid race condition with refetch.
      // The save endpoint returns getDailySummary()'s shape (customer: {id,name},
      // nozzle: {id,name}). Use the same mapper as GET hydration so grouping
      // keys (customerId) resolve identically — otherwise every row collapses
      // into one Walk-in group until the next refetch.
      if (savedData?.transactions && savedData.transactions.length > 0) {
        const hydrated = savedData.transactions.map((txn: any) => ({
          ...mapApiTxnToLocal(txn),
          _localStatus: 'saved' as const,
        }));
        hydratingRef.current = true;
        setTransactions(hydrated);
        setSyncMessage(`Saved ${hydrated.length} transactions.`);
      } else {
        hydratingRef.current = true;
        setTransactions([]);
        setSyncMessage('Draft saved (no transactions).');
      }
      toast.success('Draft saved');
      setLastSaved(new Date());
      setIsDirty(false);
      justSavedRef.current = true;
      setLoadedKey('');
      setDeletedTransactionIds([]);
      // Still refetch in background for metrics/summary updates
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
      const finalizedAt =
        data?.finalizedAt ||
        data?.details?.finalizedAt ||
        data?.timestamp ||
        new Date().toISOString();
      const finalizedBy =
        data?.finalizedBy?.fullName ||
        data?.finalizedBy?.username ||
        data?.finalizedByName ||
        user?.full_name ||
        user?.username ||
        '—';
      setFinalizeResult({
        type: 'success', message: data?.message || 'Finalized!', alreadyFinalized: data?.alreadyFinalized,
        salesCreated: data?.postedSalesCount || data?.details?.salesCreated || 0,
        transactionsProcessed: data?.details?.transactionsProcessed || 0,
        paymentBreakdown: data?.paymentBreakdown || null, // Legacy, kept for backward compatibility
        reconciliationTotals: data?.reconciliationTotals || null, // ✅ NEW: Reconciliation totals
        branchName: data?.branchName || null, // ✅ NEW: Branch name
        cashGapWarning: data?.cashGapWarning,
        finalizedAt,
        finalizedBy,
        businessDate, // for the reconciled-date dialog title
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
    const newId = crypto.randomUUID();
    pendingFocusRef.current = newId;
    setTransactions(prev => [...prev, {
      id: newId, customerId: customerId === '__walkin__' ? '' : customerId,
      customerName: customerId === '__walkin__' ? '' : customerName,
      fuelCode: '' as const, productName: '', quantity: '', unitPrice: '', lineTotal: '0',
      paymentMethod: customerId === '__walkin__' ? 'cash' as const : 'credit_customer' as const,
      _localStatus: 'draft' as const,
    }]);
    setActiveCustomerId(customerId);
    // Ensure the target group is expanded so the new row (and its fuel selector)
    // is actually in the DOM when we try to focus it.
    setCollapsedGroups(prev => {
      if (!prev.has(customerId)) return prev;
      const next = new Set(prev);
      next.delete(customerId);
      return next;
    });
  };

  // After a new row is added, focus its fuel selector so the user can pick a
  // fuel type immediately without mouse/tab navigation.
  useEffect(() => {
    const targetId = pendingFocusRef.current;
    if (!targetId) return;
    const t = setTimeout(() => {
      const el = document.querySelector(
        `[data-fuel-selector-row="${targetId}"]`,
      ) as HTMLElement | null;
      if (el) {
        el.focus();
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      pendingFocusRef.current = null;
    }, 50);
    return () => clearTimeout(t);
  }, [transactions]);

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

  // Price is always derived — never user-editable. Fuel rows take price from
  // fuelPricesData by code; non-fuel rows take unitPrice from productsData by
  // productName. Returns '' when no source value is available so downstream
  // math falls through to 0.
  const derivePriceFor = (fuelCode: string, productName?: string): string => {
    if (fuelCode === 'HSD' || fuelCode === 'PMG') {
      const fp = (fuelPricesData || []).find((f: any) => f.fuelType?.code === fuelCode);
      return fp?.pricePerLiter != null ? fp.pricePerLiter.toString() : '';
    }
    if (fuelCode === 'OTHER' && productName) {
      const prod = nonFuelProductOptions.find(p => p.name === productName);
      return prod?.unitPrice != null ? prod.unitPrice.toString() : '';
    }
    return '';
  };

  const updateTransaction = (index: number, field: keyof Transaction, value: any) => {
    // Price rule: fuel rows (HSD/PMG) stay master-driven and cannot be edited
    // directly. Non-fuel rows (fuelCode='OTHER' or empty/new rows) allow
    // manual price override so operators can match the actual sold price on
    // oil/accessories/etc. that differs from the product-master default.
    if (field === 'unitPrice') {
      const currentFuelCode = transactions[index]?.fuelCode;
      if (currentFuelCode === 'HSD' || currentFuelCode === 'PMG') return;
    }
    setTransactions(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      // Nozzle-fuel consistency guard
      if (field === 'fuelCode' && updated[index].nozzleId) {
        const map = (dailySummaryData?.nozzleStatuses || []).reduce((m: any, ns: any) => { m[ns.nozzleId] = ns.fuelType; return m; }, {});
        if (map[updated[index].nozzleId] && map[updated[index].nozzleId] !== value) updated[index].nozzleId = '';
      }
      // Auto-fill product name + unit price when fuelCode changes. When the
      // master price isn't resolvable (data not loaded, missing product),
      // force "0" so no stale price lingers and lineTotal collapses to 0 —
      // instead of silently pricing off a previously-hydrated value.
      if (field === 'fuelCode') {
        if (value === 'HSD') updated[index].productName = 'High Speed Diesel';
        else if (value === 'PMG') updated[index].productName = 'Premium Motor Gasoline';
        else if (value === 'OTHER') updated[index].productName = '';
        updated[index].unitPrice = derivePriceFor(value, updated[index].productName) || '0';
      }
      // Non-fuel product pick drives its own price.
      if (field === 'productName' && updated[index].fuelCode === 'OTHER') {
        updated[index].unitPrice = derivePriceFor('OTHER', value) || '0';
      }
      // Auto-calc line total (quantity × current unitPrice). `unitPrice` is
      // included so non-fuel manual price edits reflow the total.
      if (field === 'quantity' || field === 'fuelCode' || field === 'productName' || field === 'unitPrice') {
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

  const toggleGroup = (customerId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(customerId)) next.delete(customerId); else next.add(customerId);
      return next;
    });
  };

  // ── Pre-computed render data ───────────────────────────────────────────────
  const meterShifts = (backdatedMeterReadingsData as any)?.shifts || [];
  const meterSummary = (backdatedMeterReadingsData as any)?.summary;
  const meterPct = meterSummary?.completionPercent || 0;
  const meterEntered = meterSummary?.totalReadingsEntered || 0;
  const meterExpected = meterSummary?.totalReadingsExpected || 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-background">

      {/* ═══════════════════════════════════════════════════════════════════════
          HEADER BAR
          ═══════════════════════════════════════════════════════════════════════ */}
      <header className="bg-slate-800 text-white px-4 py-2 flex items-center gap-3 flex-shrink-0 z-20">
        <CalendarClock className="h-4 w-4 text-blue-300 flex-shrink-0" />
        <span className="text-sm font-semibold tracking-tight whitespace-nowrap">Daily Posting</span>

        <div className="flex items-center gap-2">
          <Input type="date" value={businessDate} onChange={e => setBusinessDate(e.target.value)}
            max={format(new Date(), 'yyyy-MM-dd')}
            className="h-7 w-36 text-xs bg-slate-700 border-slate-600 text-white [color-scheme:dark]" />
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

        {selectedBranchId && businessDate && (
          <div className="flex items-center gap-4 ml-2">
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-blue-300 font-medium">HSD</span>
              <div className="w-20 h-2 bg-slate-600 rounded-full overflow-hidden">
                <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${Math.min(hsdPct, 100)}%` }} />
              </div>
              <span className="font-mono w-8 text-right">{hsdPct}%</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-green-300 font-medium">PMG</span>
              <div className="w-20 h-2 bg-slate-600 rounded-full overflow-hidden">
                <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${Math.min(pmgPct, 100)}%` }} />
              </div>
              <span className="font-mono w-8 text-right">{pmgPct}%</span>
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {syncMessage && <span className="text-[10px] text-slate-400 max-w-[160px] truncate">{syncMessage}</span>}
          {isDirty && <Badge className="bg-amber-600 text-[10px] px-1.5">Unsaved</Badge>}
          <Button size="sm" variant="secondary" className="h-7 text-xs gap-1" onClick={async () => {
            try { await saveDraftMut.mutateAsync(undefined); }
            catch (e: any) { /* Error already handled by mutation onError */ }
          }}
            disabled={saveDraftMut.isPending || !selectedBranchId}>
            {saveDraftMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save
          </Button>
          <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={handleFinalize}
            disabled={finalizeMut.isPending || isDirty || !selectedBranchId}>
            {finalizeMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
            Finalize
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-400 hover:text-white"
            onClick={() => { refetchDailySummary(); refetchMeterReadings(); }}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════════════
          FINALIZED DAY BANNER — Shows when day is already finalized
          ═══════════════════════════════════════════════════════════════════════ */}
      {dailySummaryData?.isFinalized && (
        <div className="flex-shrink-0 bg-amber-50 border-b border-amber-200">
          <div className="px-4 py-2.5 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-amber-900 text-sm">Day Finalized Already</div>
              <div className="text-xs text-amber-700">
                This day has been finalized. Changes are still possible but will require re-finalization.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          METER READINGS STRIP — full-width, collapsible, workflow step 1
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex-shrink-0 border-b bg-slate-50">
        <button
          className="w-full px-4 py-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 hover:bg-slate-100 transition-colors"
          onClick={() => setMeterExpanded(!meterExpanded)}
        >
          {meterExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Meter Readings
          {meterSummary && (
            <Badge variant={meterPct === 100 ? 'default' : 'secondary'} className={cn('text-[10px]', meterPct === 100 && 'bg-emerald-600')}>
              {meterEntered}/{meterExpected}
            </Badge>
          )}
          {meterPct > 0 && meterPct < 100 && (
            <div className="flex items-center gap-1.5 ml-1">
              <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${meterPct}%` }} />
              </div>
              <span className="font-mono text-[10px] text-amber-700">{meterPct}%</span>
            </div>
          )}
          {backdatedReadingsError && <span className="text-destructive text-[10px] ml-2 font-normal normal-case">Load failed</span>}
        </button>

        {meterExpanded && selectedBranchId && (
          <div className="px-4 pb-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
            {meterShifts.length === 0 && !backdatedReadingsError && (
              <div className="col-span-full text-xs text-muted-foreground py-3 text-center">
                No shift data for this date. Ensure shifts are configured.
              </div>
            )}
            {meterShifts.map((shift: any) => (
              <div key={shift.shiftId} className="border rounded-lg overflow-hidden bg-white shadow-sm">
                {/* Shift header */}
                <div className="bg-slate-100 px-3 py-1.5 flex items-center gap-2 border-b">
                  <span className="text-xs font-bold text-slate-700">{shift.shiftName}</span>
                  {shift.startTime && shift.endTime && (
                    <span className="text-[10px] text-slate-400">
                      {typeof shift.startTime === 'string' ? shift.startTime.substring(0, 5) : ''} – {typeof shift.endTime === 'string' ? shift.endTime.substring(0, 5) : ''}
                    </span>
                  )}
                  {shift.summary && (
                    <Badge variant={toNumber(shift.summary.completionPercent) === 100 ? 'default' : 'outline'}
                      className={cn('text-[10px] ml-auto', toNumber(shift.summary.completionPercent) === 100 && 'bg-emerald-600 text-white')}>
                      {toNumber(shift.summary.completionPercent).toFixed(0)}%
                    </Badge>
                  )}
                </div>

                {/* Nozzle column headers */}
                <div className="grid grid-cols-[minmax(100px,1fr)_140px_140px_60px] px-3 py-1 text-[10px] text-slate-400 font-semibold uppercase tracking-wider bg-slate-50/50 border-b">
                  <span>Nozzle</span>
                  <span className="text-center">Opening</span>
                  <span className="text-center">Closing</span>
                  <span className="text-right">Sales</span>
                </div>

                {/* Nozzle rows */}
                <div className="divide-y divide-slate-100">
                  {(shift.nozzles || []).map((nozzle: any) => {
                    const op = nozzle.opening;
                    const cl = nozzle.closing;
                    const opVal = op?.value;
                    const clVal = cl?.value;
                    const sales = opVal != null && clVal != null ? (clVal - opVal) : null;
                    const isHSD = nozzle.fuelTypeName === 'HSD' || nozzle.fuelType === 'HSD';

                    const ReadingCell = ({ reading, readingType }: { reading: any; readingType: 'opening' | 'closing' }) => {
                      const val = reading?.value;
                      const hasAttach = !!(reading?.imageUrl || reading?.attachmentUrl);
                      const isPropagated = reading?.status === 'propagated_forward' || reading?.status === 'propagated_backward';
                      const sourceId = reading?.propagatedFrom?.sourceReadingId;
                      const deletableId = reading?.id || sourceId;
                      const propSrc = reading?.propagatedFrom;
                      if (val != null) {
                        return (
                          <div className="flex items-center justify-center gap-1 group/cell">
                            <button
                              className={cn(
                                'font-mono text-xs font-semibold px-2.5 py-1 rounded border transition-colors cursor-pointer',
                                isPropagated
                                  ? 'border-dashed border-slate-300 bg-slate-50 text-slate-600 italic hover:border-blue-400 hover:bg-blue-50'
                                  : 'border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50'
                              )}
                              onClick={() => openMeterDialog(nozzle, readingType, shift, reading?.id ? reading : null)}
                              title={
                                isPropagated && propSrc
                                  ? `Auto-filled from ${propSrc.date} ${propSrc.readingType}. Click to enter a specific value.`
                                  : `Click to edit ${readingType}`
                              }
                            >
                              {val.toLocaleString()}
                            </button>
                            {hasAttach && (
                              <button className="text-blue-500 hover:text-blue-700 p-0.5" title="View attachment"
                                onClick={() => openAttachmentInNewTab(reading.attachmentUrl || reading.imageUrl)}>
                                <Paperclip className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {deletableId && (
                              <button
                                className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                                title={
                                  isPropagated && propSrc
                                    ? `Delete source reading (${propSrc.date} ${propSrc.readingType})`
                                    : `Delete ${readingType}`
                                }
                                onClick={() => {
                                  const msg = isPropagated && propSrc
                                    ? `This ${readingType} is auto-filled from ${propSrc.date} ${propSrc.readingType} reading.\n\nDeleting will remove the source reading on ${propSrc.date}. Continue?`
                                    : `Delete this ${readingType} reading?`;
                                  if (confirm(msg)) deleteMeterMut.mutate(deletableId);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      }
                      return (
                        <div className="flex justify-center">
                          <button
                            className="text-[11px] font-semibold px-3 py-1.5 rounded-md border-2 border-dashed border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-500 transition-colors"
                            onClick={() => openMeterDialog(nozzle, readingType, shift)}
                          >
                            Enter {readingType === 'opening' ? 'Opening' : 'Closing'}
                          </button>
                        </div>
                      );
                    };

                    return (
                      <div key={`${shift.shiftId}-${nozzle.nozzleId}`}
                        className="grid grid-cols-[minmax(100px,1fr)_140px_140px_60px] items-center px-3 py-2 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-medium text-slate-700 truncate">
                            {nozzle.nozzleName || `N-${nozzle.nozzleNumber}`}
                          </span>
                          <span className={cn(
                            'text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0',
                            isHSD ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                          )}>
                            {nozzle.fuelTypeName || nozzle.fuelType}
                          </span>
                        </div>
                        <ReadingCell reading={op} readingType="opening" />
                        <ReadingCell reading={cl} readingType="closing" />
                        <div className="text-right">
                          {sales != null ? (
                            <span className={cn('font-mono text-xs font-semibold', sales < 0 ? 'text-red-600' : 'text-slate-700')}>
                              {sales.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          3-PANEL BODY
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── CENTER PANEL: Transactions ───────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Panel toggle toolbar */}
          <div className="flex items-center px-1 py-0.5 border-b bg-muted/10 flex-shrink-0 gap-1">
            <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1 px-2"
              onClick={() => setAddGroupOpen(true)}
              title="Add customer group">
              <Plus className="h-3 w-3" /> Add Group
            </Button>
            <div className="flex-1 text-center text-[10px] text-muted-foreground font-medium">
              {transactions.length > 0 && `${transactions.length} txn | ${customerGroups.length} groups | ${fmtPKR(totalPKR)} PKR`}
              {lastSaved && <span className="ml-2 text-emerald-600">Saved {format(lastSaved, 'HH:mm')}</span>}
            </div>
            <span className="text-[10px] text-muted-foreground">{rightCollapsed ? 'Summary' : ''}</span>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setRightCollapsed(!rightCollapsed)}
              title={rightCollapsed ? 'Show reconciliation' : 'Hide reconciliation'}>
              {rightCollapsed ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </Button>
          </div>

          {/* Transaction content */}
          <div className="flex-1 overflow-y-auto">
            {!selectedBranchId && (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Select a branch and date to begin
              </div>
            )}
            {selectedBranchId && isDailySummaryLoading && (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading transactions...
              </div>
            )}
            {selectedBranchId && !isDailySummaryLoading && customerGroups.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                <Users className="h-10 w-10 text-muted-foreground/30" />
                <span className="text-sm">No transactions for this date</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAddGroupOpen(true)}>
                    <Plus className="h-3 w-3 mr-1" /> Add Customer Group
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => addTransactionToCustomer('__walkin__', 'Walk-in Sales')}>
                    Walk-in Sale
                  </Button>
                </div>
              </div>
            )}

            {/* ── Customer Group Accordions ─────────────────────────────────── */}
            {selectedBranchId && !isDailySummaryLoading && customerGroups.map(group => {
              const isGroupCollapsed = collapsedGroups.has(group.customerId);
              return (
                <div key={group.customerId} id={`group-${group.customerId}`} className="mx-2 my-3 border rounded-lg bg-card shadow-sm last:mb-3">
                  {/* Group header — click to collapse */}
                  <div
                    className={cn(
                      'px-3 py-2.5 bg-muted/50 flex items-center gap-2 cursor-pointer select-none hover:bg-muted/70 transition-colors rounded-t-lg border-b',
                      activeCustomerId === group.customerId && 'bg-primary/10 border-l-2 border-l-primary pl-2.5'
                    )}
                    onClick={() => { toggleGroup(group.customerId); setActiveCustomerId(group.customerId); }}
                  >
                    {isGroupCollapsed
                      ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                    <span className="text-sm font-semibold truncate min-w-0">{group.customerName}</span>
                    <Badge variant="secondary" className="text-[10px] flex-shrink-0">{group.transactions.length}</Badge>
                    <span className="text-xs text-muted-foreground ml-auto flex-shrink-0 whitespace-nowrap">
                      {fmtL(group.totalLiters)}L
                    </span>
                    <span className="text-xs font-mono font-bold flex-shrink-0 whitespace-nowrap">
                      {fmtPKR(group.totalAmount)} PKR
                    </span>
                    <div className="flex gap-0.5 flex-shrink-0 ml-1" onClick={e => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-0.5"
                        onClick={() => duplicateLastInGroup(group.indices)} title="Duplicate last row">
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-0.5"
                        onClick={() => addTransactionToCustomer(group.customerId, group.customerName)} title="Add row">
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Transaction table — hidden when group collapsed */}
                  {!isGroupCollapsed && (
                    <div className="overflow-x-auto rounded-b-lg">
                      <table className="w-full text-xs" style={{ minWidth: group.customerId !== '__walkin__' ? '820px' : '650px' }}>
                        <thead>
                          <tr className="border-b bg-muted/20 text-[10px]">
                            <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground" style={{ width: 90 }}>Fuel</th>
                            {group.customerId !== '__walkin__' && (
                              <>
                                <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground" style={{ width: 100 }}>Slip#</th>
                                <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground" style={{ width: 100 }}>Vehicle#</th>
                              </>
                            )}
                            <th className="text-right px-2 py-1.5 font-semibold text-muted-foreground" style={{ width: 90 }}>Qty (L)</th>
                            <th className="text-right px-2 py-1.5 font-semibold text-muted-foreground" style={{ width: 85 }}>Price/L</th>
                            <th className="text-right px-2 py-1.5 font-semibold text-muted-foreground" style={{ width: 100 }}>Total</th>
                            <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground" style={{ width: 115 }}>Payment</th>
                            <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground" style={{ width: 115 }}>Bank</th>
                            <th className="px-1 py-1.5 text-center font-semibold text-muted-foreground sticky right-0 bg-muted/20 z-10 border-l" style={{ width: 68 }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.indices.map(idx => {
                            const txn = transactions[idx];
                            if (!txn) return null;
                            const showBank = txn.paymentMethod === 'credit_card' || txn.paymentMethod === 'bank_card';
                            return (
                              <tr key={txn.id || idx}
                                className={cn(
                                  'border-b hover:bg-accent/30 transition-colors',
                                  txn._localStatus === 'draft' && 'bg-blue-50/40'
                                )}>
                                <td className="px-2 py-1">
                                  <Select value={txn.fuelCode} onValueChange={v => updateTransaction(idx, 'fuelCode', v)}>
                                    <SelectTrigger
                                      data-fuel-selector-row={txn.id}
                                      className="h-8 text-xs"
                                    ><SelectValue placeholder="—" /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="HSD">HSD</SelectItem>
                                      <SelectItem value="PMG">PMG</SelectItem>
                                      <SelectItem value="OTHER">Other</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {txn.fuelCode === 'OTHER' && (
                                    <Select value={txn.productName} onValueChange={v => updateTransaction(idx, 'productName', v)}>
                                      <SelectTrigger className="h-8 text-xs mt-0.5 min-w-[200px]"><SelectValue placeholder="Select product" /></SelectTrigger>
                                      <SelectContent className="max-w-[300px]">
                                        {nonFuelProductOptions.map(p => (
                                          <SelectItem key={p.id} value={p.name} className="text-xs">{p.name}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                </td>
                                {group.customerId !== '__walkin__' && (
                                  <>
                                    <td className="px-2 py-1">
                                      <Input value={txn.slipNumber || ''} onChange={e => updateTransaction(idx, 'slipNumber', e.target.value)}
                                        className="h-8 text-xs" placeholder="Slip#" />
                                    </td>
                                    <td className="px-2 py-1">
                                      <Input value={txn.vehicleNumber || ''} onChange={e => updateTransaction(idx, 'vehicleNumber', e.target.value)}
                                        className="h-8 text-xs" placeholder="Vehicle#" />
                                    </td>
                                  </>
                                )}
                                <td className="px-2 py-1">
                                  <Input type="number" value={txn.quantity} onChange={e => updateTransaction(idx, 'quantity', e.target.value)}
                                    className="h-8 text-xs text-right font-mono" placeholder="0" />
                                </td>
                                <td className="px-2 py-1">
                                  {(() => {
                                    const isFuelRow = txn.fuelCode === 'HSD' || txn.fuelCode === 'PMG';
                                    const displayValue = isFuelRow
                                      ? (derivePriceFor(txn.fuelCode, txn.productName) || '0')
                                      : (txn.unitPrice || '');
                                    return (
                                      <Input
                                        type="number"
                                        value={displayValue}
                                        onChange={e => updateTransaction(idx, 'unitPrice', e.target.value)}
                                        readOnly={isFuelRow}
                                        tabIndex={isFuelRow ? -1 : undefined}
                                        aria-readonly={isFuelRow ? 'true' : undefined}
                                        title={isFuelRow
                                          ? 'Fuel price is set by Fuel Prices master and cannot be edited here'
                                          : 'Non-fuel price — edit to override the product master default'}
                                        className={cn(
                                          'h-8 text-xs text-right font-mono',
                                          isFuelRow && 'bg-muted/40 cursor-not-allowed'
                                        )}
                                        placeholder="0"
                                      />
                                    );
                                  })()}
                                </td>
                                <td className="px-2 py-1 text-right">
                                  <span className="font-mono font-bold text-sm">{fmtPKR(toNumber(txn.lineTotal))}</span>
                                </td>
                                <td className="px-2 py-1">
                                  <Select value={txn.paymentMethod} onValueChange={v => updateTransaction(idx, 'paymentMethod', v)}>
                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="cash">Cash</SelectItem>
                                      <SelectItem value="credit_card">Credit Card</SelectItem>
                                      <SelectItem value="bank_card">Bank Card</SelectItem>
                                      <SelectItem value="pso_card">PSO Card</SelectItem>
                                      <SelectItem value="credit_customer">Credit</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="px-2 py-1">
                                  {showBank ? (
                                    <Select value={txn.bankId || ''} onValueChange={v => updateTransaction(idx, 'bankId', v)}>
                                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Bank" /></SelectTrigger>
                                      <SelectContent>
                                        {(banksData || []).map((b: any) => (
                                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <span className="text-muted-foreground/40 text-xs px-2">—</span>
                                  )}
                                </td>
                                <td className="px-1 py-1 sticky right-0 bg-white z-10 border-l">
                                  <div className="flex gap-0.5 justify-center">
                                    <Button size="sm" variant="ghost"
                                      className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                      onClick={() => saveRow(idx)} title="Save row">
                                      <Save className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button size="sm" variant="ghost"
                                      className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                                      onClick={() => removeTransaction(idx)} title="Delete row">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT PANEL: Reconciliation ──────────────────────────────────── */}
        {!rightCollapsed && (
          <div className="w-[272px] border-l flex-shrink-0 overflow-y-auto bg-slate-50/50 p-3 space-y-4">
            {/* Fuel Reconciliation */}
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Fuel Reconciliation</div>
              {/* HSD */}
              <div className="space-y-1.5 mb-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-blue-700">HSD (Diesel)</span>
                  <span className={cn('font-mono text-xs font-bold', hsdPct >= 95 ? 'text-emerald-600' : 'text-slate-600')}>{hsdPct}%</span>
                </div>
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', hsdPct >= 95 ? 'bg-emerald-500' : 'bg-blue-500')}
                    style={{ width: `${Math.min(hsdPct, 100)}%` }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-slate-400 pt-0.5">
                  <div>
                    Meter<br />
                    <span className="font-mono text-slate-700 font-semibold">{fmtL(hsd)}</span>
                    <span className="block font-mono text-slate-500 text-[10px]">{fmtPKR(hsd * hsdPrice)} PKR</span>
                  </div>
                  <div className="text-center">
                    Posted<br />
                    <span className="font-mono text-blue-600 font-semibold">{fmtL(hsdPosted)}</span>
                    <span className="block font-mono text-blue-500 text-[10px]">{fmtPKR(hsdPosted * hsdPrice)} PKR</span>
                  </div>
                  <div className="text-right">
                    Remain<br />
                    <span className="font-mono text-orange-600 font-bold text-sm">{fmtL(hsdRemain)}</span>
                    <span className="block font-mono text-orange-500 text-[10px]">{fmtPKR(hsdRemain * hsdPrice)} PKR</span>
                  </div>
                </div>
              </div>
              {/* PMG */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-green-700">PMG (Petrol)</span>
                  <span className={cn('font-mono text-xs font-bold', pmgPct >= 95 ? 'text-emerald-600' : 'text-slate-600')}>{pmgPct}%</span>
                </div>
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', pmgPct >= 95 ? 'bg-emerald-500' : 'bg-green-500')}
                    style={{ width: `${Math.min(pmgPct, 100)}%` }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-slate-400 pt-0.5">
                  <div>
                    Meter<br />
                    <span className="font-mono text-slate-700 font-semibold">{fmtL(pmg)}</span>
                    <span className="block font-mono text-slate-500 text-[10px]">{fmtPKR(pmg * pmgPrice)} PKR</span>
                  </div>
                  <div className="text-center">
                    Posted<br />
                    <span className="font-mono text-green-600 font-semibold">{fmtL(pmgPosted)}</span>
                    <span className="block font-mono text-green-500 text-[10px]">{fmtPKR(pmgPosted * pmgPrice)} PKR</span>
                  </div>
                  <div className="text-right">
                    Remain<br />
                    <span className="font-mono text-orange-600 font-bold text-sm">{fmtL(pmgRemain)}</span>
                    <span className="block font-mono text-orange-500 text-[10px]">{fmtPKR(pmgRemain * pmgPrice)} PKR</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="h-px bg-slate-200" />

            {/* Payment Breakdown */}
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Payments</div>
              <div className="space-y-1.5 text-xs">
                {([
                  { label: 'Cash', value: paymentBreakdown.cash },
                  { label: 'Credit Card', value: paymentBreakdown.credit_card },
                  { label: 'Bank Card', value: paymentBreakdown.bank_card },
                  { label: 'PSO Card', value: paymentBreakdown.pso_card },
                  { label: 'Credit Cust.', value: paymentBreakdown.credit_customer },
                ] as const).filter(r => r.value > 0 || r.label === 'Cash').map(r => (
                  <div key={r.label} className="flex justify-between">
                    <span className="text-slate-500">{r.label}</span>
                    <span className="font-mono font-semibold text-slate-700">{fmtPKR(r.value)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold border-t border-slate-200 pt-2 mt-2 text-sm">
                  <span className="text-slate-700">Total Sales (Fuel + Non-fuel)</span>
                  <span className="font-mono text-slate-900">{fmtPKR(paymentSummary.total)}</span>
                </div>
              </div>
            </div>

            {/* Non-Fuel + Fuel breakdown */}
            {paymentSummary.total > 0 && (
              <>
                <div className="h-px bg-slate-200" />
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Breakdown</div>
                  <div className="space-y-1.5 text-xs">
                    {paymentSummary.nonFuel > 0 && (
                      <div className="flex justify-between font-semibold">
                        <span className="text-slate-700">Total Non-Fuel Sale (Cash + Credit)</span>
                        <span className="font-mono text-slate-900">{fmtPKR(paymentSummary.nonFuel)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-semibold">
                      <span className="text-slate-700">Total Fuel Sale for the day</span>
                      <span className="font-mono text-slate-900">{fmtPKR(paymentSummary.fuel)}</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="h-px bg-slate-200" />

            {/* Summary */}
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Summary</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Customer groups</span>
                  <span className="font-mono font-semibold">{customerGroups.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Transactions</span>
                  <span className="font-mono font-semibold">{transactions.length}</span>
                </div>
                {lastSaved && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Last saved</span>
                    <span className="text-emerald-600 font-medium">{format(lastSaved, 'HH:mm')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          DIALOGS — identical to previous version
          ═══════════════════════════════════════════════════════════════════════ */}

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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {finalizeResult?.type === 'success' ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-emerald-700">
                  {finalizeResult.alreadyFinalized
                    ? 'Day Already Finalized'
                    : (formatReconciledDateHeader(finalizeResult.businessDate) || 'Successfully Reconciled!')}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 text-sm">

                {/* Summary message */}
                <p className="text-muted-foreground">{finalizeResult.message}</p>

                {/* Reconciliation Totals Summary */}
                {finalizeResult.reconciliationTotals && !finalizeResult.alreadyFinalized && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-3 space-y-2 text-sm">
                    <div className="font-semibold text-blue-900 mb-2 text-xs">
                      RECONCILIATION SUMMARY
                    </div>

                    {/* HSD Sales */}
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Total HSD Sales Reconciled:</span>
                      <span className="font-semibold font-mono">
                        {finalizeResult.reconciliationTotals.hsd.liters.toFixed(3)} L @ PKR {finalizeResult.reconciliationTotals.hsd.amount.toFixed(2)}
                      </span>
                    </div>

                    {/* PMG Sales */}
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Total PMG Sales Reconciled:</span>
                      <span className="font-semibold font-mono">
                        {finalizeResult.reconciliationTotals.pmg.liters.toFixed(3)} L @ PKR {finalizeResult.reconciliationTotals.pmg.amount.toFixed(2)}
                      </span>
                    </div>

                    {/* Non-Fuel Sales */}
                    {finalizeResult.reconciliationTotals.nonFuel.amount > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Total Non Fuel Items Posted:</span>
                        <span className="font-semibold font-mono">
                          PKR {finalizeResult.reconciliationTotals.nonFuel.amount.toFixed(2)}
                        </span>
                      </div>
                    )}

                    {/* Total Sales */}
                    <div className="flex justify-between border-t pt-2 mt-2 text-xs">
                      <span className="text-muted-foreground font-semibold">Total Sales Posted:</span>
                      <span className="font-semibold font-mono text-blue-900">
                        PKR {finalizeResult.reconciliationTotals.total.amount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Details Section */}
                <div className="bg-green-50 border border-green-200 rounded p-3 space-y-2 text-sm">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Transactions Posted:</span>
                    <span className="font-semibold">{finalizeResult.transactionsProcessed || 0}</span>
                  </div>
                  {finalizeResult.salesCreated > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Sales Records Created:</span>
                      <span className="font-semibold">{finalizeResult.salesCreated}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Branch:</span>
                    <span className="font-semibold">{finalizeResult.branchName || branchesData?.find((b: any) => b.id === selectedBranchId)?.name || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Created By:</span>
                    <span className="font-semibold">{finalizeResult.finalizedBy || 'Unknown'}</span>
                  </div>
                </div>

                {/* Finalization Timestamp Footer */}
                {finalizeResult.finalizedAt && (
                  <div className="text-xs text-center text-muted-foreground border-t pt-3">
                    Finalized & Reconciled on Date/Time:{' '}
                    <span className="font-semibold text-slate-700">
                      {format(new Date(finalizeResult.finalizedAt), 'PPpp')}
                    </span>
                  </div>
                )}

                {/* Cash Gap Warning (if present) */}
                {finalizeResult.cashGapWarning && (
                  <div className="bg-amber-50 border border-amber-200 rounded p-3 text-amber-800 text-xs space-y-1">
                    <div className="font-semibold">⚠️ Cash Variance</div>
                    <div>PKR {Math.abs(finalizeResult.cashGapWarning.amount).toFixed(2)}</div>
                  </div>
                )}

                {!finalizeResult.alreadyFinalized && (
                  <div className="text-xs text-muted-foreground text-center">
                    Transactions will be synced to QuickBooks in the background.
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
