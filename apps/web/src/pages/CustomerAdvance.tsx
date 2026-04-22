import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Wallet, Plus, Minus, Ban, User, Building2, Loader2,
  ArrowDownCircle, ArrowUpCircle, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { branchesApi, customersApi } from '@/api';
import { banksApi } from '@/api/banks';
import {
  customerAdvanceApi,
  type AdvanceMovement,
  type AdvanceDepositMethod,
} from '@/api/customerAdvance';
import { useAuthStore } from '@/store/auth';

const fmtPKR = (n: number) => n.toLocaleString('en-PK', { maximumFractionDigits: 2 });

const KIND_LABELS: Record<string, string> = {
  DEPOSIT_CASH: 'Cash deposit',
  DEPOSIT_IBFT: 'IBFT / Bank transfer',
  DEPOSIT_BANK_CARD: 'Bank Card deposit',
  DEPOSIT_PSO_CARD: 'PSO Card deposit',
  CASH_HANDOUT: 'Driver cash handout',
  FUEL_OFFSET: 'Fuel offset',
  MANUAL_ADJUSTMENT_IN: 'Manual IN',
  MANUAL_ADJUSTMENT_OUT: 'Manual OUT',
};

export function CustomerAdvance() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [branchId, setBranchId] = useState<string>(() => (user as any)?.branch?.id || '');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');

  const [depositOpen, setDepositOpen] = useState(false);
  const [handoutOpen, setHandoutOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<AdvanceMovement | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const [deposit, setDeposit] = useState<{
    method: AdvanceDepositMethod;
    amount: string;
    bankId: string;
    referenceNumber: string;
    memo: string;
    businessDate: string;
  }>({
    method: 'cash',
    amount: '',
    bankId: '',
    referenceNumber: '',
    memo: '',
    businessDate: format(new Date(), 'yyyy-MM-dd'),
  });

  const [handout, setHandout] = useState({
    amount: '',
    memo: '',
    businessDate: format(new Date(), 'yyyy-MM-dd'),
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await branchesApi.getAll()).items,
  });

  const { data: customersPage } = useQuery({
    queryKey: ['customers', 'advance'],
    queryFn: () => customersApi.getAll({ size: 500 }),
  });
  const customers = customersPage?.items || [];

  const { data: banksData = [] } = useQuery({
    queryKey: ['banks', 'advance'],
    queryFn: async () => (await banksApi.getAll()).banks,
  });

  const { data: balance } = useQuery({
    queryKey: ['customer-advance-balance', selectedCustomerId],
    enabled: !!selectedCustomerId,
    queryFn: () => customerAdvanceApi.getBalance(selectedCustomerId),
  });

  const { data: movementsResult, isLoading } = useQuery({
    queryKey: ['customer-advance-movements', selectedCustomerId],
    enabled: !!selectedCustomerId,
    queryFn: () =>
      customerAdvanceApi.listMovements({ customerId: selectedCustomerId, limit: 200 }),
  });

  const movements = movementsResult?.items || [];

  const selectedCustomer = useMemo(
    () => customers.find((c: any) => c.id === selectedCustomerId),
    [selectedCustomerId, customers],
  );

  const depositMut = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error('Select a branch');
      if (!selectedCustomerId) throw new Error('Select a customer');
      const amt = parseFloat(deposit.amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter a positive amount');
      if ((deposit.method === 'ibft' || deposit.method === 'bank_card') && !deposit.bankId) {
        throw new Error(`${deposit.method} requires selecting a bank`);
      }
      return customerAdvanceApi.deposit({
        customerId: selectedCustomerId,
        branchId,
        businessDate: deposit.businessDate,
        method: deposit.method,
        amount: amt,
        bankId: deposit.bankId || undefined,
        referenceNumber: deposit.referenceNumber || undefined,
        memo: deposit.memo || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Deposit recorded');
      setDepositOpen(false);
      setDeposit({
        method: 'cash',
        amount: '',
        bankId: '',
        referenceNumber: '',
        memo: '',
        businessDate: format(new Date(), 'yyyy-MM-dd'),
      });
      queryClient.invalidateQueries({ queryKey: ['customer-advance-balance'] });
      queryClient.invalidateQueries({ queryKey: ['customer-advance-movements'] });
      queryClient.invalidateQueries({ queryKey: ['cash-recon-preview'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || err.message),
  });

  const handoutMut = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error('Select a branch');
      if (!selectedCustomerId) throw new Error('Select a customer');
      const amt = parseFloat(handout.amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter a positive amount');
      return customerAdvanceApi.cashHandout({
        customerId: selectedCustomerId,
        branchId,
        businessDate: handout.businessDate,
        amount: amt,
        memo: handout.memo || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Cash handout recorded');
      setHandoutOpen(false);
      setHandout({ amount: '', memo: '', businessDate: format(new Date(), 'yyyy-MM-dd') });
      queryClient.invalidateQueries({ queryKey: ['customer-advance-balance'] });
      queryClient.invalidateQueries({ queryKey: ['customer-advance-movements'] });
      queryClient.invalidateQueries({ queryKey: ['cash-recon-preview'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || err.message),
  });

  const voidMut = useMutation({
    mutationFn: async () => {
      if (!voidTarget) throw new Error('No target');
      if (!voidReason.trim()) throw new Error('Reason required');
      await customerAdvanceApi.voidMovement(voidTarget.id, voidReason.trim());
    },
    onSuccess: () => {
      toast.success('Movement voided');
      setVoidTarget(null);
      setVoidReason('');
      queryClient.invalidateQueries({ queryKey: ['customer-advance-balance'] });
      queryClient.invalidateQueries({ queryKey: ['customer-advance-movements'] });
      queryClient.invalidateQueries({ queryKey: ['cash-recon-preview'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || err.message),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="h-6 w-6" /> Customer Advance Accounts
          </h1>
          <p className="text-sm text-muted-foreground">
            Track customer deposits and driver usage against an advance balance.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setDepositOpen(true)}
            disabled={!selectedCustomerId}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <ArrowDownCircle className="h-4 w-4 mr-2" /> Deposit
          </Button>
          <Button
            onClick={() => setHandoutOpen(true)}
            disabled={!selectedCustomerId}
            variant="outline"
          >
            <ArrowUpCircle className="h-4 w-4 mr-2" /> Cash Handout
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 border rounded-md bg-muted/20">
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
          <Label className="text-xs flex items-center gap-1"><User className="h-3 w-3" /> Customer</Label>
          <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
            <SelectTrigger><SelectValue placeholder="Choose customer..." /></SelectTrigger>
            <SelectContent>
              {customers.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col justify-end">
          {balance && (
            <>
              <div className="text-xs text-muted-foreground">Advance Balance</div>
              <div className={`text-2xl font-bold font-mono ${balance.balance < 0 ? 'text-red-700' : balance.balance > 0 ? 'text-emerald-700' : ''}`}>
                {fmtPKR(balance.balance)} PKR
              </div>
              <div className="text-[10px] text-muted-foreground">
                Deposits: {fmtPKR(balance.inTotal)} · Usage: {fmtPKR(balance.outTotal)}
              </div>
            </>
          )}
        </div>
      </div>

      {selectedCustomerId && (
        <div className="border rounded-md overflow-hidden">
          <div className="px-4 py-2 bg-muted/30 text-xs uppercase tracking-wide font-semibold">
            Movements for {selectedCustomer?.name}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Kind</th>
                <th className="text-left px-3 py-2">Bank / Ref</th>
                <th className="text-left px-3 py-2">Memo</th>
                <th className="text-right px-3 py-2">IN</th>
                <th className="text-right px-3 py-2">OUT</th>
                <th className="text-left px-3 py-2">QB</th>
                <th className="text-center px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="text-center py-6 text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Loading...</td></tr>
              )}
              {!isLoading && movements.length === 0 && (
                <tr><td colSpan={8} className="text-center py-6 text-muted-foreground">No movements yet.</td></tr>
              )}
              {movements.map((m) => (
                <tr key={m.id} className={m.voidedAt ? 'bg-red-50/40 text-muted-foreground line-through' : ''}>
                  <td className="px-3 py-2">{format(new Date(m.createdAt), 'yyyy-MM-dd HH:mm')}</td>
                  <td className="px-3 py-2">{KIND_LABELS[m.kind] || m.kind}</td>
                  <td className="px-3 py-2 text-xs">
                    {m.bank?.name || '—'}{m.referenceNumber ? ` · ${m.referenceNumber}` : ''}
                  </td>
                  <td className="px-3 py-2 text-xs">{m.memo || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-700">
                    {m.direction === 'IN' ? fmtPKR(Number(m.amount)) : ''}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-red-700">
                    {m.direction === 'OUT' ? fmtPKR(Number(m.amount)) : ''}
                  </td>
                  <td className="px-3 py-2">
                    {m.qbSynced ? <Badge className="bg-emerald-600">JE #{m.qbJournalEntryId}</Badge> : <Badge variant="outline">Pending</Badge>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {!m.voidedAt && (
                      <Button size="sm" variant="ghost" className="h-7 text-red-600" onClick={() => setVoidTarget(m)} title="Void">
                        <Ban className="h-4 w-4" />
                      </Button>
                    )}
                    {m.voidedAt && <span className="text-[10px]">Voided: {m.voidReason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Deposit dialog */}
      <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ArrowDownCircle className="h-5 w-5 text-emerald-600" /> New Advance Deposit</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Date *</Label>
              <Input type="date" value={deposit.businessDate} onChange={(e) => setDeposit({ ...deposit, businessDate: e.target.value })} />
            </div>
            <div>
              <Label>Method *</Label>
              <Select value={deposit.method} onValueChange={(v) => setDeposit({ ...deposit, method: v as AdvanceDepositMethod })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="ibft">IBFT / Bank Transfer</SelectItem>
                  <SelectItem value="bank_card">Bank Card</SelectItem>
                  <SelectItem value="pso_card">PSO Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(deposit.method === 'ibft' || deposit.method === 'bank_card') && (
              <div>
                <Label>Bank *</Label>
                <Select value={deposit.bankId} onValueChange={(v) => setDeposit({ ...deposit, bankId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
                  <SelectContent>
                    {banksData.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Amount (PKR) *</Label>
              <Input type="number" step="0.01" min="0" value={deposit.amount} onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })} />
            </div>
            <div>
              <Label>Reference / Cheque # (optional)</Label>
              <Input value={deposit.referenceNumber} onChange={(e) => setDeposit({ ...deposit, referenceNumber: e.target.value })} />
            </div>
            <div>
              <Label>Memo (optional)</Label>
              <Input value={deposit.memo} onChange={(e) => setDeposit({ ...deposit, memo: e.target.value })} />
            </div>
            <div className="text-xs text-muted-foreground p-2 border rounded bg-muted/20">
              {deposit.method === 'cash' && '→ Cash IN to drawer ledger. QB JE: DR Cash / CR Customer Advance.'}
              {deposit.method === 'ibft' && '→ No cash-drawer impact. QB JE: DR Bank / CR Customer Advance.'}
              {deposit.method === 'bank_card' && '→ No cash-drawer impact. QB JE: DR Bank Card Receivable / CR Customer Advance.'}
              {deposit.method === 'pso_card' && '→ No cash-drawer impact. QB JE: DR PSO Card Receivable / CR Customer Advance.'}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepositOpen(false)}>Cancel</Button>
            <Button onClick={() => depositMut.mutate()} disabled={depositMut.isPending} className="bg-emerald-600 hover:bg-emerald-700">
              {depositMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Record Deposit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cash handout dialog */}
      <Dialog open={handoutOpen} onOpenChange={setHandoutOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ArrowUpCircle className="h-5 w-5 text-red-600" /> Driver Cash Handout</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {balance && (
              <div className="p-2 border rounded bg-muted/30 text-sm flex items-center justify-between">
                <span>Available advance balance:</span>
                <span className="font-mono font-bold">{fmtPKR(balance.balance)} PKR</span>
              </div>
            )}
            <div>
              <Label>Date *</Label>
              <Input type="date" value={handout.businessDate} onChange={(e) => setHandout({ ...handout, businessDate: e.target.value })} />
            </div>
            <div>
              <Label>Amount (PKR) *</Label>
              <Input type="number" step="0.01" min="0" value={handout.amount} onChange={(e) => setHandout({ ...handout, amount: e.target.value })} />
              {balance && parseFloat(handout.amount) > balance.balance && (
                <div className="text-xs text-red-600 flex items-center gap-1 mt-1">
                  <AlertTriangle className="h-3 w-3" /> Exceeds available balance
                </div>
              )}
            </div>
            <div>
              <Label>Memo (optional)</Label>
              <Input value={handout.memo} onChange={(e) => setHandout({ ...handout, memo: e.target.value })} placeholder="Driver name, purpose..." />
            </div>
            <div className="text-xs text-muted-foreground p-2 border rounded bg-muted/20">
              → Cash OUT from drawer ledger. QB JE: DR Customer Advance / CR Cash.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHandoutOpen(false)}>Cancel</Button>
            <Button onClick={() => handoutMut.mutate()} disabled={handoutMut.isPending} variant="destructive">
              {handoutMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Minus className="h-4 w-4 mr-2" />}
              Record Handout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void dialog */}
      <Dialog open={!!voidTarget} onOpenChange={(o) => { if (!o) { setVoidTarget(null); setVoidReason(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Void movement</DialogTitle></DialogHeader>
          {voidTarget && (
            <div className="space-y-3 py-2 text-sm">
              <div className="p-2 border rounded bg-muted/30">
                <div><strong>{KIND_LABELS[voidTarget.kind] || voidTarget.kind}</strong> — <span className="font-mono">{fmtPKR(Number(voidTarget.amount))} PKR</span></div>
                <div className="text-xs text-muted-foreground">{voidTarget.memo}</div>
              </div>
              <div>
                <Label>Reason *</Label>
                <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
              </div>
              <div className="text-xs text-muted-foreground">
                Voiding reverses the paired cash-ledger post (if any). Already-posted QB
                JE is NOT auto-voided — delete it in QB manually.
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
