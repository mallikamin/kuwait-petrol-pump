import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  CreditCard, Plus, Ban, Building2, CalendarDays, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { branchesApi, customersApi } from '@/api';
import { psoTopupsApi, type PsoTopup } from '@/api/psoTopups';
import { useAuthStore } from '@/store/auth';
import { useOnOrgSwitch } from '@/hooks/useEffectiveBranch';

const fmtPKR = (n: number) => n.toLocaleString('en-PK', { maximumFractionDigits: 2 });

export function PsoTopups() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [branchId, setBranchId] = useState<string>(() => (user as any)?.branch?.id || '');
  // Reset selection when the org switches via the top-bar dropdown.
  useOnOrgSwitch(() => setBranchId(''));
  const [startDate, setStartDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));

  const [createOpen, setCreateOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<PsoTopup | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const [form, setForm] = useState({
    businessDate: format(new Date(), 'yyyy-MM-dd'),
    customerId: '',
    psoCardLast4: '',
    amount: '',
    memo: '',
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await branchesApi.getAll()).items,
  });

  const { data: customersPage } = useQuery({
    queryKey: ['customers', 'pso-topup'],
    queryFn: () => customersApi.getAll({ size: 500 }),
  });
  const customers = customersPage?.items || [];

  const { data: topupResult, isLoading } = useQuery({
    queryKey: ['pso-topups', branchId, startDate, endDate],
    enabled: !!branchId,
    queryFn: () => psoTopupsApi.list({ branchId, startDate, endDate, limit: 500 }),
  });
  const topups = topupResult?.items || [];

  const totals = useMemo(() => {
    let active = 0;
    let voided = 0;
    for (const t of topups) {
      const n = Number(t.amount);
      if (t.voidedAt) voided += n;
      else active += n;
    }
    return { active, voided };
  }, [topups]);

  const createMut = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error('Select a branch');
      const amt = parseFloat(form.amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter a positive amount');
      return psoTopupsApi.create({
        branchId,
        businessDate: form.businessDate,
        customerId: form.customerId && form.customerId !== '__none__' ? form.customerId : undefined,
        psoCardLast4: form.psoCardLast4 || undefined,
        amount: amt,
        memo: form.memo || undefined,
      });
    },
    onSuccess: () => {
      toast.success('PSO top-up recorded');
      setCreateOpen(false);
      setForm({
        businessDate: format(new Date(), 'yyyy-MM-dd'),
        customerId: '',
        psoCardLast4: '',
        amount: '',
        memo: '',
      });
      queryClient.invalidateQueries({ queryKey: ['pso-topups'] });
      queryClient.invalidateQueries({ queryKey: ['cash-recon-preview'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || err.message),
  });

  const voidMut = useMutation({
    mutationFn: async () => {
      if (!voidTarget) throw new Error('No entry');
      if (!voidReason.trim()) throw new Error('Reason required');
      await psoTopupsApi.void(voidTarget.id, voidReason.trim());
    },
    onSuccess: () => {
      toast.success('Top-up voided');
      setVoidTarget(null);
      setVoidReason('');
      queryClient.invalidateQueries({ queryKey: ['pso-topups'] });
      queryClient.invalidateQueries({ queryKey: ['cash-recon-preview'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || err.message),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="h-6 w-6" /> PSO Card Top-Ups
          </h1>
          <p className="text-sm text-muted-foreground">
            Customer hands cash; pump loads the PSO Card. Cash IN, PSO supplier A/P up.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!branchId}>
          <Plus className="h-4 w-4 mr-2" /> New Top-Up
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 border rounded-md bg-muted/20">
        <div>
          <Label className="text-xs flex items-center gap-1"><Building2 className="h-3 w-3" /> Branch</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
            <SelectContent>
              {branches.map((b: any) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Start</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs flex items-center gap-1"><CalendarDays className="h-3 w-3" /> End</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="flex flex-col justify-end">
          <div className="text-xs text-muted-foreground">Active total</div>
          <div className="text-lg font-mono font-bold">{fmtPKR(totals.active)} PKR</div>
        </div>
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-left px-3 py-2">Customer / Card</th>
              <th className="text-left px-3 py-2">Memo</th>
              <th className="text-right px-3 py-2">Amount</th>
              <th className="text-left px-3 py-2">QB</th>
              <th className="text-left px-3 py-2">By</th>
              <th className="text-center px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="text-center py-6 text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Loading...</td></tr>
            )}
            {!isLoading && topups.length === 0 && (
              <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">No PSO top-ups for this filter.</td></tr>
            )}
            {topups.map((t) => (
              <tr key={t.id} className={t.voidedAt ? 'bg-red-50/40 text-muted-foreground line-through' : ''}>
                <td className="px-3 py-2">{format(new Date(t.businessDate), 'yyyy-MM-dd')}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{t.customer?.name || '—'}</div>
                  {t.psoCardLast4 && <div className="text-[10px] text-muted-foreground">PSO ****{t.psoCardLast4}</div>}
                </td>
                <td className="px-3 py-2 text-xs">{t.memo || '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtPKR(Number(t.amount))}</td>
                <td className="px-3 py-2">
                  {t.qbSynced ? <Badge className="bg-emerald-600">JE #{t.qbJournalEntryId}</Badge> : <Badge variant="outline">Pending</Badge>}
                </td>
                <td className="px-3 py-2 text-xs">{t.createdByUser?.fullName || t.createdByUser?.username || '—'}</td>
                <td className="px-3 py-2 text-center">
                  {!t.voidedAt && (
                    <Button size="sm" variant="ghost" className="h-7 text-red-600" onClick={() => setVoidTarget(t)} title="Void">
                      <Ban className="h-4 w-4" />
                    </Button>
                  )}
                  {t.voidedAt && <span className="text-[10px]">Voided: {t.voidReason}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> New PSO Top-Up</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Date *</Label>
              <Input type="date" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} />
            </div>
            <div>
              <Label>Customer (optional)</Label>
              <Select value={form.customerId} onValueChange={(v) => setForm({ ...form, customerId: v })}>
                <SelectTrigger><SelectValue placeholder="Walk-in if left blank" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No customer —</SelectItem>
                  {customers.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>PSO Card last 4 (optional)</Label>
              <Input value={form.psoCardLast4} onChange={(e) => setForm({ ...form, psoCardLast4: e.target.value.slice(0, 10) })} placeholder="e.g. 1234" />
            </div>
            <div>
              <Label>Amount (PKR) *</Label>
              <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <Label>Memo (optional)</Label>
              <Input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="Notes..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Record Top-Up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void dialog */}
      <Dialog open={!!voidTarget} onOpenChange={(o) => { if (!o) { setVoidTarget(null); setVoidReason(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Void PSO Top-Up</DialogTitle></DialogHeader>
          {voidTarget && (
            <div className="space-y-3 py-2 text-sm">
              <div className="p-2 border rounded bg-muted/30">
                <div><strong>{voidTarget.customer?.name || 'Walk-in'}</strong> <span className="font-mono">{fmtPKR(Number(voidTarget.amount))} PKR</span></div>
                <div className="text-xs text-muted-foreground">{voidTarget.memo}</div>
                <div className="text-xs text-muted-foreground">{format(new Date(voidTarget.businessDate), 'yyyy-MM-dd')}</div>
              </div>
              <div>
                <Label>Reason *</Label>
                <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
              </div>
              <div className="text-xs text-muted-foreground">
                Voiding reverses the cash ledger IN entry. Any QB JournalEntry already
                posted is NOT auto-voided — delete it in QB manually.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setVoidTarget(null); setVoidReason(''); }}>Cancel</Button>
            <Button variant="destructive" onClick={() => voidMut.mutate()} disabled={voidMut.isPending}>
              {voidMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Ban className="h-4 w-4 mr-2" />}
              Void
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
