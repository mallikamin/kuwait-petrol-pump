# Reports Module - Detailed Fix Guide
**Kuwait Petrol Pump POS | 2026-04-02**

This document provides **exact code changes** needed to fix all identified issues in the Reports module.

---

## Priority 0 Fixes (CRITICAL - Must Do Before Deployment)

### Fix 1: Variance Report Calculation (CRITICAL BUG)

**File**: `apps/backend/src/modules/reports/reports.service.ts`

**Current Code** (Lines 422-433):
```typescript
const nozzleVariances = Object.values(shift.nozzles).map((nozzle) => ({
  ...nozzle,
  variance:
    nozzle.opening !== null && nozzle.closing !== null
      ? nozzle.closing - nozzle.opening  // ❌ WRONG! This is just meter difference
      : null,
}));
```

**Problem**: Variance should be `(closing - opening) - actual sales`, not just `closing - opening`.

**Fixed Code**:
```typescript
// Step 1: Get actual fuel sales for this shift
const fuelSalesForShift = await prisma.fuelSale.findMany({
  where: {
    sale: {
      shiftInstanceId: shift.shiftInstance.id,
    },
  },
  select: {
    nozzleId: true,
    quantityLiters: true,
  },
});

// Step 2: Aggregate sales by nozzle
const salesByNozzle: Record<string, number> = {};
fuelSalesForShift.forEach((fs) => {
  if (!salesByNozzle[fs.nozzleId]) {
    salesByNozzle[fs.nozzleId] = 0;
  }
  salesByNozzle[fs.nozzleId] += fs.quantityLiters.toNumber();
});

// Step 3: Calculate variance with actual sales comparison
const nozzleVariances = Object.values(shift.nozzles).map((nozzle) => {
  const opening = nozzle.opening;
  const closing = nozzle.closing;
  const expected = opening !== null && closing !== null ? closing - opening : null;
  const actual = salesByNozzle[nozzle.nozzle.id] || 0;
  const variance = expected !== null ? expected - actual : null;
  const variancePercent = expected !== null && expected !== 0
    ? ((variance! / expected) * 100).toFixed(2)
    : null;

  return {
    ...nozzle,
    expected,  // Add expected column
    actual,    // Add actual sales column
    variance,  // Now correctly calculated
    variancePercent: variancePercent ? parseFloat(variancePercent) : null,
    severity: variance !== null
      ? Math.abs(variance) < expected! * 0.01 ? 'low'      // <1% = green
        : Math.abs(variance) < expected! * 0.03 ? 'medium' // 1-3% = amber
        : 'high'                                           // >3% = red
      : null,
  };
});
```

**Update Return Type**:
```typescript
return {
  ...nozzle,
  expected: number | null,    // Meter difference (closing - opening)
  actual: number | null,      // Actual fuel sales from fuelSales table
  variance: number | null,    // expected - actual
  variancePercent: number | null,  // (variance / expected) * 100
  severity: 'low' | 'medium' | 'high' | null,
};
```

**UI Update** (`apps/web/src/pages/Reports.tsx`):

Add new columns to Variance Report table:
```tsx
<TableHeader>
  <TableRow>
    <TableHead>Shift</TableHead>
    <TableHead>Nozzle</TableHead>
    <TableHead>Fuel Type</TableHead>
    <TableHead className="text-right">Opening</TableHead>
    <TableHead className="text-right">Closing</TableHead>
    <TableHead className="text-right">Expected (Δ)</TableHead>  {/* NEW */}
    <TableHead className="text-right">Actual Sales</TableHead> {/* NEW */}
    <TableHead className="text-right">Variance</TableHead>
    <TableHead className="text-right">%</TableHead>            {/* NEW */}
  </TableRow>
</TableHeader>
<TableBody>
  {variance.shifts.map((s: any, si: number) =>
    (s.nozzles || []).map((n: any, ni: number) => (
      <TableRow key={`${si}-${ni}`}>
        <TableCell>{s.shift?.shiftName || '-'}</TableCell>
        <TableCell>{n.nozzle?.nozzleNumber || '-'}</TableCell>
        <TableCell>{n.nozzle?.fuelType || '-'}</TableCell>
        <TableCell className="text-right">{n.opening?.toFixed(2) || '-'}</TableCell>
        <TableCell className="text-right">{n.closing?.toFixed(2) || '-'}</TableCell>
        <TableCell className="text-right font-medium">{n.expected?.toFixed(2) || '-'}</TableCell>
        <TableCell className="text-right">{n.actual?.toFixed(2) || '-'}</TableCell>
        <TableCell className="text-right">
          <Badge variant={
            n.severity === 'low' ? 'default' :
            n.severity === 'medium' ? 'secondary' :
            'destructive'
          }>
            {n.variance?.toFixed(2) || '-'} L
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          <span className={
            n.severity === 'high' ? 'text-red-600 font-bold' :
            n.severity === 'medium' ? 'text-yellow-600' :
            'text-green-600'
          }>
            {n.variancePercent ? `${n.variancePercent}%` : '-'}
          </span>
        </TableCell>
      </TableRow>
    ))
  )}
</TableBody>
```

---

### Fix 2: CSV Currency Formatting

**File**: `apps/web/src/utils/format.ts`

**Add New Function**:
```typescript
/**
 * Format currency for CSV export (raw number, no prefix, no thousand separator)
 */
export const formatCurrencyForCSV = (amount: number): string => {
  return amount.toFixed(2);  // Just "3211.70", no "Rs", no commas
};

/**
 * Format date for CSV export (ISO 8601 sortable format)
 */
export const formatDateForCSV = (date: string | Date): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];  // "2026-04-02"
};

/**
 * Format liters with unit
 */
export const formatLiters = (liters: number): string => {
  return `${liters.toFixed(2)} L`;
};

/**
 * Format percentage
 */
export const formatPercentage = (value: number): string => {
  return `${(value * 100).toFixed(1)}%`;
};
```

**Update CSV Exports** (`apps/web/src/pages/Reports.tsx`):

**Before**:
```typescript
const rows: string[][] = [
  ['Total Sales', String(summary.totalTransactions || 0), formatCurrency(Number(summary.totalAmount || 0))],  // ❌ Has "Rs"
];
```

**After**:
```typescript
import { formatCurrencyForCSV, formatDateForCSV } from '@/utils/format';

const rows: string[][] = [
  ['Total Sales', String(summary.totalTransactions || 0), formatCurrencyForCSV(Number(summary.totalAmount || 0))],  // ✅ Just number
];
```

**Add UTF-8 BOM and Metadata**:
```typescript
function downloadCSV(filename: string, csvContent: string, metadata?: Record<string, string>) {
  // Add UTF-8 BOM for proper encoding in Excel
  const BOM = '\uFEFF';

  // Add metadata rows at top
  let finalContent = BOM;
  if (metadata) {
    Object.entries(metadata).forEach(([key, value]) => {
      finalContent += `"${key}:","${value}"\n`;
    });
    finalContent += '\n';  // Blank line after metadata
  }
  finalContent += csvContent;

  const blob = new Blob([finalContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Usage
const exportDailySalesCSV = () => {
  if (!dailySales) return;

  const metadata = {
    'Report': 'Daily Sales Summary',
    'Date': formatDateForCSV(reportDate),
    'Branch': dailySales.branch?.name || 'All Branches',
    'Generated': new Date().toISOString(),
  };

  const headers = ['Category', 'Count', 'Amount'];
  const rows: string[][] = [
    ['Total Sales', String(summary.totalTransactions || 0), formatCurrencyForCSV(Number(summary.totalAmount || 0))],
    ['Fuel Sales', String(summary.fuel?.count || 0), formatCurrencyForCSV(Number(summary.fuel?.amount || 0))],
    // ...
  ];

  downloadCSV(`daily-sales-${reportDate}.csv`, toCSV(headers, rows), metadata);
};
```

---

### Fix 3: Add Shift Report to UI

**File**: `apps/web/src/pages/Reports.tsx`

**Step 1: Add to Report Type Selector**:
```tsx
<Select value={selectedReport} onValueChange={(v) => { setSelectedReport(v as ReportType); setFetchEnabled(false); }}>
  <SelectTrigger>
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="daily-sales">Daily Sales Summary</SelectItem>
    <SelectItem value="shift">Shift Report</SelectItem>  {/* NEW */}
    <SelectItem value="inventory">Inventory Report</SelectItem>
    <SelectItem value="variance">Variance Report</SelectItem>
  </SelectContent>
</Select>
```

**Step 2: Add Shift Instance Selector**:
```tsx
// Add state
const [selectedShiftId, setSelectedShiftId] = useState<string>('');

// Fetch available shifts
const { data: shifts } = useQuery({
  queryKey: ['shifts', branchId],
  queryFn: async () => {
    const response = await apiClient.get('/api/shifts/instances', {
      params: { branchId, limit: 50, status: 'closed' }
    });
    return response.data.items || [];
  },
  enabled: selectedReport === 'shift' && !!branchId,
});

// Add selector in UI
{selectedReport === 'shift' && (
  <div className="space-y-2">
    <Label>Shift Instance</Label>
    <Select value={selectedShiftId} onValueChange={(v) => { setSelectedShiftId(v); setFetchEnabled(false); }}>
      <SelectTrigger>
        <SelectValue placeholder="Select a shift" />
      </SelectTrigger>
      <SelectContent>
        {shifts?.map((shift: any) => (
          <SelectItem key={shift.id} value={shift.id}>
            {shift.shift?.name || 'Shift'} - {formatDate(shift.date)} ({shift.status})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
)}
```

**Step 3: Add Query**:
```tsx
const { data: shiftReport, isLoading: loadingShift, isError: errorShift } = useQuery({
  queryKey: ['report-shift', selectedShiftId],
  queryFn: () => reportsApi.getShiftReport(selectedShiftId),
  enabled: fetchEnabled && selectedReport === 'shift' && !!selectedShiftId,
});
```

**Step 4: Add UI Rendering**:
```tsx
{/* SHIFT REPORT */}
{selectedReport === 'shift' && shiftReport && !isLoading && (
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <h2 className="text-xl font-semibold">
        Shift Report - {shiftReport.shiftInstance?.shiftName} ({formatDate(shiftReport.shiftInstance?.date)})
      </h2>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={exportShiftCSV}>
          <Download className="mr-2 h-4 w-4" /> CSV
        </Button>
        <Button variant="outline" size="sm" onClick={printShift}>
          <Printer className="mr-2 h-4 w-4" /> Print / PDF
        </Button>
      </div>
    </div>

    {/* Shift Metadata */}
    <Card>
      <CardHeader><CardTitle className="text-base">Shift Details</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Opened By</p>
            <p className="font-medium">{shiftReport.shiftInstance?.openedBy?.fullName || '-'}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(shiftReport.shiftInstance?.openedAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Closed By</p>
            <p className="font-medium">{shiftReport.shiftInstance?.closedBy?.fullName || '-'}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(shiftReport.shiftInstance?.closedAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total Sales</p>
            <p className="font-medium text-lg">{formatCurrency(shiftReport.sales?.totalAmount || 0)}</p>
            <p className="text-xs text-muted-foreground">{shiftReport.sales?.totalCount || 0} transactions</p>
          </div>
          <div>
            <p className="text-muted-foreground">Status</p>
            <Badge variant={shiftReport.shiftInstance?.status === 'closed' ? 'default' : 'secondary'}>
              {shiftReport.shiftInstance?.status}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>

    {/* Sales Summary */}
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Fuel Sales</p>
          <p className="text-2xl font-bold">{formatCurrency(shiftReport.sales?.fuel?.amount || 0)}</p>
          <p className="text-xs text-muted-foreground">{shiftReport.sales?.fuel?.count || 0} transactions</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Non-Fuel Sales</p>
          <p className="text-2xl font-bold">{formatCurrency(shiftReport.sales?.nonFuel?.amount || 0)}</p>
          <p className="text-xs text-muted-foreground">{shiftReport.sales?.nonFuel?.count || 0} transactions</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Meter Readings</p>
          <p className="text-2xl font-bold">{shiftReport.meterReadings?.count || 0}</p>
          <p className="text-xs text-muted-foreground">recorded</p>
        </CardContent>
      </Card>
    </div>

    {/* Meter Variance Table */}
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
              <TableHead className="text-right">Variance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shiftReport.meterReadings?.variance?.map((v: any, i: number) => (
              <TableRow key={i}>
                <TableCell>Unit {v.nozzle?.unitNumber} - Nozzle {v.nozzle?.nozzleNumber}</TableCell>
                <TableCell>{v.nozzle?.fuelType}</TableCell>
                <TableCell className="text-right">{v.openingReading?.value?.toFixed(2) || '-'}</TableCell>
                <TableCell className="text-right">{v.closingReading?.value?.toFixed(2) || '-'}</TableCell>
                <TableCell className="text-right">
                  <Badge variant={v.variance === null ? 'secondary' : v.variance === 0 ? 'default' : 'destructive'}>
                    {v.variance !== null ? `${v.variance.toFixed(2)} L` : 'Incomplete'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    {/* Payment Breakdown */}
    {shiftReport.sales?.paymentBreakdown && Object.keys(shiftReport.sales.paymentBreakdown).length > 0 && (
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
              {Object.entries(shiftReport.sales.paymentBreakdown).map(([method, data]: [string, any]) => (
                <TableRow key={method}>
                  <TableCell><Badge variant="outline">{method}</Badge></TableCell>
                  <TableCell className="text-right">{data.count}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(data.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    )}
  </div>
)}
```

---

### Fix 4: Add Customer Ledger to UI

**Similar to Shift Report**, add:
1. `customer-ledger` to report type dropdown
2. Customer selector (autocomplete search)
3. Query for customer ledger data
4. UI table with transaction history
5. CSV + Print export

**File**: `apps/web/src/pages/Reports.tsx`

```tsx
// Add to report type enum
type ReportType = 'daily-sales' | 'shift' | 'inventory' | 'variance' | 'customer-ledger';

// Add state
const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');

// Add customer search
const { data: customers } = useQuery({
  queryKey: ['customers', branchId],
  queryFn: async () => {
    const response = await apiClient.get('/api/customers', {
      params: { limit: 100, isActive: true }
    });
    return response.data.items || [];
  },
  enabled: selectedReport === 'customer-ledger',
});

// Add selector
{selectedReport === 'customer-ledger' && (
  <>
    <div className="space-y-2">
      <Label>Customer</Label>
      <Select value={selectedCustomerId} onValueChange={(v) => { setSelectedCustomerId(v); setFetchEnabled(false); }}>
        <SelectTrigger>
          <SelectValue placeholder="Select a customer" />
        </SelectTrigger>
        <SelectContent>
          {customers?.map((customer: any) => (
            <SelectItem key={customer.id} value={customer.id}>
              {customer.name} ({customer.phone || customer.email})
            </SelectItem>
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

// Add query
const { data: customerLedger, isLoading: loadingLedger, isError: errorLedger } = useQuery({
  queryKey: ['report-customer-ledger', selectedCustomerId, startDate, endDate],
  queryFn: () => reportsApi.getCustomerLedger(selectedCustomerId, new Date(startDate).toISOString(), new Date(endDate).toISOString()),
  enabled: fetchEnabled && selectedReport === 'customer-ledger' && !!selectedCustomerId,
});

// Add UI rendering (transaction table with running balance)
{selectedReport === 'customer-ledger' && customerLedger && !isLoading && (
  <div className="space-y-4">
    {/* Customer Info Card */}
    <Card>
      <CardContent className="pt-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Customer Name</p>
            <p className="font-medium">{customerLedger.customer?.name}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Phone</p>
            <p className="font-medium">{customerLedger.customer?.phone || '-'}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total Transactions</p>
            <p className="font-medium">{customerLedger.summary?.totalTransactions || 0}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total Amount</p>
            <p className="font-medium text-lg">{formatCurrency(customerLedger.summary?.totalAmount || 0)}</p>
          </div>
        </div>
      </CardContent>
    </Card>

    {/* Transaction History Table */}
    <Card>
      <CardHeader><CardTitle className="text-base">Transaction History</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Payment Method</TableHead>
              <TableHead>Cashier</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customerLedger.transactions?.map((txn: any) => (
              <TableRow key={txn.id}>
                <TableCell>{formatDate(txn.date)}</TableCell>
                <TableCell>
                  <Badge variant={txn.type === 'fuel' ? 'default' : 'secondary'}>
                    {txn.type}
                  </Badge>
                </TableCell>
                <TableCell>{txn.paymentMethod}</TableCell>
                <TableCell>{txn.cashier?.fullName || '-'}</TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(txn.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
)}
```

---

## Priority 1 Fixes (High Impact)

### Fix 5: Add Fuel Type Breakdown to Daily Sales UI

**File**: `apps/web/src/pages/Reports.tsx`

**Current**: Shows total fuel amount only

**Desired**: Show PMG, HSD, etc. separately

```tsx
{/* Add Fuel Type Cards */}
{dailySales.summary?.fuel?.byType && Object.keys(dailySales.summary.fuel.byType).length > 0 && (
  <Card>
    <CardHeader><CardTitle className="text-base">Fuel Sales by Type</CardTitle></CardHeader>
    <CardContent>
      <div className="grid gap-4 md:grid-cols-3">
        {Object.entries(dailySales.summary.fuel.byType).map(([fuelType, data]: [string, any]) => (
          <div key={fuelType} className="border rounded-lg p-4">
            <p className="text-sm font-medium text-muted-foreground">{fuelType}</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(data.amount || 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">{formatLiters(data.liters || 0)}</p>
          </div>
        ))}
      </div>
    </CardContent>
  </Card>
)}
```

---

### Fix 6: Improve Print Layout

**File**: `apps/web/src/pages/Reports.tsx`

**Update `printReport` function**:

```typescript
function printReport(title: string, contentHtml: string, metadata?: { branch?: string; date?: string; user?: string }) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;

  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 12pt;  /* Increased from 12px */
      padding: 0.5in;
      line-height: 1.4;
    }

    /* Company Header */
    .report-header {
      border-bottom: 3px solid #000;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }

    .report-header h1 {
      font-size: 22pt;
      font-weight: bold;
      margin-bottom: 4px;
    }

    .report-header .subtitle {
      font-size: 14pt;
      color: #666;
      margin-bottom: 8px;
    }

    .report-header .meta {
      font-size: 10pt;
      color: #666;
    }

    /* Content */
    h2 {
      font-size: 14pt;
      margin-top: 20px;
      margin-bottom: 12px;
      border-bottom: 1px solid #ddd;
      padding-bottom: 4px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      page-break-inside: avoid;  /* Prevent table splits */
    }

    th, td {
      border: 1px solid #ddd;
      padding: 8px 10px;
      text-align: left;
      font-size: 11pt;
    }

    th {
      background: #f5f5f5;
      font-weight: bold;
      border-bottom: 2px solid #999;
    }

    /* Prevent row breaks across pages */
    tr {
      page-break-inside: avoid;
    }

    /* Right-align numbers */
    .right { text-align: right; }

    /* Bold totals */
    .bold, .total-row td {
      font-weight: bold;
      background: #fafafa;
    }

    /* Footer on every page */
    .report-footer {
      position: fixed;
      bottom: 0.5in;
      left: 0.5in;
      right: 0.5in;
      border-top: 1px solid #ddd;
      padding-top: 8px;
      font-size: 9pt;
      color: #666;
      display: flex;
      justify-content: space-between;
    }

    /* Print-specific styles */
    @media print {
      body {
        padding: 0;
        margin: 0.5in;
      }

      .report-footer {
        position: fixed;
        bottom: 0;
      }

      /* Page numbers */
      @page {
        margin: 1in 0.75in;

        @bottom-right {
          content: "Page " counter(page) " of " counter(pages);
          font-size: 9pt;
          color: #666;
        }
      }

      /* Avoid page breaks */
      h2, .report-header { page-break-after: avoid; }
      table { page-break-inside: avoid; }
    }

    /* Landscape mode for wide tables */
    @media print and (orientation: landscape) {
      @page { size: A4 landscape; }
    }
  </style>
</head>
<body>
  <!-- Company Header -->
  <div class="report-header">
    <h1>Kuwait Petrol Pump POS</h1>
    <div class="subtitle">${title}</div>
    <div class="meta">
      ${metadata?.branch ? `Branch: ${metadata.branch} | ` : ''}
      ${metadata?.date ? `Date: ${metadata.date} | ` : ''}
      Generated: ${new Date().toLocaleString('en-PK')} by ${metadata?.user || 'System'}
    </div>
  </div>

  <!-- Report Content -->
  ${contentHtml}

  <!-- Footer -->
  <div class="report-footer">
    <span>Kuwait Petrol Pump POS - Confidential</span>
    <span>Currency: Pakistani Rupees (PKR)</span>
  </div>

  <script>
    window.onload = function() {
      window.print();
      // Auto-close after print dialog (optional)
      // window.onafterprint = function() { window.close(); };
    };
  </script>
</body>
</html>`);

  win.document.close();
}

// Usage
const printDailySales = () => {
  if (!dailySales) return;

  let html = `...`;  // Same content generation

  printReport(
    `Daily Sales Report - ${formatDate(reportDate)}`,
    html,
    {
      branch: dailySales.branch?.name || 'All Branches',
      date: formatDate(reportDate),
      user: user?.full_name || user?.fullName || 'Manager',
    }
  );
};
```

---

### Fix 7: Add Tax and Discount to Daily Sales

**File**: `apps/backend/src/modules/reports/reports.service.ts`

**Update aggregation logic**:

```typescript
// Line 54: Add tax and discount tracking
let totalFuelAmount = 0;
let totalNonFuelAmount = 0;
let totalTaxAmount = 0;      // NEW
let totalDiscountAmount = 0; // NEW

// Inside loop (line 60-98):
for (const sale of sales) {
  const amount = sale.totalAmount.toNumber();
  totalTaxAmount += sale.taxAmount.toNumber();           // NEW
  totalDiscountAmount += sale.discountAmount.toNumber(); // NEW

  // ... rest of logic
}

// Update return object (line 100-120):
return {
  date,
  branch: { id: branch.id, name: branch.name },
  totalSales: sales.length,
  summary: {
    totalAmount: totalFuelAmount + totalNonFuelAmount,
    totalTax: totalTaxAmount,          // NEW
    totalDiscount: totalDiscountAmount, // NEW
    netAmount: (totalFuelAmount + totalNonFuelAmount) - totalDiscountAmount, // NEW
    fuel: {
      amount: totalFuelAmount,
      byType: fuelByType,
    },
    nonFuel: {
      amount: totalNonFuelAmount,
      count: sales.filter(s => s.saleType === 'non_fuel').length,
    },
  },
  paymentMethodBreakdown: paymentBreakdown,
  shiftBreakdown: Object.keys(shiftBreakdown).length > 0 ? shiftBreakdown : null,
};
```

**Update Frontend**:

```tsx
{/* Add Tax/Discount Cards */}
<div className="grid gap-4 md:grid-cols-4">
  {/* ... existing cards ... */}
  <Card>
    <CardContent className="pt-6">
      <p className="text-sm text-muted-foreground">Total Tax</p>
      <p className="text-xl font-bold">{formatCurrency(dailySales.summary?.totalTax || 0)}</p>
    </CardContent>
  </Card>
  <Card>
    <CardContent className="pt-6">
      <p className="text-sm text-muted-foreground">Total Discounts</p>
      <p className="text-xl font-bold text-red-600">{formatCurrency(dailySales.summary?.totalDiscount || 0)}</p>
    </CardContent>
  </Card>
</div>
```

---

## Testing Checklist

After implementing fixes, test each item:

### Daily Sales Report
- [ ] Generate for today's date
- [ ] Verify fuel breakdown shows PMG, HSD separately
- [ ] Verify payment method totals add up to total amount
- [ ] Download CSV, open in Excel, verify numbers are raw (no "Rs")
- [ ] Print report, verify company header, page numbers, footer
- [ ] Test empty state (date with no sales)

### Variance Report
- [ ] Generate for last 7 days
- [ ] Verify "Expected" = Closing - Opening
- [ ] Verify "Actual" matches fuel sales from Sales tab
- [ ] Verify "Variance" = Expected - Actual
- [ ] Verify percentage calculation correct
- [ ] Verify severity badges (green < 1%, amber 1-3%, red > 3%)

### Shift Report
- [ ] Select a closed shift from dropdown
- [ ] Verify shift metadata shows (opened by, closed by, times)
- [ ] Verify sales summary matches shift sales
- [ ] Verify meter readings table shows all nozzles
- [ ] Download CSV and print

### Inventory Report
- [ ] Generate report
- [ ] Verify low stock items flagged correctly
- [ ] Verify total value calculated (if added)
- [ ] Download CSV

### Customer Ledger
- [ ] Select a customer with credit sales
- [ ] Select date range covering their transactions
- [ ] Verify all transactions listed
- [ ] Verify total amount correct
- [ ] Download CSV

---

## Deployment Steps

1. **Apply backend fixes**:
   ```bash
   cd apps/backend
   # Edit reports.service.ts with variance fix, tax/discount aggregation
   npm run build
   ```

2. **Apply frontend fixes**:
   ```bash
   cd apps/web
   # Edit Reports.tsx, format.ts
   npm run build
   ```

3. **Test locally** (if dev environment available):
   ```bash
   npm run dev  # Test all reports
   ```

4. **Deploy to server**:
   ```bash
   # From project root
   ssh root@64.226.65.80 "cd ~/kuwait-pos && git pull && docker compose -f docker-compose.prod.yml up -d --build backend web"
   ```

5. **Verify on production**:
   - Visit https://kuwaitpos.duckdns.org
   - Login as manager/admin
   - Test each report type
   - Download CSV files
   - Test print layouts

6. **Create test data** (if needed):
   ```bash
   ssh root@64.226.65.80 "docker compose -f docker-compose.prod.yml exec backend npm run seed:reports-test"
   ```

---

**End of Detailed Fix Guide**

All fixes can be implemented incrementally. Priority 0 fixes are critical and should be done first (estimated 6-8 hours total).
