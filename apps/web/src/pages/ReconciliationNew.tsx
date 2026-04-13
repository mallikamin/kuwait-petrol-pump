/**
 * Reconciliation Dashboard - Accountant's Power Tool
 *
 * Purpose: Identify days that need reconciliation, show what's missing, provide audit trail
 * Data Source: Backdated Meter Readings API (shift-segregated daily read model)
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar, CheckCircle, AlertTriangle, XCircle, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate } from '@/utils/format';
import { useAuthStore } from '@/store/auth';
import { apiClient } from '@/api/client';

interface DailySummary {
  businessDate: string;
  totalReadingsExpected: number;
  totalReadingsEntered: number;
  totalReadingsDerived: number;
  totalReadingsMissing: number;
  completionPercent: number;
  status: 'fully_reconciled' | 'partially_reconciled' | 'not_reconciled';
  postingChecks: {
    transactionsByFuel: { HSD: number; PMG: number };
    creditOrBankByFuel: { HSD: number; PMG: number };
    cashByFuel: { HSD: number; PMG: number };
    meterComplete: boolean;
    coreChecksPassed: boolean;
  };
  finalizeStatus: 'finalized' | 'not_finalized' | 'no_entries';
  blockers: string[];
  readyForFinalize: boolean;
  missingDetails?: {
    shiftName: string;
    nozzleName: string;
    missingReadings: ('opening' | 'closing')[];
  }[];
  auditTrail?: {
    recordedBy: string;
    recordedAt: string;
    editedBy?: string;
    editedAt?: string;
  }[];
}

export function ReconciliationNew() {
  const toNumber = (value: unknown): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);

  const { user } = useAuthStore();
  const branchId = user?.branch_id || (user as any)?.branch?.id;

  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30); // Last 30 days
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  // Fetch daily summaries for date range
  const { data: summaries, isLoading, error } = useQuery({
    queryKey: ['reconciliation-summary', branchId, startDate, endDate],
    queryFn: async () => {
      if (!branchId) throw new Error('Branch not found. Please log in again.');

      const response = await apiClient.get('/api/backdated-entries/daily/reconciliation-range', {
        params: {
          branchId,
          startDate,
          endDate,
        },
      });

      return (response.data?.data?.dailySummaries || []) as DailySummary[];
    },
    enabled: !!branchId,
    staleTime: 30000, // Cache for 30 seconds
  });

  const toggleDay = (date: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  const exportToCSV = () => {
    if (!summaries) return;

    const headers = ['Date', 'Status', 'Expected', 'Entered', 'Derived', 'Missing', 'Completion %'];
    const rows = summaries.map(s => [
      s.businessDate,
      s.status.replace(/_/g, ' ').toUpperCase(),
      s.totalReadingsExpected,
      s.totalReadingsEntered,
      s.totalReadingsDerived,
      s.totalReadingsMissing,
      toNumber(s.completionPercent).toFixed(0) + '%',
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation-summary-${startDate}-to-${endDate}.csv`;
    a.click();
  };

  // Aggregate stats
  const stats = summaries ? {
    fullyReconciled: summaries.filter(s => s.status === 'fully_reconciled').length,
    partiallyReconciled: summaries.filter(s => s.status === 'partially_reconciled').length,
    notReconciled: summaries.filter(s => s.status === 'not_reconciled').length,
    totalMissing: summaries.reduce((sum, s) => sum + s.totalReadingsMissing, 0),
  } : null;

  if (!branchId) {
    return (
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Branch not found. Please log in again.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reconciliation Dashboard</h1>
          <p className="text-muted-foreground">Accountant's hack to identify unbalanced days and missing entries</p>
        </div>
        <Button onClick={exportToCSV} disabled={!summaries || summaries.length === 0}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Date Range Filter */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Date Range</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                max={endDate}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                max={new Date().toISOString().split('T')[0]}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Fully Reconciled</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.fullyReconciled}</div>
              <p className="text-xs text-muted-foreground">100% complete</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Partially Reconciled</CardTitle>
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{stats.partiallyReconciled}</div>
              <p className="text-xs text-muted-foreground">Some data entered</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Not Reconciled</CardTitle>
              <XCircle className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.notReconciled}</div>
              <p className="text-xs text-muted-foreground">No data</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Missing Readings</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalMissing}</div>
              <p className="text-xs text-muted-foreground">Across all days</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Daily Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Reconciliation Status</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {(error as any).message || 'Failed to load reconciliation data'}
              </AlertDescription>
            </Alert>
          ) : !summaries || summaries.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No data for selected date range
            </div>
          ) : (
            <div className="space-y-2">
              {summaries.map((day) => {
                const completionPercent = toNumber(day?.completionPercent);
                const totalReadingsEntered = toNumber(day?.totalReadingsEntered);
                const totalReadingsDerived = toNumber(day?.totalReadingsDerived);
                const totalReadingsExpected = toNumber(day?.totalReadingsExpected);
                const totalReadingsMissing = toNumber(day?.totalReadingsMissing);
                const postingChecks = day?.postingChecks || {
                  transactionsByFuel: { HSD: 0, PMG: 0 },
                  creditOrBankByFuel: { HSD: 0, PMG: 0 },
                  cashByFuel: { HSD: 0, PMG: 0 },
                  meterComplete: false,
                  coreChecksPassed: false,
                };

                return (
                <Collapsible
                  key={day.businessDate}
                  open={expandedDays.has(day.businessDate)}
                  onOpenChange={() => toggleDay(day.businessDate)}
                >
                  <div className={`border rounded-lg ${
                    day.status === 'fully_reconciled' ? 'bg-green-50 border-green-200' :
                    day.status === 'partially_reconciled' ? 'bg-yellow-50 border-yellow-200' :
                    'bg-red-50 border-red-200'
                  }`}>
                    <CollapsibleTrigger asChild>
                      <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/50 transition-colors">
                        <div className="flex items-center gap-4">
                          {expandedDays.has(day.businessDate) ? (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                          )}
                          <div>
                            <h3 className="font-semibold">{formatDate(day.businessDate)}</h3>
                            <p className="text-sm text-muted-foreground">
                              {totalReadingsEntered} entered, {totalReadingsDerived} derived, {totalReadingsMissing} missing
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-2xl font-bold">
                              {completionPercent.toFixed(0)}%
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {totalReadingsEntered + totalReadingsDerived}/{totalReadingsExpected} readings
                            </p>
                          </div>
                          <Badge variant={
                            day.status === 'fully_reconciled' ? 'default' :
                            day.status === 'partially_reconciled' ? 'secondary' :
                            'destructive'
                          }>
                            {day.status === 'fully_reconciled' ? 'Fully Reconciled' :
                             day.status === 'partially_reconciled' ? 'Partial Data' :
                             'Not Reconciled'}
                          </Badge>
                        </div>
                      </div>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="border-t px-4 py-4 bg-white">
                        <div className="space-y-3">
                          <h4 className="font-semibold text-sm">Posting Checklist:</h4>
                          <div className="text-sm text-muted-foreground">
                            Txn count: HSD {toNumber(postingChecks.transactionsByFuel?.HSD)}, PMG {toNumber(postingChecks.transactionsByFuel?.PMG)}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Credit/Bank count: HSD {toNumber(postingChecks.creditOrBankByFuel?.HSD)}, PMG {toNumber(postingChecks.creditOrBankByFuel?.PMG)}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Cash count: HSD {toNumber(postingChecks.cashByFuel?.HSD)}, PMG {toNumber(postingChecks.cashByFuel?.PMG)}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={postingChecks.coreChecksPassed ? 'default' : 'destructive'}>
                              {postingChecks.coreChecksPassed ? 'Core Posting Checks Passed' : 'Posting Checks Pending'}
                            </Badge>
                            <Badge variant={day.finalizeStatus === 'finalized' ? 'default' : 'secondary'}>
                              {day.finalizeStatus === 'finalized'
                                ? 'Finalized'
                                : day.finalizeStatus === 'not_finalized'
                                  ? 'Not Finalized'
                                  : 'No Entries'}
                            </Badge>
                          </div>

                          {day.blockers && day.blockers.length > 0 ? (
                            <div className="space-y-2">
                              <h4 className="font-semibold text-sm text-red-700">Action Items:</h4>
                              <ul className="text-sm text-red-700 list-disc pl-5 space-y-1">
                                {day.blockers.map((blocker, idx) => (
                                  <li key={idx}>{blocker}</li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-green-700">
                              <CheckCircle className="h-5 w-5" />
                              <span className="font-medium">
                                Ready state complete{day.finalizeStatus === 'finalized' ? ' and finalized' : ''}.
                              </span>
                            </div>
                          )}

                          {day.missingDetails && day.missingDetails.length > 0 ? (
                          <div className="space-y-3">
                            <h4 className="font-semibold text-sm">Missing Readings:</h4>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Shift</TableHead>
                                  <TableHead>Nozzle</TableHead>
                                  <TableHead>Missing</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {asArray<any>(day.missingDetails).map((detail, idx) => (
                                  <TableRow key={idx}>
                                    <TableCell>{detail.shiftName}</TableCell>
                                    <TableCell className="font-medium">{detail.nozzleName}</TableCell>
                                    <TableCell>
                                      {asArray<string>(detail.missingReadings).map(r => (
                                        <Badge key={r} variant="outline" className="mr-1">
                                          {r}
                                        </Badge>
                                      ))}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                            <Button
                              size="sm"
                              onClick={() => {
                                // Navigate to Backdated Entries with pre-selected date
                                window.location.href = `/backdated-entries?date=${day.businessDate}`;
                              }}
                            >
                              Fill Missing Readings
                            </Button>
                          </div>
                          ) : null}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              )})}
            </div>
          )}
        </CardContent>
      </Card>

      {/* User Guide */}
      <Card>
        <CardHeader>
          <CardTitle>How to Use This Dashboard</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <strong className="text-green-700">Fully Reconciled (Green)</strong>
              <p className="text-sm text-muted-foreground">
                All meter readings entered for both Day and Night shifts. Ready for accounting.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
            <div>
              <strong className="text-yellow-700">Partially Reconciled (Yellow)</strong>
              <p className="text-sm text-muted-foreground">
                Some readings entered or derived. Click to expand and see what's missing.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
            <div>
              <strong className="text-red-700">Not Reconciled (Red)</strong>
              <p className="text-sm text-muted-foreground">
                No data entered. Click "Fill Missing Readings" to add meter readings in Backdated Entries module.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

