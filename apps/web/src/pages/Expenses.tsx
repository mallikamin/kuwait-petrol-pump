import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Plus, Receipt, Ban, Building2, CalendarDays, Loader2, CopyPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { branchesApi } from '@/api';
import { expensesApi, type ExpenseAccount, type ExpenseEntry } from '@/api/expenses';
import { useAuthStore } from '@/store/auth';

const fmtPKR = (n: number) => n.toLocaleString('en-PK', { maximumFractionDigits: 2 });

export function Expenses() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [selectedBranchId, setSelectedBranchId] = useState<string>(() =>
    (user as any)?.branch?.id || ''
  );
  const [startDate, setStartDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));

  const [createOpen, setCreateOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<ExpenseEntry | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const [form, setForm] = useState<{
    expenseAccountId: string;
    amount: string;
    memo: string;
    businessDate: string;
  }>({
    expenseAccountId: '',
    amount: '',
    memo: '',
    businessDate: format(new Date(), 'yyyy-MM-dd'),
  });

  // Tracks whether the in-flight submit should close the dialog or keep it
  // open for rapid sequential entry (Save vs Save and New).
  const keepDialogOpenRef = useRef(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await branchesApi.getAll()).items,
  });

  const { data: accounts = [] } = useQuery<ExpenseAccount[]>({
    queryKey: ['expense-accounts'],
    queryFn: () => expensesApi.listAccounts(false),
  });

  const { data: entriesResult, isLoading: entriesLoading } = useQuery({
    queryKey: ['expense-entries', selectedBranchId, startDate, endDate],
    enabled: !!selectedBranchId,
    queryFn: () =>
      expensesApi.listEntries({
        branchId: selectedBranchId,
        startDate,
        endDate,
        limit: 500,
      }),
  });

  const entries = entriesResult?.items || [];

  const totals = useMemo(() => {
    let active = 0;
    let voided = 0;
    for (const e of entries) {
      const n = Number(e.amount);
      if (e.voidedAt) voided += n;
      else active += n;
    }
    return { active, voided };
  }, [entries]);

  const createMut = useMutation({
    mutationFn: async () => {
      if (!selectedBranchId) throw new Error('Select a branch');
      if (!form.expenseAccountId) throw new Error('Select an expense account');
      const amt = parseFloat(form.amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter a positive amount');
      return expensesApi.createEntry({
        branchId: selectedBranchId,
        businessDate: form.businessDate,
        expenseAccountId: form.expenseAccountId,
        amount: amt,
        memo: form.memo || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Expense recorded');
      if (keepDialogOpenRef.current) {
        // Save and New: preserve expense account + business date so the
        // accountant can burn through a batch of same-day/same-account
        // expenses without re-picking context. Clear only the amount + memo.
        setForm((prev) => ({ ...prev, amount: '', memo: '' }));
        keepDialogOpenRef.current = false;
        setTimeout(() => amountInputRef.current?.focus(), 0);
      } else {
        setCreateOpen(false);
        setForm({ expenseAccountId: '', amount: '', memo: '', businessDate: format(new Date(), 'yyyy-MM-dd') });
      }
      queryClient.invalidateQueries({ queryKey: ['expense-entries'] });
      queryClient.invalidateQueries({ queryKey: ['cash-ledger-day'] });
    },
    onError: (err: any) => {
      keepDialogOpenRef.current = false;
      toast.error(err?.response?.data?.error || err.message || 'Failed to create expense');
    },
  });

  const voidMut = useMutation({
    mutationFn: async () => {
      if (!voidTarget) throw new Error('No entry selected');
      if (!voidReason.trim()) throw new Error('Enter a reason');
      await expensesApi.voidEntry(voidTarget.id, voidReason.trim());
    },
    onSuccess: () => {
      toast.success('Expense voided');
      setVoidTarget(null);
      setVoidReason('');
      queryClient.invalidateQueries({ queryKey: ['expense-entries'] });
      queryClient.invalidateQueries({ queryKey: ['cash-ledger-day'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || err.message || 'Failed to void entry'),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-sm text-muted-foreground">
            Cash paid out from the drawer. Each entry posts an OUT to the cash ledger and
            a QB Purchase against the mapped expense account.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!selectedBranchId}>
          <Plus className="h-4 w-4 mr-2" /> New Expense
        </Button>
      </div>

      {/* Filter bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 border rounded-md bg-muted/20">
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
          <Label className="text-xs flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Start Date</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs flex items-center gap-1"><CalendarDays className="h-3 w-3" /> End Date</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="flex flex-col justify-end">
          <div className="text-xs text-muted-foreground">Active total</div>
          <div className="text-lg font-mono font-bold">{fmtPKR(totals.active)} PKR</div>
          {totals.voided > 0 && (
            <div className="text-xs text-muted-foreground">
              Voided: <span className="font-mono">{fmtPKR(totals.voided)} PKR</span>
            </div>
          )}
        </div>
      </div>

      {/* Entries table */}
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-left px-3 py-2">Account</th>
              <th className="text-left px-3 py-2">Memo</th>
              <th className="text-right px-3 py-2">Amount</th>
              <th className="text-left px-3 py-2">QB</th>
              <th className="text-left px-3 py-2">By</th>
              <th className="text-center px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entriesLoading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Loading...
                </td>
              </tr>
            )}
            {!entriesLoading && entries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No expense entries for this branch + date range.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className={e.voidedAt ? 'bg-red-50/40 text-muted-foreground line-through' : ''}>
                <td className="px-3 py-2">{format(new Date(e.businessDate), 'yyyy-MM-dd')}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{e.expenseAccount?.label || '—'}</div>
                  {e.expenseAccount?.qbAccountName && (
                    <div className="text-[10px] text-muted-foreground font-mono">{e.expenseAccount.qbAccountName}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{e.memo || '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtPKR(Number(e.amount))}</td>
                <td className="px-3 py-2">
                  {e.qbSynced ? (
                    <Badge className="bg-emerald-600">#{e.qbPurchaseId}</Badge>
                  ) : (
                    <Badge variant="outline">Pending</Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {e.createdByUser?.fullName || e.createdByUser?.username || '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  {!e.voidedAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-red-600"
                      onClick={() => setVoidTarget(e)}
                      title="Void this expense"
                    >
                      <Ban className="h-4 w-4" />
                    </Button>
                  )}
                  {e.voidedAt && (
                    <span className="text-[10px]">Voided: {e.voidReason}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" /> New Expense
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Expense Account *</Label>
              <Select value={form.expenseAccountId} onValueChange={(v) => setForm({ ...form, expenseAccountId: v })}>
                <SelectTrigger><SelectValue placeholder="Choose account..." /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date *</Label>
              <Input type="date" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} />
            </div>
            <div>
              <Label>Amount (PKR) *</Label>
              <Input
                ref={amountInputRef}
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Memo (optional)</Label>
              <Input
                value={form.memo}
                onChange={(e) => setForm({ ...form, memo: e.target.value })}
                placeholder="What was this expense for?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              variant="secondary"
              onClick={() => {
                keepDialogOpenRef.current = true;
                createMut.mutate();
              }}
              disabled={createMut.isPending}
              title="Save this expense and keep the dialog open for another entry (same branch, date, and account are preserved)."
            >
              {createMut.isPending && keepDialogOpenRef.current
                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                : <CopyPlus className="h-4 w-4 mr-2" />}
              Save and New
            </Button>
            <Button
              onClick={() => {
                keepDialogOpenRef.current = false;
                createMut.mutate();
              }}
              disabled={createMut.isPending}
            >
              {createMut.isPending && !keepDialogOpenRef.current
                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                : <Plus className="h-4 w-4 mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void dialog */}
      <Dialog open={!!voidTarget} onOpenChange={(o) => { if (!o) { setVoidTarget(null); setVoidReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void Expense</DialogTitle>
          </DialogHeader>
          {voidTarget && (
            <div className="space-y-3 py-2 text-sm">
              <div className="p-2 border rounded bg-muted/30">
                <div>
                  <strong>{voidTarget.expenseAccount?.label}</strong>{' '}
                  <span className="font-mono">{fmtPKR(Number(voidTarget.amount))} PKR</span>
                </div>
                <div className="text-xs text-muted-foreground">{voidTarget.memo}</div>
                <div className="text-xs text-muted-foreground">{format(new Date(voidTarget.businessDate), 'yyyy-MM-dd')}</div>
              </div>
              <div>
                <Label>Reason *</Label>
                <Input
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="e.g. Entered twice, wrong branch..."
                />
              </div>
              <div className="text-xs text-muted-foreground">
                Voiding will reverse the paired cash-ledger OUT entry. The original QB
                Purchase (if already posted) is NOT auto-voided — delete it in QB
                manually if needed.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setVoidTarget(null); setVoidReason(''); }}>Cancel</Button>
            <Button variant="destructive" onClick={() => voidMut.mutate()} disabled={voidMut.isPending}>
              {voidMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Ban className="h-4 w-4 mr-2" />}
              Void Expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
