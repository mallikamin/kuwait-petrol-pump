import { useEffect, useMemo, useState, useRef } from 'react';
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Calendar, DollarSign, AlertCircle, Plus, Trash2, Save, CheckCircle, Users, Copy, Search, Gauge, Camera, Edit, Loader2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, RefreshCw, Eye, Clock, User } from 'lucide-react';
import { cn } from '@/utils/cn';
import { apiClient } from '@/api/client';
import { branchesApi, customersApi, meterReadingsApi, productsApi } from '@/api';
import { banksApi } from '@/api/banks';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MeterReadingCapture, type MeterReadingData } from '@/components/MeterReadingCapture';

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

// Meter reading structure is now transformed from backdated API response
// interface MeterReadingRow {
//   id: string;
//   nozzle_id?: string;
//   shift_id?: string;
//   reading_type: 'opening' | 'closing';
//   meter_value?: number;
//   reading_value?: number;
//   created_at?: string;
//   recorded_at?: string;
//   image_url?: string;
//   imageUrl?: string;
//   attachment_url?: string;
//   attachmentUrl?: string;
//   is_manual?: boolean;
//   isManual?: boolean;
//   ocr_manually_edited?: boolean;
//   ocrManuallyEdited?: boolean;
//   submitted_by_name?: string;
//   submittedByName?: string;
//   submitted_at?: string;
//   submittedAt?: string;
//   shift_instance?: {
//     shift?: {
//       name?: string;
//     };
//   };
// }

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

// ✅ NEW: Format liters - remove decimals for whole numbers (3000.00L → 3000L)
const formatLiters = (liters: number): string => {
  if (liters === 0) return '0';
  const rounded = Math.round(liters * 1000) / 1000; // Round to 3 decimals
  const str = rounded.toFixed(3); // Format to 3 decimals
  return str.replace(/\.?0+$/, ''); // Remove trailing zeros and decimal point if needed
};

const safeFormatDateTime = (value: unknown, pattern = 'MMM dd, yyyy HH:mm'): string => {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return 'N/A';
  return format(date, pattern);
};

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
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      return;
    } catch {
      return;
    }
  }

  window.open(rawUrl, '_blank', 'noopener,noreferrer');
};

export function BackdatedEntries() {
  // ✅ CRITICAL: React Query client for manual cache invalidation
  const queryClient = useQueryClient();

  // Entry fields
  const [businessDate, setBusinessDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedShiftId, setSelectedShiftId] = useState('');

  // Transaction fields
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [deletedTransactionIds, setDeletedTransactionIds] = useState<string[]>([]);
  const [syncMessage, setSyncMessage] = useState('');

  // Auto-save state
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const justSavedRef = useRef(false); // Track if we just saved to prevent useEffect from overwriting
  const hydratingTransactionsRef = useRef(false);
  const transactionsInitializedRef = useRef(false);

  // UX redesign state
  const [isContextCollapsed, setIsContextCollapsed] = useState(true);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);

  // Finalize modal dialog state
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);
  const [finalizeResult, setFinalizeResult] = useState<{
    type: 'success' | 'error';
    message?: string;
    alreadyFinalized?: boolean;
    blockers?: Array<{ message: string }>;
    metrics?: { hsdGap?: number; pmgGap?: number; cashGap?: number };
    salesCreated?: number;
    transactionsProcessed?: number;
    businessDate?: string; // ✅ NEW: Business date for success modal context
    paymentBreakdown?: {
      cash: { liters: number; amount: number };
      credit: { liters: number; amount: number };
      bankCard: { liters: number; amount: number };
      psoCard: { liters: number; amount: number };
    };
    reconciliationTotals?: {
      hsd: { liters: number; amount: number };
      pmg: { liters: number; amount: number };
      nonFuel: { amount: number };
      total: { amount: number };
    };
    branchName?: string;
    finalizedBy?: { fullName: string; username: string };
    finalizedAt?: string;
    cashGapWarning?: { amount: number; message: string };
  } | null>(null);

  // Use sessionStorage for loadedKey to persist across tab navigation
  const setLoadedKey = (key: string) => sessionStorage.setItem('backdated_loaded_key', key);

  // Restore context from URL query (supports navigation from reconciliation screens)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get('date');
    const branchParam = params.get('branchId');

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      setBusinessDate(dateParam);
    }
    if (branchParam) {
      setSelectedBranchId(branchParam);
    }
  }, []);

  // ✅ CRITICAL: Invalidate React Query cache when date/branch/shift change (forces fresh fetch)
  useEffect(() => {
    console.log('[QueryCache] Invalidating backdated-entries-daily for new date/branch/shift');
    queryClient.invalidateQueries({
      queryKey: ['backdated-entries-daily'],
    });
  }, [businessDate, selectedBranchId, queryClient]);

  // Keep URL in sync with selected context to avoid date/branch/shift persistence loss.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (businessDate) params.set('date', businessDate);
    if (selectedBranchId) params.set('branchId', selectedBranchId);
    else params.delete('branchId');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [businessDate, selectedBranchId]);

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
  const { data: shiftInstancesData } = useQuery({
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
  // ✅ DETERMINISTIC BEHAVIOR: Always refetch on mount/focus, never cache stale data
  const { data: dailySummaryData, refetch: refetchDailySummary, isLoading: isDailySummaryLoading } = useQuery({
    queryKey: ['backdated-entries-daily', selectedBranchId, businessDate],
    enabled: !!selectedBranchId && !!businessDate,
    staleTime: 0, // Never treat data as fresh (forces refetch)
    refetchOnMount: 'always', // Always refetch on component mount
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    refetchInterval: 15000, // ✅ LIVE UPDATE: Refetch every 15 seconds while page is open (catches posted transactions)
    retry: 1, // Retry once on failure
    queryFn: async () => {
      const res = await apiClient.get('/api/backdated-entries/daily', {
        params: {
          branchId: selectedBranchId,
          businessDate: businessDate,
        },
      });
      return res.data?.data;
    },
  });

  // ✅ FIXED: Fetch meter readings from backdated endpoint (shift-independent, day-level)
  const { data: backdatedMeterReadingsData, refetch: refetchMeterReadings, isError: backdatedReadingsError } = useQuery({
    queryKey: ['backdated-meter-readings-daily', selectedBranchId, businessDate],
    enabled: !!selectedBranchId && !!businessDate,
    refetchInterval: 15000, // ✅ LIVE UPDATE: Refetch every 15 seconds while page is open
    queryFn: async () => {
      if (!selectedBranchId || !businessDate) return null;
      return await meterReadingsApi.getDailyBackdatedReadings({
        branchId: selectedBranchId,
        businessDate: businessDate,
      });
    },
  });

  // Transform backdated response to flat list matching legacy structure (for getPreviousReading compatibility)
  const meterReadingsData = useMemo(() => {
    if (!backdatedMeterReadingsData?.nozzles) return [];

    return backdatedMeterReadingsData.nozzles.flatMap(nozzle => {
      const readings = [];

      // Opening reading
      if (nozzle.opening.status === 'entered') {
        readings.push({
          id: nozzle.opening.id, // ✅ Backdated ID for edit/delete
          nozzle_id: nozzle.nozzleId,
          nozzle_name: nozzle.nozzleName,
          fuel_type: nozzle.fuelType,
          reading_type: 'opening' as const,
          meter_value: nozzle.opening.value,
          reading_value: nozzle.opening.value,
          recorded_at: nozzle.opening.recordedAt,
          recorded_by: nozzle.opening.recordedBy,
          created_at: nozzle.opening.submittedAt,
          // Additional backdated fields
          submitted_by_name: nozzle.opening.submittedByName || '',
          submittedByName: nozzle.opening.submittedByName || '',
          submitted_at: nozzle.opening.submittedAt || '',
          submittedAt: nozzle.opening.submittedAt || '',
          ocr_manually_edited: nozzle.opening.ocrManuallyEdited || false,
          ocrManuallyEdited: nozzle.opening.ocrManuallyEdited || false,
          is_manual: nozzle.opening.ocrManuallyEdited || false,
          isManual: nozzle.opening.ocrManuallyEdited || false,
          image_url: nozzle.opening.imageUrl || '',
          imageUrl: nozzle.opening.imageUrl || '',
          attachment_url: nozzle.opening.attachmentUrl || '',
          attachmentUrl: nozzle.opening.attachmentUrl || '',
        } as any);
      }

      // Closing reading
      if (nozzle.closing.status === 'entered') {
        readings.push({
          id: nozzle.closing.id, // ✅ Backdated ID for edit/delete
          nozzle_id: nozzle.nozzleId,
          nozzle_name: nozzle.nozzleName,
          fuel_type: nozzle.fuelType,
          reading_type: 'closing' as const,
          meter_value: nozzle.closing.value,
          reading_value: nozzle.closing.value,
          recorded_at: nozzle.closing.recordedAt,
          recorded_by: nozzle.closing.recordedBy,
          created_at: nozzle.closing.submittedAt,
          // Additional backdated fields
          submitted_by_name: nozzle.closing.submittedByName || '',
          submittedByName: nozzle.closing.submittedByName || '',
          submitted_at: nozzle.closing.submittedAt || '',
          submittedAt: nozzle.closing.submittedAt || '',
          ocr_manually_edited: nozzle.closing.ocrManuallyEdited || false,
          ocrManuallyEdited: nozzle.closing.ocrManuallyEdited || false,
          is_manual: nozzle.closing.ocrManuallyEdited || false,
          isManual: nozzle.closing.ocrManuallyEdited || false,
          image_url: nozzle.closing.imageUrl || '',
          imageUrl: nozzle.closing.imageUrl || '',
          attachment_url: nozzle.closing.attachmentUrl || '',
          attachmentUrl: nozzle.closing.attachmentUrl || '',
        } as any);
      }

      return readings;
    });
  }, [backdatedMeterReadingsData]);

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

  const customerGroupIds = useMemo(
    () => customerGroups.map((g) => g.customerId),
    [customerGroups]
  );

  // Keep accordion items open by default for first load and only auto-open truly new groups.
  // This preserves user-collapsed state on existing groups when transactions update.
  const seenCustomerGroupIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const seen = seenCustomerGroupIdsRef.current;
    const isFirstRender = seen.length === 0;
    const newlyIntroducedIds = customerGroupIds.filter((id) => !seen.includes(id));

    setOpenAccordionItems((prev) => {
      if (isFirstRender) {
        return customerGroupIds;
      }
      if (newlyIntroducedIds.length === 0) {
        return prev;
      }
      const merged = [...prev];
      for (const id of newlyIntroducedIds) {
        if (!merged.includes(id)) merged.push(id);
      }
      return merged;
    });

    seenCustomerGroupIdsRef.current = customerGroupIds;
  }, [customerGroupIds]);

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
  const [editingReadingId, setEditingReadingId] = useState<string | null>(null);
  const [modalPreviousReading, setModalPreviousReading] = useState<number | null>(null);

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

  const nonFuelProductOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; unitPrice?: number; isLegacy?: boolean }>();

    (productsData || []).forEach((p: any) => {
      if (!p?.name) return;
      map.set(p.name, {
        id: p.id || p.name,
        name: p.name,
        unitPrice: p.unitPrice,
        isLegacy: false,
      });
    });

    // Preserve visibility of already-saved non-fuel products even if they are no longer in master data.
    transactions.forEach((t) => {
      if (t.fuelCode !== 'OTHER') return;
      const name = (t.productName || '').trim();
      if (!name || map.has(name)) return;
      map.set(name, {
        id: `legacy-${name}`,
        name,
        isLegacy: true,
      });
    });

    return Array.from(map.values());
  }, [productsData, transactions]);

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
    setOpenAccordionItems((prev) => (prev.includes(customerId) ? prev : [...prev, customerId]));

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

  const getCreditCustomerValidationError = (txn: Transaction): string | null => {
    if (txn.paymentMethod !== 'credit_customer') return null;

    const hasCustomer = !!txn.customerId && txn.customerId.trim() !== '';
    const hasVehicle = !!txn.vehicleNumber && txn.vehicleNumber.trim() !== '';
    const hasSlip = !!txn.slipNumber && txn.slipNumber.trim() !== '';

    if (!hasCustomer || !hasVehicle || !hasSlip) {
      return `Credit customer transaction requires customer, vehicle#, and slip# (row with ${txn.quantity}L)`;
    }

    return null;
  };

  // Save individual transaction row (triggers auto-save to server)
  const saveTransactionRow = async (index: number) => {
    const row = transactions[index];
    const validationError = getCreditCustomerValidationError(row);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const updated = [...transactions];
    updated[index] = { ...updated[index], _localStatus: 'saved' };
    setTransactions(updated);

    // Save this row immediately without being blocked by unrelated incomplete rows.
    try {
      await saveDailyDraftMutation.mutateAsync({
        transactions: [row],
        partialSave: true,
        deletedTransactionIds: [],
      });
      toast.success('Row saved successfully');
    } catch (error: any) {
      console.error('Auto-save failed:', error);
      const errorMsg = error?.response?.data?.error || error?.message || 'Failed to save row. Please click "Save Draft" manually.';
      toast.error(errorMsg);
      updated[index]._localStatus = 'draft'; // Revert status on error
      setTransactions(updated);
    }
  };

  // REMOVED: Duplicate useEffect that was overwriting transactions after save.

  // Mark dirty only on user edits, not when hydrating from API/session.
  useEffect(() => {
    if (!transactionsInitializedRef.current) {
      transactionsInitializedRef.current = true;
      return;
    }
    if (hydratingTransactionsRef.current) {
      hydratingTransactionsRef.current = false;
      return;
    }
    setIsDirty(true);
  }, [transactions]);

  // Save transactions to sessionStorage on every change (prevents data loss on navigation)
  useEffect(() => {
    if (selectedBranchId && businessDate && (transactions.length > 0 || deletedTransactionIds.length > 0)) {
      const key = `backdated_transactions_${selectedBranchId}_${businessDate}_${selectedShiftId || 'all'}`;
      sessionStorage.setItem(key, JSON.stringify({
        transactions,
        deletedTransactionIds,
        timestamp: Date.now(),
      }));
      console.log('[SessionStorage] Saved', transactions.length, 'transactions');
    }
  }, [transactions, deletedTransactionIds, selectedBranchId, businessDate, selectedShiftId]);


  // Load transactions from API on branch/date/shift change
  useEffect(() => {
    // ✅ CRITICAL FIX: Don't skip hydration after save - the refetched API data should be loaded
    // justSavedRef was blocking hydration of refetched data, causing old transactions to disappear
    // Only reset the flag but continue to load the new API data
    if (justSavedRef.current) {
      console.log('[Transactions] Continuing hydration after save (refetched data)');
      justSavedRef.current = false;
      // DON'T return - continue to load the new API data below
    }

    if (!selectedBranchId || !businessDate) {
      console.log('[Transactions] Clearing (no branch/date selected)');
      hydratingTransactionsRef.current = true;
      setTransactions([]);
      setDeletedTransactionIds([]);
      setSyncMessage('');
      setLoadedKey('');
      return;
    }

    const currentKey = `${selectedBranchId}_${businessDate}_${selectedShiftId || 'all'}`;
    const previousKey = sessionStorage.getItem('backdated_loaded_key');
    const dateChanged = previousKey && previousKey !== currentKey;

    // ✅ CRITICAL FIX: If businessDate changed, clear in-memory staged rows AND force API refetch
    if (dateChanged) {
      const oldSessionKey = `backdated_transactions_${previousKey}`;
      console.log('[Date Change] Clearing previous date data:', { previousKey, currentKey });
      sessionStorage.removeItem(oldSessionKey);
      // Force fresh refetch from API (bypass cache) when date changes
      refetchDailySummary();
    }

    console.log('[Transactions] Loading key:', {
      currentKey,
      previousKey,
      dateChanged,
      hasAPIData: !!dailySummaryData?.transactions,
      apiCount: dailySummaryData?.transactions?.length || 0,
    });

    // ✅ CRITICAL FIX: Only clear transactions if API has FINISHED loading
    // If API is still loading (undefined), don't update state - wait for data
    if (isDailySummaryLoading) {
      console.log('[Transactions] Waiting for API data to load...');
      return; // Don't update state until API data arrives
    }

    // ✅ SAFETY: Never overwrite local unsaved edits/deletes with periodic refetch data.
    if (isDirty && !dateChanged && !justSavedRef.current) {
      console.log('[Transactions] Skipping API hydration (local unsaved changes present)');
      return;
    }

    // ✅ PRIORITY: Load from API when clean state or after save.
    if (dailySummaryData?.transactions && dailySummaryData.transactions.length > 0) {
      console.log('[Transactions] Loading from API (server truth):', dailySummaryData.transactions.length);

      // ✅ IMMUTABLE HYDRATION: Create exact copies of API data WITHOUT mutations
      // Do NOT auto-fill product names or prices during hydration - keep API values as-is
      // Only user field edits (via updateTransaction) should trigger auto-fill logic
      const hydratedTransactions = dailySummaryData.transactions.map((txn: any): Transaction => {
        const mapped: Transaction = {
          id: txn.id,
          nozzleId: txn.nozzle?.id || '',
          customerId: txn.customer?.id || '',
          customerName: txn.customer?.name || '',
          fuelCode: (txn.fuelCode || '') as any, // ✅ CRITICAL: Use exact API value (NEVER fall back to nozzle fuel type)
          vehicleNumber: txn.vehicleNumber || '',
          slipNumber: txn.slipNumber || '',
          productName: txn.productName || '', // Keep exact API value
          quantity: toNumber(txn.quantity).toString(),
          unitPrice: toNumber(txn.unitPrice).toFixed(2), // Keep exact API value
          lineTotal: toNumber(txn.lineTotal).toFixed(2),
          paymentMethod: txn.paymentMethod,
          bankId: txn.bankId || '',
          // Audit fields (immutable)
          createdBy: txn.createdBy,
          createdByUser: txn.createdByUser,
          updatedBy: txn.updatedBy,
          updatedByUser: txn.updatedByUser,
          createdAt: txn.createdAt,
          updatedAt: txn.updatedAt,
        };

        // ✅ FORENSIC: Log if fuelCode appears empty (would indicate API bug)
        if (!txn.fuelCode) {
          console.warn('[Hydration] Transaction has empty fuelCode from API - should not happen!', {
            txnId: txn.id,
            productName: txn.productName,
            nozzleId: txn.nozzle?.id,
            nozzleFuelType: txn.nozzle?.fuelType?.code,
          });
        }

        return mapped;
      });

      hydratingTransactionsRef.current = true;
      setTransactions(hydratedTransactions);

      console.log('[Transactions] Hydration complete:', {
        count: hydratedTransactions.length,
        sampleFuelCodes: hydratedTransactions.slice(0, 3).map((t: Transaction) => ({ id: t.id, fuelCode: t.fuelCode, productName: t.productName })),
      });

      setSyncMessage(`Loaded ${dailySummaryData.transactions.length} existing transactions.`);
      setLoadedKey(currentKey);
      // Clear sessionStorage since server is now source of truth for this key.
      const sessionKey = `backdated_transactions_${currentKey}`;
      sessionStorage.removeItem(sessionKey);
    } else {
      // API finished loading but returned no transactions (user may have cleared them)
      console.log('[Transactions] API loaded: no transactions found');
      hydratingTransactionsRef.current = true;
      setTransactions([]);
      setSyncMessage('No existing transactions. Start adding customer groups.');
      setLoadedKey(currentKey); // Mark as loaded even if empty
    }
  }, [
    selectedBranchId,
    businessDate,
    selectedShiftId,
    dailySummaryData,
    isDailySummaryLoading,
  ]);



  // Auto-save timer (2 minutes)
  // ✅ SAFETY: Disable auto-save while API is loading (prevents overwriting server data with stale local)
  useEffect(() => {
    if (!isDirty || (transactions.length === 0 && deletedTransactionIds.length === 0) || !selectedBranchId || isDailySummaryLoading) return;
    const timer = setTimeout(async () => {
      try {
        await saveDailyDraftMutation.mutateAsync(undefined);
        console.log('Auto-saved draft at', new Date().toLocaleTimeString());
      } catch (error) {
        console.error('Auto-save failed:', error);
      }
    }, 120000); // 2 minutes
    return () => clearTimeout(timer);
  }, [isDirty, transactions, deletedTransactionIds, selectedBranchId, isDailySummaryLoading]);

  // Track viewport height for responsive sticky behavior
  useEffect(() => {
    const handleResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Remove transaction row
  const removeTransaction = (index: number) => {
    const txnToRemove = transactions[index];
    const nextTransactions = transactions.filter((_, i) => i !== index);
    const nextDeletedIds = txnToRemove?.id
      ? (deletedTransactionIds.includes(txnToRemove.id) ? deletedTransactionIds : [...deletedTransactionIds, txnToRemove.id])
      : deletedTransactionIds;

    setTransactions(nextTransactions);
    setDeletedTransactionIds(nextDeletedIds);

    if (txnToRemove?.id && selectedBranchId) {
      saveDailyDraftMutation.mutate(
        { transactions: nextTransactions, deletedTransactionIds: nextDeletedIds },
        {
          onSuccess: () => {
            toast.success('Transaction deleted and synced');
          },
          onError: (error: any) => {
            const errorMsg = error?.response?.data?.error || error?.message || 'Failed to sync deletion';
            toast.error(errorMsg);
          },
        }
      );
    }
  };

  // Update transaction field
  const updateTransaction = (index: number, field: keyof Transaction, value: any) => {
    setTransactions((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };

      // ✅ NOZZLE-FUEL CONSISTENCY GUARD
      // When fuel code changes, verify it matches the selected nozzle's fuel type
      // If mismatch, clear nozzleId to force user to select compatible nozzle
      if (field === 'fuelCode' && updated[index].nozzleId) {
        const nozzleFuelMap = (dailySummaryData?.nozzleStatuses || []).reduce((map: any, ns: any) => {
          map[ns.nozzleId] = ns.fuelType;
          return map;
        }, {});

        const nozzleFuelType = nozzleFuelMap[updated[index].nozzleId];
        if (nozzleFuelType && nozzleFuelType !== value) {
          console.warn('[Frontend Guard] Fuel type mismatch detected, clearing nozzleId:', {
            nozzleId: updated[index].nozzleId,
            nozzleFuelType,
            selectedFuelCode: value,
          });
          updated[index].nozzleId = ''; // Clear incompatible nozzle selection
        }
      }

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
          updated[index].productName = '';
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

      return updated;
    });
  };

  // Save daily draft mutation (new consolidated API)
  const saveDailyDraftMutation = useMutation({
    mutationFn: async (override?: { transactions?: Transaction[]; deletedTransactionIds?: string[]; partialSave?: boolean }) => {
      const txnsToSave = override?.transactions ?? transactions;
      const deletedIdsToSave = override?.deletedTransactionIds ?? deletedTransactionIds;
      const partialSave = override?.partialSave ?? false;

      console.log('[Save Draft] Starting...', {
        branchId: selectedBranchId,
        businessDate,
        transactionCount: txnsToSave.length,
      });

      if (!selectedBranchId) {
        const error = 'Please select a branch';
        console.error('[Save Draft] Validation failed:', error);
        throw new Error(error);
      }

      if (txnsToSave.length === 0 && deletedIdsToSave.length === 0) {
        const error = 'No transactions to save';
        console.error('[Save Draft] Validation failed:', error);
        throw new Error(error);
      }

      // Validate credit customer requirements
      for (const txn of txnsToSave) {
        const error = getCreditCustomerValidationError(txn);
        if (error) {
          console.error('[Save Draft] Validation failed:', error);
          throw new Error(error);
        }
      }

      // Build outbound payload with detailed tracking
      const outboundTransactions = txnsToSave.map(txn => ({
        id: txn.id || undefined,
        nozzleId: txn.nozzleId || undefined,
        customerId: txn.customerId || undefined,
        fuelCode: txn.fuelCode || undefined,
        vehicleNumber: txn.vehicleNumber?.trim() || undefined,
        slipNumber: txn.slipNumber?.trim() || undefined,
        productName: txn.productName,
        quantity: toNumber(txn.quantity),
        unitPrice: toNumber(txn.unitPrice),
        lineTotal: toNumber(txn.lineTotal),
        paymentMethod: txn.paymentMethod,
        bankId: txn.bankId || undefined,
      }));

      const withNozzleIds = outboundTransactions.filter(t => t.nozzleId).length;
      const withoutNozzleIds = outboundTransactions.filter(t => !t.nozzleId).length;
      const totalLiters = outboundTransactions.reduce((sum, t) => sum + (t.quantity || 0), 0);

      console.log('[Save Draft] Sending to API:', {
        endpoint: '/api/backdated-entries/daily',
        totalTransactions: outboundTransactions.length,
        deletedTransactions: deletedIdsToSave.length,
        partialSave,
        withNozzleIds,
        withoutNozzleIds,
        totalLiters,
        branchId: selectedBranchId,
        businessDate,
        shiftId: undefined,
      });

      const res = await apiClient.post('/api/backdated-entries/daily', {
        branchId: selectedBranchId,
        businessDate,
        partialSave,
        transactions: outboundTransactions,
        deletedTransactionIds: deletedIdsToSave,
      });

      console.log('[Save Draft] API response:', {
        status: res.status,
        transactionsSaved: res.data?.data?.totalTransactions,
        postedLiters: res.data?.data?.postedTotals,
      });
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
      setDeletedTransactionIds([]);
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
      console.log('[Finalize] Success:', data);
      setIsDirty(false); // ✅ Reset dirty state after successful finalize

      const alreadyFinalized = data?.alreadyFinalized || false;

      // ✅ Show success dialog with details
      const resultPayload: any = {
        type: 'success',
        message: message,
        alreadyFinalized,
        salesCreated: data?.postedSalesCount || data?.details?.salesCreated || 0,
        transactionsProcessed: data?.details?.transactionsProcessed || 0,
        paymentBreakdown: data?.paymentBreakdown || null, // Legacy, kept for backward compatibility
        reconciliationTotals: data?.reconciliationTotals || null, // ✅ NEW: Reconciliation totals
        branchName: data?.branchName || null, // ✅ NEW: Branch name
        finalizedBy: data?.finalizedBy || null, // ✅ NEW: User who finalized
        finalizedAt: data?.finalizedAt || null, // ✅ NEW: Finalization timestamp
      };

      // Include cash gap warning if present (no longer a blocker, just audit info)
      if (data?.cashGapWarning) {
        resultPayload.cashGapWarning = data.cashGapWarning;
      }

      setFinalizeResult(resultPayload);
      setFinalizeDialogOpen(true);

      // Show toast based on finalization state
      if (alreadyFinalized) {
        toast.info('This day has already been finalized with no changes');
      } else if (data?.cashGapWarning) {
        toast.success(`Finalized with cash variance warning: PKR ${Math.abs(data.cashGapWarning.amount).toFixed(2)}`);
      } else {
        toast.success('Day finalized successfully!');
      }

      // Ensure Sales tab reflects newly posted finalized transactions.
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey?.[0];
          return key === 'sales' || key === 'sales-summary';
        },
      });

      refetchDailySummary();
    },
    onError: (error: any) => {
      const payload = error?.response?.data;

      // ✅ Log full response for debugging
      console.error('[Finalize] API error response:', payload);
      console.error('[Finalize] Error status:', error?.response?.status);
      console.error('[Finalize] Metrics:', payload?.metrics);

      // ✅ Extract blocker messages from structured error response
      let blockers: Array<{ message: string }> = [];

      if (Array.isArray(payload?.details) && payload.details.length > 0) {
        // Server returned structured blockers (new format)
        blockers = payload.details.map((d: any) => ({
          message: d?.message || 'Unknown blocker',
        }));
      }

      // ✅ Show error dialog with blockers and metrics
      setFinalizeResult({
        type: 'error',
        message: payload?.error || payload?.message || 'Failed to finalize day',
        blockers: blockers.length > 0 ? blockers : undefined,
        metrics: payload?.metrics,
      });
      setFinalizeDialogOpen(true);

      // Also show brief toast
      toast.error('Finalize blocked - see dialog for details', { duration: 5000 });
    },
  });

  const handleSaveDraft = async () => {
    console.log('[Save Draft] Button clicked', {
      transactionCount: transactions.length,
      branchId: selectedBranchId,
      businessDate,
    });
    try {
      await saveDailyDraftMutation.mutateAsync(undefined);
    } catch (e: any) {
      // Error already handled by mutation onError callback
      console.error('[Save Draft] Error:', e?.response?.data?.error || e.message);
    }
  };

  const handleFinalizeDay = async () => {
    // ✅ SAFETY: Minimal client checks only - NO hard-stop validation
    if (isDailySummaryLoading) {
      toast.error('Please wait - server data is still loading');
      return;
    }

    if (!selectedBranchId) {
      toast.error('Please select a branch');
      return;
    }

    if (isDirty) {
      toast.error('Please save draft first before finalizing');
      return;
    }

    if (transactions.length === 0) {
      toast.error('No transactions to finalize');
      return;
    }

    // ✅ GATE: All minimal checks passed, call backend (backend is only authority for validation)
    console.log('[Finalize] API call started', {
      branchId: selectedBranchId,
      businessDate,
      transactionCount: transactions.length,
    });

    try {
      // ✅ Step 1: Call backend finalize endpoint - backend validates & returns blockers
      const result = await finalizeDayMutation.mutateAsync();
      console.log('[Finalize] API call succeeded, mutation returned:', result);
    } catch (error: any) {
      // ✅ Catch uncaught promise rejections (mutation onError already handles API errors)
      console.error('[Finalize] Uncaught error outside mutation:', error);

      // Only show toast if not an API error (API errors handled by mutation onError)
      if (!error?.response?.status) {
        toast.error(error?.message || 'An unexpected error occurred during finalization', { duration: 7000 });
      }
    }
  };

  // Save backdated meter reading mutation
  const saveMeterReadingMutation = useMutation({
    mutationFn: async ({ nozzleId, shiftId, readingType, meterValue, imageUrl, ocrConfidence, attachmentUrl, ocrManuallyEdited }: {
      nozzleId: string;
      shiftId: string;
      readingType: 'opening' | 'closing';
      meterValue: number;
      imageUrl?: string;
      ocrConfidence?: number;
      attachmentUrl?: string;
      ocrManuallyEdited?: boolean;
    }) => {
      const res = await apiClient.post('/api/backdated-meter-readings/daily', {
        branchId: selectedBranchId,
        businessDate,
        nozzleId,
        shiftId,
        readingType,
        meterValue,
        source: ocrConfidence ? 'ocr' : 'manual',
        imageUrl,
        ocrConfidence,
        attachmentUrl,
        ocrManuallyEdited,
      });
      return res.data;
    },
    onSuccess: () => {
      toast.success(`Meter reading saved!`);
      setIsMeterReadingOpen(false);
      setSelectedMeterNozzle(null);
      refetchMeterReadings(); // Refresh meter readings
      refetchDailySummary(); // Refresh daily summary to update totals
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error.message || 'Failed to save meter reading';
      toast.error(errorMsg);
    },
  });

  // Delete meter reading mutation
  const deleteMeterReadingMutation = useMutation({
    mutationFn: async (readingId: string) => {
      // ✅ GUARD: Prevent 404 if no valid ID
      if (!readingId || readingId.length < 10) {
        throw new Error('Invalid reading ID. Cannot delete meter reading without a valid database ID.');
      }

      const res = await apiClient.delete(`/api/backdated-meter-readings/daily/${readingId}`);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Meter reading deleted successfully');
      refetchMeterReadings();
      refetchDailySummary();
    },
    onError: (error: any) => {
      // ✅ USER-FRIENDLY ERROR: Don't show raw 404
      let errorMsg = error?.response?.data?.error || error.message || 'Failed to delete meter reading';
      if (error?.response?.status === 404) {
        errorMsg = 'Meter reading not found. It may have been already deleted.';
      }
      toast.error(errorMsg);
    },
  });

  // Update meter reading mutation
  const updateMeterReadingMutation = useMutation({
    mutationFn: async ({ readingId, meterValue, attachmentUrl, ocrManuallyEdited }: {
      readingId: string;
      meterValue: number;
      attachmentUrl?: string;
      ocrManuallyEdited?: boolean;
    }) => {
      // ✅ GUARD: Prevent 404 if no valid ID
      if (!readingId || readingId.length < 10) {
        throw new Error('Invalid reading ID. Cannot update meter reading without a valid database ID.');
      }

      const res = await apiClient.patch(`/api/backdated-meter-readings/daily/${readingId}`, {
        meterValue,
        attachmentUrl,
        ocrManuallyEdited,
      });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Meter reading updated successfully');
      setEditingReadingId(null);
      refetchMeterReadings();
      refetchDailySummary();
    },
    onError: (error: any) => {
      // ✅ USER-FRIENDLY ERROR: Don't show raw 404
      let errorMsg = error?.response?.data?.error || error.message || 'Failed to update meter reading';
      if (error?.response?.status === 404) {
        errorMsg = 'Meter reading not found. Please refresh the page and try again.';
      }
      toast.error(errorMsg);
    },
  });

  const handleMeterReadingCapture = async (data: MeterReadingData) => {
    try {
      if (!selectedMeterNozzle) {
        toast.error('No nozzle selected. Please try again.');
        return;
      }

      // Normalize nozzle ID (day-level API uses nozzleId, legacy might use id)
      const nozzleId = selectedMeterNozzle.nozzleId || selectedMeterNozzle.id;
      if (!nozzleId) {
        toast.error('Invalid nozzle ID. Please refresh and try again.');
        return;
      }

      // Coerce and validate meter value
      const meterValue = Number(data.currentReading);
      if (!Number.isFinite(meterValue) || meterValue < 0) {
        toast.error('Invalid meter value. Please enter a valid number.');
        return;
      }

      console.log('[MeterReading] Capture handler called:', {
        editingReadingId,
        nozzleId,
        readingType: selectedReadingType,
        meterValue,
        isManualReading: data.isManualReading,
      });

      // If editing existing reading, call UPDATE
      if (editingReadingId) {
        await updateMeterReadingMutation.mutateAsync({
          readingId: editingReadingId,
          meterValue,
          attachmentUrl: data.referenceAttachmentUrl,
          ocrManuallyEdited: data.isManualReading && data.ocrConfidence !== undefined,
        });
        setIsMeterReadingOpen(false);
        setSelectedMeterNozzle(null);
        return;
      }

      // Otherwise, create new reading
      await saveMeterReadingMutation.mutateAsync({
        nozzleId,
        shiftId: selectedShiftId,
        readingType: selectedReadingType,
        meterValue,
        imageUrl: data.imageUrl,
        ocrConfidence: data.ocrConfidence,
        attachmentUrl: data.referenceAttachmentUrl,
        ocrManuallyEdited: data.isManualReading && data.ocrConfidence !== undefined,
      });
    } catch (error: any) {
      console.error('[MeterReading] Capture handler error:', error);
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || error?.message || 'Failed to save meter reading. Please try again.';
      toast.error(errorMsg);
    }
  };

  const openMeterReadingDialog = async (nozzle: any, type: 'opening' | 'closing', shift?: any, reading?: any) => {
    const normalizedNozzle = {
      ...nozzle,
      id: nozzle?.id || nozzle?.nozzleId,
      name: nozzle?.name || nozzle?.nozzleName,
      nozzleNumber: nozzle?.nozzleNumber || nozzle?.nozzleNo || nozzle?.nozzleCode,
      fuelType: nozzle?.fuelType || { name: nozzle?.fuelTypeName || nozzle?.fuelType || 'Unknown' },
    };

    setSelectedMeterNozzle(normalizedNozzle);
    setSelectedReadingType(type);
    setSelectedShiftId(shift?.shiftId || '');
    if (reading) {
      setEditingReadingId(reading.id);
    } else {
      setEditingReadingId(null);
    }

    // Fetch previous reading for modal context
    const nozzleId = normalizedNozzle?.id;
    if (shift?.shiftId && nozzleId) {
      try {
        const prevReading = await meterReadingsApi.getModalPreviousReading({
          branchId: selectedBranchId,
          businessDate,
          shiftId: shift.shiftId,
          nozzleId,
          readingType: type,
        });
        setModalPreviousReading(prevReading?.value ?? null);
      } catch (error) {
        console.error('[MeterReading] Failed to fetch previous reading:', error);
        setModalPreviousReading(null);
      }
    }

    setIsMeterReadingOpen(true);
  };

  const resetForm = () => {
    setBusinessDate(format(new Date(), 'yyyy-MM-dd'));
    setSelectedBranchId('');
    setSelectedShiftId('');
    hydratingTransactionsRef.current = true;
    setTransactions([]);
    setDeletedTransactionIds([]);
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
      {(selectedBranchId || businessDate) && (
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

                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>

          {/* Meter Readings Section - Daily */}
          {selectedBranchId && businessDate ? (
            <Card className="border rounded-lg">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Gauge className="h-5 w-5" />
                    Backdated Meter Readings (Daily)
                  </CardTitle>
                  <Badge variant="outline" className="text-blue-600 border-blue-600">
                    <Camera className="h-3 w-3 mr-1" />
                    OCR + Upload
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {/* Continuity Info Alert */}
                <Alert className="mb-4 border-blue-200 bg-blue-50">
                  <CheckCircle className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-sm text-blue-900">
                    <strong>Daily Chain:</strong> Opening auto-fills from previous day closing and closing can auto-fill next day opening. Gaps are shown as warnings.
                  </AlertDescription>
                </Alert>

                {/* Loading State */}
                {!backdatedMeterReadingsData && !backdatedReadingsError && (
                  <Alert className="mb-4 border-blue-200 bg-blue-50">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-sm text-blue-900">
                      <strong>Loading meter readings...</strong> Please wait.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Error Alert */}
                {backdatedReadingsError && (
                  <Alert className="mb-4 border-red-200 bg-red-50">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    <AlertDescription className="text-sm text-red-900">
                      <strong>Failed to load backdated meter readings.</strong> This may indicate a database connection issue or missing data. Try refreshing the page, or contact support if the issue persists.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Aggregate Summary (across all shifts) */}
                {(backdatedMeterReadingsData as any)?.aggregateSummary && (
                  <div className="grid grid-cols-4 gap-4 mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <div>
                      <div className="text-xs text-muted-foreground">Total Sales (Daily)</div>
                      <div className="text-2xl font-bold text-green-600">
                        {formatLiters((backdatedMeterReadingsData as any).aggregateSummary.totalSalesLiters || 0)} L
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Completion</div>
                      <div className="text-2xl font-bold">
                        {((backdatedMeterReadingsData as any).aggregateSummary.completionPercent || 0).toFixed(0)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Filled Readings</div>
                      <div className="text-lg font-semibold">
                        {(backdatedMeterReadingsData as any).aggregateSummary.filledReadings} / {(backdatedMeterReadingsData as any).aggregateSummary.totalReadingsExpected}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Missing</div>
                      <div className="text-lg font-semibold text-amber-600">
                        {(backdatedMeterReadingsData as any).aggregateSummary.totalReadingsMissing}
                      </div>
                    </div>
                  </div>
                )}

                {/* Empty State */}
                {backdatedMeterReadingsData && !(backdatedMeterReadingsData as any)?.shifts?.length && (
                  <Alert className="mb-4 border-amber-200 bg-amber-50">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-sm text-amber-900">
                      <strong>No nozzle readings found for this date.</strong> Start by selecting a nozzle and entering meter readings above.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Shift Accordions */}
                {(backdatedMeterReadingsData as any)?.shifts?.length > 0 ? (
                  <Accordion type="multiple" defaultValue={(backdatedMeterReadingsData as any).shifts.map((s: any) => s.shiftId)}>
                    {(backdatedMeterReadingsData as any).shifts.map((shift: any) => (
                      <AccordionItem key={shift.shiftId} value={shift.shiftId} className="border rounded-lg mb-4">
                        <AccordionTrigger className="px-4 hover:no-underline">
                          <div className="flex items-center justify-between w-full pr-2">
                            <div className="flex items-center gap-3">
                              <Clock className="h-5 w-5 text-blue-600" />
                              <div>
                                <div className="font-semibold text-lg text-left">{shift.shiftName}</div>
                                <div className="text-xs text-muted-foreground text-left">
                                  {(typeof shift.startTime === 'string' && shift.startTime.length >= 16) ? shift.startTime.substring(11, 16) : 'N/A'} - {(typeof shift.endTime === 'string' && shift.endTime.length >= 16) ? shift.endTime.substring(11, 16) : 'N/A'}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <Badge variant={toNumber(shift?.summary?.completionPercent) === 100 ? 'default' : 'secondary'} className="text-sm">
                                {toNumber(shift?.summary?.completionPercent).toFixed(0)}% Complete
                              </Badge>
                              <div className="text-sm text-muted-foreground">
                                {/* ✅ NEW: Product-wise sales breakdown */}
                                HSD: <span className="font-semibold text-blue-600">{formatLiters(toNumber(shift?.summary?.hsdSalesLiters))} L</span>
                                {' '}| PMG: <span className="font-semibold text-orange-600">{formatLiters(toNumber(shift?.summary?.pmgSalesLiters))} L</span>
                                {' '}| Total: <span className="font-semibold text-green-600">{formatLiters(toNumber(shift?.summary?.totalSalesLiters))} L</span>
                              </div>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4">
                          {/* Nozzles for this shift */}
                          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                            {(Array.isArray(shift?.nozzles) ? shift.nozzles : []).map((nozzle: any) => {
                              const hasEnteredOpening = nozzle.opening?.status === 'entered';
                              const hasEnteredClosing = nozzle.closing?.status === 'entered';
                              const isPropagatedOpening = nozzle.opening?.status === 'propagated_backward' || nozzle.opening?.status === 'propagated_forward';
                              const isPropagatedClosing = nozzle.closing?.status === 'propagated_backward' || nozzle.closing?.status === 'propagated_forward';
                              const hasBothValid = (hasEnteredOpening || isPropagatedOpening) && (hasEnteredClosing || isPropagatedClosing);
                              const openingValue = nozzle.opening?.value;
                              const closingValue = nozzle.closing?.value;
                              const showSales = hasBothValid && (openingValue > 0) && (closingValue > 0);
                              const salesLiters = showSales ? closingValue - openingValue : null;

                              let rowState = 'Both Missing';
                              let statusColor = 'bg-amber-50 border-amber-200';
                              if (hasEnteredOpening && hasEnteredClosing) {
                                rowState = '✓ Complete';
                                statusColor = 'bg-green-50 border-green-300';
                              } else if ((hasEnteredOpening || isPropagatedOpening) && (hasEnteredClosing || isPropagatedClosing)) {
                                rowState = '✓ Complete (with derived)';
                                statusColor = 'bg-blue-50 border-blue-300';
                              } else if ((hasEnteredOpening || isPropagatedOpening) && !hasEnteredClosing && !isPropagatedClosing) {
                                rowState = 'Closing Missing';
                                statusColor = 'bg-amber-50 border-amber-300';
                              } else if (!hasEnteredOpening && !isPropagatedOpening && (hasEnteredClosing || isPropagatedClosing)) {
                                rowState = 'Opening Missing';
                                statusColor = 'bg-amber-50 border-amber-300';
                              }

                              return (
                                <div key={nozzle.nozzleId} className={`border rounded-lg p-3 ${statusColor}`}>
                          {/* Nozzle Header */}
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <div className="font-semibold text-base">
                                {nozzle.nozzleName}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {nozzle.fuelTypeName || 'Unknown'}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={(hasEnteredOpening || isPropagatedOpening) && (hasEnteredClosing || isPropagatedClosing) ? 'default' : 'secondary'}
                                className={
                                  (hasEnteredOpening || isPropagatedOpening) && (hasEnteredClosing || isPropagatedClosing)
                                    ? 'bg-green-600 text-xs'
                                    : 'bg-amber-600 text-xs'
                                }
                              >
                                {rowState}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {nozzle.fuelType || 'N/A'}
                              </Badge>
                            </div>
                          </div>

                          {/* Continuity Warning Alert (if applicable) */}
                          {nozzle.continuityWarning && (
                            <Alert className="mb-3 border-amber-200 bg-amber-50">
                              <AlertCircle className="h-4 w-4 text-amber-600" />
                              <AlertDescription className="text-xs text-amber-900">
                                {nozzle.continuityWarning}
                              </AlertDescription>
                            </Alert>
                          )}

                          {/* Reading Inputs */}
                          <div className="grid grid-cols-3 gap-2">
                            {/* Opening Reading */}
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-muted-foreground">Opening</div>
                              {(hasEnteredOpening || isPropagatedOpening) ? (
                                <div className="space-y-2">
                                  {/* Propagated Badge */}
                                  {isPropagatedOpening && (
                                    <div className="text-xs text-blue-700 font-medium bg-blue-50 px-2 py-1 rounded border border-blue-200">
                                      From {shift.shiftName} (previous)
                                    </div>
                                  )}
                                  {/* Value and Actions */}
                                  <div className="flex items-center gap-2 justify-between">
                                    <div className="flex items-center gap-2">
                                      <CheckCircle className="h-4 w-4 text-green-600" />
                                      <span className="font-mono font-semibold text-sm">
                                        {openingValue?.toFixed(3)}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {nozzle.opening?.imageUrl && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => openAttachmentInNewTab(nozzle.opening?.imageUrl)}
                                          className="h-7 w-7 p-0"
                                          title="View image"
                                        >
                                          <Eye className="h-3 w-3 text-blue-600" />
                                        </Button>
                                      )}
                                      {nozzle.opening?.attachmentUrl && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => openAttachmentInNewTab(nozzle.opening?.attachmentUrl)}
                                          className="h-7 w-7 p-0"
                                          title="View attachment"
                                        >
                                          <Eye className="h-3 w-3 text-green-600" />
                                        </Button>
                                      )}
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() =>
                                          openMeterReadingDialog(nozzle, 'opening', shift, {
                                            id: nozzle.opening?.id,
                                            meter_value: nozzle.opening?.value,
                                          })
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
                                          if (!nozzle.opening?.id) {
                                            toast.error('Reading ID missing. Please refresh and try again.');
                                            return;
                                          }
                                          if (confirm('Delete this opening reading?')) {
                                            deleteMeterReadingMutation.mutate(nozzle.opening.id);
                                          }
                                        }}
                                        className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                                        title="Delete opening"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                  {/* Audit Trail */}
                                  <div className="text-xs space-y-1 bg-gray-50 p-2 rounded border border-gray-200">
                                    {nozzle.opening?.submittedByName && (
                                      <div className="flex items-center gap-1 text-gray-700">
                                        <User className="h-3 w-3 text-blue-600" />
                                        <span>By {nozzle.opening.submittedByName}</span>
                                      </div>
                                    )}
                                    {nozzle.opening?.submittedAt && (
                                      <div className="flex items-center gap-1 text-gray-700">
                                        <Clock className="h-3 w-3 text-blue-600" />
                                        <span>{safeFormatDateTime(nozzle.opening.submittedAt)}</span>
                                      </div>
                                    )}
                                    {nozzle.opening?.ocrManuallyEdited && (
                                      <div className="text-blue-600 font-medium">OCR (manually edited)</div>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openMeterReadingDialog(nozzle, 'opening', shift)}
                                  className="w-full h-11 text-sm border-amber-600 text-amber-700 hover:bg-amber-100"
                                >
                                  <Camera className="h-4 w-4 mr-1" />
                                  Add
                                </Button>
                              )}
                            </div>

                            {/* Closing Reading */}
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-muted-foreground">Closing</div>
                              {(hasEnteredClosing || isPropagatedClosing) ? (
                                <div className="space-y-2">
                                  {/* Propagated Badge */}
                                  {isPropagatedClosing && (
                                    <div className="text-xs text-blue-700 font-medium bg-blue-50 px-2 py-1 rounded border border-blue-200">
                                      From {shift.shiftName} (next)
                                    </div>
                                  )}
                                  {/* Value and Actions */}
                                  <div className="flex items-center gap-2 justify-between">
                                    <div className="flex items-center gap-2">
                                      <CheckCircle className="h-4 w-4 text-green-600" />
                                      <span className="font-mono font-semibold text-sm">
                                        {closingValue?.toFixed(3)}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {nozzle.closing?.imageUrl && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => openAttachmentInNewTab(nozzle.closing?.imageUrl)}
                                          className="h-7 w-7 p-0"
                                          title="View image"
                                        >
                                          <Eye className="h-3 w-3 text-blue-600" />
                                        </Button>
                                      )}
                                      {nozzle.closing?.attachmentUrl && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => openAttachmentInNewTab(nozzle.closing?.attachmentUrl)}
                                          className="h-7 w-7 p-0"
                                          title="View attachment"
                                        >
                                          <Eye className="h-3 w-3 text-green-600" />
                                        </Button>
                                      )}
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() =>
                                          openMeterReadingDialog(nozzle, 'closing', shift, {
                                            id: nozzle.closing?.id,
                                            meter_value: nozzle.closing?.value,
                                          })
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
                                          if (!nozzle.closing?.id) {
                                            toast.error('Reading ID missing. Please refresh and try again.');
                                            return;
                                          }
                                          if (confirm('Delete this closing reading?')) {
                                            deleteMeterReadingMutation.mutate(nozzle.closing.id);
                                          }
                                        }}
                                        className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                                        title="Delete closing"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                  {/* Audit Trail */}
                                  <div className="text-xs space-y-1 bg-gray-50 p-2 rounded border border-gray-200">
                                    {nozzle.closing?.submittedByName && (
                                      <div className="flex items-center gap-1 text-gray-700">
                                        <User className="h-3 w-3 text-blue-600" />
                                        <span>By {nozzle.closing.submittedByName}</span>
                                      </div>
                                    )}
                                    {nozzle.closing?.submittedAt && (
                                      <div className="flex items-center gap-1 text-gray-700">
                                        <Clock className="h-3 w-3 text-blue-600" />
                                        <span>{safeFormatDateTime(nozzle.closing.submittedAt)}</span>
                                      </div>
                                    )}
                                    {nozzle.closing?.ocrManuallyEdited && (
                                      <div className="text-blue-600 font-medium">OCR (manually edited)</div>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openMeterReadingDialog(nozzle, 'closing', shift)}
                                  className="w-full h-11 text-sm border-amber-600 text-amber-700 hover:bg-amber-100"
                                >
                                  <Camera className="h-4 w-4 mr-1" />
                                  Add
                                </Button>
                              )}
                            </div>

                            {/* Sales Column */}
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-muted-foreground">Sales (L)</div>
                              <div className="flex items-center justify-center h-11 rounded border border-gray-200 bg-gray-50">
                                <span className="font-mono font-semibold text-sm">
                                  {showSales && salesLiters !== null ? salesLiters.toFixed(2) : '—'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* HSD/PMG Dashboard Cards */}
          {selectedBranchId && businessDate && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* HSD Card - USE SAME DATA SOURCE AS FINALIZE (dailySummaryData) */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">HSD (Diesel)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Meter Total:</span>
                    <span className="font-mono font-semibold">{(dailySummaryData?.meterTotals?.hsdLiters || 0).toFixed(3)} L</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Posted:</span>
                    <span className="font-mono text-blue-600">{(dailySummaryData?.postedTotals?.hsdLiters || 0).toFixed(3)} L</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Remaining:</span>
                    <span className="font-mono font-semibold text-orange-600">{(dailySummaryData?.remainingLiters?.hsd || 0).toFixed(3)} L</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm font-medium text-muted-foreground">
                      <span>{(dailySummaryData?.meterTotals?.hsdLiters || 0) > 0 ? Math.round(((dailySummaryData?.postedTotals?.hsdLiters || 0) / (dailySummaryData?.meterTotals?.hsdLiters || 1)) * 100) : 0}% Reconciled</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 transition-all"
                        style={{ width: `${(dailySummaryData?.meterTotals?.hsdLiters || 0) > 0 ? Math.min(((dailySummaryData?.postedTotals?.hsdLiters || 0) / (dailySummaryData?.meterTotals?.hsdLiters || 1)) * 100, 100) : 0}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* PMG Card - USE SAME DATA SOURCE AS FINALIZE (dailySummaryData) */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">PMG (Petrol)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Meter Total:</span>
                    <span className="font-mono font-semibold">{(dailySummaryData?.meterTotals?.pmgLiters || 0).toFixed(3)} L</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Posted:</span>
                    <span className="font-mono text-blue-600">{(dailySummaryData?.postedTotals?.pmgLiters || 0).toFixed(3)} L</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Remaining:</span>
                    <span className="font-mono font-semibold text-orange-600">{(dailySummaryData?.remainingLiters?.pmg || 0).toFixed(3)} L</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm font-medium text-muted-foreground">
                      <span>{(dailySummaryData?.meterTotals?.pmgLiters || 0) > 0 ? Math.round(((dailySummaryData?.postedTotals?.pmgLiters || 0) / (dailySummaryData?.meterTotals?.pmgLiters || 1)) * 100) : 0}% Reconciled</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 transition-all"
                        style={{ width: `${(dailySummaryData?.meterTotals?.pmgLiters || 0) > 0 ? Math.min(((dailySummaryData?.postedTotals?.pmgLiters || 0) / (dailySummaryData?.meterTotals?.pmgLiters || 1)) * 100, 100) : 0}%` }}
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
                                            const product = nonFuelProductOptions.find((p: any) => p.name === v);
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
                                            {nonFuelProductOptions.length > 0 ? (
                                              nonFuelProductOptions.map((product: any) => (
                                                <SelectItem key={product.id} value={product.name}>
                                                  {product.name}
                                                  {product.unitPrice ? ` - PKR ${product.unitPrice}` : ''}
                                                  {product.isLegacy ? ' (Saved)' : ''}
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
            }
          }}>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {selectedReadingType === 'opening' ? 'Opening' : 'Closing'} Reading
                </DialogTitle>
                <DialogDescription>
                  {selectedMeterNozzle?.name || `Nozzle ${selectedMeterNozzle?.nozzleNumber || '-'}`} ({selectedMeterNozzle?.fuelType?.name || selectedMeterNozzle?.fuelTypeName || selectedMeterNozzle?.fuelType || 'Unknown'})
                  {' • '}
                  Business Date: {businessDate}
                </DialogDescription>
              </DialogHeader>
              {selectedMeterNozzle && (
                <MeterReadingCapture
                  nozzleId={selectedMeterNozzle.id}
                  nozzleName={`${selectedMeterNozzle.name || `Nozzle ${selectedMeterNozzle.nozzleNumber || '-'}`} (${selectedMeterNozzle.fuelType?.name || selectedMeterNozzle?.fuelTypeName || selectedMeterNozzle?.fuelType || 'Unknown'})`}
                  previousReading={modalPreviousReading ?? undefined}
                  onCapture={handleMeterReadingCapture}
                  onCancel={() => {
                    setIsMeterReadingOpen(false);
                    setSelectedMeterNozzle(null);
                    setEditingReadingId(null);
                    setModalPreviousReading(null);
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

      {/* Finalize Result Modal Dialog */}
      <Dialog open={finalizeDialogOpen} onOpenChange={setFinalizeDialogOpen}>
        <DialogContent className="max-w-md max-h-96 overflow-y-auto">
          {finalizeResult?.type === 'success' ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-5 w-5" />
                  {finalizeResult.alreadyFinalized
                    ? 'Day Already Finalized'
                    : 'Successfully Finalized!'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* Business Date Context */}
                {finalizeResult.businessDate && (
                  <div className="bg-slate-100 border border-slate-300 rounded px-3 py-2 text-sm">
                    <span className="font-semibold text-slate-700">Business Date: </span>
                    <span className="font-semibold text-slate-900">
                      {new Date(finalizeResult.businessDate + 'T00:00:00').toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                )}

                <div className="text-sm text-muted-foreground">
                  {finalizeResult.message}
                </div>

                {/* Reconciliation Totals Summary */}
                {finalizeResult.reconciliationTotals && !finalizeResult.alreadyFinalized && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-3 space-y-2 text-sm">
                    <div className="font-semibold text-blue-900 mb-2">
                      Reconciliation Summary
                    </div>

                    {/* HSD Sales */}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total HSD Sales Reconciled:</span>
                      <span className="font-semibold">
                        {finalizeResult.reconciliationTotals.hsd.liters.toFixed(3)} L @ PKR {finalizeResult.reconciliationTotals.hsd.amount.toFixed(2)}
                      </span>
                    </div>

                    {/* PMG Sales */}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total PMG Sales Reconciled:</span>
                      <span className="font-semibold">
                        {finalizeResult.reconciliationTotals.pmg.liters.toFixed(3)} L @ PKR {finalizeResult.reconciliationTotals.pmg.amount.toFixed(2)}
                      </span>
                    </div>

                    {/* Non-Fuel Sales */}
                    {finalizeResult.reconciliationTotals.nonFuel.amount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Non Fuel Items Posted:</span>
                        <span className="font-semibold">
                          PKR {finalizeResult.reconciliationTotals.nonFuel.amount.toFixed(2)}
                        </span>
                      </div>
                    )}

                    {/* Total Sales */}
                    <div className="flex justify-between border-t pt-2 mt-2">
                      <span className="text-muted-foreground font-semibold">Total Sales Posted:</span>
                      <span className="font-semibold text-blue-900">
                        PKR {finalizeResult.reconciliationTotals.total.amount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                <div className="bg-green-50 border border-green-200 rounded p-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transactions Posted:</span>
                    <span className="font-semibold">{finalizeResult.transactionsProcessed || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sales Records Created:</span>
                    <span className="font-semibold">{finalizeResult.salesCreated || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Branch:</span>
                    <span className="font-semibold">{finalizeResult.branchName || branchesData?.find((b: any) => b.id === selectedBranchId)?.name || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Created By:</span>
                    <span className="font-semibold">{finalizeResult.finalizedBy?.fullName || finalizeResult.finalizedBy?.username || 'Unknown'}</span>
                  </div>
                </div>

                {/* Finalization Timestamp Footer */}
                {finalizeResult.finalizedAt && (
                  <div className="text-xs text-center text-muted-foreground border-t pt-3">
                    Finalized & Reconciled on Date/Time:{' '}
                    <span className="font-semibold text-slate-700">
                      {new Date(finalizeResult.finalizedAt).toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                )}

                {!finalizeResult.alreadyFinalized && (
                  <div className="text-xs text-muted-foreground">
                    Transactions will be synced to QuickBooks in the background.
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={() => setFinalizeDialogOpen(false)} className="w-full">
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-orange-600">
                  <AlertCircle className="h-5 w-5" />
                  Finalize Blocked
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  {finalizeResult?.message}
                </div>

                {/* Blockers List */}
                {finalizeResult?.blockers && finalizeResult.blockers.length > 0 && (
                  <div className="bg-orange-50 border border-orange-200 rounded p-3 space-y-2 text-sm">
                    <div className="font-semibold text-orange-900">Blockers:</div>
                    {finalizeResult.blockers.map((blocker, idx) => (
                      <div key={idx} className="flex gap-2 text-orange-800">
                        <span className="mt-0.5">•</span>
                        <span>{blocker.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Metrics Display */}
                {finalizeResult?.metrics && (
                  <div className="bg-slate-50 border border-slate-200 rounded p-3 space-y-2 text-sm">
                    <div className="font-semibold text-slate-900">Gaps:</div>
                    <div className="space-y-1">
                      {finalizeResult.metrics.hsdGap !== undefined && (
                        <div className="flex justify-between text-slate-700">
                          <span className="text-muted-foreground">HSD Gap:</span>
                          <span className={`font-mono font-semibold ${Math.abs(finalizeResult.metrics.hsdGap) > 0.01 ? 'text-orange-600' : 'text-green-600'}`}>
                            {finalizeResult.metrics.hsdGap.toFixed(3)} L
                          </span>
                        </div>
                      )}
                      {finalizeResult.metrics.pmgGap !== undefined && (
                        <div className="flex justify-between text-slate-700">
                          <span className="text-muted-foreground">PMG Gap:</span>
                          <span className={`font-mono font-semibold ${Math.abs(finalizeResult.metrics.pmgGap) > 0.01 ? 'text-orange-600' : 'text-green-600'}`}>
                            {finalizeResult.metrics.pmgGap.toFixed(3)} L
                          </span>
                        </div>
                      )}
                      {finalizeResult.metrics.cashGap !== undefined && (
                        <div className="flex justify-between text-slate-700">
                          <span className="text-muted-foreground">Cash Gap:</span>
                          <span className={`font-mono font-semibold ${Math.abs(finalizeResult.metrics.cashGap) > 0.01 ? 'text-orange-600' : 'text-green-600'}`}>
                            {finalizeResult.metrics.cashGap.toFixed(2)} PKR
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  Fix the blockers above and save your draft again before finalizing.
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => setFinalizeDialogOpen(false)} variant="outline" className="w-full">
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
