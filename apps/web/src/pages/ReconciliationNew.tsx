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
import { useEffectiveBranchId } from '@/hooks/useEffectiveBranch';
import { apiClient } from '@/api/client';
import { cashReconciliationApi, type CashReconSummaryDay } from '@/api/cashReconciliation';

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
  // Reporting aggregates (added 2026-04-26 for CSV export + per-day cards)
  meter?: { hsdLiters: number; pmgLiters: number; hsdPkr: number; pmgPkr: number };
  posted?: { hsdLiters: number; pmgLiters: number; hsdPkr: number; pmgPkr: number };
  nonFuel?: { units: number; pkr: number };
  cashSales?: number;
  expensesTotal?: number;
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
  // Active branch from the top-bar org/branch switcher; falls back to the
  // user's JWT branch for single-org users (zero behavior change for them).
  const branchId = useEffectiveBranchId() || user?.branch_id || (user as any)?.branch?.id;

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
    enabled: !!branchId && !!startDate && !!endDate, // Only run if dates are valid
    staleTime: 30000, // Cache for 30 seconds
  });

  // Cash reconciliation digest for the same window — purely informational
  // here (the Reconciliation tab is a read-only reference). Failures are
  // soft: an empty cash dimension still lets the meter/txn dimensions render.
  const { data: cashRangeRaw } = useQuery({
    queryKey: ['cash-recon-range', branchId, startDate, endDate],
    queryFn: () => cashReconciliationApi.getSummaryRange(branchId!, startDate, endDate),
    enabled: !!branchId && !!startDate && !!endDate,
    staleTime: 30000,
    retry: 0,
  });
  const cashByDate = new Map<string, CashReconSummaryDay>();
  for (const row of cashRangeRaw || []) cashByDate.set(row.businessDate, row);

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

  // CSV cell escape — wrap values with commas/quotes/newlines.
  const csvCell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? v.toString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportToCSV = () => {
    if (!summaries) return;

    const headers = [
      'Date',
      'Expected Readings',
      'Entered',
      'Missing',
      'HSD Meter Litres',
      'HSD Meter PKR',
      'HSD Posted Litres',
      'HSD Posted PKR',
      'HSD Variation (Litres)',
      'PMG Meter Litres',
      'PMG Meter PKR',
      'PMG Posted Litres',
      'PMG Posted PKR',
      'PMG Variation (Litres)',
      'Non-Fuel Units',
      'Non-Fuel PKR',
      'Cash Sales (Fuel + Non-Fuel)',
      'Day Finalized',
      'Expenses',
      'Expected Cash',
      'Physical Cash Submitted',
      'Cash Variance',
      'Cash Recon Day Closed',
    ];

    const rows = summaries.map((s) => {
      const meter = s.meter || { hsdLiters: 0, pmgLiters: 0, hsdPkr: 0, pmgPkr: 0 };
      const posted = s.posted || { hsdLiters: 0, pmgLiters: 0, hsdPkr: 0, pmgPkr: 0 };
      const nonFuel = s.nonFuel || { units: 0, pkr: 0 };
      const cash = cashByDate.get(s.businessDate);
      const expectedCash = (cash?.inflowsTotal ?? 0) - (cash?.outflowsTotal ?? 0);
      const hsdVar = meter.hsdLiters - posted.hsdLiters;
      const pmgVar = meter.pmgLiters - posted.pmgLiters;
      const round2 = (n: number) => Math.round(n * 100) / 100;

      return [
        s.businessDate,
        s.totalReadingsExpected,
        s.totalReadingsEntered,
        s.totalReadingsMissing,
        round2(meter.hsdLiters),
        round2(meter.hsdPkr),
        round2(posted.hsdLiters),
        round2(posted.hsdPkr),
        round2(hsdVar),
        round2(meter.pmgLiters),
        round2(meter.pmgPkr),
        round2(posted.pmgLiters),
        round2(posted.pmgPkr),
        round2(pmgVar),
        round2(nonFuel.units),
        round2(nonFuel.pkr),
        round2(s.cashSales ?? 0),
        s.finalizeStatus === 'finalized' ? 'Yes' : 'No',
        round2(s.expensesTotal ?? 0),
        cash ? round2(expectedCash) : '',
        cash?.physicalCash !== null && cash?.physicalCash !== undefined ? round2(cash.physicalCash) : '',
        cash?.variance !== null && cash?.variance !== undefined ? round2(cash.variance) : '',
        cash?.status === 'closed' ? 'Yes' : 'No',
      ];
    });

    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation-summary-${startDate}-to-${endDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Aggregate stats — accountant-correct definitions:
  //   Fully Reconciled = day finalized AND cash recon closed
  //   Partially Reconciled = day finalized but cash recon not closed
  //   Not Reconciled = day not finalized (backdated work still missing)
  // Cash close cannot happen until backdated is finalized, so the three
  // buckets are mutually exclusive.
  const stats = summaries ? (() => {
    let fullyReconciled = 0;
    let partiallyReconciled = 0;
    let notReconciled = 0;
    let totalMissing = 0;
    for (const s of summaries) {
      const finalized = s.finalizeStatus === 'finalized';
      const cashClosed = cashByDate.get(s.businessDate)?.status === 'closed';
      if (finalized && cashClosed) fullyReconciled += 1;
      else if (finalized) partiallyReconciled += 1;
      else notReconciled += 1;
      totalMissing += s.totalReadingsMissing;
    }
    return { fullyReconciled, partiallyReconciled, notReconciled, totalMissing };
  })() : null;

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
                onChange={(e) => {
                  const newValue = e.target.value;
                  if (newValue && /^\d{4}-\d{2}-\d{2}$/.test(newValue)) {
                    setStartDate(newValue);
                  }
                }}
                max={endDate}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => {
                  const newValue = e.target.value;
                  if (newValue && /^\d{4}-\d{2}-\d{2}$/.test(newValue)) {
                    setEndDate(newValue);
                  }
                }}
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
              <p className="text-xs text-muted-foreground">Finalized + cash closed</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Partially Reconciled</CardTitle>
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{stats.partiallyReconciled}</div>
              <p className="text-xs text-muted-foreground">Finalized, cash close pending</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Not Reconciled</CardTitle>
              <XCircle className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.notReconciled}</div>
              <p className="text-xs text-muted-foreground">Backdated missing</p>
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
                        <div className="flex items-center gap-2">
                          {(() => {
                            // Meter dimension — purely a function of readings entered+derived vs expected.
                            const meterDone = totalReadingsExpected > 0 && totalReadingsMissing === 0;
                            const meterPartial = !meterDone && (totalReadingsEntered + totalReadingsDerived) > 0;
                            const meterVariant: 'default' | 'secondary' | 'destructive' = meterDone ? 'default' : meterPartial ? 'secondary' : 'destructive';

                            // Txn dimension — backdated transactions reconciled means
                            // posting checks pass *and* the day was finalized.
                            const txnsReconciled = postingChecks.coreChecksPassed && day.finalizeStatus === 'finalized';
                            const txnsLabel = day.finalizeStatus === 'no_entries'
                              ? 'Txns: No Entries'
                              : txnsReconciled
                                ? 'Txns: Reconciled'
                                : 'Txns: Pending';
                            const txnsVariant: 'default' | 'secondary' | 'destructive' = txnsReconciled
                              ? 'default'
                              : day.finalizeStatus === 'no_entries' ? 'destructive' : 'secondary';

                            // Cash dimension — read-only reference; actions live in Cash Reconciliation tab.
                            const cash = cashByDate.get(day.businessDate);
                            const isFinalized = day.finalizeStatus === 'finalized';
                            let cashLabel = 'Cash: Pending';
                            let cashVariant: 'default' | 'secondary' | 'destructive' = 'destructive';
                            if (cash?.status === 'closed') {
                              const v = cash.variance ?? 0;
                              const sign = v > 0 ? '+' : '';
                              cashLabel = `Cash: Closed (${sign}${v.toLocaleString()})`;
                              cashVariant = 'default';
                            } else if (cash?.status === 'open') {
                              cashLabel = 'Cash: Submitted';
                              cashVariant = 'secondary';
                            } else if (isFinalized) {
                              cashLabel = 'Cash: Awaiting Close';
                              cashVariant = 'secondary';
                            }

                            return (
                              <div className="flex flex-col items-end gap-1">
                                <Badge variant={meterVariant}>
                                  Meter Readings: {totalReadingsEntered + totalReadingsDerived}/{totalReadingsExpected}
                                </Badge>
                                <Badge variant={txnsVariant}>{txnsLabel}</Badge>
                                <Badge variant={cashVariant}>{cashLabel}</Badge>
                              </div>
                            );
                          })()}
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

                          {/* Cash Reconciliation — read-only reference. Actions live in the Cash Reconciliation tab. */}
                          {(() => {
                            const cash = cashByDate.get(day.businessDate);
                            const isFinalized = day.finalizeStatus === 'finalized';
                            const fmt = (n: number | null | undefined) => n === null || n === undefined ? '—' : n.toLocaleString();
                            const status = cash?.status || 'none';
                            const variance = cash?.variance ?? null;

                            return (
                              <div className="pt-3 border-t border-dashed space-y-2">
                                <div className="flex items-center justify-between">
                                  <h4 className="font-semibold text-sm">Cash Reconciliation:</h4>
                                  {status === 'closed' && cash?.closedAt ? (
                                    <Badge variant="default" className="text-xs">
                                      🔒 Closed {new Date(cash.closedAt).toLocaleDateString()}
                                    </Badge>
                                  ) : status === 'open' ? (
                                    <Badge variant="secondary" className="text-xs">Submitted, not closed</Badge>
                                  ) : isFinalized ? (
                                    <Badge variant="secondary" className="text-xs">Awaiting Close</Badge>
                                  ) : (
                                    <Badge variant="destructive" className="text-xs">Pending — finalize day first</Badge>
                                  )}
                                </div>
                                <div className="grid grid-cols-4 gap-3 text-xs">
                                  <div>
                                    <div className="text-muted-foreground">Cash In (sales)</div>
                                    <div className="num text-base font-semibold">{isFinalized || (cash && cash.inflowsTotal > 0) ? fmt(cash?.inflowsTotal ?? 0) : '—'}</div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Cash Out (expenses)</div>
                                    <div className="num text-base font-semibold">{fmt(cash?.outflowsTotal ?? 0)}</div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Physical Submitted</div>
                                    <div className="num text-base font-semibold">{fmt(cash?.physicalCash)}</div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Variance</div>
                                    <div className={`num text-base font-semibold ${
                                      variance === null ? 'text-muted-foreground' :
                                      variance === 0 ? 'text-green-700' :
                                      variance < 0 ? 'text-red-700' : 'text-blue-700'
                                    }`}>
                                      {variance === null ? '—' : (variance > 0 ? '+' : '') + variance.toLocaleString()}
                                    </div>
                                  </div>
                                </div>
                                {!isFinalized && status === 'none' && (
                                  <p className="text-xs text-muted-foreground italic">
                                    Cash inflows post once the day is finalized. Manage from the Cash Reconciliation tab.
                                  </p>
                                )}
                              </div>
                            );
                          })()}

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
                                window.location.href = `/backdated-entries2?date=${day.businessDate}`;
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

