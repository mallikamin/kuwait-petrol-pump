import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, Loader2 } from 'lucide-react';
import { apiClient } from '@/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Inventory bootstrap editor - drives the PUT /api/inventory/bootstrap
 * endpoint. Renders as a modal dialog over the Inventory Report so it
 * doesn't fight the report layout for space. All rows for the selected
 * branch + date are loaded on open; the user edits quantities inline and
 * hits Save to bulk-upsert.
 *
 * Intentional scope choices for the first pass:
 *   - Single date (defaults to bootstrap anchor 2026-01-01, editable
 *     in case a future anchor gets added).
 *   - No pagination: the row set per branch is bounded by products plus
 *     HSD/PMG, so a single scrollable table is fine.
 *   - Only changed rows are sent in the PUT - the backend accepts a
 *     partial list and leaves untouched rows alone.
 */

type Category = 'all' | 'total_fuel' | 'HSD' | 'PMG' | 'non_fuel';

interface BootstrapRow {
  id: string;
  branchId: string;
  productId: string | null;
  fuelTypeId: string | null;
  asOfDate: string;
  quantity: number;
  source: string;
  notes: string | null;
  productName: string;
  productType: 'HSD' | 'PMG' | 'non_fuel';
  unit: 'L' | 'units';
  sku: string | null;
  category: string | null;
  updatedByName: string | null;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  branchName?: string;
  /** When the editor successfully saves, refetch the inventory report. */
  onSaved?: () => void;
}

const DEFAULT_AS_OF = '2026-01-01';

export function InventoryBootstrapEditor({
  open,
  onOpenChange,
  branchId,
  branchName,
  onSaved,
}: Props) {
  const queryClient = useQueryClient();
  const [asOfDate, setAsOfDate] = useState(DEFAULT_AS_OF);
  const [category, setCategory] = useState<Category>('all');
  // Map row.id -> edited quantity. Only entries present here are dirty.
  const [dirty, setDirty] = useState<Record<string, number>>({});

  // Fetch bootstrap rows.
  const query = useQuery<{ rows: BootstrapRow[] }>({
    queryKey: ['inventory-bootstrap', branchId, asOfDate, category],
    enabled: open && !!branchId,
    queryFn: async () => {
      const params = new URLSearchParams({ branchId, asOfDate });
      if (category !== 'all') params.set('category', category);
      const { data } = await apiClient.get(`/api/inventory/bootstrap?${params.toString()}`);
      return data;
    },
  });

  // Clear dirty state whenever the query set changes (fresh data).
  useEffect(() => {
    setDirty({});
  }, [query.data]);

  const rows: BootstrapRow[] = query.data?.rows || [];

  const changedCount = Object.keys(dirty).length;

  const mutation = useMutation({
    mutationFn: async () => {
      const changedRows = rows
        .filter((r) => dirty[r.id] !== undefined && dirty[r.id] !== r.quantity)
        .map((r) => ({
          productId: r.productId,
          fuelTypeId: r.fuelTypeId,
          quantity: dirty[r.id],
          notes: r.notes,
        }));
      if (changedRows.length === 0) return { updated: 0, created: 0 };
      const { data } = await apiClient.put('/api/inventory/bootstrap', {
        branchId,
        asOfDate,
        rows: changedRows,
      });
      return data as { updated: number; created: number };
    },
    onSuccess: (result) => {
      toast.success('Opening stock saved', {
        description: `${result.updated ?? 0} updated, ${result.created ?? 0} created.`,
      });
      setDirty({});
      // Refresh this dialog and the inventory report behind it so
      // openingQty / closingQty reflect the new bootstrap immediately.
      queryClient.invalidateQueries({ queryKey: ['inventory-bootstrap'] });
      queryClient.invalidateQueries({ queryKey: ['report-inventory'] });
      onSaved?.();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || err?.message || 'Failed to save opening stock';
      toast.error('Save failed', { description: msg });
    },
  });

  const onQtyChange = (row: BootstrapRow, raw: string) => {
    const num = Number(raw);
    if (raw === '' || Number.isNaN(num)) {
      // Treat empty/NaN as "no change" - drop from dirty so we don't PUT garbage.
      setDirty((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      return;
    }
    setDirty((prev) => ({ ...prev, [row.id]: num }));
  };

  const displayQty = (row: BootstrapRow) =>
    dirty[row.id] !== undefined ? dirty[row.id] : row.quantity;

  const isDirty = (row: BootstrapRow) =>
    dirty[row.id] !== undefined && dirty[row.id] !== row.quantity;

  const sourceBadge = (row: BootstrapRow) => {
    if (row.source === 'user_entered') {
      return <Badge variant="default" className="font-normal">Manual</Badge>;
    }
    return <Badge variant="outline" className="font-normal">Seeded</Badge>;
  };

  const headerMeta = useMemo(() => {
    const manual = rows.filter((r) => r.source === 'user_entered').length;
    const seeded = rows.length - manual;
    return `${rows.length} rows - ${manual} manual, ${seeded} seeded`;
  }, [rows]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Opening Stock (Bootstrap)</DialogTitle>
          <DialogDescription>
            Set the opening quantity for each product and fuel type at the bootstrap date.
            Every Inventory Report range is rolled forward from these values.
            {branchName ? ` Branch: ${branchName}.` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3 pb-2 border-b">
          <div className="flex flex-col gap-1">
            <Label htmlFor="bootstrap-asofdate" className="text-xs">Bootstrap date</Label>
            <Input
              id="bootstrap-asofdate"
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="h-8 w-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="total_fuel">Total Fuel</SelectItem>
                <SelectItem value="HSD">HSD</SelectItem>
                <SelectItem value="PMG">PMG</SelectItem>
                <SelectItem value="non_fuel">Non-Fuel</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto text-xs text-muted-foreground self-center">
            {query.isLoading ? 'Loading...' : headerMeta}
          </div>
        </div>

        <div className="overflow-auto flex-1 border rounded">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="w-20">Type</TableHead>
                <TableHead className="w-16">Unit</TableHead>
                <TableHead className="text-right w-40">Opening Qty</TableHead>
                <TableHead className="w-24">Source</TableHead>
                <TableHead className="w-44">Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading bootstrap rows...</TableCell></TableRow>
              )}
              {query.isError && (
                <TableRow><TableCell colSpan={6} className="text-center py-6 text-destructive">Failed to load bootstrap rows.</TableCell></TableRow>
              )}
              {!query.isLoading && !query.isError && rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No rows for the selected date and category.</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id} className={isDirty(r) ? 'bg-yellow-50' : undefined}>
                  <TableCell className="font-medium">
                    {r.productName}
                    {r.sku && <span className="text-xs text-muted-foreground ml-2">{r.sku}</span>}
                  </TableCell>
                  <TableCell>{r.productType === 'non_fuel' ? 'Non-Fuel' : r.productType}</TableCell>
                  <TableCell>{r.unit}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.001"
                      value={displayQty(r)}
                      onChange={(e) => onQtyChange(r, e.target.value)}
                      className="h-8 text-right font-mono"
                    />
                  </TableCell>
                  <TableCell>{sourceBadge(r)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.updatedByName ? (
                      <>
                        {r.updatedByName}
                        <br />
                        <span className="text-[10px]">{new Date(r.updatedAt).toLocaleString('en-PK')}</span>
                      </>
                    ) : (
                      <span className="text-[10px]">{new Date(r.updatedAt).toLocaleString('en-PK')}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <div className="text-xs text-muted-foreground mr-auto self-center">
            {changedCount === 0 ? 'No pending changes.' : `${changedCount} pending change${changedCount === 1 ? '' : 's'}`}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Close
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={changedCount === 0 || mutation.isPending}
          >
            {mutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
            ) : (
              <><Save className="mr-2 h-4 w-4" /> Save ({changedCount})</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
