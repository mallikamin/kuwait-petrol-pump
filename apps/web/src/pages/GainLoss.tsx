import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Building2, CalendarDays, Loader2, Plus, Trash2, Check, X, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { branchesApi, apiClient, inventoryApi } from '@/api';
import type { GainLossEntry, StockAtDateResult } from '@/api/inventory';
import { useAuthStore } from '@/store/auth';
import { useOnOrgSwitch } from '@/hooks/useEffectiveBranch';
import { cn } from '@/utils/cn';

interface FuelType {
  id: string;
  code: 'HSD' | 'PMG' | string;
  name: string;
}

const fmtL = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  if (v === 0) return '0';
  return (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
};
const fmtPKR = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-PK', { maximumFractionDigits: 0 });

const monthOf = (d: string | null | undefined) => (d || '').slice(0, 7) || '—';

/**
 * Inline editor for an existing gain/loss entry. Edits the measured liters;
 * server re-derives quantity + value against the originally captured
 * bookQtyAtDate so the chain of subsequent entries stays stable.
 */
function MeasuredCell({
  entry,
  onSaved,
}: {
  entry: GainLossEntry;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState<string>(
    entry.measuredQty != null ? String(entry.measuredQty) : '',
  );

  const mut = useMutation({
    mutationFn: async () => {
      const num = parseFloat(val);
      if (!Number.isFinite(num)) throw new Error('Enter a number');
      return inventoryApi.updateGainLossEntry(entry.id, { measuredQty: num });
    },
    onSuccess: () => {
      toast.success('Updated');
      setEditing(false);
      onSaved();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || e?.message || 'Update failed';
      toast.error('Update failed', { description: msg });
    },
  });

  if (!editing) {
    return (
      <button
        type="button"
        className="font-mono w-full text-right hover:bg-accent rounded px-1 py-0.5 cursor-pointer group"
        onClick={() => setEditing(true)}
        title="Click to edit measured liters"
      >
        {entry.measuredQty != null ? fmtL(entry.measuredQty) : '—'}
        <Pencil className="inline-block ml-1 h-3 w-3 opacity-0 group-hover:opacity-50" />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus
        type="number"
        step="0.001"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') mut.mutate();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="h-7 text-right font-mono w-28"
      />
      <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => mut.mutate()} disabled={mut.isPending}>
        {mut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => setEditing(false)}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

function RemarksCell({
  entry,
  onSaved,
}: {
  entry: GainLossEntry;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(entry.remarks || '');

  const mut = useMutation({
    mutationFn: async () =>
      inventoryApi.updateGainLossEntry(entry.id, { remarks: val || null }),
    onSuccess: () => {
      toast.success('Remarks updated');
      setEditing(false);
      onSaved();
    },
    onError: (e: any) => {
      toast.error('Update failed', {
        description: e?.response?.data?.error || e?.message,
      });
    },
  });

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-left w-full truncate hover:bg-accent rounded px-1 py-0.5 cursor-pointer text-muted-foreground"
        title={entry.remarks || 'Click to add remarks'}
      >
        {entry.remarks || <span className="italic opacity-50">add remarks</span>}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') mut.mutate();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="h-7 text-sm"
      />
      <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => mut.mutate()} disabled={mut.isPending}>
        <Check className="h-3 w-3" />
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => setEditing(false)}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function GainLoss() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    () => (user as any)?.branch?.id || '',
  );
  // Reset selection when the org switches via the top-bar dropdown — the
  // auto-pick effect below will repopulate from the new org's branches.
  useOnOrgSwitch(() => setSelectedBranchId(''));

  // Default: this calendar year so the operator sees yearly totals at a glance.
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-01-01`;
  });
  const [endDate, setEndDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));

  // Inline new-entry row state. Lives at the top of each fuel section so the
  // accountant can punch in a measurement without opening a modal.
  const [draft, setDraft] = useState({
    fuelTypeId: '',
    businessDate: format(new Date(), 'yyyy-MM-dd'),
    measuredQty: '',
    remarks: '',
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await branchesApi.getAll()).items,
  });

  useEffect(() => {
    if (!selectedBranchId && branches.length > 0) {
      setSelectedBranchId(branches[0].id);
    }
  }, [branches, selectedBranchId]);

  const { data: fuelTypes = [] } = useQuery<FuelType[]>({
    queryKey: ['fuel-types'],
    queryFn: async () => {
      const response = await apiClient.get('/fuel-prices/fuel-types');
      return response.data;
    },
  });

  // Default the draft fuel to the first fuel once the list arrives.
  useEffect(() => {
    if (!draft.fuelTypeId && fuelTypes.length > 0) {
      setDraft((d) => ({ ...d, fuelTypeId: fuelTypes[0].id }));
    }
  }, [fuelTypes, draft.fuelTypeId]);

  const { data: entriesResult, isLoading: entriesLoading } = useQuery({
    queryKey: ['gain-loss-entries', selectedBranchId, startDate, endDate],
    enabled: !!selectedBranchId,
    queryFn: () =>
      inventoryApi.getGainLossEntries({
        branchId: selectedBranchId,
        startDate,
        endDate,
      }),
  });

  const entries = entriesResult?.entries || [];

  const { data: stockAtDate, isFetching: stockLoading } = useQuery<StockAtDateResult>({
    queryKey: ['stock-at-date', selectedBranchId, draft.fuelTypeId, draft.businessDate],
    enabled: !!selectedBranchId && !!draft.fuelTypeId && !!draft.businessDate,
    queryFn: () =>
      inventoryApi.getStockAtDate({
        branchId: selectedBranchId,
        fuelTypeId: draft.fuelTypeId,
        asOfDate: draft.businessDate,
      }),
  });

  const measuredNum = parseFloat(draft.measuredQty);
  const computedDelta =
    stockAtDate && Number.isFinite(measuredNum) ? measuredNum - stockAtDate.bookQty : null;
  const computedValue =
    computedDelta != null && stockAtDate?.lastPurchaseRate != null
      ? computedDelta * stockAtDate.lastPurchaseRate
      : null;

  const createMut = useMutation({
    mutationFn: async () => {
      if (!selectedBranchId) throw new Error('Select a branch');
      if (!draft.fuelTypeId) throw new Error('Select a fuel');
      const measured = parseFloat(draft.measuredQty);
      if (!Number.isFinite(measured)) throw new Error('Enter measured liters');
      return inventoryApi.createGainLossByDate({
        branchId: selectedBranchId,
        fuelTypeId: draft.fuelTypeId,
        businessDate: draft.businessDate,
        measuredQty: measured,
        remarks: draft.remarks || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Entry recorded');
      setDraft((d) => ({ ...d, measuredQty: '', remarks: '' }));
      queryClient.invalidateQueries({ queryKey: ['gain-loss-entries'] });
      queryClient.invalidateQueries({ queryKey: ['report-inventory'] });
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.error || err?.message || 'Failed to save';
      toast.error('Save failed', { description: msg });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.delete(`/inventory/monthly-gain-loss/${id}`);
      return data;
    },
    onSuccess: () => {
      toast.success('Entry deleted');
      queryClient.invalidateQueries({ queryKey: ['gain-loss-entries'] });
      queryClient.invalidateQueries({ queryKey: ['report-inventory'] });
    },
    onError: (err: any) => {
      toast.error('Delete failed', {
        description: err?.response?.data?.error || err?.message,
      });
    },
  });

  // Period totals for the KPI strip — sums quantity + value across all entries
  // currently visible (i.e. inside the date range filter).
  const totals = useMemo(() => {
    const acc: Record<string, { qty: number; value: number; n: number }> = {
      HSD: { qty: 0, value: 0, n: 0 },
      PMG: { qty: 0, value: 0, n: 0 },
    };
    entries.forEach((e) => {
      const code = e.fuel?.code;
      if (!code || !acc[code]) return;
      acc[code].qty += Number(e.quantity);
      acc[code].value += Number(e.valueAtRate || 0);
      acc[code].n += 1;
    });
    return acc;
  }, [entries]);

  const onRefetchEntries = () => {
    queryClient.invalidateQueries({ queryKey: ['gain-loss-entries'] });
    queryClient.invalidateQueries({ queryKey: ['report-inventory'] });
  };

  const draftFuelCode = fuelTypes.find((f) => f.id === draft.fuelTypeId)?.code || '';
  const canSubmit =
    !!selectedBranchId &&
    !!draft.fuelTypeId &&
    !!draft.businessDate &&
    Number.isFinite(parseFloat(draft.measuredQty));

  return (
    <div className="p-3 space-y-3">
      {/* Top toolbar: branch + date range + KPI strip — single row, no scrolling. */}
      <div className="flex flex-wrap items-end gap-2 border-b pb-2">
        <div>
          <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center gap-1">
            <Building2 className="h-3 w-3" /> Branch
          </div>
          <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
            <SelectTrigger className="h-8 w-48">
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b: any) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center gap-1">
            <CalendarDays className="h-3 w-3" /> From
          </div>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-8 w-36"
          />
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center gap-1">
            <CalendarDays className="h-3 w-3" /> To
          </div>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-8 w-36"
          />
        </div>
        <h1 className="text-base font-semibold ml-2">Inventory Gain / Loss</h1>

        <div className="ml-auto flex items-center gap-3 text-xs">
          {(['HSD', 'PMG'] as const).map((code) => (
            <div key={code} className="rounded border px-2 py-1">
              <div className="text-[10px] text-muted-foreground">{code} Net</div>
              <div className="flex gap-3">
                <span
                  className={cn(
                    'font-mono font-semibold',
                    totals[code].qty < 0 && 'text-destructive',
                    totals[code].qty > 0 && 'text-green-700',
                  )}
                >
                  {fmtL(totals[code].qty)} L
                </span>
                <span
                  className={cn(
                    'font-mono text-muted-foreground',
                    totals[code].value < 0 && 'text-destructive',
                  )}
                >
                  PKR {fmtPKR(totals[code].value)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Inline new-entry row — single line, no modal. */}
      <div className="rounded border bg-muted/30 p-2">
        <div className="grid grid-cols-12 gap-2 items-end text-xs">
          <div className="col-span-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">Fuel</div>
            <Select
              value={draft.fuelTypeId}
              onValueChange={(v) => setDraft((d) => ({ ...d, fuelTypeId: v }))}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Fuel" />
              </SelectTrigger>
              <SelectContent>
                {fuelTypes.map((ft) => (
                  <SelectItem key={ft.id} value={ft.id}>
                    {ft.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">Date measured</div>
            <Input
              type="date"
              value={draft.businessDate}
              max={format(new Date(), 'yyyy-MM-dd')}
              onChange={(e) => setDraft((d) => ({ ...d, businessDate: e.target.value }))}
              className="h-8"
            />
          </div>
          <div className="col-span-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">
              Book stock {stockLoading && <Loader2 className="inline h-2.5 w-2.5 animate-spin ml-1" />}
            </div>
            <div className="h-8 px-2 flex items-center font-mono text-sm bg-background rounded border">
              {stockAtDate ? `${fmtL(stockAtDate.bookQty)} L` : '—'}
            </div>
          </div>
          <div className="col-span-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">Measured (dipstick)</div>
            <Input
              type="number"
              step="0.001"
              placeholder="liters"
              value={draft.measuredQty}
              onChange={(e) => setDraft((d) => ({ ...d, measuredQty: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) createMut.mutate();
              }}
              className="h-8 font-mono text-right"
            />
          </div>
          <div className="col-span-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">
              {computedDelta != null
                ? computedDelta >= 0 ? 'Gain' : 'Loss'
                : 'Δ'}
            </div>
            <div
              className={cn(
                'h-8 px-2 flex items-center justify-between rounded border bg-background font-mono text-sm',
                computedDelta != null && computedDelta < 0 && 'text-destructive',
                computedDelta != null && computedDelta > 0 && 'text-green-700',
              )}
            >
              <span>{computedDelta != null ? `${fmtL(computedDelta)} L` : '—'}</span>
              {computedValue != null && (
                <span className="text-[11px] text-muted-foreground">
                  PKR {fmtPKR(computedValue)}
                </span>
              )}
            </div>
          </div>
          <div className="col-span-2 flex gap-1">
            <Input
              placeholder="Remarks"
              value={draft.remarks}
              onChange={(e) => setDraft((d) => ({ ...d, remarks: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) createMut.mutate();
              }}
              className="h-8 text-sm"
            />
            <Button
              size="sm"
              className="h-8 px-2"
              onClick={() => createMut.mutate()}
              disabled={!canSubmit || createMut.isPending}
              title={`Save ${draftFuelCode} entry for ${draft.businessDate}`}
            >
              {createMut.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
        {stockAtDate?.lastPurchaseRate == null && draft.fuelTypeId && (
          <p className="mt-1 text-[11px] text-amber-600">
            No purchase rate found on/before this date — value will not be saved.
          </p>
        )}
        {stockAtDate?.lastPurchaseRate != null && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Rate: PKR {fmtPKR(stockAtDate.lastPurchaseRate)}/L (last purchase {stockAtDate.lastPurchaseDate}). Bootstrap {fmtL(stockAtDate.bootstrapQty)} L · +Pur {fmtL(stockAtDate.purchasesQty)} · −Sales {fmtL(stockAtDate.soldQty)} · ±G/L {fmtL(stockAtDate.priorGainLossQty)} = {fmtL(stockAtDate.bookQty)} L.
          </p>
        )}
      </div>

      {/* Entries table — single dense table, no scrolling, inline editing. */}
      <div className="border rounded">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="text-left p-2 font-medium">Date</th>
              <th className="text-left p-2 font-medium">Month</th>
              <th className="text-left p-2 font-medium">Fuel</th>
              <th className="text-right p-2 font-medium">Measured</th>
              <th className="text-right p-2 font-medium">Book</th>
              <th className="text-right p-2 font-medium">Gain/Loss</th>
              <th className="text-right p-2 font-medium">Rate</th>
              <th className="text-right p-2 font-medium">Value</th>
              <th className="text-left p-2 font-medium">Remarks</th>
              <th className="text-left p-2 font-medium">By</th>
              <th className="w-8 p-2"></th>
            </tr>
          </thead>
          <tbody>
            {entriesLoading && (
              <tr>
                <td colSpan={11} className="p-4 text-center text-muted-foreground">
                  <Loader2 className="inline h-3 w-3 animate-spin mr-1" /> Loading…
                </td>
              </tr>
            )}
            {!entriesLoading && entries.length === 0 && (
              <tr>
                <td colSpan={11} className="p-4 text-center text-muted-foreground">
                  No entries in this date range. Add one above.
                </td>
              </tr>
            )}
            {entries.map((e) => {
              const qty = Number(e.quantity);
              const val = Number(e.valueAtRate || 0);
              return (
                <tr key={e.id} className="border-t hover:bg-muted/20">
                  <td className="p-2 font-mono">{e.businessDate || '—'}</td>
                  <td className="p-2 text-muted-foreground">{monthOf(e.businessDate)}</td>
                  <td className="p-2">
                    <span
                      className={cn(
                        'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium',
                        e.fuel?.code === 'HSD' && 'bg-orange-100 text-orange-800',
                        e.fuel?.code === 'PMG' && 'bg-emerald-100 text-emerald-800',
                      )}
                    >
                      {e.fuel?.code}
                    </span>
                  </td>
                  <td className="p-2 text-right">
                    <MeasuredCell entry={e} onSaved={onRefetchEntries} />
                  </td>
                  <td className="p-2 text-right font-mono text-muted-foreground">
                    {e.bookQtyAtDate != null ? fmtL(e.bookQtyAtDate) : '—'}
                  </td>
                  <td
                    className={cn(
                      'p-2 text-right font-mono font-semibold',
                      qty < 0 && 'text-destructive',
                      qty > 0 && 'text-green-700',
                    )}
                  >
                    {fmtL(qty)}
                  </td>
                  <td className="p-2 text-right font-mono text-muted-foreground">
                    {e.lastPurchaseRate != null ? fmtPKR(e.lastPurchaseRate) : '—'}
                  </td>
                  <td
                    className={cn(
                      'p-2 text-right font-mono',
                      val < 0 && 'text-destructive',
                    )}
                  >
                    {e.valueAtRate != null ? fmtPKR(val) : '—'}
                  </td>
                  <td className="p-2 max-w-[200px]">
                    <RemarksCell entry={e} onSaved={onRefetchEntries} />
                  </td>
                  <td className="p-2 text-muted-foreground text-[11px]">
                    {e.recordedByUser?.fullName || e.recordedByUser?.username || '—'}
                  </td>
                  <td className="p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => {
                        if (confirm(`Delete ${e.fuel?.code} entry on ${e.businessDate}?`)) {
                          deleteMut.mutate(e.id);
                        }
                      }}
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Tip: click measured liters or remarks to edit inline. Δ recomputes
        against the originally captured book stock so editing one entry
        won't ripple through later ones.
      </p>
    </div>
  );
}
