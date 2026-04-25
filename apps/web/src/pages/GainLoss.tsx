import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Plus, Loader2, AlertTriangle, Building2, CalendarDays, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { branchesApi, apiClient, inventoryApi } from '@/api';
import type { GainLossEntry, StockAtDateResult } from '@/api/inventory';
import { useAuthStore } from '@/store/auth';

interface FuelType {
  id: string;
  code: 'HSD' | 'PMG' | string;
  name: string;
}

const fmtL = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-PK', { maximumFractionDigits: 3 });

const fmtPKR = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-PK', { maximumFractionDigits: 2 });

const monthOf = (d: string) => d.slice(0, 7);

export function GainLoss() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    () => (user as any)?.branch?.id || '',
  );

  // Default to last 90 days so the operator sees recent entries by default;
  // they can widen via the date filters.
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return format(d, 'yyyy-MM-dd');
  });
  const [endDate, setEndDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    fuelTypeId: '',
    businessDate: format(new Date(), 'yyyy-MM-dd'),
    measuredQty: '',
    remarks: '',
  });

  const [deleteTarget, setDeleteTarget] = useState<GainLossEntry | null>(null);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await branchesApi.getAll()).items,
  });

  // Pick the first branch automatically when none is selected — avoids the
  // empty-state lockout the user saw on Expenses before they wired up
  // a default.
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

  // Live book-stock lookup for the form. Refetches whenever fuel/date changes.
  const { data: stockAtDate, isFetching: stockLoading } = useQuery<StockAtDateResult>({
    queryKey: ['stock-at-date', selectedBranchId, form.fuelTypeId, form.businessDate],
    enabled: createOpen && !!selectedBranchId && !!form.fuelTypeId && !!form.businessDate,
    queryFn: () =>
      inventoryApi.getStockAtDate({
        branchId: selectedBranchId,
        fuelTypeId: form.fuelTypeId,
        asOfDate: form.businessDate,
      }),
  });

  // Computed gain/loss preview shown live while the user types.
  const measuredNum = parseFloat(form.measuredQty);
  const computedDelta =
    stockAtDate && Number.isFinite(measuredNum)
      ? measuredNum - stockAtDate.bookQty
      : null;
  const computedValue =
    computedDelta != null && stockAtDate?.lastPurchaseRate != null
      ? computedDelta * stockAtDate.lastPurchaseRate
      : null;

  const createMut = useMutation({
    mutationFn: async () => {
      if (!selectedBranchId) throw new Error('Select a branch');
      if (!form.fuelTypeId) throw new Error('Select a fuel');
      if (!form.businessDate) throw new Error('Pick a date');
      const measured = parseFloat(form.measuredQty);
      if (!Number.isFinite(measured)) throw new Error('Enter measured liters');
      return inventoryApi.createGainLossByDate({
        branchId: selectedBranchId,
        fuelTypeId: form.fuelTypeId,
        businessDate: form.businessDate,
        measuredQty: measured,
        remarks: form.remarks || undefined,
      });
    },
    onSuccess: (entry) => {
      toast.success('Gain/Loss recorded', {
        description: `${entry.fuel?.code || ''} delta = ${fmtL(entry.quantity)} L`,
      });
      setCreateOpen(false);
      setForm((f) => ({ ...f, measuredQty: '', remarks: '' }));
      queryClient.invalidateQueries({ queryKey: ['gain-loss-entries'] });
      queryClient.invalidateQueries({ queryKey: ['report-inventory'] });
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        'Failed to save';
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
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['gain-loss-entries'] });
      queryClient.invalidateQueries({ queryKey: ['report-inventory'] });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || err?.message || 'Delete failed';
      toast.error('Delete failed', { description: msg });
    },
  });

  // Split entries by fuel + compute monthly subtotals.
  const split = useMemo(() => {
    const byFuel: Record<string, GainLossEntry[]> = { HSD: [], PMG: [], OTHER: [] };
    entries.forEach((e) => {
      const code = e.fuel?.code || 'OTHER';
      const bucket = code === 'HSD' || code === 'PMG' ? code : 'OTHER';
      byFuel[bucket].push(e);
    });

    const monthly = (rows: GainLossEntry[]) => {
      const map = new Map<string, { qty: number; value: number; count: number }>();
      rows.forEach((r) => {
        const m = monthOf(r.businessDate || r.month + '-01');
        const cur = map.get(m) || { qty: 0, value: 0, count: 0 };
        cur.qty += Number(r.quantity);
        cur.value += Number(r.valueAtRate || 0);
        cur.count += 1;
        map.set(m, cur);
      });
      return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
    };

    return {
      hsd: byFuel.HSD,
      pmg: byFuel.PMG,
      hsdMonthly: monthly(byFuel.HSD),
      pmgMonthly: monthly(byFuel.PMG),
    };
  }, [entries]);

  type MonthlyAgg = [string, { qty: number; value: number; count: number }];
  const renderTable = (title: string, rows: GainLossEntry[], monthly: MonthlyAgg[]) => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span>{title} Gain / Loss</span>
          <span className="text-xs font-normal text-muted-foreground">
            {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {monthly.length > 0 && (
          <div className="mb-3 grid grid-cols-2 md:grid-cols-4 gap-2">
            {monthly.slice(0, 4).map(([m, agg]) => (
              <div key={m} className="rounded border p-2 text-xs">
                <div className="text-muted-foreground">{m}</div>
                <div className="font-mono">
                  <span className={agg.qty < 0 ? 'text-destructive' : ''}>
                    {fmtL(agg.qty)} L
                  </span>
                </div>
                <div className="text-muted-foreground">PKR {fmtPKR(agg.value)}</div>
              </div>
            ))}
          </div>
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No entries in this date range.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Measured (L)</TableHead>
                <TableHead className="text-right">Book (L)</TableHead>
                <TableHead className="text-right">Gain/Loss (L)</TableHead>
                <TableHead className="text-right">Rate (PKR/L)</TableHead>
                <TableHead className="text-right">Value (PKR)</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead>By</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">
                    {r.businessDate || r.month}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.measuredQty != null ? fmtL(r.measuredQty) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.bookQtyAtDate != null ? fmtL(r.bookQtyAtDate) : '—'}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono font-semibold ${
                      Number(r.quantity) < 0 ? 'text-destructive' : 'text-green-700'
                    }`}
                  >
                    {fmtL(r.quantity)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.lastPurchaseRate != null ? fmtPKR(r.lastPurchaseRate) : '—'}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono ${
                      Number(r.valueAtRate || 0) < 0 ? 'text-destructive' : ''
                    }`}
                  >
                    {r.valueAtRate != null ? fmtPKR(r.valueAtRate) : '—'}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate" title={r.remarks || ''}>
                    {r.remarks || ''}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.recordedByUser?.fullName || r.recordedByUser?.username || '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(r)}
                      title="Delete (within 24h of recording)"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventory Gain / Loss</h1>
          <p className="text-sm text-muted-foreground">
            Record fuel gain/loss against measured tank levels. System computes
            the delta and values it at the last purchase rate.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!selectedBranchId}>
          <Plus className="mr-2 h-4 w-4" /> New Entry
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <Label className="text-xs flex items-center gap-1">
                <Building2 className="h-3 w-3" /> Branch
              </Label>
              <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                <SelectTrigger className="h-9">
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
              <Label className="text-xs flex items-center gap-1">
                <CalendarDays className="h-3 w-3" /> From
              </Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">
                <CalendarDays className="h-3 w-3" /> To
              </Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {entriesLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading entries…
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {renderTable('HSD', split.hsd, split.hsdMonthly)}
          {renderTable('PMG', split.pmg, split.pmgMonthly)}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Gain/Loss Entry</DialogTitle>
            <DialogDescription>
              Pick a fuel and date. The system shows the current book stock
              for that day; enter the measured liters from the dipstick to
              auto-compute the gain/loss.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fuel</Label>
                <Select
                  value={form.fuelTypeId}
                  onValueChange={(v) => setForm((f) => ({ ...f, fuelTypeId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select fuel" />
                  </SelectTrigger>
                  <SelectContent>
                    {fuelTypes.map((ft) => (
                      <SelectItem key={ft.id} value={ft.id}>
                        {ft.code} — {ft.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date measured</Label>
                <Input
                  type="date"
                  value={form.businessDate}
                  max={format(new Date(), 'yyyy-MM-dd')}
                  onChange={(e) => setForm((f) => ({ ...f, businessDate: e.target.value }))}
                />
              </div>
            </div>

            {/* Live book-stock readout */}
            <div className="rounded border bg-muted/40 p-3 text-sm space-y-1">
              {!form.fuelTypeId ? (
                <p className="text-muted-foreground">
                  Select a fuel to see its current book stock.
                </p>
              ) : stockLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading book stock…
                </div>
              ) : stockAtDate ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Book stock on {stockAtDate.asOfDate}</span>
                    <span className="font-mono font-semibold">{fmtL(stockAtDate.bookQty)} L</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Bootstrap</span>
                    <span className="font-mono">{fmtL(stockAtDate.bootstrapQty)} L</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>+ Purchases</span>
                    <span className="font-mono">{fmtL(stockAtDate.purchasesQty)} L</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>− Sales</span>
                    <span className="font-mono">{fmtL(stockAtDate.soldQty)} L</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>± Prior gain/loss</span>
                    <span className="font-mono">{fmtL(stockAtDate.priorGainLossQty)} L</span>
                  </div>
                  <div className="flex justify-between text-xs pt-1 border-t mt-1">
                    <span className="text-muted-foreground">Last purchase rate</span>
                    <span className="font-mono">
                      {stockAtDate.lastPurchaseRate != null
                        ? `PKR ${fmtPKR(stockAtDate.lastPurchaseRate)} / L`
                        : '—'}
                      {stockAtDate.lastPurchaseDate ? ` (${stockAtDate.lastPurchaseDate})` : ''}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground">No data.</p>
              )}
            </div>

            <div>
              <Label>Measured liters (from dipstick / tank gauge)</Label>
              <Input
                type="number"
                step="0.001"
                placeholder="e.g. 9850.500"
                value={form.measuredQty}
                onChange={(e) => setForm((f) => ({ ...f, measuredQty: e.target.value }))}
                className="font-mono text-lg"
              />
            </div>

            {computedDelta != null && (
              <div className="rounded border-2 border-primary/30 bg-primary/5 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium">
                    {computedDelta >= 0 ? 'Gain' : 'Loss'}
                  </span>
                  <span
                    className={`font-mono text-lg font-bold ${
                      computedDelta < 0 ? 'text-destructive' : 'text-green-700'
                    }`}
                  >
                    {fmtL(computedDelta)} L
                  </span>
                </div>
                {computedValue != null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Valued at last purchase rate</span>
                    <span className={`font-mono ${computedValue < 0 ? 'text-destructive' : ''}`}>
                      PKR {fmtPKR(computedValue)}
                    </span>
                  </div>
                )}
                {stockAtDate?.lastPurchaseRate == null && (
                  <p className="mt-1 flex items-start gap-1 text-xs text-amber-600">
                    <AlertTriangle className="h-3 w-3 mt-0.5" />
                    No purchase rate found on/before this date — value will not
                    be saved. Record a purchase first if needed.
                  </p>
                )}
              </div>
            )}

            <div>
              <Label>Remarks (optional)</Label>
              <Input
                value={form.remarks}
                onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                placeholder="Reason for variance, dipstick notes, etc."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={
                createMut.isPending ||
                !form.fuelTypeId ||
                !Number.isFinite(parseFloat(form.measuredQty))
              }
            >
              {createMut.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" /> Save Entry
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Gain/Loss Entry?</DialogTitle>
            <DialogDescription>
              This entry will be removed permanently. Only entries recorded
              within the last 24 hours can be deleted.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="rounded border p-3 text-sm space-y-1">
              <div>
                {deleteTarget.fuel?.code} on {deleteTarget.businessDate || deleteTarget.month}
              </div>
              <div className="font-mono">
                Quantity: {fmtL(deleteTarget.quantity)} L
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
            >
              {deleteMut.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
