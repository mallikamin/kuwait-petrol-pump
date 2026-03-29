import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, Shield, ShieldAlert, RefreshCw } from 'lucide-react';
import { quickbooksApi } from '@/api/quickbooks';
import { toast } from 'sonner';
import type { QBControlsResponse, SyncMode } from '@/types/quickbooks';

interface ControlsPanelProps {
  userRole: string;
}

export function ControlsPanel({ userRole }: ControlsPanelProps) {
  const [controlsData, setControlsData] = useState<QBControlsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = userRole === 'admin';

  const fetchControls = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await quickbooksApi.getControls();
      setControlsData(result);
    } catch (err: any) {
      const message = err.response?.data?.error || 'Failed to fetch controls';
      if (err.response?.status === 403) {
        setError('Access denied. Admin role required.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchControls();
    }
  }, [isAdmin]);

  const handleKillSwitchToggle = async (enabled: boolean) => {
    if (!enabled) {
      if (!confirm('Warning: Disabling the kill switch will allow QuickBooks writes. Are you sure?')) {
        return;
      }
    }

    try {
      setUpdating(true);
      await quickbooksApi.updateControls({ killSwitch: enabled });
      setControlsData((prev) =>
        prev
          ? { ...prev, controls: { ...prev.controls, killSwitch: enabled } }
          : null
      );
      toast.success(`Kill switch ${enabled ? 'activated' : 'deactivated'}`);
    } catch (err: any) {
      const message = err.response?.data?.error || 'Failed to update kill switch';
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  };

  const handleSyncModeChange = async (newMode: SyncMode) => {
    if (newMode === 'FULL_SYNC') {
      if (
        !confirm(
          'Warning: FULL_SYNC mode will write data to QuickBooks. Ensure you have:\n\n' +
            '1. Completed READ_ONLY testing (1-2 weeks)\n' +
            '2. Completed DRY_RUN validation (1 week)\n' +
            '3. Verified all entity mappings\n' +
            '4. Configured backups\n\n' +
            'Proceed with FULL_SYNC?'
        )
      ) {
        return;
      }
    }

    try {
      setUpdating(true);
      await quickbooksApi.updateControls({ syncMode: newMode });
      setControlsData((prev) =>
        prev
          ? { ...prev, controls: { ...prev.controls, syncMode: newMode } }
          : null
      );
      toast.success(`Sync mode changed to ${newMode}`);
    } catch (err: any) {
      const message = err.response?.data?.error || 'Failed to update sync mode';
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  };

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Controls
          </CardTitle>
          <CardDescription>Manage QuickBooks sync controls</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-3 bg-yellow-50 text-yellow-900 rounded-md text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p>Admin access required to view and modify QuickBooks controls.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {controlsData?.controls.killSwitch ? (
                <ShieldAlert className="h-5 w-5 text-red-600" />
              ) : (
                <Shield className="h-5 w-5" />
              )}
              Controls
            </CardTitle>
            <CardDescription>Manage QuickBooks sync controls (Admin Only)</CardDescription>
          </div>
          <Button
            onClick={fetchControls}
            disabled={loading || updating}
            size="sm"
            variant="outline"
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="p-3 mb-4 bg-red-50 text-red-900 rounded-md text-sm">
            {error}
          </div>
        )}

        {controlsData?.controls && (
          <div className="space-y-6">
            {/* Kill Switch */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="kill-switch" className="text-base font-medium">
                    Global Kill Switch
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Emergency stop for all QuickBooks writes
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={controlsData.controls.killSwitch ? 'destructive' : 'default'}
                    className="gap-1"
                  >
                    {controlsData.controls.killSwitch ? 'Active' : 'Inactive'}
                  </Badge>
                  <Switch
                    id="kill-switch"
                    checked={controlsData.controls.killSwitch}
                    onCheckedChange={handleKillSwitchToggle}
                    disabled={updating}
                  />
                </div>
              </div>
              {controlsData.controls.killSwitch && (
                <p className="text-sm text-red-600">
                  Warning: Kill switch is active. All QuickBooks writes are blocked.
                </p>
              )}
            </div>

            <div className="border-t pt-6" />

            {/* Sync Mode */}
            <div className="space-y-2">
              <Label htmlFor="sync-mode" className="text-base font-medium">
                Sync Mode
              </Label>
              <p className="text-sm text-muted-foreground mb-3">
                Control QuickBooks write permissions
              </p>
              <Select
                value={controlsData.controls.syncMode}
                onValueChange={(value) => handleSyncModeChange(value as SyncMode)}
                disabled={updating}
              >
                <SelectTrigger id="sync-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="READ_ONLY">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">READ_ONLY</span>
                      <span className="text-xs text-muted-foreground">
                        OAuth validation only, no writes
                      </span>
                    </div>
                  </SelectItem>
                  <SelectItem value="DRY_RUN">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">DRY_RUN</span>
                      <span className="text-xs text-muted-foreground">
                        Validate payloads without QB API calls
                      </span>
                    </div>
                  </SelectItem>
                  <SelectItem value="FULL_SYNC">
                    <div className="flex flex-col items-start">
                      <span className="font-medium text-red-600">FULL_SYNC</span>
                      <span className="text-xs text-muted-foreground">
                        Production writes to QuickBooks
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <div className="p-3 bg-blue-50 text-blue-900 rounded-md text-sm space-y-1">
                <p className="font-medium">Current Mode: {controlsData.controls.syncMode}</p>
                {controlsData.controls.syncMode === 'READ_ONLY' && (
                  <p>Week 1-2: OAuth connection + infrastructure validation</p>
                )}
                {controlsData.controls.syncMode === 'DRY_RUN' && (
                  <p>Week 3: Payload generation + mapping validation (no real QB writes)</p>
                )}
                {controlsData.controls.syncMode === 'FULL_SYNC' && (
                  <p className="text-red-600 font-medium">
                    Warning: Production mode - actual QuickBooks writes enabled
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {!controlsData && !loading && !error && (
          <p className="text-sm text-muted-foreground">Loading controls...</p>
        )}
      </CardContent>
    </Card>
  );
}
