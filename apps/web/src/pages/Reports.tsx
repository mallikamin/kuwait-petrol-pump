import { useEffect, useState } from 'react';
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
import { reportsApi, apiClient, productsApi } from '@/api';
import { useAuthStore } from '@/store/auth';
import { formatCurrency } from '@/utils/format';

type ReportType =
  | 'daily-sales'
  | 'shift'
  | 'inventory'
  | 'customer-ledger'
  | 'variance'
  | 'fuel-price-history'
  | 'customer-wise-sales'
  | 'vehicle-wise-report'
  | 'product-wise-summary';
const WALK_IN_LEDGER_ID = '__walkin__';

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

function printReport(
  title: string,
  contentHtml: string,
  options?: {
    branchName?: string;
    subtitle?: string;
    periodText?: string;
  }
) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  const branchName = options?.branchName || 'Sundar Industrial Petrol Pump - Main Branch, Lahore';
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
      .brand { font-size: 16px; font-weight: 700; margin-bottom: 2px; text-align: center; }
      .subtitle { font-size: 13px; text-align: center; margin-bottom: 2px; }
      .period { font-size: 12px; text-align: center; margin-bottom: 10px; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <div class="brand">${branchName}</div>
    ${options?.subtitle ? `<div class="subtitle">${options.subtitle}</div>` : ''}
    ${options?.periodText ? `<div class="period">${options.periodText}</div>` : ''}
    <h1>${title}</h1>
    <p class="meta">Generated: ${new Date().toLocaleString('en-PK')} | Petrol Pump POS</p>
    ${contentHtml}
    <script>window.onload = function() { window.print(); }<\/script>
  </body></html>`);
  win.document.close();
}

function normalizeFuelItemLabel(fuelType: string): string {
  const t = (fuelType || '').toLowerCase();
  if (t.includes('hsd') || t.includes('diesel')) return 'DIESEL';
  if (t.includes('pmg') || t.includes('petrol') || t.includes('gasoline')) return 'PETROL';
  return (fuelType || 'FUEL').toUpperCase();
}

function formatDateForHeader(date: string): string {
  const d = new Date(date);
  const day = d.getDate().toString().padStart(2, '0');
  const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

function formatMonthYearForHeader(date: string): string {
  const d = new Date(date);
  const month = d.toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
  const year = d.getFullYear();
  return `${month}-${year}`;
}

type FilterMode = 'no-filter' | 'single-date' | 'date-range';

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

  // Filter mode state for each report
  const [dailySalesFilterMode, setDailySalesFilterMode] = useState<FilterMode>('single-date');
  const [varianceFilterMode, setVarianceFilterMode] = useState<FilterMode>('date-range');
  const [customerLedgerFilterMode, setCustomerLedgerFilterMode] = useState<FilterMode>('date-range');
  const [fuelPriceFilterMode, setFuelPriceFilterMode] = useState<FilterMode>('date-range');
  const [customerWiseSalesFilterMode, setCustomerWiseSalesFilterMode] = useState<FilterMode>('date-range');
  const [productWiseFilterMode, setProductWiseFilterMode] = useState<FilterMode>('date-range');
  const [productWiseType, setProductWiseType] = useState<'all' | 'fuel' | 'non_fuel'>('all');
  const [selectedNonFuelProductId, setSelectedNonFuelProductId] = useState<string>('ALL');
  const [vehicleWiseFilterMode, setVehicleWiseFilterMode] = useState<FilterMode>('date-range');
  const [selectedVehicleNumber, setSelectedVehicleNumber] = useState<string>('ALL');
  const [vehicleSearch, setVehicleSearch] = useState<string>('');
  const [inventoryFilterMode, setInventoryFilterMode] = useState<FilterMode>('date-range');

  // Daily Sales (supports no-filter, single date, and date range)
  const { data: dailySales, isLoading: loadingDaily, isError: errorDaily } = useQuery({
    queryKey: ['report-daily-sales', branchId, dailySalesFilterMode, reportDate, startDate, endDate],
    queryFn: () => {
      if (dailySalesFilterMode === 'date-range') {
        return reportsApi.getDailySales(branchId, undefined, startDate, endDate);
      } else if (dailySalesFilterMode === 'single-date') {
        return reportsApi.getDailySales(branchId, reportDate);
      } else {
        // no-filter mode
        return reportsApi.getDailySales(branchId);
      }
    },
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
    queryKey: ['report-inventory', branchId, inventoryFilterMode, reportDate, startDate, endDate],
    queryFn: () => {
      if (inventoryFilterMode === 'date-range') {
        return reportsApi.getInventoryReport(
          branchId,
          undefined,
          startDate ? new Date(startDate).toISOString() : undefined,
          endDate ? new Date(endDate).toISOString() : undefined
        );
      } else if (inventoryFilterMode === 'single-date') {
        return reportsApi.getInventoryReport(
          branchId,
          new Date(reportDate).toISOString(),
          undefined,
          undefined
        );
      } else {
        // no-filter mode
        return reportsApi.getInventoryReport(branchId);
      }
    },
    enabled: fetchEnabled && selectedReport === 'inventory' && !!branchId,
  });

  // Customer Ledger
  const { data: customerLedger, isLoading: loadingLedger, isError: errorLedger } = useQuery({
    queryKey: ['report-customer-ledger', selectedCustomerId, customerLedgerFilterMode, reportDate, startDate, endDate],
    queryFn: () => {
      if (customerLedgerFilterMode === 'date-range') {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return reportsApi.getCustomerLedger(selectedCustomerId, undefined, start.toISOString(), end.toISOString());
      } else if (customerLedgerFilterMode === 'single-date') {
        const d = new Date(reportDate);
        d.setHours(23, 59, 59, 999);
        return reportsApi.getCustomerLedger(selectedCustomerId, reportDate, undefined, d.toISOString());
      } else {
        // no-filter mode
        return reportsApi.getCustomerLedger(selectedCustomerId);
      }
    },
    enabled: fetchEnabled && selectedReport === 'customer-ledger' && !!selectedCustomerId,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  // Variance
  const { data: variance, isLoading: loadingVariance, isError: errorVariance } = useQuery({
    queryKey: ['report-variance', branchId, varianceFilterMode, reportDate, startDate, endDate],
    queryFn: () => {
      if (varianceFilterMode === 'date-range') {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return reportsApi.getVarianceReport(branchId, undefined, start.toISOString(), end.toISOString());
      } else if (varianceFilterMode === 'single-date') {
        const d = new Date(reportDate);
        d.setHours(23, 59, 59, 999);
        return reportsApi.getVarianceReport(branchId, reportDate, undefined, d.toISOString());
      } else {
        // no-filter mode
        return reportsApi.getVarianceReport(branchId);
      }
    },
    enabled: fetchEnabled && selectedReport === 'variance' && !!branchId,
  });

  // Fuel Price History
  const { data: fuelPriceHistory, isLoading: loadingFuelPrice, isError: errorFuelPrice } = useQuery({
    queryKey: ['report-fuel-price-history', fuelPriceFilterMode, reportDate, startDate, endDate],
    queryFn: () => {
      if (fuelPriceFilterMode === 'date-range') {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return reportsApi.getFuelPriceHistory(undefined, start.toISOString(), end.toISOString());
      } else if (fuelPriceFilterMode === 'single-date') {
        const d = new Date(reportDate);
        d.setHours(23, 59, 59, 999);
        return reportsApi.getFuelPriceHistory(reportDate, undefined, d.toISOString());
      } else {
        // no-filter mode
        return reportsApi.getFuelPriceHistory();
      }
    },
    enabled: fetchEnabled && selectedReport === 'fuel-price-history',
  });

  // Customer-Wise Sales
  const { data: customerWiseSales, isLoading: loadingCustomerWise, isError: errorCustomerWise } = useQuery({
    queryKey: ['report-customer-wise-sales', branchId, customerWiseSalesFilterMode, reportDate, startDate, endDate, selectedCustomerId],
    queryFn: () => {
      if (customerWiseSalesFilterMode === 'date-range') {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return reportsApi.getCustomerWiseSales(
          branchId,
          undefined,
          start.toISOString(),
          end.toISOString(),
          selectedCustomerId && selectedCustomerId !== WALK_IN_LEDGER_ID ? selectedCustomerId : undefined
        );
      } else if (customerWiseSalesFilterMode === 'single-date') {
        const d = new Date(reportDate);
        d.setHours(23, 59, 59, 999);
        return reportsApi.getCustomerWiseSales(
          branchId,
          reportDate,
          undefined,
          d.toISOString(),
          selectedCustomerId && selectedCustomerId !== WALK_IN_LEDGER_ID ? selectedCustomerId : undefined
        );
      } else {
        // no-filter mode
        return reportsApi.getCustomerWiseSales(
          branchId,
          undefined,
          undefined,
          undefined,
          selectedCustomerId && selectedCustomerId !== WALK_IN_LEDGER_ID ? selectedCustomerId : undefined
        );
      }
    },
    enabled: fetchEnabled && selectedReport === 'customer-wise-sales' && !!branchId,
  });

  // Product-Wise Summary
  const { data: productWiseSummary, isLoading: loadingProductWise, isError: errorProductWise } = useQuery({
    queryKey: ['report-product-wise-summary', branchId, productWiseFilterMode, reportDate, startDate, endDate, productWiseType, selectedNonFuelProductId],
    queryFn: () => {
      const productId = selectedNonFuelProductId !== 'ALL' ? selectedNonFuelProductId : undefined;
      if (productWiseFilterMode === 'date-range') {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return reportsApi.getProductWiseSummary(
          branchId,
          undefined,
          start.toISOString(),
          end.toISOString(),
          productWiseType,
          productId
        );
      } else if (productWiseFilterMode === 'single-date') {
        const d = new Date(reportDate);
        d.setHours(23, 59, 59, 999);
        return reportsApi.getProductWiseSummary(
          branchId,
          reportDate,
          undefined,
          d.toISOString(),
          productWiseType,
          productId
        );
      } else {
        return reportsApi.getProductWiseSummary(
          branchId,
          undefined,
          undefined,
          undefined,
          productWiseType,
          productId
        );
      }
    },
    enabled: fetchEnabled && selectedReport === 'product-wise-summary' && !!branchId,
  });

  // Vehicle-Wise Report (statement format based on customer ledger data)
  const { data: vehicleWiseLedger, isLoading: loadingVehicleWise, isError: errorVehicleWise } = useQuery({
    queryKey: ['report-vehicle-wise', selectedCustomerId, vehicleWiseFilterMode, reportDate, startDate, endDate],
    queryFn: () => {
      if (vehicleWiseFilterMode === 'date-range') {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return reportsApi.getCustomerLedger(selectedCustomerId, undefined, start.toISOString(), end.toISOString());
      } else if (vehicleWiseFilterMode === 'single-date') {
        const d = new Date(reportDate);
        d.setHours(23, 59, 59, 999);
        return reportsApi.getCustomerLedger(selectedCustomerId, reportDate, undefined, d.toISOString());
      } else {
        return reportsApi.getCustomerLedger(selectedCustomerId);
      }
    },
    enabled: fetchEnabled && selectedReport === 'vehicle-wise-report' && !!selectedCustomerId && selectedCustomerId !== WALK_IN_LEDGER_ID,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  // Get customers list for dropdown (ledger, customer-wise, and vehicle-wise reports)
  const [customerSearch, setCustomerSearch] = useState('');
  const { data: customersData } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () =>
      apiClient
        .get('/api/customers', { params: { limit: 500, offset: 0, isActive: 'true' } })
        .then(r => r.data.customers || []),
    enabled:
      selectedReport === 'customer-ledger' ||
      selectedReport === 'customer-wise-sales' ||
      selectedReport === 'vehicle-wise-report',
  });

  const { data: nonFuelProductsData } = useQuery({
    queryKey: ['non-fuel-products-report'],
    queryFn: () => productsApi.getAll({ size: 1000 }),
    enabled: selectedReport === 'product-wise-summary',
  });
  const nonFuelProducts = (nonFuelProductsData?.items || []).filter((p: any) => p.isActive !== false);

  // Filter customers by search
  const filteredCustomers = (customersData || []).filter((c: any) =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.phone && c.phone.includes(customerSearch)) ||
    (c.email && c.email.toLowerCase().includes(customerSearch.toLowerCase()))
  );

  const selectedCustomer = (customersData || []).find((c: any) => c.id === selectedCustomerId);
  const registeredVehicles = (selectedCustomer?.vehicleNumbers || [])
    .map((v: string) => (v || '').trim())
    .filter((v: string) => v.length > 0);
  const ledgerVehicles = (vehicleWiseLedger?.transactions || [])
    .map((t: any) => (t.vehicleNumber || '').trim())
    .filter((v: string) => v.length > 0);
  const allVehicles = Array.from(new Set([...registeredVehicles, ...ledgerVehicles])).sort((a, b) => a.localeCompare(b));
  const filteredVehicles = allVehicles.filter((v) => v.toLowerCase().includes(vehicleSearch.toLowerCase()));

  useEffect(() => {
    if (selectedReport !== 'customer-ledger' && selectedCustomerId === WALK_IN_LEDGER_ID) {
      setSelectedCustomerId('');
    }
  }, [selectedReport, selectedCustomerId]);

  useEffect(() => {
    setSelectedVehicleNumber('ALL');
    setVehicleSearch('');
  }, [selectedCustomerId]);

  useEffect(() => {
    if (productWiseType !== 'non_fuel') {
      setSelectedNonFuelProductId('ALL');
    }
  }, [productWiseType]);

  const isLoading =
    loadingDaily ||
    loadingShift ||
    loadingInventory ||
    loadingLedger ||
    loadingVariance ||
    loadingFuelPrice ||
    loadingCustomerWise ||
    loadingVehicleWise ||
    loadingProductWise;
  const isError =
    errorDaily ||
    errorShift ||
    errorInventory ||
    errorLedger ||
    errorVariance ||
    errorFuelPrice ||
    errorCustomerWise ||
    errorVehicleWise ||
    errorProductWise;

  const handleGenerate = () => {
    setFetchEnabled(true);
  };

  // CSV + Print for Daily Sales
  const exportDailySalesCSV = () => {
    if (!dailySales) return;
    const summary = dailySales.summary || {};
    const payments = dailySales.paymentMethodBreakdown || [];
    const shifts = dailySales.shiftBreakdown || [];
    const shiftFuels = dailySales.shiftFuelBreakdown || [];
    const variantPayments = dailySales.variantPaymentBreakdown || [];
    const fuelByType = summary.fuel?.byType || {};

    const rows: (string | number)[][] = [
      ['Daily Sales Report', formatDate(reportDate)],
      ['', ''],
      ['Summary', 'Count', 'Amount'],
      ['Total Sales', summary.totalTransactions || 0, Number(summary.totalAmount || 0)],
      ['Fuel Sales', summary.fuel?.count || 0, Number(summary.fuel?.amount || 0)],
      ['Non-Fuel Sales', summary.nonFuel?.count || 0, Number(summary.nonFuel?.amount || 0)],
      ['', '', ''],
      ['Product Variant', 'Liters', 'Amount'],
      ...Object.entries(fuelByType).map(([type, data]: [string, any]) => [
        type,
        Number(data.liters || 0).toFixed(2),
        Number(data.amount || 0)
      ]),
      ['', '', ''],
      ['Payment Method', 'Count', 'Amount'],
      ...payments.map((p: any) => [p.paymentMethod || p.method, p.count || p._count || 0, Number(p.totalAmount || p.amount || 0)]),
      ['', '', ''],
      ['Product Variant', 'Payment Type', 'Count', 'Amount'],
      ...variantPayments.map((vp: any) => [vp.variant, vp.paymentMethod, vp.count, Number(vp.amount)]),
      ['', '', '', ''],
      ['Shift', 'Cashier', 'Sales', 'Amount'],
      ...shifts.map((s: any) => [s.shiftNumber || s.name || '-', s.cashier?.fullName || s.cashier || '-', s.count || 0, Number(s.totalAmount || s.amount || 0)]),
      ['', '', '', ''],
      ['Shift', 'Fuel Type', 'Liters', 'Count', 'Amount'],
      ...shiftFuels.map((sf: any) => [sf.shiftName || '-', sf.fuelType || '-', Number(sf.liters || 0).toFixed(2), sf.count || 0, Number(sf.amount || 0)]),
    ];

    downloadCSV(`daily-sales-${reportDate}.csv`, toCSV(['', '', '', '', ''], rows));
  };

  const printDailySales = () => {
    if (!dailySales) return;
    const summary = dailySales.summary || {};
    const payments = dailySales.paymentMethodBreakdown || [];
    const shifts = dailySales.shiftBreakdown || [];
    const shiftFuels = dailySales.shiftFuelBreakdown || [];
    const variantPayments = dailySales.variantPaymentBreakdown || [];

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
      <h2>Product Variant × Payment Type</h2>
      <table>
        <tr><th>Variant</th><th>Payment</th><th class="right">Count</th><th class="right">Amount</th><th class="right">Liters</th></tr>
        ${variantPayments.map((vp: any) => `<tr><td>${vp.variant}</td><td>${vp.paymentMethod}</td><td class="right">${vp.count}</td><td class="right">${formatCurrency(Number(vp.amount))}</td><td class="right">${vp.liters ? Number(vp.liters).toFixed(2) + ' L' : '-'}</td></tr>`).join('')}
      </table>
      <h2>Shift Breakdown</h2>
      <table>
        <tr><th>Shift</th><th>Cashier</th><th class="right">Sales</th><th class="right">Amount</th></tr>
        ${shifts.map((s: any) => `<tr><td>${s.shiftNumber || s.name || '-'}</td><td>${s.cashier?.fullName || s.cashier || '-'}</td><td class="right">${s.count || 0}</td><td class="right">${formatCurrency(Number(s.totalAmount || s.amount || 0))}</td></tr>`).join('')}
      </table>
      <h2>Shift-wise Fuel Type Breakdown</h2>
      <table>
        <tr><th>Shift</th><th>Fuel Type</th><th class="right">Liters</th><th class="right">Count</th><th class="right">Amount</th></tr>
        ${shiftFuels.map((sf: any) => `<tr><td>${sf.shiftName || '-'}</td><td>${sf.fuelType || '-'}</td><td class="right">${Number(sf.liters || 0).toFixed(2)} L</td><td class="right">${sf.count || 0}</td><td class="right">${formatCurrency(Number(sf.amount || 0))}</td></tr>`).join('')}
      </table>`;
    printReport(`Daily Sales Report - ${formatDate(reportDate)}`, html, {
      branchName: dailySales?.branch?.name,
    });
  };

  // CSV + Print for Inventory
  const exportInventoryCSV = () => {
    if (!inventory) return;

    // Export purchases if available
    if (inventory.purchases && inventory.purchases.length > 0) {
      const purchases = inventory.purchases;
      const headers = ['Product', 'SKU', 'Supplier', 'Quantity Received', 'Cost/Unit', 'Total Cost', 'Receipt Date', 'Status'];
      const rows: (string | number)[][] = purchases.map((p: any) => [
        p.name || '-',
        p.sku || '-',
        p.supplierName || p.supplier || '-',
        Number(p.quantityReceived || 0),
        Number(p.costPerUnit || 0),
        Number(p.totalCost || 0),
        p.receiptDate ? new Date(p.receiptDate).toLocaleDateString('en-PK') : '-',
        p.status === 'received_with_receipt' ? 'Received' : 'Pending Receipt',
      ]);
      downloadCSV(`inventory-purchases-${new Date().toISOString().split('T')[0]}.csv`, toCSV(headers, rows));
      return;
    }

    // Fall back to current stock if no purchases
    const products = inventory.nonFuelProducts || [];
    const headers = ['Product', 'SKU', 'Category', 'Quantity', 'Unit Price', 'Stock Value', 'Status'];
    const allProducts = [...(products.normal || []), ...(products.lowStock || [])];
    const rows: (string | number)[][] = allProducts.map((p: any) => {
      const qty = p.quantity ?? p.stockLevel ?? 0;
      const unitPrice = Number(p.unitPrice || 0);
      return [
        p.name || '-',
        p.sku || '-',
        p.category || '-',
        qty,
        unitPrice,
        qty * unitPrice,
        qty <= (p.lowStockThreshold || 10) ? 'LOW STOCK' : 'OK',
      ];
    });
    downloadCSV(`inventory-stock-${new Date().toISOString().split('T')[0]}.csv`, toCSV(headers, rows));
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
    printReport('Inventory Report', html, {
      branchName: inventory?.branch?.name,
    });
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
                  <SelectItem value="customer-wise-sales">Customer-Wise Sales</SelectItem>
                  <SelectItem value="vehicle-wise-report">Vehicle-Wise Report</SelectItem>
                  <SelectItem value="product-wise-summary">Product-Wise Summary</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selectedReport === 'daily-sales' && (
              <>
                <div className="space-y-2">
                  <Label>Filter Mode</Label>
                  <Select value={dailySalesFilterMode} onValueChange={(v) => { setDailySalesFilterMode(v as FilterMode); setFetchEnabled(false); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no-filter">All Data (No Filter)</SelectItem>
                      <SelectItem value="single-date">Single Date</SelectItem>
                      <SelectItem value="date-range">Date Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {dailySalesFilterMode === 'single-date' && (
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input type="date" value={reportDate} onChange={(e) => { setReportDate(e.target.value); setFetchEnabled(false); }} />
                  </div>
                )}
                {dailySalesFilterMode === 'date-range' && (
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
              </>
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
                <div className="space-y-2 md:col-span-4">
                  <Label>Search Customer</Label>
                  <Input
                    placeholder="🔍 Search by name, phone, or email..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {filteredCustomers.length} of {customersData?.length || 0} customers (+ Walk-in Sales Ledger)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Customer *</Label>
                  <Select value={selectedCustomerId} onValueChange={(v) => { setSelectedCustomerId(v); setFetchEnabled(false); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      <SelectItem value={WALK_IN_LEDGER_ID}>
                        <div className="flex flex-col">
                          <span>Walk-in Sales Ledger</span>
                          <span className="text-xs text-muted-foreground">All sales where customer is not selected</span>
                        </div>
                      </SelectItem>
                      {filteredCustomers.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          <div className="flex flex-col">
                            <span>{c.name}</span>
                            {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Filter Mode</Label>
                  <Select value={customerLedgerFilterMode} onValueChange={(v) => { setCustomerLedgerFilterMode(v as FilterMode); setFetchEnabled(false); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no-filter">All Data (No Filter)</SelectItem>
                      <SelectItem value="single-date">Single Date</SelectItem>
                      <SelectItem value="date-range">Date Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {customerLedgerFilterMode === 'single-date' && (
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input type="date" value={reportDate} onChange={(e) => { setReportDate(e.target.value); setFetchEnabled(false); }} />
                  </div>
                )}
                {customerLedgerFilterMode === 'date-range' && (
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
              </>
            )}

            {selectedReport === 'variance' && (
              <>
                <div className="space-y-2">
                  <Label>Filter Mode</Label>
                  <Select value={varianceFilterMode} onValueChange={(v) => { setVarianceFilterMode(v as FilterMode); setFetchEnabled(false); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no-filter">All Data (No Filter)</SelectItem>
                      <SelectItem value="single-date">Single Date</SelectItem>
                      <SelectItem value="date-range">Date Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {varianceFilterMode === 'single-date' && (
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input type="date" value={reportDate} onChange={(e) => { setReportDate(e.target.value); setFetchEnabled(false); }} />
                  </div>
                )}
                {varianceFilterMode === 'date-range' && (
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
              </>
            )}

            {selectedReport === 'fuel-price-history' && (
              <>
                <div className="space-y-2">
                  <Label>Filter Mode</Label>
                  <Select value={fuelPriceFilterMode} onValueChange={(v) => { setFuelPriceFilterMode(v as FilterMode); setFetchEnabled(false); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no-filter">All Data (No Filter)</SelectItem>
                      <SelectItem value="single-date">Single Date</SelectItem>
                      <SelectItem value="date-range">Date Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {fuelPriceFilterMode === 'single-date' && (
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input type="date" value={reportDate} onChange={(e) => { setReportDate(e.target.value); setFetchEnabled(false); }} />
                  </div>
                )}
                {fuelPriceFilterMode === 'date-range' && (
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
              </>
            )}

            {selectedReport === 'inventory' && (
              <>
                <div className="space-y-2">
                  <Label>Filter Mode</Label>
                  <Select value={inventoryFilterMode} onValueChange={(v) => { setInventoryFilterMode(v as FilterMode); setFetchEnabled(false); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no-filter">All Data (No Filter)</SelectItem>
                      <SelectItem value="single-date">Snapshot (Single Date)</SelectItem>
                      <SelectItem value="date-range">Date Range (Purchases)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {inventoryFilterMode === 'single-date' && (
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input type="date" value={reportDate} onChange={(e) => { setReportDate(e.target.value); setFetchEnabled(false); }} />
                  </div>
                )}
                {inventoryFilterMode === 'date-range' && (
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
              </>
            )}

            {selectedReport === 'customer-wise-sales' && (
              <>
                <div className="space-y-2 md:col-span-4">
                  <Label>Search Customer (Optional)</Label>
                  <Input
                    placeholder="🔍 Search by name, phone, or email..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {filteredCustomers.length} of {customersData?.length || 0} customers
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Customer (Optional)</Label>
                  <Select value={selectedCustomerId || 'ALL'} onValueChange={(v) => { setSelectedCustomerId(v === 'ALL' ? '' : v); setFetchEnabled(false); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="All customers" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      <SelectItem value="ALL">All Customers</SelectItem>
                      {filteredCustomers.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          <div className="flex flex-col">
                            <span>{c.name}</span>
                            {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Filter Mode</Label>
                  <Select value={customerWiseSalesFilterMode} onValueChange={(v) => { setCustomerWiseSalesFilterMode(v as FilterMode); setFetchEnabled(false); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no-filter">All Data (No Filter)</SelectItem>
                      <SelectItem value="single-date">Single Date</SelectItem>
                      <SelectItem value="date-range">Date Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {customerWiseSalesFilterMode === 'single-date' && (
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input type="date" value={reportDate} onChange={(e) => { setReportDate(e.target.value); setFetchEnabled(false); }} />
                  </div>
                )}
                {customerWiseSalesFilterMode === 'date-range' && (
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
              </>
            )}

            {selectedReport === 'vehicle-wise-report' && (
              <>
                <div className="space-y-2 md:col-span-4">
                  <Label>Search Customer</Label>
                  <Input
                    placeholder="Search by name, phone, or email..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {filteredCustomers.length} of {customersData?.length || 0} customers
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Customer *</Label>
                  <Select value={selectedCustomerId} onValueChange={(v) => { setSelectedCustomerId(v); setFetchEnabled(false); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {filteredCustomers.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          <div className="flex flex-col">
                            <span>{c.name}</span>
                            {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-4">
                  <Label>Search Vehicle (Optional)</Label>
                  <Input
                    placeholder="Search vehicle number..."
                    value={vehicleSearch}
                    onChange={(e) => setVehicleSearch(e.target.value)}
                    disabled={!selectedCustomerId}
                  />
                  <p className="text-xs text-muted-foreground">
                    {selectedCustomerId ? `${filteredVehicles.length} of ${allVehicles.length} vehicles` : 'Select customer first'}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Vehicle (Optional)</Label>
                  <Select
                    value={selectedVehicleNumber}
                    onValueChange={(v) => { setSelectedVehicleNumber(v); setFetchEnabled(false); }}
                    disabled={!selectedCustomerId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All vehicles" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      <SelectItem value="ALL">All Vehicles</SelectItem>
                      {filteredVehicles.map((vehicle) => (
                        <SelectItem key={vehicle} value={vehicle}>{vehicle}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Filter Mode</Label>
                  <Select value={vehicleWiseFilterMode} onValueChange={(v) => { setVehicleWiseFilterMode(v as FilterMode); setFetchEnabled(false); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no-filter">All Data (No Filter)</SelectItem>
                      <SelectItem value="single-date">Single Date</SelectItem>
                      <SelectItem value="date-range">Date Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {vehicleWiseFilterMode === 'single-date' && (
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input type="date" value={reportDate} onChange={(e) => { setReportDate(e.target.value); setFetchEnabled(false); }} />
                  </div>
                )}
                {vehicleWiseFilterMode === 'date-range' && (
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
              </>
            )}

            {selectedReport === 'product-wise-summary' && (
              <>
                <div className="space-y-2">
                  <Label>Filter Mode</Label>
                  <Select value={productWiseFilterMode} onValueChange={(v) => { setProductWiseFilterMode(v as FilterMode); setFetchEnabled(false); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no-filter">All Data (No Filter)</SelectItem>
                      <SelectItem value="single-date">Single Date</SelectItem>
                      <SelectItem value="date-range">Date Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Product Type</Label>
                  <Select value={productWiseType} onValueChange={(v) => { setProductWiseType(v as 'all' | 'fuel' | 'non_fuel'); setFetchEnabled(false); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All (Fuel + Non-Fuel)</SelectItem>
                      <SelectItem value="fuel">Fuel Only</SelectItem>
                      <SelectItem value="non_fuel">Non-Fuel Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {productWiseType === 'non_fuel' && (
                  <div className="space-y-2">
                    <Label>Non-Fuel Product</Label>
                    <Select value={selectedNonFuelProductId} onValueChange={(v) => { setSelectedNonFuelProductId(v); setFetchEnabled(false); }}>
                      <SelectTrigger>
                        <SelectValue placeholder="All non-fuel products" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        <SelectItem value="ALL">All Non-Fuel Products</SelectItem>
                        {nonFuelProducts.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {productWiseFilterMode === 'single-date' && (
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input type="date" value={reportDate} onChange={(e) => { setReportDate(e.target.value); setFetchEnabled(false); }} />
                  </div>
                )}
                {productWiseFilterMode === 'date-range' && (
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

          {/* Product Variant Cards */}
          {dailySales.summary?.fuel?.byType && Object.keys(dailySales.summary.fuel.byType).length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Product Variant Breakdown</h3>
              <div className="grid gap-4 md:grid-cols-4">
                {Object.entries(dailySales.summary.fuel.byType).map(([fuelType, data]: [string, any]) => (
                  <Card key={fuelType}>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">{fuelType}</p>
                      <p className="text-2xl font-bold">{formatCurrency(Number(data.amount || 0))}</p>
                      <p className="text-xs text-muted-foreground">{Number(data.liters || 0).toFixed(2)} liters</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

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

          {/* Product Variant × Payment Type Breakdown */}
          {dailySales.variantPaymentBreakdown?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Product Variant × Payment Type Breakdown</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product Variant</TableHead>
                      <TableHead>Payment Type</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Liters</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailySales.variantPaymentBreakdown
                      .sort((a: any, b: any) => a.variant.localeCompare(b.variant))
                      .map((vp: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Badge variant="outline">{vp.variant}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge>{vp.paymentMethod}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{vp.count}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(Number(vp.amount))}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {vp.liters ? `${Number(vp.liters).toFixed(2)} L` : '-'}
                        </TableCell>
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

          {/* Shift-wise Fuel Type Breakdown */}
          {dailySales.shiftFuelBreakdown?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Shift-wise Fuel Type Breakdown</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shift</TableHead>
                      <TableHead>Fuel Type</TableHead>
                      <TableHead className="text-right">Liters</TableHead>
                      <TableHead className="text-right">Transactions</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailySales.shiftFuelBreakdown.map((sf: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{sf.shiftName || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{sf.fuelType || '-'}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {typeof sf.liters === 'number' ? `${Number(sf.liters).toFixed(2)} L` : '-'}
                        </TableCell>
                        <TableCell className="text-right">{sf.count || 0}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(Number(sf.amount || 0))}</TableCell>
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
                const headers = ['Date', 'Customer Name', 'Vehicle#', 'Slip#', 'Product/Fuel', 'Rate', 'Quantity', 'Price', 'Payment Method', 'Balance'];
                const rows: (string | number)[][] = (customerLedger.transactions || []).map((t: any) => {
                  const isFuel = t.type === 'fuel';
                  const fuelSales = t.details?.fuelSales || [];
                  const items = t.details?.items || [];
                  const vehicleNumber = t.vehicleNumber || '-'; // Use per-transaction vehicle number

                  if (isFuel && fuelSales.length > 0) {
                    // For fuel sales, create one row per fuel type
                    return fuelSales.map((fs: any) => [
                      formatDate(t.date || new Date()),
                      customerLedger.customer?.name || '-',
                      vehicleNumber,
                      t.slipNumber || '-',
                      fs.fuelType || '-',
                      fs.pricePerLiter || 0,
                      `${fs.liters || 0}L`,
                      fs.amount || 0,
                      t.paymentMethod || '-',
                      t.runningBalance || 0,
                    ]);
                  } else if (items.length > 0) {
                    // For non-fuel sales, create one row per item
                    return items.map((item: any) => [
                      formatDate(t.date || new Date()),
                      customerLedger.customer?.name || '-',
                      vehicleNumber,
                      t.slipNumber || '-',
                      item.productName || '-',
                      item.unitPrice || 0,
                      item.quantity || 0,
                      item.amount || 0,
                      t.paymentMethod || '-',
                      t.runningBalance || 0,
                    ]);
                  }

                  return [[
                    formatDate(t.date || new Date()),
                    customerLedger.customer?.name || '-',
                    vehicleNumber,
                    t.slipNumber || '-',
                    '-',
                    0,
                    0,
                    t.amount || 0,
                    t.paymentMethod || '-',
                    t.runningBalance || 0,
                  ]];
                }).flat();
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

          {/* Purchases Received */}
          {inventory.purchases && inventory.purchases.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Purchases Received</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Cost/Unit</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                      <TableHead>Receipt Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.purchases.map((p: any) => (
                      <TableRow key={p.id || `${p.sku}-${p.receiptDate}`}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell>{p.sku}</TableCell>
                        <TableCell>{p.supplierName || p.supplier || '-'}</TableCell>
                        <TableCell className="text-right">{Number(p.quantityReceived || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(Number(p.costPerUnit || 0))}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(Number(p.totalCost || 0))}</TableCell>
                        <TableCell>{p.receiptDate ? formatDate(p.receiptDate) : '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* All Products */}
          <Card>
            <CardHeader><CardTitle className="text-base">Current Stock</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Stock Value</TableHead>
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
                      <TableCell className="text-right font-medium">{formatCurrency(Number((p.quantity ?? p.stockLevel ?? 0) * (p.unitPrice || 0)))}</TableCell>
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
                printReport(`Variance Report - ${formatDate(startDate)} to ${formatDate(endDate)}`, html, {
                  branchName: variance?.branch?.name,
                });
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
      {selectedReport === 'fuel-price-history' && fuelPriceHistory && !isLoading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Fuel Price History ({formatDate(startDate)} - {formatDate(endDate)})</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                if (!fuelPriceHistory) return;
                const headers = ['Date', 'Fuel Type', 'Old Price', 'New Price', 'Change Amount', 'Change %', 'Changed By'];
                const rows: (string | number)[][] = (fuelPriceHistory.priceChanges || []).map((change: any) => [
                  formatDate(change.date),
                  `${change.fuelType} (${change.fuelTypeCode})`,
                  change.oldPrice !== null ? change.oldPrice : 'N/A',
                  change.newPrice,
                  change.priceChange !== null ? change.priceChange.toFixed(3) : 'N/A',
                  change.percentageChange !== null ? change.percentageChange.toFixed(2) + '%' : 'N/A',
                  change.changedBy,
                ]);
                downloadCSV(`fuel-price-history-${startDate}-to-${endDate}.csv`, toCSV(headers, rows));
              }}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                if (!fuelPriceHistory) return;
                let html = `<h2>Fuel Price History</h2><p>Period: ${formatDate(startDate)} to ${formatDate(endDate)}</p><table><tr><th>Date</th><th>Fuel Type</th><th class="right">Old Price</th><th class="right">New Price</th><th class="right">Change</th><th class="right">Change %</th><th>Changed By</th></tr>`;
                (fuelPriceHistory.priceChanges || []).forEach((change: any) => {
                  html += `<tr><td>${formatDate(change.date)}</td><td>${change.fuelType} (${change.fuelTypeCode})</td><td class="right">${change.oldPrice !== null ? formatCurrency(change.oldPrice) : '-'}</td><td class="right">${formatCurrency(change.newPrice)}</td><td class="right">${change.priceChange !== null ? change.priceChange.toFixed(3) : '-'}</td><td class="right">${change.percentageChange !== null ? change.percentageChange.toFixed(2) + '%' : '-'}</td><td>${change.changedBy}</td></tr>`;
                });
                html += '</table>';
                printReport(`Fuel Price History - ${formatDate(startDate)} to ${formatDate(endDate)}`, html, {
                  branchName: (user as any)?.branch?.name,
                });
              }}>
                <Printer className="mr-2 h-4 w-4" /> Print / PDF
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Total Price Changes</p>
                <p className="text-2xl font-bold">{fuelPriceHistory.totalChanges || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Date Range</p>
                <p className="text-2xl font-bold">{formatDate(startDate)} - {formatDate(endDate)}</p>
              </CardContent>
            </Card>
          </div>

          {(fuelPriceHistory.priceChanges || []).length > 0 ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Price Change History</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Fuel Type</TableHead>
                      <TableHead className="text-right">Old Price</TableHead>
                      <TableHead className="text-right">New Price</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                      <TableHead className="text-right">Change %</TableHead>
                      <TableHead>Changed By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fuelPriceHistory.priceChanges.map((change: any) => (
                      <TableRow key={change.id}>
                        <TableCell>{formatDate(change.date)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{change.fuelType} ({change.fuelTypeCode})</Badge>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {change.oldPrice !== null ? formatCurrency(change.oldPrice) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(change.newPrice)}
                        </TableCell>
                        <TableCell className="text-right">
                          {change.priceChange !== null ? (
                            <span className={change.priceChange > 0 ? 'text-red-600' : change.priceChange < 0 ? 'text-green-600' : ''}>
                              {change.priceChange > 0 ? '+' : ''}{change.priceChange.toFixed(3)}
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {change.percentageChange !== null ? (
                            <Badge variant={change.percentageChange > 0 ? 'destructive' : change.percentageChange < 0 ? 'default' : 'secondary'}>
                              {change.percentageChange > 0 ? '+' : ''}{change.percentageChange.toFixed(2)}%
                            </Badge>
                          ) : '-'}
                        </TableCell>
                        <TableCell>{change.changedBy}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No fuel price changes found for the selected date range.
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* CUSTOMER-WISE SALES REPORT */}
      {selectedReport === 'customer-wise-sales' && customerWiseSales && !isLoading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              Customer-Wise Sales Report ({formatDate(startDate)} - {formatDate(endDate)})
            </h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                if (!customerWiseSales) return;
                const headers = ['Date', 'Customer Name', 'Slip#', 'Product', 'Variant', 'Rate', 'Quantity', 'Amount', 'Payment Method', 'Vehicle#'];
                const rows: (string | number)[][] = (customerWiseSales.saleDetails || []).map((detail: any) => [
                  formatDate(detail.date),
                  detail.customerName,
                  detail.slipNumber || '-',
                  detail.productName,
                  detail.productVariant,
                  detail.rate,
                  detail.quantity,
                  detail.amount,
                  detail.paymentMethod,
                  detail.vehicleNumber || '-',
                ]);
                downloadCSV(`customer-wise-sales-${startDate}-to-${endDate}.csv`, toCSV(headers, rows));
              }}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Total Sales</p>
                <p className="text-2xl font-bold">{customerWiseSales.totalSales || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Total Amount</p>
                <p className="text-2xl font-bold">{formatCurrency(customerWiseSales.totalAmount || 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Total Customers</p>
                <p className="text-2xl font-bold">{customerWiseSales.customerSummary?.length || 0}</p>
              </CardContent>
            </Card>
          </div>

          {/* Customer Summary */}
          {customerWiseSales.customerSummary?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Customer Summary</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Transactions</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                      <TableHead>Top Variant</TableHead>
                      <TableHead>Top Payment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerWiseSales.customerSummary.map((cust: any, i: number) => {
                      const topVariant = Object.entries(cust.byVariant).sort((a: any, b: any) => b[1].amount - a[1].amount)[0];
                      const topPayment = Object.entries(cust.byPaymentMethod).sort((a: any, b: any) => b[1].amount - a[1].amount)[0];
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{cust.name}</TableCell>
                          <TableCell className="text-right">{cust.totalTransactions}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(cust.totalAmount)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{topVariant ? topVariant[0] : '-'}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge>{topPayment ? topPayment[0] : '-'}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Detailed Transactions */}
          {customerWiseSales.saleDetails?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Transaction Details</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Slip#</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Variant</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Vehicle#</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerWiseSales.saleDetails.slice(0, 100).map((detail: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell>{formatDate(detail.date)}</TableCell>
                        <TableCell>{detail.customerName}</TableCell>
                        <TableCell className="text-muted-foreground">{detail.slipNumber || '-'}</TableCell>
                        <TableCell>{detail.productName}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{detail.productVariant}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(detail.rate)}</TableCell>
                        <TableCell className="text-right">{Number(detail.quantity).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(detail.amount)}</TableCell>
                        <TableCell>
                          <Badge>{detail.paymentMethod}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{detail.vehicleNumber || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {customerWiseSales.saleDetails.length > 100 && (
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    Showing first 100 of {customerWiseSales.saleDetails.length} transactions. Download CSV for full data.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* PRODUCT-WISE SUMMARY REPORT */}
      {selectedReport === 'product-wise-summary' && productWiseSummary && !isLoading && (
        <div className="space-y-4">
          {(() => {
            const rows = productWiseSummary.rows || [];
            const displayFromDate = productWiseFilterMode === 'single-date' ? reportDate : startDate;
            const displayToDate = productWiseFilterMode === 'single-date' ? reportDate : endDate;
            const monthText = formatMonthYearForHeader(displayFromDate);
            const periodText = `FOR THE PERIOD FROM ${formatDateForHeader(displayFromDate)} TO ${formatDateForHeader(displayToDate)}`;
            const branchName = productWiseSummary.branch?.name || 'Sundar Industrial Petrol Pump - Main Branch, Lahore';

            return (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">
                    Product-Wise Summary ({formatDate(displayFromDate)} - {formatDate(displayToDate)})
                  </h2>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => {
                      const headers = ['Product', 'Qty', 'Unit', 'Price', 'Amount', 'Slip#', 'Payment Method'];
                      const csvRows: (string | number)[][] = rows.map((r: any) => [
                        r.product,
                        Number(r.qty || 0).toFixed(2),
                        r.unit,
                        Number(r.price || 0),
                        Number(r.amount || 0),
                        r.slipNumber || '-',
                        r.paymentMethod || '-',
                      ]);
                      csvRows.push(['TOTAL', '', '', '', Number(productWiseSummary.totalAmount || 0), '', '']);
                      downloadCSV(`product-wise-summary-${displayFromDate}-to-${displayToDate}.csv`, toCSV(headers, csvRows));
                    }}>
                      <Download className="mr-2 h-4 w-4" /> CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => {
                      const html = `
                        <table>
                          <tr><th>Product</th><th class="right">Qty</th><th>Unit</th><th class="right">Price</th><th class="right">Amount</th><th>Slip#</th><th>Payment Method</th></tr>
                          ${rows.map((r: any) => `
                            <tr>
                              <td>${r.product}</td>
                              <td class="right">${Number(r.qty || 0).toFixed(2)}</td>
                              <td>${r.unit}</td>
                              <td class="right">${Number(r.price || 0).toLocaleString('en-PK')}</td>
                              <td class="right">${Number(r.amount || 0).toLocaleString('en-PK')}</td>
                              <td>${r.slipNumber || '-'}</td>
                              <td>${r.paymentMethod || '-'}</td>
                            </tr>
                          `).join('')}
                          <tr>
                            <td class="bold">Total</td>
                            <td colspan="3"></td>
                            <td class="right bold">${Number(productWiseSummary.totalAmount || 0).toLocaleString('en-PK')}</td>
                            <td colspan="2"></td>
                          </tr>
                        </table>
                      `;
                      printReport(
                        `PRODUCT WISE DETAIL`,
                        html,
                        {
                          branchName,
                          subtitle: `BILL FOR THE MONTH OF ${monthText}`,
                          periodText,
                        }
                      );
                    }}>
                      <Printer className="mr-2 h-4 w-4" /> Print / PDF
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">Total Rows</p>
                      <p className="text-2xl font-bold">{productWiseSummary.totalRows || 0}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">Branch</p>
                      <p className="text-base font-semibold">{branchName}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">Total Amount</p>
                      <p className="text-2xl font-bold">{formatCurrency(Number(productWiseSummary.totalAmount || 0))}</p>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader><CardTitle className="text-base">Product Wise Detail</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Slip#</TableHead>
                          <TableHead>Payment Method</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((r: any, i: number) => (
                          <TableRow key={`${r.saleId}-${r.product}-${i}`}>
                            <TableCell className="font-medium">{r.product}</TableCell>
                            <TableCell className="text-right">{Number(r.qty || 0).toFixed(2)}</TableCell>
                            <TableCell>{r.unit}</TableCell>
                            <TableCell className="text-right">{formatCurrency(Number(r.price || 0))}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(Number(r.amount || 0))}</TableCell>
                            <TableCell className="text-muted-foreground">{r.slipNumber || '-'}</TableCell>
                            <TableCell><Badge>{r.paymentMethod || '-'}</Badge></TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell className="font-bold">TOTAL</TableCell>
                          <TableCell />
                          <TableCell />
                          <TableCell />
                          <TableCell className="text-right font-bold">{formatCurrency(Number(productWiseSummary.totalAmount || 0))}</TableCell>
                          <TableCell />
                          <TableCell />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            );
          })()}
        </div>
      )}

      {/* VEHICLE-WISE REPORT */}
      {selectedReport === 'vehicle-wise-report' && vehicleWiseLedger && !isLoading && (
        <div className="space-y-4">
          {(() => {
            const rows = (vehicleWiseLedger.transactions || []).flatMap((txn: any) => {
              const vehicleNumber = txn.vehicleNumber || '-';
              if (txn.type === 'fuel' && txn.details?.fuelSales?.length) {
                return txn.details.fuelSales.map((fs: any) => ({
                  date: txn.date,
                  vehicleNumber,
                  item: normalizeFuelItemLabel(fs.fuelType),
                  paymentMethod: txn.paymentMethod || '-',
                  amount: Number(fs.amount || 0),
                }));
              }
              if (txn.type === 'non_fuel' && txn.details?.items?.length) {
                return txn.details.items.map((item: any) => ({
                  date: txn.date,
                  vehicleNumber,
                  item: `NON-FUEL: ${(item.productName || 'ITEM').toUpperCase()}`,
                  paymentMethod: txn.paymentMethod || '-',
                  amount: Number(item.amount || 0),
                }));
              }
              return [{
                date: txn.date,
                vehicleNumber,
                item: 'UNKNOWN',
                paymentMethod: txn.paymentMethod || '-',
                amount: Number(txn.amount || 0),
              }];
            });

            const filteredRows = selectedVehicleNumber === 'ALL'
              ? rows
              : rows.filter((r: any) => r.vehicleNumber === selectedVehicleNumber);
            const sortedRows = [...filteredRows].sort((a: any, b: any) => {
              const vehicleCmp = String(a.vehicleNumber).localeCompare(String(b.vehicleNumber));
              if (vehicleCmp !== 0) return vehicleCmp;
              return new Date(a.date).getTime() - new Date(b.date).getTime();
            });

            const totalAmount = sortedRows.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
            const customerName = vehicleWiseLedger.customer?.name || 'Customer';
            const displayFromDate = vehicleWiseFilterMode === 'single-date' ? reportDate : startDate;
            const displayToDate = vehicleWiseFilterMode === 'single-date' ? reportDate : endDate;
            const headerMonth = formatMonthYearForHeader(displayFromDate);
            const periodStart = formatDateForHeader(displayFromDate);
            const periodEnd = formatDateForHeader(displayToDate);
            const branchName = vehicleWiseLedger.transactions?.[0]?.branch?.name || (user as any)?.branch?.name || 'Sundar Industrial Petrol Pump - Main Branch, Lahore';

            return (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">
                    Vehicle-Wise Report - {customerName} ({formatDate(displayFromDate)} - {formatDate(displayToDate)})
                  </h2>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const headers = ['SR.#', 'DATE', 'VEH.#', 'ITEMS', 'PAYMENT METHOD', 'BALANCE AMOUNT'];
                        const csvRows: (string | number)[][] = sortedRows.map((row: any, idx: number) => [
                          idx + 1,
                          formatDate(row.date),
                          row.vehicleNumber,
                          row.item,
                          row.paymentMethod,
                          row.amount,
                        ]);
                        csvRows.push(['', '', '', 'TOTAL', '', totalAmount]);
                        downloadCSV(
                          `vehicle-wise-${customerName}-${displayFromDate}-to-${displayToDate}.csv`,
                          toCSV(headers, csvRows)
                        );
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" /> CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const html = `
                          <table>
                            <tr><th>SR.#</th><th>DATE</th><th>VEH. #</th><th>ITEMS</th><th>PAYMENT METHOD</th><th class="right">BALANCE AMOUNT</th></tr>
                            ${sortedRows.map((row: any, idx: number) => `
                              <tr>
                                <td>${idx + 1}</td>
                                <td>${formatDate(row.date)}</td>
                                <td>${row.vehicleNumber}</td>
                                <td>${row.item}</td>
                                <td>${row.paymentMethod}</td>
                                <td class="right">${Number(row.amount || 0).toLocaleString('en-PK')}</td>
                              </tr>
                            `).join('')}
                            <tr>
                              <td colspan="5" class="bold right">TOTAL</td>
                              <td class="right bold">${totalAmount.toLocaleString('en-PK')}</td>
                            </tr>
                          </table>
                        `;
                        printReport(`Vehicle-Wise Report (${formatDate(displayFromDate)} - ${formatDate(displayToDate)})`, html, {
                          branchName,
                          subtitle: `${customerName.toUpperCase()} - BILL FOR THE MONTH OF ${headerMonth}`,
                          periodText: `FOR THE PERIOD FROM ${periodStart} TO ${periodEnd}`,
                        });
                      }}
                    >
                      <Printer className="mr-2 h-4 w-4" /> Print / PDF
                    </Button>
                  </div>
                </div>

                <Card>
                  <CardHeader><CardTitle className="text-base">Vehicle-Wise Billing</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>SR.#</TableHead>
                          <TableHead>DATE</TableHead>
                          <TableHead>VEH. #</TableHead>
                          <TableHead>ITEMS</TableHead>
                          <TableHead>PAYMENT METHOD</TableHead>
                          <TableHead className="text-right">BALANCE AMOUNT</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedRows.map((row: any, idx: number) => (
                          <TableRow key={`${row.vehicleNumber}-${row.item}-${idx}`}>
                            <TableCell>{idx + 1}</TableCell>
                            <TableCell>{formatDate(row.date)}</TableCell>
                            <TableCell className="font-medium">{row.vehicleNumber}</TableCell>
                            <TableCell>{row.item}</TableCell>
                            <TableCell>{row.paymentMethod}</TableCell>
                            <TableCell className="text-right font-medium">
                              {Number(row.amount || 0).toLocaleString('en-PK')}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell />
                          <TableCell />
                          <TableCell />
                          <TableCell className="text-right font-bold">TOTAL</TableCell>
                          <TableCell />
                          <TableCell className="text-right font-bold">{totalAmount.toLocaleString('en-PK')}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            );
          })()}
        </div>
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
