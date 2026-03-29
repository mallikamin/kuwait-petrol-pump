import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useAuthStore } from '@/store/auth';
import { OfflineQueue, QueuedSale } from '@/db/indexeddb';
import { SyncStatus } from '@/components/SyncStatus';
import { ShoppingCart, Send, WifiOff } from 'lucide-react';

type PaymentMethod = 'cash' | 'credit' | 'card' | 'pso_card' | 'other';

export function POS() {
  const { toast } = useToast();
  const { user } = useAuthStore();

  const [totalAmount, setTotalAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [slipNumber, setSlipNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{
    offlineQueueId: string;
    flushed: boolean;
    syncResult?: { synced: number; failed: number; duplicates: number };
  } | null>(null);

  const branchId = user?.branch_id || (user as any)?.branch?.id;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!branchId) {
      toast({ title: 'No branch assigned', description: 'Your user account has no branch_id. Contact admin.', variant: 'destructive' });
      return;
    }

    const amount = parseFloat(totalAmount);
    if (!amount || amount <= 0) {
      toast({ title: 'Invalid amount', description: 'Enter a positive amount.', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      // Always enqueue to IndexedDB first (offline-first)
      const saleData: Omit<QueuedSale, 'offlineQueueId' | 'queuedAt' | 'attempts' | 'status'> = {
        branchId,
        saleType: 'non_fuel',
        saleDate: new Date().toISOString(),
        totalAmount: amount,
        paymentMethod,
        slipNumber: slipNumber || undefined,
      };

      const offlineQueueId = await OfflineQueue.enqueueSale(saleData);

      toast({ title: 'Sale queued', description: `ID: ${offlineQueueId.slice(0, 8)}...` });

      // If online, flush immediately
      let syncResult: { synced: number; failed: number; duplicates: number } | undefined;
      if (navigator.onLine) {
        try {
          const deviceId = localStorage.getItem('deviceId') || 'web-' + Math.random().toString(36).substr(2, 9);
          localStorage.setItem('deviceId', deviceId);
          syncResult = await OfflineQueue.flushWhenOnline(deviceId);
          toast({ title: 'Synced', description: `${syncResult.synced} synced, ${syncResult.duplicates} duplicates` });
        } catch {
          toast({ title: 'Queued (sync later)', description: 'Sale saved locally. Will sync when connection is restored.', variant: 'destructive' });
        }
      } else {
        toast({ title: 'Offline - sale saved locally', description: 'Will sync automatically when back online.' });
      }

      setLastResult({ offlineQueueId, flushed: !!syncResult, syncResult });

      // Reset form
      setTotalAmount('');
      setSlipNumber('');
    } catch (err) {
      toast({ title: 'Queue failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Point of Sale</h1>
          <p className="text-muted-foreground">Create sales (works offline)</p>
        </div>
        <SyncStatus />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sale Entry Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              New Sale
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Amount */}
              <div className="space-y-2">
                <Label htmlFor="totalAmount">Total Amount (PKR)</Label>
                <Input
                  id="totalAmount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  required
                />
              </div>

              {/* Payment Method */}
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="credit">Credit</SelectItem>
                    <SelectItem value="pso_card">PSO Card</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Slip Number */}
              <div className="space-y-2">
                <Label htmlFor="slipNumber">Slip Number (optional)</Label>
                <Input
                  id="slipNumber"
                  placeholder="e.g. SL-0001"
                  value={slipNumber}
                  onChange={(e) => setSlipNumber(e.target.value)}
                />
              </div>

              {/* Offline indicator */}
              {!navigator.onLine && (
                <div className="flex items-center gap-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                  <WifiOff className="h-4 w-4" />
                  Offline - sale will be saved locally and synced later
                </div>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                <Send className="mr-2 h-4 w-4" />
                {submitting ? 'Saving...' : 'Complete Sale'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Last Result + Queue Status */}
        <div className="space-y-4">
          {lastResult && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Last Sale</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Queue ID</span>
                  <code className="text-xs">{lastResult.offlineQueueId.slice(0, 12)}...</code>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  {lastResult.flushed ? (
                    <Badge>Synced</Badge>
                  ) : (
                    <Badge variant="secondary">Pending</Badge>
                  )}
                </div>
                {lastResult.syncResult && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Synced</span>
                      <span>{lastResult.syncResult.synced}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Duplicates</span>
                      <span>{lastResult.syncResult.duplicates}</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Branch Info</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">User</span>
                <span>{user?.full_name || user?.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Role</span>
                <Badge variant="outline">{user?.role}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Branch ID</span>
                <code className="text-xs">{branchId?.slice(0, 8) || 'none'}...</code>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
