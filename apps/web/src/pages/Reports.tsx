import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Download, Printer, Loader2, Calendar } from 'lucide-react';
import { reportsApi, apiClient } from '@/api';
import { useAuthStore } from '@/store/auth';
import { formatCurrency } from '@/utils/format';

type ReportType = 'daily-sales' | 'shift' | 'inventory' | 'customer-ledger' | 'variance' | 'fuel-price-history';

function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-PK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function toCSV(headers: string[], rows: (string | number)[][]): string {
  const escape = (v: string | number) => {
    // Keep numbers as-is for Excel compatibility
    if (typeof v === 'number') return String(v);
    // Escape strings
    return `"${String(v || '').replace(/"/g, '""')}"`;
  };
  return [
    headers.map(escape).join(','),
    ...rows.map(r => r.map(escape).join(',')),
  ].join('\n');
}

function downloadCSV(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function printReport(title: string, contentHtml: string) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      h2 { font-size: 14px; margin-top: 16px; margin-bottom: 8px; }
      .meta { color: #666; margin-bottom: 16px; font-size: 11px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
      th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; font-size: 11px; }
      th { background: #f5f5f5; font-weight: bold; }
      .right { text-align: right; }
      .bold { font-weight: bold; }
      .summary { display: flex; gap: 24px; margin-bottom: 16px; }
      .summary-item { }
      .summary-label { color: #666; font-size: 10px; }
      .summary-value { font-size: 16px; font-weight: bold; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <h1>${title}</h1>
    <p class="meta">Generated: ${new Date().toLocaleString('en-PK')} | Petrol Pump POS</p>
    ${contentHtml}
    <script>window.onload = function() { window.print(); }<\/script>
  </body></html>`);
  win.document.close();
}

export function Reports() {
  const { user } = useAuthStore();
  const branchId = user?.branch_id || (user as any)?.branch?.id || (user as any)?.branchId;

  const [selectedReport, setSelectedReport] = useState<ReportType>('daily-sales');
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [startDate, setStartDate] = useState(
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [fetchEnabled, setFetchEnabled] = useState(false);

  // Daily Sales
  const { data: dailySales, isLoading: loadingDaily, isError: errorDaily } = useQuery({
    queryKey: ['report-daily-sales', branchId, reportDate],
    queryFn: () => reportsApi.getDailySales(branchId, new Date(reportDate).toISOString()),
    enabled: fetchEnabled && selectedReport === 'daily-sales' && !!branchId,
  });

  // Shift Report
  const { data: shiftReport, isLoading: loadingShift, isError: errorShift } = useQuery({
    queryKey: ['report-shift', selectedShiftId],
    queryFn: () => reportsApi.getShiftReport(selectedShiftId),
    enabled: fetchEnabled && selectedReport === 'shift' && !!selectedShiftId,
  });

  // Inventory
  const { data: inventory, isLoading: loadingInventory, isError: errorInventory } = useQuery({
    queryKey: ['report-inventory', branchId],
    queryFn: () => reportsApi.getInventoryReport(branchId),
    enabled: fetchEnabled && selectedReport === 'inventory' && !!branchId,
  });

  // Customer Ledger
  const { data: customerLedger, isLoading: loadingLedger, isError: errorLedger } = useQuery({
    queryKey: ['report-customer-ledger', selectedCustomerId, startDate, endDate],
    queryFn: () => reportsApi.getCustomerLedger(selectedCustomerId, new Date(startDate).toISOString(), new Date(endDate).toISOString()),
    enabled: fetchEnabled && selectedReport === 'customer-ledger' && !!selectedCustomerId,
  });

  // Variance
  const { data: variance, isLoading: loadingVariance, isError: errorVariance } = useQuery({
    queryKey: ['report-variance', branchId, startDate, endDate],
    queryFn: () => reportsApi.getVarianceReport(branchId, new Date(startDate).toISOString(), new Date(endDate).toISOString()),
    enabled: fetchEnabled && selectedReport === 'variance' && !!branchId,
  });

  // Get customers list for dropdown
  const { data: customersData } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => apiClient.get('/api/customers', { params: { page: 1, size: 100 } }).then(r => r.data.customers || []),
    enabled: selectedReport === 'customer-ledger',
  });

  const isLoading = loadingDaily || loadingShift || loadingInventory || loadingLedger || loadingVariance;
  const isError = errorDaily || errorShift || errorInventory || errorLedger || errorVariance;

  const handleGenerate = () => {
    setFetchEnabled(true);
  };

  // CSV + Print for Daily Sales
  const exportDailySalesCSV = () => {
    if (!dailySales) return;
    const summary = dailySales.summary || {};
    const payments = dailySales.paymentMethodBreakdown || [];
    const shifts = dailySales.shiftBreakdown || [];

    const headers = ['Category', 'Count', 'Amount'];
    const rows: (string | number)[][] = [
      ['Total Sales', summary.totalTransactions || 0, Number(summary.totalAmount || 0)],
      ['Fuel Sales', summary.fuel?.count || 0, Number(summary.fuel?.amount || 0)],
      ['Non-Fuel Sales', summary.nonFuel?.count || 0, Number(summary.nonFuel?.amount || 0)],
      ['', '', ''],
      ['Payment Method', 'Count', 'Amount'],
      ...payments.map((p: any) => [p.paymentMethod || p.method, p.count || p._count || 0, Number(p.totalAmount || p.amount || 0)]),
      ['', '', ''],
      ['Shift', 'Cashier', 'Amount'],
      ...shifts.map((s: any) => [s.shiftNumber || s.name || '-', s.cashier?.fullName || s.cashier || '-', Number(s.totalAmount || s.amount || 0)]),
    ];

    downloadCSV(`daily-sales-${reportDate}.csv`, toCSV(headers, rows));
  };

  const printDailySales = () => {
    if (!dailySales) return;
    const summary = dailySales.summary || {};
    const payments = dailySales.paymentMethodBreakdown || [];
    const shifts = dailySales.shiftBreakdown || [];

    let html = `
      <h2>Summary - ${formatDate(reportDate)}</h2>
      <table>
        <tr><th>Category</th><th class="right">Count</th><th class="right">Amount</th></tr>
        <tr><td>Total Sales</td><td class="right">${summary.totalTransactions || 0}</td><td class="right bold">${formatCurrency(Number(summary.totalAmount || 0))}</td></tr>
        <tr><td>Fuel Sales</td><td class="right">${summary.fuel?.count || 0}</td><td class="right">${formatCurrency(Number(summary.fuel?.amount || 0))}</td></tr>
        <tr><td>Non-Fuel Sales</td><td class="right">${summary.nonFuel?.count || 0}</td><td class="right">${formatCurrency(Number(summary.nonFuel?.amount || 0))}</td></tr>
      </table>
      <h2>Payment Breakdown</h2>
      <table>
        <tr><th>Method</th><th class="right">Count</th><th class="right">Amount</th></tr>
        ${payments.map((p: any) => `<tr><td>${p.paymentMethod || p.method || '-'}</td><td class="right">${p.count || p._count || 0}</td><td class="right">${formatCurrency(Number(p.totalAmount || p.amount || 0))}</td></tr>`).join('')}
      </table>
      <h2>Shift Breakdown</h2>
      <table>
        <tr><th>Shift</th><th>Cashier</th><th class="right">Amount</th></tr>
        ${shifts.map((s: any) => `<tr><td>${s.shiftNumber || s.name || '-'}</td><td>${s.cashier?.fullName || s.cashier || '-'}</td><td class="right">${formatCurrency(Number(s.totalAmount || s.amount || 0))}</td></tr>`).join('')}
      </table>`;
    printReport(`Daily Sales Report - ${formatDate(reportDate)}`, html);
  };

  // CSV + Print for Inventory
  const exportInventoryCSV = () => {
    if (!inventory) return;
    const products = inventory.nonFuelProducts || [];
    const headers = ['Product', 'SKU', 'Category', 'Quantity', 'Unit Price', 'Status'];
    const allProducts = [...(products.normal || []), ...(products.lowStock || [])];
    const rows: (string | number)[][] = allProducts.map((p: any) => [
      p.name || '-', p.sku || '-', p.category || '-',
      p.quantity ?? p.stockLevel ?? 0,
      Number(p.unitPrice || 0),
      (p.quantity ?? p.stockLevel ?? 999) <= (p.lowStockThreshold || 10) ? 'LOW STOCK' : 'OK',
    ]);
    downloadCSV(`inventory-${reportDate}.csv`, toCSV(headers, rows));
  };

  const printInventory = () => {
    if (!inventory) return;
    const products = inventory.nonFuelProducts || {};
    const allProducts = [...(products.normal || []), ...(products.lowStock || [])];
    let html = `
      <h2>Inventory Report</h2>
      <table>
        <tr><th>Product</th><th>SKU</th><th>Category</th><th class="right">Qty</th><th class="right">Price</th><th>Status</th></tr>
        ${allProducts.map((p: any) => {
          const qty = p.quantity ?? p.stockLevel ?? 0;
          const low = qty <= (p.lowStockThreshold || 10);
          return `<tr><td>${p.name || '-'}</td><td>${p.sku || '-'}</td><td>${p.category || '-'}</td><td class="right">${qty}</td><td class="right">${formatCurrency(Number(p.unitPrice || 0))}</td><td>${low ? '<b style="color:red">LOW</b>' : 'OK'}</td></tr>`;
        }).join('')}
      </table>`;
    printReport('Inventory Report', html);
  };

  // CSV + Print for Variance
  const exportVarianceCSV = () => {
    if (!variance) return;
    const shifts = variance.shifts || [];
    const headers = ['Shift', 'Nozzle', 'Fuel Type', 'Opening', 'Closing', 'Meter Difference', 'Actual Sales', 'Variance'];
    const rows: (string | number)[][] = [];
    shifts.forEach((s: any) => {
      (s.nozzles || s.meterReadings || []).forEach((n: any) => {
        rows.push([
          s.shiftNumber || s.name || s.shift?.shiftName || formatDate(s.shift?.date || new Date()),
          n.nozzleNumber || n.nozzle?.nozzleNumber || '-',
          n.fuelType || n.nozzle?.fuelType?.name || n.nozzle?.fuelType || '-',
          n.opening ?? n.openingReading?.value ?? 0,
          n.closing ?? n.closingReading?.value ?? 0,
          n.meterDifference ?? n.calculated ?? 0,
          n.actualSales ?? n.actual ?? 0,
          n.variance ?? 0,
        ]);
      });
    });
    downloadCSV(`variance-${startDate}-to-${endDate}.csv`, toCSV(headers, rows));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground">Generate, view, and export reports</p>
      </div>

      {/* Report Selection + Parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Report Parameters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Report Type</Label>
              <Select value={selectedReport} onValueChange={(v) => { setSelectedReport(v as ReportType); setFetchEnabled(false); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily-sales">Daily Sales Summary</SelectItem>
                  <SelectItem value="shift">Shift Report</SelectItem>
                  <SelectItem value="inventory">Inventory Report</SelectItem>
                  <SelectItem value="customer-ledger">Customer Ledger</SelectItem>
                  <SelectItem value="variance">Variance Report</SelectItem>
                  <SelectItem value="fuel-price-history">Fuel Price History</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selectedReport === 'daily-sales' && (
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={reportDate} onChange={(e) => { setReportDate(e.target.value); setFetchEnabled(false); }} />
              </div>
            )}

            {selectedReport === 'shift' && (
              <div className="space-y-2">
                <Label>Shift Instance ID</Label>
                <Input
                  type="text"
                  placeholder="Enter shift instance ID"
                  value={selectedShiftId}
                  onChange={(e) => { setSelectedShiftId(e.target.value); setFetchEnabled(false); }}
                />
              </div>
            )}

            {selectedReport === 'customer-ledger' && (
              <>
                <div className="space-y-2">
                  <Label>Customer</Label>
                  <Select value={selectedCustomerId} onValueChange={(v) => { setSelectedCustomerId(v); setFetchEnabled(false); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {(customersData || []).map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setFetchEnabled(false); }} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setFetchEnabled(false); }} />
                </div>
              </>
            )}

            {(selectedReport === 'variance' || selectedReport === 'fuel-price-history') && (
              <>
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setFetchEnabled(false); }} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setFetchEnabled(false); }} />
                </div>
              </>
            )}

            <div className="flex items-end">
              <Button onClick={handleGenerate} disabled={isLoading} className="w-full">
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                Generate
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report Results */}
      {isLoading && (
        <Card>
          <CardContent className="py-8">
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          </CardContent>
        </Card>
      )}

      {isError && fetchEnabled && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Failed to load report. Make sure you have the correct permissions and try again.
          </CardContent>
        </Card>
      )}

      {/* DAILY SALES REPORT */}
      {selectedReport === 'daily-sales' && dailySales && !isLoading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Daily Sales - {formatDate(reportDate)}</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportDailySalesCSV}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={printDailySales}>
                <Printer className="mr-2 h-4 w-4" /> Print / PDF
              </Button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Total Sales</p>
                <p className="text-2xl font-bold">{formatCurrency(Number(dailySales.summary?.totalAmount || dailySales.totalSales || 0))}</p>
                <p className="text-xs text-muted-foreground">{dailySales.summary?.totalTransactions || 0} transactions</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Fuel Sales</p>
                <p className="text-2xl font-bold">{formatCurrency(Number(dailySales.summary?.fuel?.amount || 0))}</p>
                <p className="text-xs text-muted-foreground">{dailySales.summary?.fuel?.count || 0} transactions</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Non-Fuel Sales</p>
                <p className="text-2xl font-bold">{formatCurrency(Number(dailySales.summary?.nonFuel?.amount || 0))}</p>
                <p className="text-xs text-muted-foreground">{dailySales.summary?.nonFuel?.count || 0} transactions</p>
              </CardContent>
            </Card>
          </div>

          {/* Payment Breakdown */}
          {dailySales.paymentMethodBreakdown?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Payment Method Breakdown</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailySales.paymentMethodBreakdown.map((p: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Badge variant="outline">{p.paymentMethod || p.method || '-'}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{p.count || p._count || 0}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(Number(p.totalAmount || p.amount || 0))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Shift Breakdown */}
          {dailySales.shiftBreakdown?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Shift Breakdown</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shift</TableHead>
                      <TableHead>Cashier</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailySales.shiftBreakdown.map((s: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell>{s.shiftNumber || s.name || '-'}</TableCell>
                        <TableCell>{s.cashier?.fullName || s.cashier || '-'}</TableCell>
                        <TableCell className="text-right">{s.salesCount || s.count || 0}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(Number(s.totalAmount || s.amount || 0))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* SHIFT REPORT */}
      {selectedReport === 'shift' && shiftReport && !isLoading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Shift Report</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                if (!shiftReport) return;
                const headers = ['Metric', 'Value'];
                const rows: (string | number)[][] = [
                  ['Shift', shiftReport.shiftInstance?.shiftName || '-'],
                  ['Date', formatDate(shiftReport.shiftInstance?.date || new Date())],
                  ['Status', shiftReport.shiftInstance?.status || '-'],
                  ['Opened By', shiftReport.shiftInstance?.openedBy?.fullName || '-'],
                  ['Closed By', shiftReport.shiftInstance?.closedBy?.fullName || '-'],
                  ['', ''],
                  ['Total Sales', shiftReport.sales?.totalAmount || 0],
                  ['Fuel Sales', shiftReport.sales?.fuel?.amount || 0],
                  ['Non-Fuel Sales', shiftReport.sales?.nonFuel?.amount || 0],
                ];
                downloadCSV(`shift-report-${shiftReport.shiftInstance?.id || 'unknown'}.csv`, toCSV(headers, rows));
              }}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Shift Information</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">Shift Name</p>
                  <p className="font-medium">{shiftReport.shiftInstance?.shiftName || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-medium">{formatDate(shiftReport.shiftInstance?.date || new Date())}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Opened By</p>
                  <p className="font-medium">{shiftReport.shiftInstance?.openedBy?.fullName || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Closed By</p>
                  <p className="font-medium">{shiftReport.shiftInstance?.closedBy?.fullName || '-'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Total Sales</p>
                <p className="text-2xl font-bold">{formatCurrency(Number(shiftReport.sales?.totalAmount || 0))}</p>
                <p className="text-xs text-muted-foreground">{shiftReport.sales?.totalCount || 0} transactions</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Fuel Sales</p>
                <p className="text-2xl font-bold">{formatCurrency(Number(shiftReport.sales?.fuel?.amount || 0))}</p>
                <p className="text-xs text-muted-foreground">{shiftReport.sales?.fuel?.count || 0} transactions</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Non-Fuel Sales</p>
                <p className="text-2xl font-bold">{formatCurrency(Number(shiftReport.sales?.nonFuel?.amount || 0))}</p>
                <p className="text-xs text-muted-foreground">{shiftReport.sales?.nonFuel?.count || 0} transactions</p>
              </CardContent>
            </Card>
          </div>

          {shiftReport.meterReadings?.variance?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Meter Readings & Variance</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nozzle</TableHead>
                      <TableHead>Fuel Type</TableHead>
                      <TableHead className="text-right">Opening</TableHead>
                      <TableHead className="text-right">Closing</TableHead>
                      <TableHead className="text-right">Difference</TableHead>
                      <TableHead className="text-right">Actual Sales</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shiftReport.meterReadings.variance.map((v: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell>Unit {v.nozzle?.unitNumber} - Nozzle {v.nozzle?.nozzleNumber}</TableCell>
                        <TableCell>{v.nozzle?.fuelType}</TableCell>
                        <TableCell className="text-right">{v.openingReading?.value?.toFixed(2) || '-'}</TableCell>
                        <TableCell className="text-right">{v.closingReading?.value?.toFixed(2) || '-'}</TableCell>
                        <TableCell className="text-right">{v.meterDifference?.toFixed(2) || '-'}</TableCell>
                        <TableCell className="text-right">{v.actualSales?.toFixed(2) || '0.00'}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={Number(v.variance || 0) === 0 ? 'default' : 'destructive'}>
                            {v.variance?.toFixed(2) || '-'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* CUSTOMER LEDGER REPORT */}
      {selectedReport === 'customer-ledger' && customerLedger && !isLoading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Customer Ledger - {customerLedger.customer?.name}</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                if (!customerLedger) return;
                const headers = ['Date', 'Type', 'Details', 'Amount', 'Payment Method'];
                const rows: (string | number)[][] = (customerLedger.transactions || []).map((t: any) => [
                  formatDate(t.date || new Date()),
                  t.type || '-',
                  t.type === 'fuel' ? (t.details?.fuelSales || []).map((fs: any) => `${fs.fuelType}: ${fs.liters}L`).join(', ') : '-',
                  t.amount || 0,
                  t.paymentMethod || '-',
                ]);
                downloadCSV(`customer-ledger-${customerLedger.customer?.name || 'unknown'}-${startDate}-to-${endDate}.csv`, toCSV(headers, rows));
              }}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Customer Information</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-sm text-muted-foreground">Name</p>
                  <p className="font-medium">{customerLedger.customer?.name || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Phone</p>
                  <p className="font-medium">{customerLedger.customer?.phone || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium">{customerLedger.customer?.email || '-'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Total Transactions</p>
                <p className="text-2xl font-bold">{customerLedger.summary?.totalTransactions || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Total Amount</p>
                <p className="text-2xl font-bold">{formatCurrency(Number(customerLedger.summary?.totalAmount || 0))}</p>
              </CardContent>
            </Card>
          </div>

          {customerLedger.transactions?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Transaction History</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerLedger.transactions.map((t: any) => (
                      <TableRow key={t.id}>
                        <TableCell>{formatDate(t.date || new Date())}</TableCell>
                        <TableCell><Badge variant="outline">{t.type}</Badge></TableCell>
                        <TableCell className="max-w-xs truncate">
                          {t.type === 'fuel' && t.details?.fuelSales?.map((fs: any) => (
                            <span key={fs.fuelType}>{fs.fuelType}: {fs.liters}L </span>
                          ))}
                          {t.type === 'non_fuel' && t.details?.items?.map((item: any, i: number) => (
                            <span key={i}>{item.productName} (x{item.quantity}) </span>
                          ))}
                        </TableCell>
                        <TableCell><Badge>{t.paymentMethod}</Badge></TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(Number(t.amount || 0))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* INVENTORY REPORT */}
      {selectedReport === 'inventory' && inventory && !isLoading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Inventory Report</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportInventoryCSV}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={printInventory}>
                <Printer className="mr-2 h-4 w-4" /> Print / PDF
              </Button>
            </div>
          </div>

          {/* Summary */}
          {inventory.summary && (
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Total Products</p>
                  <p className="text-2xl font-bold">{inventory.summary.totalProducts || 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Low Stock Items</p>
                  <p className="text-2xl font-bold text-destructive">{inventory.summary.lowStockCount || 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Total Value</p>
                  <p className="text-2xl font-bold">{formatCurrency(Number(inventory.summary.totalValue || 0))}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Low Stock Alert */}
          {inventory.nonFuelProducts?.lowStock?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base text-destructive">Low Stock Alert</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Current Qty</TableHead>
                      <TableHead className="text-right">Threshold</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.nonFuelProducts.lowStock.map((p: any) => (
                      <TableRow key={p.id || p.sku}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell>{p.sku}</TableCell>
                        <TableCell className="text-right text-destructive font-bold">{p.quantity ?? p.stockLevel ?? 0}</TableCell>
                        <TableCell className="text-right">{p.lowStockThreshold || 10}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* All Products */}
          <Card>
            <CardHeader><CardTitle className="text-base">All Products</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...(inventory.nonFuelProducts?.normal || []), ...(inventory.nonFuelProducts?.lowStock || [])].map((p: any) => (
                    <TableRow key={p.id || p.sku}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.sku}</TableCell>
                      <TableCell>{p.category || '-'}</TableCell>
                      <TableCell className="text-right">{p.quantity ?? p.stockLevel ?? 0}</TableCell>
                      <TableCell className="text-right">{formatCurrency(Number(p.unitPrice || 0))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* VARIANCE REPORT */}
      {selectedReport === 'variance' && variance && !isLoading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Variance Report ({formatDate(startDate)} - {formatDate(endDate)})</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportVarianceCSV}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                if (!variance) return;
                const shifts = variance.shifts || [];
                let html = '<h2>Meter Reading Variance</h2><table><tr><th>Shift</th><th>Nozzle</th><th>Fuel</th><th class="right">Opening</th><th class="right">Closing</th><th class="right">Meter Diff</th><th class="right">Actual Sales</th><th class="right">Variance</th></tr>';
                shifts.forEach((s: any) => {
                  (s.nozzles || []).forEach((n: any) => {
                    html += `<tr><td>${formatDate(s.shift?.date || new Date())}</td><td>Unit ${n.nozzle?.unitNumber} - #${n.nozzle?.nozzleNumber}</td><td>${n.nozzle?.fuelType || '-'}</td><td class="right">${Number(n.opening || 0).toFixed(2)}</td><td class="right">${Number(n.closing || 0).toFixed(2)}</td><td class="right">${Number(n.meterDifference || 0).toFixed(2)}</td><td class="right">${Number(n.actualSales || 0).toFixed(2)}</td><td class="right">${Number(n.variance || 0).toFixed(2)}</td></tr>`;
                  });
                });
                html += '</table>';
                printReport(`Variance Report - ${formatDate(startDate)} to ${formatDate(endDate)}`, html);
              }}>
                <Printer className="mr-2 h-4 w-4" /> Print / PDF
              </Button>
            </div>
          </div>

          {variance.shifts?.length > 0 ? (
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shift</TableHead>
                      <TableHead>Nozzle</TableHead>
                      <TableHead>Fuel Type</TableHead>
                      <TableHead className="text-right">Opening</TableHead>
                      <TableHead className="text-right">Closing</TableHead>
                      <TableHead className="text-right">Meter Diff</TableHead>
                      <TableHead className="text-right">Actual Sales</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variance.shifts.map((s: any, si: number) =>
                      (s.nozzles || s.meterReadings || []).map((n: any, ni: number) => (
                        <TableRow key={`${si}-${ni}`}>
                          <TableCell>{formatDate(s.shift?.date || new Date())}</TableCell>
                          <TableCell>Unit {n.nozzle?.unitNumber} - #{n.nozzle?.nozzleNumber}</TableCell>
                          <TableCell>{n.nozzle?.fuelType || '-'}</TableCell>
                          <TableCell className="text-right">{Number(n.opening || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right">{Number(n.closing || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right">{Number(n.meterDifference || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right">{Number(n.actualSales || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={Math.abs(Number(n.variance || 0)) < 0.5 ? 'default' : 'destructive'}>
                              {Number(n.variance || 0).toFixed(2)} L
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No variance data found for the selected date range.
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* FUEL PRICE HISTORY REPORT */}
      {selectedReport === 'fuel-price-history' && fetchEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>Fuel Price History</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Fuel price history report showing all price changes from {formatDate(startDate)} to {formatDate(endDate)}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              <strong>Coming Soon:</strong> This report will show Date, Product (PMG/HSD), Old Price, New Price, Changed By
            </p>
          </CardContent>
        </Card>
      )}

      {/* No report generated yet */}
      {!fetchEnabled && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p>Select a report type and click Generate</p>
            <p className="text-xs mt-1">Reports include CSV download and Print/PDF options</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
