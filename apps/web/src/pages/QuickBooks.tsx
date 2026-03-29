import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Link2, Unlink } from 'lucide-react';
import { apiClient } from '@/api/client';

export default function QuickBooks() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/api/quickbooks/oauth/status');
      setStatus(response.data);
    } catch (error) {
      console.error('Failed to fetch QB status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      const response = await apiClient.get('/api/quickbooks/oauth/authorize');
      window.location.href = response.data.authorizationUrl;
    } catch (error) {
      console.error('Failed to initiate OAuth:', error);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect QuickBooks?')) return;

    try {
      await apiClient.post('/api/quickbooks/oauth/disconnect');
      await fetchStatus();
    } catch (error) {
      console.error('Failed to disconnect:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">QuickBooks Integration</h1>
        <p className="text-muted-foreground">
          Connect your QuickBooks Online account to sync sales, customers, and products
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Connection Status
            {status?.connected ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <AlertCircle className="h-3 w-3" />
                Not Connected
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Manage your QuickBooks Online connection
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : status?.connected ? (
            <>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="font-medium">Company:</span>
                  <span>{status.connection.companyName}</span>
                  <span className="font-medium">Sync Mode:</span>
                  <span>
                    <Badge variant={status.connection.syncMode === 'READ_ONLY' ? 'outline' : 'default'}>
                      {status.connection.syncMode}
                    </Badge>
                  </span>
                  <span className="font-medium">Last Sync:</span>
                  <span>
                    {status.connection.lastSyncAt
                      ? new Date(status.connection.lastSyncAt).toLocaleString()
                      : 'Never'}
                  </span>
                </div>
              </div>
              <Button variant="destructive" onClick={handleDisconnect} className="gap-2">
                <Unlink className="h-4 w-4" />
                Disconnect QuickBooks
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Connect your QuickBooks Online account to enable automatic synchronization of:
              </p>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                <li>Sales invoices</li>
                <li>Customer records</li>
                <li>Product inventory</li>
                <li>Payment receipts</li>
              </ul>
              <Button onClick={handleConnect} className="gap-2">
                <Link2 className="h-4 w-4" />
                Connect QuickBooks
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {status?.connected && (
        <Card>
          <CardHeader>
            <CardTitle>Safety Controls</CardTitle>
            <CardDescription>
              QuickBooks sync is currently in READ-ONLY mode for safety
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Write mode can be enabled from the safety gates page once initial sync is verified.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
