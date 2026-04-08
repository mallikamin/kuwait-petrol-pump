import { useEffect, useMemo, useState, useRef } from 'react';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Calendar, DollarSign, AlertCircle, Plus, Trash2, Save, CheckCircle, Users, Copy, Search, Gauge, Camera, Edit, Loader2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { cn } from '@/utils/cn';
import { apiClient } from '@/api/client';
import { branchesApi, customersApi, meterReadingsApi, productsApi } from '@/api';
import { banksApi } from '@/api/banks';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MeterReadingCapture, type MeterReadingData } from '@/components/MeterReadingCapture';

interface Transaction {
  id?: string;
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
  bankId?: string; // Required for card payments (credit_card, bank_card)
  _localStatus?: 'draft' | 'saved'; // Local status for UI feedback
  // Audit fields
  createdBy?: string;
  createdByUser?: { id: string; fullName: string; username: string } | null;
  updatedBy?: string;
  updatedByUser?: { id: string; fullName: string; username: string } | null;
  createdAt?: string;
  updatedAt?: string;
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
  shift_instance?: {
    shift?: {
      name?: string;
    };
  };
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
  const justSavedRef = useRef(false); // Track if we just saved to prevent useEffect from overwriting

  // UX redesign state
  const [isContextCollapsed, setIsContextCollapsed] = useState(true);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);

  // Use sessionStorage for loadedKey to persist across tab navigation
  const setLoadedKey = (key: string) => sessionStorage.setItem('backdated_loaded_key', key);

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
  const { data: customersData, refetch: refetchCustomers } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const res = await customersApi.getAll();
      return res.items;
    },
  });

  // Fetch products for non-fuel sales
  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await productsApi.getAll({ size: 1000 }); // Get all products
      return res.items;
    },
  });

  // Fetch QB banks for card payment selection
  const { data: banksData } = useQuery({
    queryKey: ['quickbooks', 'banks'],
    queryFn: async () => {
      const res = await banksApi.getAll();
      return res.banks;
    },
  });

  // Fetch fuel prices for the selected business date (historical prices for backdated entries)
  const { data: fuelPricesData } = useQuery({
    queryKey: ['fuel-prices', 'for-date', businessDate],
    enabled: !!businessDate,
    queryFn: async () => {
      if (!businessDate) return [];
      const res = await apiClient.get('/api/fuel-prices/for-date', {
        params: { date: businessDate },
      });
      return res.data || [];
    },
  });

  // Fetch shift templates for the branch (for grouping nozzles)
  const { data: shiftTemplatesData } = useQuery({
    queryKey: ['shift-templates', selectedBranchId],
    enabled: !!selectedBranchId,
    queryFn: async () => {
      const res = await apiClient.get('/api/shifts', {
        params: {
          branchId: selectedBranchId,
        },
      });
      return (res.data?.items || []) as Array<{
        id: string;
        name: string;
        shiftNumber: number;
        startTime: string;
        endTime: string;
      }>;
    },
  });

  // Fetch or create shift instances for selected business date (for meter reading assignments)
  const { data: shiftInstancesData, refetch: refetchShiftInstances } = useQuery({
    queryKey: ['shift-instances-for-date', selectedBranchId, businessDate],
    enabled: !!selectedBranchId && !!businessDate,
    queryFn: async () => {
      const res = await apiClient.get('/api/shifts/instances-for-date', {
        params: {
          branchId: selectedBranchId,
          businessDate: businessDate, // YYYY-MM-DD format
        },
      });
      return (res.data?.shiftInstances || []) as Array<{
        id: string;
        shiftId: string;
        date: string;
        shift?: { name?: string; shiftNumber?: number; startTime?: string; endTime?: string };
      }>;
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
  const { data: meterReadingsData, refetch: refetchMeterReadings } = useQuery({
    queryKey: ['meter-readings-all', selectedBranchId, businessDate, selectedShiftId],
    enabled: !!selectedBranchId && !!businessDate,
    queryFn: async () => {
      if (!selectedBranchId || !businessDate) return [];
      const res = await meterReadingsApi.getAll({
        size: 500,
        date: businessDate, // Business date filter (YYYY-MM-DD)
      });
      return (res.items || []) as MeterReadingRow[];
    },
  });

  // Get previous reading for a nozzle (shift-aware) - MUST be defined before useMemo hooks that call it
  const getPreviousReading = (nozzleId: string, type: 'opening' | 'closing', currentShift?: any): number => {
    const readings = (meterReadingsData || []).filter((r: any) => r.nozzle_id === nozzleId);

    if (type === 'opening' && currentShift) {
      // For opening reading, find the previous shift's closing value
      const currentShiftNumber = currentShift.shiftNumber;

      // Find the previous shift template (shiftNumber - 1)
      const previousShiftTemplate = (shiftTemplatesData || []).find((st: any) =>
        st.shiftNumber === currentShiftNumber - 1
      );

      if (previousShiftTemplate) {
        // Find the shift instance for the previous shift template on this business date
        const previousShiftInstance = (shiftInstancesData || []).find((si: any) =>
          si.shiftId === previousShiftTemplate.id
        );

        if (previousShiftInstance) {
          // Find closing reading from previous shift instance
          const previousShiftClosing = readings.find((r: any) =>
            r.reading_type === 'closing' &&
            r.shift_instance?.id === previousShiftInstance.id
          );

          if (previousShiftClosing) {
            return toNumber(previousShiftClosing.meter_value ?? previousShiftClosing.reading_value);
          }
        }
      }

      // Fallback: if no previous shift found, use latest closing from any shift on this date
      const latestClosing = readings
        .filter((r: any) => r.reading_type === 'closing')
        .sort((a: any, b: any) => new Date(b.recorded_at || b.created_at).getTime() - new Date(a.recorded_at || a.created_at).getTime())[0];

      return latestClosing ? toNumber(latestClosing.meter_value ?? latestClosing.reading_value) : 0;
    } else if (type === 'closing' && currentShift) {
      // For closing reading, use THIS shift's opening
      const currentShiftInstance = (shiftInstancesData || []).find((si: any) =>
        si.shiftId === currentShift.id
      );

      if (currentShiftInstance) {
        const openingReading = readings.find((r: any) =>
          r.reading_type === 'opening' &&
          r.shift_instance?.id === currentShiftInstance.id
        );

        if (openingReading) {
          return toNumber(openingReading.meter_value ?? openingReading.reading_value);
        }
      }

      // If no opening in DB, check if there's an auto-filled opening (from previous shift's closing)
      const computedOpening = getPreviousReading(nozzleId, 'opening', currentShift);
      if (computedOpening > 0) {
        return computedOpening;
      }

      // Final fallback: any opening reading for this nozzle today
      const anyOpening = readings.find((r: any) => r.reading_type === 'opening');
      return anyOpening ? toNumber(anyOpening.meter_value ?? anyOpening.reading_value) : 0;
    }

    return 0;
  };

  // Compute fuel totals using shift-segregated pairs (closing - opening per shift per nozzle)
  const fuelTotals = useMemo(() => {
    const totals = { HSD: 0, PMG: 0, other: 0 };

    if (!nozzlesData || !shiftTemplatesData || !shiftInstancesData) return totals;

    (nozzlesData || []).forEach((nozzle: any) => {
      const nozzleReadings = (meterReadingsData || []).filter((r: any) => r.nozzle_id === nozzle.id);

      // For each shift, compute sales (closing - opening)
      (shiftTemplatesData || []).forEach((shiftTemplate: any) => {
        const shiftInstance = (shiftInstancesData || []).find((si: any) => si.shiftId === shiftTemplate.id);
        if (!shiftInstance) return;

        const shiftReadings = nozzleReadings.filter((r: any) => r.shift_instance?.id === shiftInstance.id);
        const opening = shiftReadings.find((r: any) => r.reading_type === 'opening');
        const closing = shiftReadings.find((r: any) => r.reading_type === 'closing');

        // Compute auto-fill opening if not in DB
        const openingValue = opening
          ? toNumber(opening.meter_value ?? opening.reading_value)
          : getPreviousReading(nozzle.id, 'opening', shiftTemplate);

        const closingValue = closing ? toNumber(closing.meter_value ?? closing.reading_value) : 0;

        // Only count sales if we have both values
        if ((opening || openingValue > 0) && closing) {
          const sales = closingValue - openingValue;
          const fuelCode = nozzle.fuelType?.code;
          if (fuelCode === 'HSD') totals.HSD += sales;
          else if (fuelCode === 'PMG') totals.PMG += sales;
          else totals.other += sales;
        }
      });
    });

    return totals;
  }, [nozzlesData, meterReadingsData, shiftTemplatesData, shiftInstancesData]);

  // Compute posted fuel totals from transactions (uses fuelCode directly)
  const postedByFuel = useMemo(() => {
    const posted = { HSD: 0, PMG: 0, other: 0 };
    transactions.forEach(txn => {
      const qty = toNumber(txn.quantity);
      if (txn.fuelCode === 'HSD') posted.HSD += qty;
      else if (txn.fuelCode === 'PMG') posted.PMG += qty;
      else if (txn.fuelCode === 'OTHER') posted.other += qty;
    });

    console.log('[Posted Calculation]', {
      transactionsCount: transactions.length,
      posted,
      sampleFuelCodes: transactions.slice(0, 3).map(t => ({ qty: t.quantity, fuelCode: t.fuelCode }))
    });

    return posted;
  }, [transactions]);

  // Compute nozzle-level meter reading status for checklist
  const nozzleReconciliation = useMemo(() => {
    return (nozzlesData || []).map((nozzle: any) => {
      const readings = (meterReadingsData || []).filter((r: any) => r.nozzle_id === nozzle.id);
      const opening = readings.find((r: any) => r.reading_type === 'opening');
      const closing = readings.find((r: any) => r.reading_type === 'closing');
      const hasOpening = !!opening;
      const hasClosing = !!closing;
      const hasBoth = hasOpening && hasClosing;

      return {
        nozzleId: nozzle.id,
        nozzleName: nozzle.name || `N${nozzle.nozzleNumber}`,
        fuelCode: nozzle.fuelType?.code || 'Unknown',
        hasOpening,
        hasClosing,
        hasBoth,
      };
    });
  }, [nozzlesData, meterReadingsData]);

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

  // Totals Integrity: Track missing readings
  const readingsIntegrity = useMemo(() => {
    if (!nozzlesData || !shiftTemplatesData) return { expected: 0, foundDb: 0, autoFilled: 0, missing: [] };

    const expected = (nozzlesData || []).length * (shiftTemplatesData || []).length * 2; // 2 = opening + closing
    const foundDb = (meterReadingsData || []).length;
    let autoFilled = 0;
    const missing: Array<{ shift: string; nozzle: string; type: string }> = [];

    (nozzlesData || []).forEach((nozzle: any) => {
      (shiftTemplatesData || []).forEach((shiftTemplate: any) => {
        const shiftInstance = (shiftInstancesData || []).find((si: any) => si.shiftId === shiftTemplate.id);
        if (!shiftInstance) return;

        const nozzleReadings = (meterReadingsData || []).filter(
          (r: any) => r.nozzle_id === nozzle.id && r.shift_instance?.id === shiftInstance.id
        );

        const hasOpening = nozzleReadings.some((r: any) => r.reading_type === 'opening');
        const hasClosing = nozzleReadings.some((r: any) => r.reading_type === 'closing');

        // Check for auto-filled opening (not in DB but computed)
        const computedOpening = !hasOpening ? getPreviousReading(nozzle.id, 'opening', shiftTemplate) : 0;

        if (!hasOpening && computedOpening > 0) {
          autoFilled++; // Count as auto-filled (functionally complete)
        } else if (!hasOpening && computedOpening === 0) {
          missing.push({ shift: shiftTemplate.name, nozzle: nozzle.name, type: 'Opening' });
        }

        if (!hasClosing) {
          missing.push({ shift: shiftTemplate.name, nozzle: nozzle.name, type: 'Closing' });
        }
      });
    });

    return { expected, foundDb, autoFilled, missing };
  }, [nozzlesData, shiftTemplatesData, shiftInstancesData, meterReadingsData]);

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
    // Sort groups by most recent first (highest first index = added later)
    return Array.from(grouped.entries())
      .map(([customerId, { indices, txns }]) => ({
        customerId,
        customerName: customerId === '__walkin__' ? 'Walk-in Sales' : (txns[0].customerName || 'Unknown'),
        indices,
        transactions: txns,
        totalLiters: txns.reduce((s, t) => s + toNumber(t.quantity), 0),
        totalAmount: txns.reduce((s, t) => s + toNumber(t.lineTotal), 0),
        firstIndex: indices[0], // Track first occurrence for sorting
      }))
      .sort((a, b) => b.firstIndex - a.firstIndex); // Descending: newest at top
  }, [transactions]);

  // Keep accordion items open by default (sync with customer groups)
  useEffect(() => {
    const allCustomerIds = customerGroups.map(g => g.customerId);
    // Add any new customer IDs that aren't already in the open list
    const newIds = allCustomerIds.filter(id => !openAccordionItems.includes(id));
    if (newIds.length > 0) {
      setOpenAccordionItems([...openAccordionItems, ...newIds]);
    }
  }, [customerGroups]);

  // Add customer group dialog state
  const [isAddGroupOpen, setIsAddGroupOpen] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');

  // Add new customer dialog state
  const [showAddCustomerDialog, setShowAddCustomerDialog] = useState(false);
  const [isSubmittingCustomer, setIsSubmittingCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '' });

  // Ref for scrolling to transactions section
  const transactionsCardRef = useRef<HTMLDivElement>(null);

  // Accordion state - track which customer groups are open
  const [openAccordionItems, setOpenAccordionItems] = useState<string[]>([]);

  // Reconciliation panel collapse state (default collapsed to reduce scrolling)
  const [isReconciliationCollapsed, setIsReconciliationCollapsed] = useState(true);

  // Meter reading dialog state
  const [isMeterReadingOpen, setIsMeterReadingOpen] = useState(false);
  const [selectedMeterNozzle, setSelectedMeterNozzle] = useState<any>(null);
  const [selectedReadingType, setSelectedReadingType] = useState<'opening' | 'closing'>('opening');
  const [selectedShiftForReading, setSelectedShiftForReading] = useState<any>(null); // ← NEW: Track which shift this reading belongs to
  const [_editingReadingId, setEditingReadingId] = useState<string | null>(null);
  const [_editingReadingValue, setEditingReadingValue] = useState<number | null>(null);

  // UI state (removed showReconciliation - now using Accordion)

  // Filtered customers for dialog
  const filteredCustomers = useMemo(() => {
    if (!customerSearchQuery.trim()) return customersData || [];
    const query = customerSearchQuery.toLowerCase();
    return (customersData || []).filter((c: any) =>
      c.name.toLowerCase().includes(query) ||
      (c.phone && c.phone.toLowerCase().includes(query)) ||
      (c.email && c.email.toLowerCase().includes(query))
    );
  }, [customersData, customerSearchQuery]);

  const addTransactionToCustomer = (customerId: string, customerName: string) => {
    setTransactions([
      ...transactions,
      {
        id: crypto.randomUUID(), // ✅ Generate stable client-side ID for upsert (prevents data loss)
        customerId: customerId === '__walkin__' ? '' : customerId,
        customerName: customerId === '__walkin__' ? '' : customerName,
        fuelCode: '',
        productName: '',
        quantity: '',
        unitPrice: '',
        lineTotal: '0',
        paymentMethod: customerId === '__walkin__' ? 'cash' : 'credit_customer', // Walk-in defaults to cash, customers to credit
        _localStatus: 'draft', // Mark as draft until saved
      },
    ]);

    // Ensure the customer's accordion is open
    if (!openAccordionItems.includes(customerId)) {
      setOpenAccordionItems([...openAccordionItems, customerId]);
    }

    // Scroll to the newly added customer's accordion item
    setTimeout(() => {
      const accordionItem = document.querySelector(`[data-customer-id="${customerId}"]`);
      if (accordionItem) {
        accordionItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150); // Slightly longer delay to ensure accordion opens
  };

  const handleAddNewCustomer = async () => {
    if (!newCustomer.name.trim()) {
      toast.error('Customer name is required');
      return;
    }

    setIsSubmittingCustomer(true);
    try {
      const response = await customersApi.create({
        name: newCustomer.name.trim(),
        phone: newCustomer.phone.trim() || undefined,
        email: newCustomer.email.trim() || undefined,
      });

      const customer = response; // API returns customer directly (not nested)

      toast.success('Customer added successfully');
      setShowAddCustomerDialog(false);
      setNewCustomer({ name: '', phone: '', email: '' });

      // Refresh customer list
      refetchCustomers();

      // Auto-add transaction for this customer (dialog stays open until transaction added)
      if (customer && customer.id && customer.name) {
        setTimeout(() => {
          addTransactionToCustomer(customer.id, customer.name);
          setIsAddGroupOpen(false);
        }, 100); // Small delay to allow customer list refresh
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to add customer');
    } finally {
      setIsSubmittingCustomer(false);
    }
  };

  const duplicateLastInGroup = (groupIndices: number[]) => {
    if (groupIndices.length === 0) return;
    const lastIdx = groupIndices[groupIndices.length - 1];
    const lastRow = transactions[lastIdx];
    setTransactions([
      ...transactions,
      { ...lastRow, id: crypto.randomUUID(), quantity: '', lineTotal: '0', _localStatus: 'draft' }, // ✅ New UUID for duplicate
    ]);
  };

  // Save individual transaction row (triggers auto-save to server)
  const saveTransactionRow = async (index: number) => {
    const updated = [...transactions];
    updated[index] = { ...updated[index], _localStatus: 'saved' };
    setTransactions(updated);

    // Auto-save to server immediately
    try {
      await saveDailyDraftMutation.mutateAsync();
      toast.success('Row saved successfully');
    } catch (error) {
      console.error('Auto-save failed:', error);
      toast.error('Failed to save row. Please click "Save Draft" manually.');
      updated[index]._localStatus = 'draft'; // Revert status on error
      setTransactions(updated);
    }
  };

  const mappedShiftOptions = useMemo(
    () =>
      (shiftInstancesData || []).map((instance) => ({
        id: instance.id,
        label: instance.shift?.name || `Shift ${instance.shift?.shiftNumber || ''}`.trim(),
      })),
    [shiftInstancesData]
  );

  // REMOVED: Duplicate useEffect that was overwriting transactions after save.

  // Auto-save effect (mark dirty on transaction changes)
  useEffect(() => {
    if (transactions.length > 0) setIsDirty(true);
  }, [transactions]);

  // Save transactions to sessionStorage on every change (prevents data loss on navigation)
  useEffect(() => {
    if (selectedBranchId && businessDate && transactions.length > 0) {
      const key = `backdated_transactions_${selectedBranchId}_${businessDate}_${selectedShiftId || 'all'}`;
      sessionStorage.setItem(key, JSON.stringify({
        transactions,
        timestamp: Date.now(),
      }));
      console.log('[SessionStorage] Saved', transactions.length, 'transactions');
    }
  }, [transactions, selectedBranchId, businessDate, selectedShiftId]);


  // Load transactions from API on branch/date/shift change
  useEffect(() => {
    // Skip if we just saved (prevents overwriting local state after save)
    if (justSavedRef.current) {
      console.log('[Transactions] Skipping reset after save');
      justSavedRef.current = false;
      return;
    }

    if (!selectedBranchId || !businessDate) {
      console.log('[Transactions] Clearing (no branch/date selected)');
      setTransactions([]);
      setSyncMessage('');
      setLoadedKey('');
      return;
    }

    const currentKey = `${selectedBranchId}_${businessDate}_${selectedShiftId || 'all'}`;
    const previousKey = sessionStorage.getItem('backdated_loaded_key');

    // ✅ FIX: If businessDate changed, clear in-memory staged rows for previous key
    if (previousKey && previousKey !== currentKey) {
      const oldSessionKey = `backdated_transactions_${previousKey}`;
      console.log('[Date Change] Clearing previous date data:', { previousKey, currentKey });
      sessionStorage.removeItem(oldSessionKey);
    }

    console.log('[Transactions] Loading key:', {
      currentKey,
      previousKey,
      dateChanged: previousKey !== currentKey,
      hasAPIData: !!dailySummaryData?.transactions,
      apiCount: dailySummaryData?.transactions?.length || 0,
    });

    // Try loading from sessionStorage first (preserves unsaved work)
    const sessionKey = `backdated_transactions_${currentKey}`;
    const sessionData = sessionStorage.getItem(sessionKey);
    if (sessionData) {
      try {
        const { transactions: sessionTxns, timestamp } = JSON.parse(sessionData);
        const ageMinutes = (Date.now() - timestamp) / 1000 / 60;

        // ✅ FIX: NEVER auto-discard unsaved work - always restore regardless of age
        // User can manually discard if they want fresh start
        if (sessionTxns.length > 0) {
          const ageHours = Math.floor(ageMinutes / 60);
          const ageDisplay = ageHours > 0
            ? `${ageHours}h ${Math.round(ageMinutes % 60)}min`
            : `${Math.round(ageMinutes)} min`;

          console.log('[Transactions] Loading from sessionStorage:', sessionTxns.length, '(age:', ageDisplay, ')');
          setTransactions(sessionTxns);
          setSyncMessage(`⚠️ Restored ${sessionTxns.length} UNSAVED transactions from ${ageDisplay} ago. Click "Save Draft" to persist to server.`);
          setIsDirty(true); // Mark as dirty to trigger save reminder
          setLoadedKey(currentKey);
          return;
        }
      } catch (e) {
        console.error('[SessionStorage] Parse error:', e);
      }
    }

    // Load from API (server-saved data)
    if (dailySummaryData?.transactions && dailySummaryData.transactions.length > 0) {
      console.log('[Transactions] Loading from API:', dailySummaryData.transactions.length);
      setTransactions(
        dailySummaryData.transactions.map((txn: any) => ({
          id: txn.id,
          customerId: txn.customer?.id || '',
          customerName: txn.customer?.name || '',
          fuelCode: txn.fuelCode || txn.nozzle?.fuelType?.code || '',
          vehicleNumber: txn.vehicleNumber || '',
          slipNumber: txn.slipNumber || '',
          productName: txn.productName || 'Fuel',
          quantity: toNumber(txn.quantity).toString(),
          unitPrice: toNumber(txn.unitPrice).toFixed(2),
          lineTotal: toNumber(txn.lineTotal).toFixed(2),
          paymentMethod: txn.paymentMethod,
          bankId: txn.bankId || '',
          // Audit fields
          createdBy: txn.createdBy,
          createdByUser: txn.createdByUser,
          updatedBy: txn.updatedBy,
          updatedByUser: txn.updatedByUser,
          createdAt: txn.createdAt,
          updatedAt: txn.updatedAt,
        }))
      );
      setSyncMessage(`Loaded ${dailySummaryData.transactions.length} existing transactions.`);
      setLoadedKey(currentKey);
      // Clear sessionStorage since we loaded from server
      sessionStorage.removeItem(sessionKey);
    } else {
      console.log('[Transactions] No API data, clearing');
      setTransactions([]);
      setSyncMessage('No existing transactions. Start adding customer groups.');
      setLoadedKey(currentKey); // Mark as loaded even if empty
    }
  }, [
    selectedBranchId,
    businessDate,
    selectedShiftId,
    dailySummaryData,
  ]);



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

  // Track viewport height for responsive sticky behavior
  useEffect(() => {
    const handleResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Remove transaction row
  const removeTransaction = (index: number) => {
    setTransactions(transactions.filter((_, i) => i !== index));
  };

  // Update transaction field
  const updateTransaction = (index: number, field: keyof Transaction, value: any) => {
    const updated = [...transactions];
    updated[index] = { ...updated[index], [field]: value };

    // Auto-fill product name and unit price when fuel type selected
    if (field === 'fuelCode') {
      const fuelPrice = (fuelPricesData || []).find((fp: any) => fp.fuelType?.code === value);
      if (value === 'HSD') {
        updated[index].productName = 'High Speed Diesel';
        updated[index].unitPrice = fuelPrice?.pricePerLiter?.toString() || '340'; // Live price or fallback
      } else if (value === 'PMG') {
        updated[index].productName = 'Premium Motor Gasoline';
        updated[index].unitPrice = fuelPrice?.pricePerLiter?.toString() || '458'; // Live price or fallback
      } else if (value === 'OTHER') {
        updated[index].productName = 'Other Fuel';
        updated[index].unitPrice = fuelPrice?.pricePerLiter?.toString() || '0.00';
      }
    }

    // Auto-calculate line total when quantity or unit price changes
    if (field === 'quantity' || field === 'unitPrice' || field === 'fuelCode') {
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
      console.log('[Save Draft] Starting...', {
        branchId: selectedBranchId,
        businessDate,
        transactionCount: transactions.length,
      });

      if (!selectedBranchId) {
        const error = 'Please select a branch';
        console.error('[Save Draft] Validation failed:', error);
        throw new Error(error);
      }

      if (transactions.length === 0) {
        const error = 'No transactions to save';
        console.error('[Save Draft] Validation failed:', error);
        throw new Error(error);
      }

      // Validate credit customer requirements
      for (const txn of transactions) {
        if (txn.paymentMethod === 'credit_customer') {
          if (!txn.customerId || !txn.vehicleNumber || !txn.slipNumber) {
            const error = `Credit customer transaction requires customer, vehicle#, and slip# (row with ${txn.quantity}L)`;
            console.error('[Save Draft] Validation failed:', error);
            throw new Error(error);
          }
        }
      }

      console.log('[Save Draft] Sending to API:', {
        endpoint: '/api/backdated-entries/daily',
        payload: {
          branchId: selectedBranchId,
          businessDate,
          shiftId: selectedShiftId || undefined,
          transactionCount: transactions.length,
        },
      });

      const res = await apiClient.post('/api/backdated-entries/daily', {
        branchId: selectedBranchId,
        businessDate,
        shiftId: selectedShiftId || undefined,
        transactions: transactions.map(txn => ({
          customerId: txn.customerId || undefined,
          fuelCode: txn.fuelCode || undefined,
          vehicleNumber: txn.vehicleNumber || undefined,
          slipNumber: txn.slipNumber || undefined,
          productName: txn.productName,
          quantity: toNumber(txn.quantity),
          unitPrice: toNumber(txn.unitPrice),
          lineTotal: toNumber(txn.lineTotal),
          paymentMethod: txn.paymentMethod,
          bankId: txn.bankId || undefined,
        })),
      });

      console.log('[Save Draft] API response:', res.data);
      return res.data.data;
    },
    onSuccess: () => {
      console.log('[Save Draft] Success!');
      toast.success('Draft saved successfully');
      setLastSaved(new Date());
      setIsDirty(false);
      justSavedRef.current = true; // Prevent useEffect from overwriting local state
      setLoadedKey(''); // Allow reload on next navigation (fresh data from server)

      // Clear sessionStorage since data is now on server
      const sessionKey = `backdated_transactions_${selectedBranchId}_${businessDate}_${selectedShiftId || 'all'}`;
      sessionStorage.removeItem(sessionKey);
      console.log('[SessionStorage] Cleared after successful save');

      refetchDailySummary();
    },
    onError: (error: any) => {
      console.error('[Save Draft] Error:', {
        message: error.message,
        response: error?.response?.data,
        status: error?.response?.status,
      });

      // Detect network errors (ERR_NAME_NOT_RESOLVED, ERR_CONNECTION_REFUSED, etc.)
      const isNetworkError = !error?.response && (error.message?.includes('ERR_') || error.message?.includes('Network Error'));

      if (isNetworkError) {
        toast.error('Network error - draft kept locally. Retry when connection is restored.', { duration: 5000 });
      } else {
        const errorMsg = error?.response?.data?.error || error.message || 'Failed to save draft';
        toast.error(`Save failed: ${errorMsg}. Draft kept locally - you can retry.`, { duration: 5000 });
      }

      // DO NOT clear sessionStorage or local state on error - preserve user's work
      console.log('[Save Draft] Draft preserved locally after error');
    },
  });

  // Finalize day mutation (enqueue QB sync)
  const finalizeDayMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBranchId) {
        throw new Error('Please select a branch');
      }

      console.log('[Finalize] Sending:', { branchId: selectedBranchId, businessDate });

      const res = await apiClient.post('/api/backdated-entries/daily/finalize', {
        branchId: selectedBranchId,
        businessDate,
      });

      console.log('[Finalize] Response:', res.data);
      return res.data.data;
    },
    onSuccess: (data: any) => {
      const message = data?.message || `Day finalized! ${data?.transactionsCount || 0} transactions queued for QuickBooks sync. ${data?.salesCount || 0} sales created.`;
      toast.success(message);
      console.log('[Finalize] Success:', data);
      setIsDirty(false); // ✅ Reset dirty state after successful finalize
      refetchDailySummary();
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error.message || 'Failed to finalize day';
      console.error('[Finalize] Error:', error.response?.data || error);
      toast.error(`Finalize failed: ${errorMsg}`);
    },
  });

  const handleSaveDraft = async () => {
    console.log('[Save Draft] Button clicked', {
      transactionCount: transactions.length,
      branchId: selectedBranchId,
      businessDate,
    });
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

    // Calculate reconciliation percentage
    const totalMeter = fuelTotals.HSD + fuelTotals.PMG;
    const totalPosted = postedByFuel.HSD + postedByFuel.PMG;
    const reconciledPercent = totalMeter > 0 ? (totalPosted / totalMeter) * 100 : 0;

    // Warn if not fully reconciled
    if (reconciledPercent < 95) {
      const proceed = window.confirm(
        `WARNING: Only ${reconciledPercent.toFixed(1)}% reconciled.\n\n` +
        `Meter Total: ${totalMeter.toFixed(0)}L\n` +
        `Posted: ${totalPosted.toFixed(0)}L\n` +
        `Remaining: ${(totalMeter - totalPosted).toFixed(0)}L\n\n` +
        `Finalize anyway? (Not recommended - add remaining transactions first)`
      );
      if (!proceed) return;
    }

    await finalizeDayMutation.mutateAsync();
  };

  // Save backdated meter reading mutation
  const saveMeterReadingMutation = useMutation({
    mutationFn: async ({ nozzleId, readingType, meterValue, imageUrl, ocrConfidence, isManual, shiftId }: {
      nozzleId: string;
      readingType: 'opening' | 'closing';
      meterValue: number;
      imageUrl?: string;
      ocrConfidence?: number;
      isManual: boolean;
      shiftId: string; // ← Now REQUIRED, passed from UI
    }) => {
      if (!shiftId) {
        throw new Error('Shift ID is required. Please select a shift.');
      }

      const res = await apiClient.post('/api/meter-readings', {
        nozzleId,
        shiftId,                     // ← Pass shiftId (template ID), backend will auto-create instance
        readingType,
        meterValue,
        customTimestamp: `${businessDate}T12:00:00.000Z`, // ← Use customTimestamp for backdated entries
        imageUrl,
        ocrConfidence,
        isManualOverride: isManual,
        isOcr: !!ocrConfidence,
      });
      return res.data;
    },
    onSuccess: (_data, variables) => {
      const { readingType } = variables;
      const direction = readingType === 'closing' ? 'next day opening' : 'previous day closing';
      toast.success(`Meter reading saved! Auto-synced to ${direction}.`);
      setIsMeterReadingOpen(false);
      setSelectedMeterNozzle(null);
      setSelectedShiftForReading(null);
      refetchMeterReadings(); // Refresh meter readings
      refetchDailySummary(); // Refresh daily summary to update totals
      refetchShiftInstances(); // Refresh shift instances to show newly created ones
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error.message || 'Failed to save meter reading';
      toast.error(errorMsg);
    },
  });

  // Delete meter reading mutation
  const deleteMeterReadingMutation = useMutation({
    mutationFn: async (readingId: string) => {
      const res = await apiClient.delete(`/api/meter-readings/${readingId}`);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Meter reading deleted successfully');
      refetchMeterReadings();
      refetchDailySummary();
      refetchShiftInstances();
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error.message || 'Failed to delete meter reading';
      toast.error(errorMsg);
    },
  });

  // Update meter reading mutation
  const updateMeterReadingMutation = useMutation({
    mutationFn: async ({ readingId, meterValue }: { readingId: string; meterValue: number }) => {
      const res = await apiClient.patch(`/api/meter-readings/${readingId}`, { meterValue });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Meter reading updated successfully');
      setEditingReadingId(null);
      setEditingReadingValue(null);
      refetchMeterReadings();
      refetchDailySummary();
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error.message || 'Failed to update meter reading';
      toast.error(errorMsg);
    },
  });

  const handleMeterReadingCapture = async (data: MeterReadingData) => {
    if (!selectedMeterNozzle || !selectedShiftForReading) return;

    // If editing existing reading, call UPDATE
    if (_editingReadingId) {
      await updateMeterReadingMutation.mutateAsync({
        readingId: _editingReadingId,
        meterValue: data.currentReading,
      });
      setIsMeterReadingOpen(false);
      setSelectedMeterNozzle(null);
      setSelectedShiftForReading(null);
      return;
    }

    // Otherwise, create new reading
    await saveMeterReadingMutation.mutateAsync({
      nozzleId: selectedMeterNozzle.id,
      readingType: selectedReadingType,
      meterValue: data.currentReading,
      imageUrl: data.imageUrl,
      ocrConfidence: data.ocrConfidence,
      isManual: data.isManualReading,
      shiftId: selectedShiftForReading.id, // ← Pass shift template ID
    });
  };

  const openMeterReadingDialog = (nozzle: any, shift: any, type: 'opening' | 'closing', reading?: any) => {
    setSelectedMeterNozzle(nozzle);
    setSelectedShiftForReading(shift);
    setSelectedReadingType(type);
    if (reading) {
      setEditingReadingId(reading.id);
      setEditingReadingValue(toNumber(reading.meter_value ?? reading.reading_value));
    } else {
      setEditingReadingId(null);
      setEditingReadingValue(null);
    }
    setIsMeterReadingOpen(true);
  };

  const resetForm = () => {
    setBusinessDate(format(new Date(), 'yyyy-MM-dd'));
    setSelectedBranchId('');
    setSelectedShiftId('');
    setTransactions([]);
    setSyncMessage('');
  };

  return (
    <div className="space-y-4">
      {/* Header - Compact */}
      <div className="flex items-center justify-between py-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Backdated Entries</h1>
          <p className="text-sm text-muted-foreground">
            Historical backlog - Transaction-level backfill for accountant processing
            <span className="text-xs text-orange-600 ml-2">For today's live operations, use the <strong>Meter Readings</strong> page</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-orange-600 border-orange-600">
            PKR Only
          </Badge>
        </div>
      </div>

      {/* Active Filters Display */}
      {(selectedBranchId || businessDate || selectedShiftId) && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm font-medium text-blue-900">Active Filters:</span>
          {businessDate && (
            <Badge variant="secondary" className="bg-blue-100 text-blue-900">
              Date: {format(new Date(businessDate), 'MMM dd, yyyy')}
            </Badge>
          )}
          {selectedBranchId && branchesData && (
            <Badge variant="secondary" className="bg-blue-100 text-blue-900">
              Branch: {branchesData.find((b: any) => b.id === selectedBranchId)?.name || 'Unknown'}
            </Badge>
          )}
          {selectedShiftId && shiftTemplatesData && (
            <Badge variant="secondary" className="bg-blue-100 text-blue-900">
              Shift: {shiftTemplatesData.find((s: any) => s.id === selectedShiftId)?.name || 'Unknown'}
            </Badge>
          )}
          {!selectedShiftId && (
            <Badge variant="secondary" className="bg-green-100 text-green-900">
              All Shifts
            </Badge>
          )}
        </div>
      )}

      {/* Info Alert */}
      <Alert className="border-orange-200 bg-orange-50">
        <AlertCircle className="h-4 w-4 text-orange-600" />
        <AlertDescription className="text-sm text-orange-900">
          <strong>Transaction-First Approach:</strong> Select branch and date, then add customer groups with fuel type. Credit customers require vehicle# and slip#.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Left: Entry Form + Transactions */}
        <div className="flex-1 space-y-4">
          {/* Compact Sticky Toolbar */}
          <div
            className={cn(
              'bg-card border-b shadow-sm z-20 transition-all -mx-6 px-6',
              viewportHeight >= 800 ? 'sticky top-0' : 'relative'
            )}
          >
            <div className="px-0 py-3">
              <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
                {/* Left: Context selectors */}
                <div className="flex-1 flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 min-w-[180px]">
                    <Label className="text-xs text-muted-foreground mb-1">Date</Label>
                    <Input
                      type="date"
                      value={businessDate}
                      onChange={(e) => setBusinessDate(e.target.value)}
                      max={format(new Date(), 'yyyy-MM-dd')}
                      className="h-9"
                    />
                  </div>

                  <div className="flex-1 min-w-[180px]">
                    <Label className="text-xs text-muted-foreground mb-1">Branch</Label>
                    <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                      <SelectTrigger className="h-9">
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

                  <div className="flex-1 min-w-[160px]">
                    <Label className="text-xs text-muted-foreground mb-1">Shift</Label>
                    <Select value={selectedShiftId || '__none__'} onValueChange={(v) => setSelectedShiftId(v === '__none__' ? '' : v)}>
                      <SelectTrigger className="h-9">
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

                {/* Right: Action buttons */}
                <div className="flex gap-2 lg:ml-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveDraft}
                    disabled={saveDailyDraftMutation.isPending || transactions.length === 0}
                    className="h-9"
                  >
                    {saveDailyDraftMutation.isPending ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3 mr-1" />
                    )}
                    Save Draft
                    {lastSaved && <span className="text-xs ml-2">({format(lastSaved, 'HH:mm')})</span>}
                  </Button>

                  <Button
                    onClick={handleFinalizeDay}
                    disabled={finalizeDayMutation.isPending || isDirty || transactions.length === 0}
                    className="bg-green-600 hover:bg-green-700 h-9"
                    size="sm"
                  >
                    {finalizeDayMutation.isPending ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle className="h-3 w-3 mr-1" />
                    )}
                    Finalize
                  </Button>
                </div>
              </div>

              {/* Sync message */}
              {syncMessage && (
                <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  {syncMessage}
                </div>
              )}
            </div>

            {/* Show context toggle button */}
            <div className="px-0 pb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsContextCollapsed(!isContextCollapsed)}
                className="w-full h-8 text-xs text-muted-foreground hover:text-foreground"
              >
                {isContextCollapsed ? (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" />
                    Show Entry Context
                  </>
                ) : (
                  <>
                    <ChevronUp className="h-3 w-3 mr-1" />
                    Hide Entry Context
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Collapsible Entry Context Panel */}
          <Collapsible open={!isContextCollapsed}>
            <CollapsibleContent>
              <Card className="mt-4 mb-6">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Calendar className="h-4 w-4" />
                      Daily Entry Context
                    </CardTitle>
                    {selectedBranchId && businessDate && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const currentKey = `${selectedBranchId}_${businessDate}_${selectedShiftId || 'all'}`;
                          const sessionKey = `backdated_transactions_${currentKey}`;
                          sessionStorage.removeItem(sessionKey);
                          setLoadedKey('');
                          refetchDailySummary();
                          toast.info('Refreshing from server...');
                        }}
                        className="text-xs h-8"
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Refresh from Server
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-3">
                  <div className="grid grid-cols-2 gap-3">
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

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-sm">Shift (Optional)</Label>
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
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>

          {/* Meter Readings Section - Shift-Segregated */}
          {selectedBranchId && businessDate && nozzlesData && nozzlesData.length > 0 && (
            <Accordion type="single" collapsible>
              <AccordionItem value="meter-readings" className="border rounded-lg">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-2">
                    <CardTitle className="flex items-center gap-2">
                      <Gauge className="h-5 w-5" />
                      Backdated Meter Readings
                    </CardTitle>
                    <Badge variant="outline" className="text-blue-600 border-blue-600">
                      <Camera className="h-3 w-3 mr-1" />
                      OCR + Upload
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                {/* Auto-sync info */}
                <Alert className="mb-4 border-green-200 bg-green-50">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-sm text-green-900">
                    <strong>Auto-Sync Enabled:</strong> Closing readings automatically propagate to next day's opening (and vice versa). Enter data in any order.
                  </AlertDescription>
                </Alert>

                {/* Show error if no shift templates configured */}
                {(!shiftTemplatesData || shiftTemplatesData.length === 0) && (
                  <Alert className="mb-4 border-red-200 bg-red-50">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    <AlertDescription className="text-sm text-red-900">
                      <strong>No shift templates configured for this branch.</strong> Please configure shifts in Shift Management first.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Shift-segregated nozzle readings */}
                {shiftTemplatesData && shiftTemplatesData.length > 0 && (
                  <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
                    {shiftTemplatesData.map((shiftTemplate: any) => {
                      // Find shift instance for this shift template on the selected business date
                      const shiftInstance = (shiftInstancesData || []).find(
                        (si: any) => si.shiftId === shiftTemplate.id
                      );

                      // Format shift timing
                      const formatTime = (timeStr: string) => {
                        try {
                          const date = new Date(timeStr);
                          return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                        } catch {
                          return timeStr;
                        }
                      };

                      const startTime = formatTime(shiftTemplate.startTime);
                      const endTime = formatTime(shiftTemplate.endTime);

                      return (
                        <div key={shiftTemplate.id} className="border-2 border-blue-300 rounded-lg p-4 bg-blue-50/30">
                          {/* Shift Header */}
                          <div className="flex items-center justify-between mb-3 pb-2 border-b border-blue-200">
                            <div>
                              <h3 className="font-semibold text-lg text-blue-900">{shiftTemplate.name}</h3>
                              <p className="text-sm text-blue-700">
                                {startTime} – {endTime}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-blue-700 border-blue-600">
                              Shift {shiftTemplate.shiftNumber}
                            </Badge>
                          </div>

                          {/* Nozzles for this shift */}
                          <div className="space-y-3">
                            {(nozzlesData || []).map((nozzle: any) => {
                              // Get readings for this nozzle in this shift instance
                              const nozzleReadings = (meterReadingsData || []).filter(
                                (r: any) =>
                                  r.nozzle_id === nozzle.id &&
                                  shiftInstance &&
                                  r.shift_instance?.id === shiftInstance.id
                              );

                              const hasOpening = nozzleReadings.some((r: any) => r.reading_type === 'opening');
                              const hasClosing = nozzleReadings.some((r: any) => r.reading_type === 'closing');
                              const openingReading = nozzleReadings.find((r: any) => r.reading_type === 'opening');
                              const closingReading = nozzleReadings.find((r: any) => r.reading_type === 'closing');

                              // Compute auto-fill opening value from previous shift's closing
                              const computedOpening = !hasOpening ? getPreviousReading(nozzle.id, 'opening', shiftTemplate) : 0;
                              const showComputedOpening = !hasOpening && computedOpening > 0;

                              // Determine row state (consider computed opening as valid)
                              const effectiveHasOpening = hasOpening || showComputedOpening;

                              // Calculate sales (closing - opening)
                              const openingValue = hasOpening
                                ? toNumber(openingReading?.meter_value ?? openingReading?.reading_value)
                                : showComputedOpening
                                ? computedOpening
                                : 0;
                              const closingValue = hasClosing
                                ? toNumber(closingReading?.meter_value ?? closingReading?.reading_value)
                                : 0;
                              const salesLiters = effectiveHasOpening && hasClosing ? closingValue - openingValue : 0;

                              let rowState = 'Both Missing';
                              let statusColor = 'bg-amber-50 border-amber-200';
                              if (effectiveHasOpening && hasClosing) {
                                rowState = '✓ Complete';
                                statusColor = 'bg-green-50 border-green-300';
                              } else if (effectiveHasOpening && !hasClosing) {
                                rowState = 'Closing Missing';
                                statusColor = 'bg-amber-50 border-amber-300';
                              } else if (!effectiveHasOpening && hasClosing) {
                                rowState = 'Opening Missing';
                                statusColor = 'bg-amber-50 border-amber-300';
                              }

                              return (
                                <div key={nozzle.id} className={`border rounded-lg p-3 ${statusColor}`}>
                                  {/* Nozzle Header */}
                                  <div className="flex items-center justify-between mb-2">
                                    <div>
                                      <div className="font-semibold text-base">
                                        {shiftTemplate.name} – {nozzle.name || `Nozzle ${nozzle.nozzleNumber}`}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {nozzle.fuelType?.name || 'Unknown'}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Badge
                                        variant={hasOpening && hasClosing ? 'default' : 'secondary'}
                                        className={
                                          hasOpening && hasClosing
                                            ? 'bg-green-600 text-xs'
                                            : 'bg-amber-600 text-xs'
                                        }
                                      >
                                        {rowState}
                                      </Badge>
                                      <Badge variant="outline" className="text-xs">
                                        {nozzle.fuelType?.code || 'N/A'}
                                      </Badge>
                                    </div>
                                  </div>

                                  {/* Reading Inputs */}
                                  <div className="grid grid-cols-3 gap-2">
                                    {/* Opening Reading */}
                                    <div className="space-y-1">
                                      <div className="text-xs font-medium text-muted-foreground">Opening</div>
                                      {hasOpening ? (
                                        <div className="flex items-center gap-2 justify-between">
                                          <div className="flex items-center gap-2">
                                            <CheckCircle className="h-4 w-4 text-green-600" />
                                            <span className="font-mono font-semibold text-sm">
                                              {toNumber(openingReading?.meter_value ?? openingReading?.reading_value).toFixed(3)}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-1">
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={() =>
                                                openMeterReadingDialog(nozzle, shiftTemplate, 'opening', openingReading)
                                              }
                                              className="h-7 w-7 p-0"
                                              title="Edit opening"
                                            >
                                              <Edit className="h-3 w-3" />
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={() => {
                                                if (openingReading && confirm('Delete this opening reading?')) {
                                                  deleteMeterReadingMutation.mutate(openingReading.id);
                                                }
                                              }}
                                              className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                                              title="Delete opening"
                                            >
                                              <Trash2 className="h-3 w-3" />
                                            </Button>
                                          </div>
                                        </div>
                                      ) : showComputedOpening ? (
                                        <div className="flex items-center gap-2 justify-between">
                                          <div className="flex items-center gap-2">
                                            <CheckCircle className="h-4 w-4 text-gray-400" />
                                            <span className="font-mono font-semibold text-sm text-muted-foreground">
                                              {computedOpening.toFixed(3)}
                                            </span>
                                          </div>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => openMeterReadingDialog(nozzle, shiftTemplate, 'opening')}
                                            className="h-7 w-7 p-0"
                                            title="Edit"
                                          >
                                            <Edit className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      ) : (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => openMeterReadingDialog(nozzle, shiftTemplate, 'opening')}
                                          className="w-full h-11 text-sm border-amber-600 text-amber-700 hover:bg-amber-100"
                                        >
                                          <Camera className="h-4 w-4 mr-1" />
                                          Add
                                        </Button>
                                      )}
                                    </div>

                                    {/* Closing Reading */}
                                    <div className="space-y-1">
                                      <div className="text-xs font-medium text-muted-foreground">Closing</div>
                                      {hasClosing ? (
                                        <div className="flex items-center gap-2 justify-between">
                                          <div className="flex items-center gap-2">
                                            <CheckCircle className="h-4 w-4 text-green-600" />
                                            <span className="font-mono font-semibold text-sm">
                                              {toNumber(closingReading?.meter_value ?? closingReading?.reading_value).toFixed(3)}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-1">
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={() =>
                                                openMeterReadingDialog(nozzle, shiftTemplate, 'closing', closingReading)
                                              }
                                              className="h-7 w-7 p-0"
                                              title="Edit closing"
                                            >
                                              <Edit className="h-3 w-3" />
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={() => {
                                                if (closingReading && confirm('Delete this closing reading?')) {
                                                  deleteMeterReadingMutation.mutate(closingReading.id);
                                                }
                                              }}
                                              className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                                              title="Delete closing"
                                            >
                                              <Trash2 className="h-3 w-3" />
                                            </Button>
                                          </div>
                                        </div>
                                      ) : (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => openMeterReadingDialog(nozzle, shiftTemplate, 'closing')}
                                          className="w-full h-11 text-sm border-amber-600 text-amber-700 hover:bg-amber-100"
                                        >
                                          <Camera className="h-4 w-4 mr-1" />
                                          Add
                                        </Button>
                                      )}
                                    </div>

                                    {/* Sales Column (Closing - Opening) */}
                                    <div className="space-y-1">
                                      <div className="text-xs font-medium text-muted-foreground">Sales (L)</div>
                                      {effectiveHasOpening && hasClosing ? (
                                        <div className="flex items-center justify-center h-11 bg-blue-50 border border-blue-200 rounded">
                                          <span className="font-mono font-bold text-base text-blue-700">
                                            {salesLiters.toFixed(3)}
                                          </span>
                                        </div>
                                      ) : (
                                        <div className="flex items-center justify-center h-11 bg-gray-50 border border-dashed border-gray-300 rounded">
                                          <span className="text-xs text-muted-foreground">—</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

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
                    <div className="flex justify-between text-sm font-medium text-muted-foreground">
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
                    <div className="flex justify-between text-sm font-medium text-muted-foreground">
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
          <Card ref={transactionsCardRef}>
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
                <Accordion
                  type="multiple"
                  value={openAccordionItems}
                  onValueChange={setOpenAccordionItems}
                  className="space-y-2"
                >
                  {customerGroups.map((group) => (
                    <AccordionItem
                      key={group.customerId}
                      value={group.customerId}
                      data-customer-id={group.customerId}
                      className="border rounded-lg"
                    >
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
                        <div className="overflow-x-auto">
                          <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30">
                              <TableHead className="min-w-[180px]">Fuel Type</TableHead>
                              <TableHead className="min-w-[160px]">Slip#</TableHead>
                              <TableHead className="min-w-[180px]">Vehicle#</TableHead>
                              <TableHead className="min-w-[160px] text-right">Qty (L)</TableHead>
                              <TableHead className="min-w-[140px] text-right">Price/L</TableHead>
                              <TableHead className="min-w-[180px] text-right">Total (PKR)</TableHead>
                              <TableHead className="min-w-[200px]">Payment</TableHead>
                              <TableHead className="min-w-[200px]">Bank (Cards)</TableHead>
                              <TableHead className="w-[100px] text-center">Save</TableHead>
                              <TableHead className="w-[60px]"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.transactions.map((txn, localIdx) => {
                              const globalIdx = group.indices[localIdx];
                              return (
                                <>
                                <TableRow key={globalIdx}>
                                  <TableCell className="p-2">
                                    <Select
                                      value={txn.fuelCode || '__none__'}
                                      onValueChange={(v) => updateTransaction(globalIdx, 'fuelCode', v === '__none__' ? '' : v)}
                                    >
                                      <SelectTrigger className="h-11 text-base">
                                        <SelectValue placeholder="Select fuel" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__none__">Select...</SelectItem>
                                        <SelectItem value="HSD">HSD (Diesel)</SelectItem>
                                        <SelectItem value="PMG">PMG (Petrol)</SelectItem>
                                        <SelectItem value="OTHER">Non-Fuel Item</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Input
                                      className="h-11 text-base font-mono"
                                      value={txn.slipNumber || ''}
                                      onChange={(e) => updateTransaction(globalIdx, 'slipNumber', e.target.value)}
                                      placeholder="SLP-001"
                                    />
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Input
                                      className="h-11 text-base font-mono"
                                      value={txn.vehicleNumber || ''}
                                      onChange={(e) => updateTransaction(globalIdx, 'vehicleNumber', e.target.value)}
                                      placeholder="ABC-123"
                                    />
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Input
                                      className="h-11 text-base font-mono text-right"
                                      type="number"
                                      step="0.001"
                                      value={txn.quantity}
                                      onChange={(e) => updateTransaction(globalIdx, 'quantity', e.target.value)}
                                      placeholder="0.000"
                                    />
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Input
                                      className="h-11 text-base font-mono text-right"
                                      type="number"
                                      step="0.01"
                                      value={txn.unitPrice}
                                      onChange={(e) => updateTransaction(globalIdx, 'unitPrice', e.target.value)}
                                    />
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Input
                                      className="h-11 text-base font-mono text-right font-semibold bg-blue-50 text-blue-700"
                                      value={toNumber(txn.lineTotal).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                                      readOnly
                                    />
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Select
                                      value={txn.paymentMethod}
                                      onValueChange={(v: any) => updateTransaction(globalIdx, 'paymentMethod', v)}
                                    >
                                      <SelectTrigger className="h-11 text-base">
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
                                    {(txn.paymentMethod === 'credit_card' || txn.paymentMethod === 'bank_card') ? (
                                      <Select
                                        value={txn.bankId || ''}
                                        onValueChange={(v: any) => updateTransaction(globalIdx, 'bankId', v)}
                                      >
                                        <SelectTrigger className="h-11 text-base">
                                          <SelectValue placeholder="Select bank..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {banksData && banksData.length > 0 ? (
                                            banksData.map((bank) => (
                                              <SelectItem key={bank.id} value={bank.id}>
                                                {bank.name}
                                              </SelectItem>
                                            ))
                                          ) : (
                                            <SelectItem value="__no_banks__" disabled>
                                              No banks available
                                            </SelectItem>
                                          )}
                                        </SelectContent>
                                      </Select>
                                    ) : (
                                      <span className="text-sm text-muted-foreground italic">N/A</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="p-2 text-center" title={
                                    txn.createdByUser || txn.updatedByUser
                                      ? `Created: ${txn.createdByUser?.fullName || 'System'} (${new Date(txn.createdAt!).toLocaleString()})\nUpdated: ${txn.updatedByUser?.fullName || txn.createdByUser?.fullName || 'System'} (${new Date(txn.updatedAt!).toLocaleString()})`
                                      : undefined
                                  }>
                                    {txn._localStatus === 'saved' ? (
                                      <CheckCircle className="h-5 w-5 text-green-600 mx-auto" />
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => saveTransactionRow(globalIdx)}
                                        className="h-9 w-9 p-0"
                                        title="Save row to server"
                                      >
                                        <Plus className="h-5 w-5 text-blue-600" />
                                      </Button>
                                    )}
                                  </TableCell>
                                  <TableCell className="p-2">
                                    <Button size="icon" variant="ghost" onClick={() => removeTransaction(globalIdx)}>
                                      <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                                {/* Product selector row for non-fuel items */}
                                {txn.fuelCode === 'OTHER' && (
                                  <TableRow key={`${globalIdx}-product`} className="bg-amber-50">
                                    <TableCell colSpan={10} className="p-3">
                                      <div className="flex items-center gap-3">
                                        <Label className="text-sm font-semibold min-w-[120px]">Select Product:</Label>
                                        <Select
                                          value={txn.productName || ''}
                                          onValueChange={(v) => {
                                            const product = productsData?.find((p: any) => p.name === v);
                                            updateTransaction(globalIdx, 'productName', v);
                                            if (product && product.unitPrice) {
                                              updateTransaction(globalIdx, 'unitPrice', product.unitPrice.toString());
                                            }
                                          }}
                                        >
                                          <SelectTrigger className="max-w-md">
                                            <SelectValue placeholder="Choose a product..." />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {productsData && productsData.length > 0 ? (
                                              productsData.map((product: any) => (
                                                <SelectItem key={product.id} value={product.name}>
                                                  {product.name} {product.unitPrice ? `- PKR ${product.unitPrice}` : ''}
                                                </SelectItem>
                                              ))
                                            ) : (
                                              <SelectItem value="__no_products__" disabled>
                                                No products available
                                              </SelectItem>
                                            )}
                                          </SelectContent>
                                        </Select>
                                        <span className="text-xs text-muted-foreground italic">
                                          Non-fuel items use quantity as units (not liters)
                                        </span>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                )}
                                {/* Audit stamp row */}
                                <TableRow key={`${globalIdx}-audit`} className="bg-muted/30 border-b-2">
                                  <TableCell colSpan={10} className="px-4 py-1 text-xs text-muted-foreground">
                                    {txn.id ? (
                                      <>
                                        Created: {txn.createdByUser?.fullName || 'System'} • {txn.createdAt ? new Date(txn.createdAt).toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '—'}
                                        {txn.updatedAt && txn.updatedBy && new Date(txn.updatedAt).getTime() > new Date(txn.createdAt!).getTime() + 1000 && (
                                          <span className="ml-4">
                                            Updated: {txn.updatedByUser?.fullName || txn.createdByUser?.fullName || 'System'} • {new Date(txn.updatedAt).toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                                          </span>
                                        )}
                                      </>
                                    ) : (
                                      <span className="italic text-amber-600">Unsaved draft</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                                </>
                              );
                            })}
                          </TableBody>
                        </Table>
                        </div>
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
                <div className="flex justify-between items-center gap-4 mt-4 pt-3 border-t">
                  {/* Transaction count indicator */}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="font-semibold">{transactions.length}</span>
                    <span>transaction{transactions.length !== 1 ? 's' : ''} ready to save</span>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={resetForm}>Cancel</Button>
                    <Button
                      variant="outline"
                      onClick={handleSaveDraft}
                      disabled={saveDailyDraftMutation.isPending || transactions.length === 0}
                      title={transactions.length === 0 ? 'Add transactions first' : 'Save all transactions'}
                    >
                      {saveDailyDraftMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4 mr-2" />
                          Save Draft
                          {lastSaved && <span className="text-xs ml-2">({format(lastSaved, 'HH:mm')})</span>}
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={handleFinalizeDay}
                      disabled={finalizeDayMutation.isPending || isDirty || transactions.length === 0}
                      className="bg-green-600 hover:bg-green-700"
                      title={
                        finalizeDayMutation.isPending ? 'Finalizing...' :
                        isDirty ? 'Save draft first before finalizing' :
                        transactions.length === 0 ? 'Add transactions first' :
                        'Finalize day and queue for QuickBooks sync'
                      }
                    >
                      {finalizeDayMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Finalizing...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Finalize Day
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add Customer Group Dialog */}
          <Dialog open={isAddGroupOpen} onOpenChange={(open) => {
            setIsAddGroupOpen(open);
            if (!open) {
              setCustomerSearchQuery('');
            }
          }}>
            <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>Add Customer Group</DialogTitle>
                <DialogDescription>
                  Search for a customer to add transactions, or select walk-in sales for anonymous customers.
                </DialogDescription>
              </DialogHeader>
              <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                {/* Quick Walk-in Button */}
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full h-14 text-lg border-2 border-dashed hover:bg-accent"
                  onClick={() => {
                    addTransactionToCustomer('__walkin__', 'Walk-in Sales');
                    setIsAddGroupOpen(false);
                    setCustomerSearchQuery('');
                  }}
                >
                  <Users className="h-5 w-5 mr-2" />
                  Walk-in Sales
                </Button>

                {/* Add New Customer Button */}
                <Button
                  type="button"
                  variant="default"
                  className="w-full"
                  onClick={() => {
                    setShowAddCustomerDialog(true);
                    setIsAddGroupOpen(false);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add New Customer
                </Button>

                {/* Search Input */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, phone, or email..."
                    value={customerSearchQuery}
                    onChange={(e) => setCustomerSearchQuery(e.target.value)}
                    className="w-full h-12 pl-10 text-base"
                    autoFocus
                  />
                </div>

                {/* Customer List */}
                <div className="flex-1 overflow-y-auto border rounded-lg">
                  {filteredCustomers.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-muted-foreground">
                      No customers found
                    </div>
                  ) : (
                    <div className="divide-y">
                      {filteredCustomers.map((customer: any) => (
                        <button
                          key={customer.id}
                          onClick={() => {
                            addTransactionToCustomer(customer.id, customer.name);
                            setIsAddGroupOpen(false);
                            setCustomerSearchQuery('');
                          }}
                          className="w-full px-4 py-3 text-left hover:bg-accent transition-colors flex items-center justify-between group"
                        >
                          <div className="flex-1">
                            <div className="font-semibold text-base group-hover:text-primary">{customer.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {customer.phone || customer.email || 'No contact info'}
                            </div>
                          </div>
                          <Plus className="h-5 w-5 text-muted-foreground group-hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => {
                  setIsAddGroupOpen(false);
                  setCustomerSearchQuery('');
                }}>
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Meter Reading Capture Dialog */}
          <Dialog open={isMeterReadingOpen} onOpenChange={(open) => {
            setIsMeterReadingOpen(open);
            if (!open) {
              setSelectedMeterNozzle(null);
              setSelectedShiftForReading(null);
            }
          }}>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {selectedShiftForReading?.name || 'Shift'} – {selectedReadingType === 'opening' ? 'Opening' : 'Closing'} Reading
                </DialogTitle>
                <DialogDescription>
                  {selectedMeterNozzle?.name || `Nozzle ${selectedMeterNozzle?.nozzleNumber}`} ({selectedMeterNozzle?.fuelType?.name || 'Unknown'})
                  {' • '}
                  Business Date: {businessDate}
                </DialogDescription>
              </DialogHeader>
              {selectedMeterNozzle && selectedShiftForReading && (
                <MeterReadingCapture
                  nozzleId={selectedMeterNozzle.id}
                  nozzleName={`${selectedShiftForReading.name} – ${selectedMeterNozzle.name || `Nozzle ${selectedMeterNozzle.nozzleNumber}`} (${selectedMeterNozzle.fuelType?.name || 'Unknown'})`}
                  previousReading={_editingReadingValue ?? getPreviousReading(selectedMeterNozzle.id, selectedReadingType, selectedShiftForReading)}
                  onCapture={handleMeterReadingCapture}
                  onCancel={() => {
                    setIsMeterReadingOpen(false);
                    setSelectedMeterNozzle(null);
                    setSelectedShiftForReading(null);
                    setEditingReadingId(null);
                    setEditingReadingValue(null);
                  }}
                />
              )}
            </DialogContent>
          </Dialog>

          {/* Add New Customer Dialog */}
          <Dialog open={showAddCustomerDialog} onOpenChange={setShowAddCustomerDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Customer</DialogTitle>
                <DialogDescription>
                  Enter customer details to create a new customer record. The customer will be automatically added to your transaction list.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="new-customer-name">Name *</Label>
                  <Input
                    id="new-customer-name"
                    placeholder="Customer name"
                    value={newCustomer.name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                    disabled={isSubmittingCustomer}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-customer-phone">Phone</Label>
                  <Input
                    id="new-customer-phone"
                    placeholder="Phone number"
                    value={newCustomer.phone}
                    onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                    disabled={isSubmittingCustomer}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-customer-email">Email</Label>
                  <Input
                    id="new-customer-email"
                    type="email"
                    placeholder="Email address"
                    value={newCustomer.email}
                    onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                    disabled={isSubmittingCustomer}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddCustomerDialog(false)}
                  disabled={isSubmittingCustomer}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleAddNewCustomer}
                  disabled={isSubmittingCustomer}
                >
                  {isSubmittingCustomer ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Customer
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Right: Reconciliation Panel - Horizontally Collapsible */}
        <div className={`transition-all duration-300 ease-in-out ${isReconciliationCollapsed ? 'w-12' : 'w-96'} flex-shrink-0 relative`}>
          <div className={cn(
            'space-y-4',
            viewportHeight >= 800 ? 'sticky top-[72px]' : 'relative'
          )}>
            {/* Toggle Button */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsReconciliationCollapsed(!isReconciliationCollapsed)}
              className="absolute -left-6 top-2 z-10 rounded-full shadow-lg"
              title={isReconciliationCollapsed ? 'Expand Reconciliation' : 'Collapse Reconciliation'}
            >
              {isReconciliationCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>

            {/* Reconciliation Content */}
            {!isReconciliationCollapsed && (
              <Card className="border rounded-lg">
                <CardHeader className="px-4 py-3 border-b">
                  <CardTitle className="text-base">Reconciliation</CardTitle>
                </CardHeader>
                <CardContent className="px-4 py-4">
                  <div className="space-y-4 text-sm">
              {/* Totals Integrity Diagnostics */}
              {selectedBranchId && businessDate && (
                <div className={`border-2 rounded-lg p-3 ${
                  readingsIntegrity.missing.length === 0
                    ? 'border-green-300 bg-green-50'
                    : 'border-orange-300 bg-orange-50'
                }`}>
                  <div className="font-semibold mb-2 flex items-center gap-2">
                    {readingsIntegrity.missing.length === 0 ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-orange-600" />
                    )}
                    <span>Totals Integrity</span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expected Points:</span>
                      <span className="font-mono font-semibold">{readingsIntegrity.expected}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Effective Points:</span>
                      <span className="font-mono font-semibold">{readingsIntegrity.foundDb + readingsIntegrity.autoFilled}</span>
                    </div>
                    {readingsIntegrity.autoFilled > 0 && (
                      <div className="flex justify-between text-[11px] text-muted-foreground pl-2">
                        <span>├─ Database:</span>
                        <span className="font-mono">{readingsIntegrity.foundDb}</span>
                      </div>
                    )}
                    {readingsIntegrity.autoFilled > 0 && (
                      <div className="flex justify-between text-[11px] text-muted-foreground pl-2">
                        <span>└─ Auto-filled:</span>
                        <span className="font-mono">{readingsIntegrity.autoFilled}</span>
                      </div>
                    )}
                    {readingsIntegrity.missing.length > 0 && (
                      <>
                        <div className="pt-2 border-t border-orange-200">
                          <div className="font-medium text-orange-900 mb-1">Missing Readings ({readingsIntegrity.missing.length}):</div>
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {readingsIntegrity.missing.map((m, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-orange-800">
                                <span className="font-medium">{m.shift}</span>
                                <span>→</span>
                                <span>{m.nozzle}</span>
                                <span className="text-orange-600">({m.type})</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="pt-2 border-t border-orange-200">
                          <div className="text-orange-900 font-medium">
                            ⚠️ Totals partial due to missing readings ({readingsIntegrity.foundDb + readingsIntegrity.autoFilled}/{readingsIntegrity.expected})
                          </div>
                        </div>
                      </>
                    )}
                    {readingsIntegrity.missing.length === 0 && (
                      <div className="pt-2 border-t border-green-200">
                        <div className="text-green-900 font-medium flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          All readings complete
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Nozzle Meter Reading Checklist */}
              {nozzleReconciliation.length > 0 && (
                <Collapsible defaultOpen={false}>
                  <div className="pt-2 border-t">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full justify-between h-8 px-2">
                        <span className="font-semibold text-sm">Nozzle Meter Readings</span>
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-1.5 text-xs pt-2">
                        {nozzleReconciliation.map((nozzle: any) => (
                          <div key={nozzle.nozzleId} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${nozzle.hasBoth ? 'bg-green-500' : 'bg-orange-500'}`} />
                              <span className="font-medium">{nozzle.nozzleName}</span>
                              <Badge variant="outline" className="text-[10px] px-1 py-0">{nozzle.fuelCode}</Badge>
                            </div>
                            <span className="text-xs">
                              {nozzle.hasBoth ? '✓ Both' : !nozzle.hasOpening ? '✗ Opening' : '✗ Closing'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              )}

              {/* Fuel Totals */}
              <div className="pt-2 border-t">
                <div className="font-semibold mb-2 text-base">Fuel Totals</div>
                <div className="space-y-1 text-sm">
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
              <Collapsible defaultOpen={false}>
                <div className="pt-2 border-t">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full justify-between h-8 px-2">
                      <span className="font-semibold text-sm">Payment Breakdown</span>
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-1 text-xs pt-2">
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
                  </CollapsibleContent>
                </div>
              </Collapsible>

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
              {transactions.length > 0 && Math.abs(varianceLiters) < 1 && Math.abs(cashGapAmount) < 0.01 && readingsIntegrity.missing.length === 0 && (
                <div className="pt-2 border-t">
                  <Badge variant="outline" className="w-full justify-center text-green-600 border-green-600 text-base font-medium py-2">
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Balanced
                  </Badge>
                </div>
              )}

              {transactions.length > 0 && Math.abs(varianceLiters) < 1 && Math.abs(cashGapAmount) < 0.01 && readingsIntegrity.missing.length > 0 && (
                <div className="pt-2 border-t">
                  <Badge variant="outline" className="w-full justify-center text-blue-600 border-blue-600 text-base font-medium py-2">
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Balanced (Provisional)
                  </Badge>
                  <div className="text-sm text-blue-700 mt-1 text-center">
                    Missing {readingsIntegrity.missing.length} reading(s)
                  </div>
                </div>
              )}

              {(Math.abs(varianceLiters) >= 1 || Math.abs(cashGapAmount) >= 0.01) && transactions.length > 0 && (
                <div className="pt-2 border-t">
                  <Badge variant="outline" className="w-full justify-center text-orange-600 border-orange-600 text-base font-medium py-2">
                    <AlertCircle className="h-4 w-4 mr-1" />
                    Reconciliation Pending
                  </Badge>
                  {readingsIntegrity.missing.length > 0 && (
                    <div className="text-sm text-orange-700 mt-1 text-center">
                      Missing {readingsIntegrity.missing.length} reading(s)
                    </div>
                  )}
                </div>
              )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
