import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Calculator, Loader2, Save, Lock, Unlock, ArrowDownCircle, ArrowUpCircle,
  AlertTriangle, CheckCircle2, Building2, CalendarDays,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { branchesApi } from '@/api';
import { cashReconciliationApi } from '@/api/cashReconciliation';
import { useAuthStore } from '@/store/auth';

const fmtPKR = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-PK', { maximumFractionDigits: 2 }));

const SOURCE_LABELS: Record<string, string> = {
  SALE: 'Cash Sales',
  CREDIT_RECEIPT: 'Credit Receipts',
  ADVANCE_DEPOSIT: 'Customer Advances',
  PSO_TOPUP: 'PSO Card Top-Ups',
  EXPENSE: 'Expenses',
  DRIVER_HANDOUT: 'Driver Handouts',
  COUNTER_VARIANCE: 'Counter Variance',
  MANUAL_ADJUSTMENT: 'Manual Adjustments',
};

export function CashReconciliation() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [selectedBranchId, setSelectedBranchId] = useState<string>(() =>
    (user as any)?.branch?.id || ''
  );
  const [businessDate, setBusinessDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [physicalCash, setPhysicalCash] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await branchesApi.getAll()).items,
  });

  const { data: preview, isLoading } = useQuery({
    queryKey: ['cash-recon-preview', selectedBranchId, businessDate],
    enabled: !!selectedBranchId && !!businessDate,
    queryFn: () => cashReconciliationApi.getPreview(selectedBranchId, businessDate),
    refetchInterval: 30_000,
  });

  // Auto-fill from existing record
  useMemo(() => {
    if (preview?.physicalCash != null && !physicalCash) {
      setPhysicalCash(String(preview.physicalCash));
    }
    if (preview?.notes && !notes) {
      setNotes(preview.notes);
    }
  }, [preview?.existingId]); // only on load

  const physicalNum = parseFloat(physicalCash);
  const expected = preview?.expectedCash ?? 0;
  const variance = Number.isFinite(physicalNum) ? physicalNum - expected : null;

  const submitMut = useMutation({
    mutationFn: async (close: boolean) => {
      if (!selectedBranchId) throw new Error('Select a branch');
      if (!Number.isFinite(physicalNum) || physicalNum < 0) throw new Error('Enter the physical cash count');
      return cashReconciliationApi.submit({
        branchId: selectedBranchId,
        businessDate,
        physicalCash: physicalNum,
        notes: notes || undefined,
        close,
      });
    },
    onSuccess: (_d, close) => {
      toast.success(close ? 'Day closed & variance posted to ledger' : 'Reconciliation saved');
      setConfirmCloseOpen(false);
      queryClient.invalidateQueries({ queryKey: ['cash-recon-preview'] });
      queryClient.invalidateQueries({ queryKey: ['cash-ledger-day'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || err.message || 'Failed to save'),
  });

  const reopenMut = useMutation({
    mutationFn: async () => {
      if (!preview?.existingId) throw new Error('No recon to reopen');
      if (!reopenReason.trim()) throw new Error('Reason required');
      await cashReconciliationApi.reopen(preview.existingId, reopenReason.trim());
    },
    onSuccess: () => {
      toast.success('Reconciliation reopened');
      setReopenOpen(false);
      setReopenReason('');
      queryClient.invalidateQueries({ queryKey: ['cash-recon-preview'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || err.message || 'Failed to reopen'),
  });

  const isClosed = preview?.status === 'closed';

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calculator className="h-6 w-6" /> Cash Reconciliation (End of Day)
          </h1>
          <p className="text-sm text-muted-foreground">
            Supervisor cash count vs. system-expected cash from the drawer ledger.
          </p>
        </div>
      </div>

      {/* Context bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 border rounded-md bg-muted/20">
        <div>
          <Label className="text-xs flex items-center gap-1"><Building2 className="h-3 w-3" /> Branch</Label>
          <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
            <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
            <SelectContent>
              {branches.map((b: any) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Business Date</Label>
          <Input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
        </div>
        <div className="flex items-end">
          {preview && (
            <Badge className={isClosed ? 'bg-slate-600' : 'bg-emerald-600'}>
              {isClosed ? <><Lock className="h-3 w-3 mr-1" /> Closed</> : <><Unlock className="h-3 w-3 mr-1" /> Open</>}
            </Badge>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="p-6 text-center text-muted-foreground"><Loader2 className="inline animate-spin mr-2" /> Loading...</div>
      )}

      {preview && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Inflows */}
          <div className="border rounded-md p-4 space-y-2">
            <h2 className="font-semibold flex items-center gap-2 text-emerald-700">
              <ArrowDownCircle className="h-4 w-4" /> Cash Inflows
            </h2>
            {preview.inflows.bySource.length === 0 && (
              <div className="text-sm text-muted-foreground">No inflows recorded.</div>
            )}
            {preview.inflows.bySource.map((s) => (
              <div key={s.source} className="flex justify-between text-sm">
                <span>{SOURCE_LABELS[s.source] || s.source} <span className="text-xs text-muted-foreground">({s.count})</span></span>
                <span className="font-mono">{fmtPKR(s.total)}</span>
              </div>
            ))}
            <div className="border-t pt-2 flex justify-between font-semibold">
              <span>Total Inflows</span>
              <span className="font-mono">{fmtPKR(preview.inflows.total)} PKR</span>
            </div>
          </div>

          {/* Outflows */}
          <div className="border rounded-md p-4 space-y-2">
            <h2 className="font-semibold flex items-center gap-2 text-red-700">
              <ArrowUpCircle className="h-4 w-4" /> Cash Outflows
            </h2>
            {preview.outflows.bySource.length === 0 && (
              <div className="text-sm text-muted-foreground">No outflows recorded.</div>
            )}
            {preview.outflows.bySource.map((s) => (
              <div key={s.source} className="flex justify-between text-sm">
                <span>{SOURCE_LABELS[s.source] || s.source} <span className="text-xs text-muted-foreground">({s.count})</span></span>
                <span className="font-mono">{fmtPKR(s.total)}</span>
              </div>
            ))}
            <div className="border-t pt-2 flex justify-between font-semibold">
              <span>Total Outflows</span>
              <span className="font-mono">{fmtPKR(preview.outflows.total)} PKR</span>
            </div>
          </div>

          {/* Expected + Physical + Variance */}
          <div className="border rounded-md p-4 space-y-3 lg:col-span-2 bg-muted/10">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Expected Cash (System)</div>
                <div className="text-2xl font-bold font-mono">{fmtPKR(preview.expectedCash)} PKR</div>
                <div className="text-[10px] text-muted-foreground">= Inflows − Outflows</div>
              </div>
              <div>
                <Label>Physical Cash Submitted *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={physicalCash}
                  onChange={(e) => setPhysicalCash(e.target.value)}
                  disabled={isClosed}
                  placeholder="0.00"
                  className="text-xl font-mono"
                />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Variance (Physical − Expected)</div>
                <div
                  className={`text-2xl font-bold font-mono ${
                    variance == null
                      ? ''
                      : Math.abs(variance) < 0.01
                        ? 'text-emerald-700'
                        : variance > 0
                          ? 'text-amber-600'
                          : 'text-red-700'
                  }`}
                >
                  {variance == null ? '—' : (variance > 0 ? '+' : '') + fmtPKR(variance) + ' PKR'}
                </div>
                {variance != null && Math.abs(variance) >= 0.01 && (
                  <div className="text-xs flex items-center gap-1">
                    {variance > 0
                      ? <><CheckCircle2 className="h-3 w-3 text-amber-600" /> Over (more cash than expected)</>
                      : <><AlertTriangle className="h-3 w-3 text-red-700" /> Short (missing cash)</>}
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isClosed}
                placeholder="Supervisor notes — e.g. '50 PKR short, cashier informed'"
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              {isClosed ? (
                <Button variant="outline" onClick={() => setReopenOpen(true)}>
                  <Unlock className="h-4 w-4 mr-2" /> Reopen Day
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => submitMut.mutate(false)}
                    disabled={submitMut.isPending}
                  >
                    {submitMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    Save Draft
                  </Button>
                  <Button
                    onClick={() => setConfirmCloseOpen(true)}
                    disabled={submitMut.isPending || !Number.isFinite(physicalNum)}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Lock className="h-4 w-4 mr-2" /> Close Day
                  </Button>
                </>
              )}
            </div>

            {(preview.submittedBy || preview.closedBy) && (
              <div className="text-xs text-muted-foreground border-t pt-2">
                {preview.submittedBy && (
                  <div>
                    Last submitted by {preview.submittedBy.fullName || preview.submittedBy.username} @{' '}
                    {preview.submittedAt && new Date(preview.submittedAt).toLocaleString('en-PK')}
                  </div>
                )}
                {preview.closedBy && (
                  <div>
                    Closed by {preview.closedBy.fullName || preview.closedBy.username} @{' '}
                    {preview.closedAt && new Date(preview.closedAt).toLocaleString('en-PK')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirm close dialog */}
      <Dialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close the day?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <p>
              Closing this day will lock the reconciliation and post the variance
              ({variance != null ? (variance > 0 ? '+' : '') + fmtPKR(variance) + ' PKR' : '—'})
              to the cash ledger as a COUNTER_VARIANCE entry.
            </p>
            <p className="text-muted-foreground">
              Late entries after close will not affect this day's variance unless the
              reconciliation is reopened.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCloseOpen(false)}>Cancel</Button>
            <Button onClick={() => submitMut.mutate(true)} disabled={submitMut.isPending}>
              {submitMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
              Confirm & Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen dialog */}
      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reopen closed day?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <p>
              Reopening reverses the posted variance entry from the cash ledger. Any
              corrections can then be made before closing again.
            </p>
            <div>
              <Label>Reason *</Label>
              <Input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Why reopen?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => reopenMut.mutate()} disabled={reopenMut.isPending}>
              {reopenMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Unlock className="h-4 w-4 mr-2" />}
              Reopen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
