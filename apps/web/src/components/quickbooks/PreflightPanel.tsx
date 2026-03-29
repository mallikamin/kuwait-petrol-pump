import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle, XCircle, RefreshCw } from 'lucide-react';
import { quickbooksApi } from '@/api/quickbooks';
import type { PreflightResult, CheckStatus } from '@/types/quickbooks';

interface PreflightPanelProps {
  onRefresh?: () => void;
}

export function PreflightPanel({ onRefresh }: PreflightPanelProps) {
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPreflight = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await quickbooksApi.getPreflight();
      setPreflight(result);
      onRefresh?.();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch preflight checks');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: CheckStatus) => {
    switch (status) {
      case 'pass':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'warning':
        return <AlertCircle className="h-4 w-4 text-yellow-600" />;
      case 'fail':
        return <XCircle className="h-4 w-4 text-red-600" />;
    }
  };

  const getStatusBadge = (status: CheckStatus) => {
    switch (status) {
      case 'pass':
        return <Badge variant="default" className="bg-green-600">Pass</Badge>;
      case 'warning':
        return <Badge variant="default" className="bg-yellow-600">Warning</Badge>;
      case 'fail':
        return <Badge variant="destructive">Fail</Badge>;
    }
  };

  const getOverallStatusBadge = (status: string) => {
    switch (status) {
      case 'ready':
        return <Badge variant="default" className="bg-green-600">Ready</Badge>;
      case 'warning':
        return <Badge variant="default" className="bg-yellow-600">Warning</Badge>;
      case 'blocked':
        return <Badge variant="destructive">Blocked</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Preflight Checks</CardTitle>
            <CardDescription>
              Validate production readiness before enabling QuickBooks sync
            </CardDescription>
          </div>
          <Button
            onClick={fetchPreflight}
            disabled={loading}
            size="sm"
            variant="outline"
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Run Checks
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="p-3 mb-4 bg-red-50 text-red-900 rounded-md text-sm">
            {error}
          </div>
        )}

        {!preflight && !loading && !error && (
          <p className="text-sm text-muted-foreground">
            Click "Run Checks" to validate QuickBooks integration readiness
          </p>
        )}

        {preflight && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center justify-between p-3 bg-muted rounded-md">
              <div className="flex items-center gap-2">
                <span className="font-medium">Overall Status:</span>
                {getOverallStatusBadge(preflight.overallStatus)}
              </div>
              <div className="text-sm text-muted-foreground">
                {preflight.summary.passed}/{preflight.summary.totalChecks} passed
                {preflight.summary.warnings > 0 && `, ${preflight.summary.warnings} warnings`}
                {preflight.summary.failed > 0 && `, ${preflight.summary.failed} failed`}
              </div>
            </div>

            {/* Checks Table */}
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-2">Check</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {preflight.checks.map((check, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-2 flex items-center gap-2">
                        {getStatusIcon(check.status)}
                        <span className="font-medium">{check.name}</span>
                      </td>
                      <td className="p-2">{getStatusBadge(check.status)}</td>
                      <td className="p-2 text-muted-foreground">{check.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* CTA Guidance */}
            {preflight.summary.failed > 0 && (
              <div className="p-3 bg-red-50 text-red-900 rounded-md">
                <p className="font-medium mb-1">Action Required:</p>
                <ul className="list-disc list-inside text-sm space-y-1">
                  {preflight.checks
                    .filter((c) => c.status === 'fail')
                    .map((check, idx) => (
                      <li key={idx}>
                        {check.name}: {check.message}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {preflight.overallStatus === 'ready' && (
              <div className="p-3 bg-green-50 text-green-900 rounded-md text-sm">
                ✓ All checks passed. QuickBooks integration is ready for production.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
