import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Filter, X, Camera, Image as ImageIcon, Fuel, Banknote, CreditCard, Wallet, List, Users, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { salesApi } from '@/api';
import { formatCurrency, formatDateTime } from '@/utils/format';
import { useAuthStore } from '@/store/auth';

export function Sales() {
  const { user } = useAuthStore();
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [meterImageDialog, setMeterImageDialog] = useState<{ open: boolean; imageUrl: string; sale: any } | null>(null);
  const [saleDetailsDialog, setSaleDetailsDialog] = useState<{ open: boolean; sale: any } | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'customer'>('list');
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    paymentMethod: '',
    saleType: '',
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const page = 1; // TODO: Add pagination

  // Canonical branch resolution (handle multiple possible response shapes)
  const branchId = user?.branch_id || (user as any)?.branch?.id || (user as any)?.branchId;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sales', page, appliedFilters],
    queryFn: () => salesApi.getAll({
      page,
      size: 20,
      ...appliedFilters,
    }),
  });

  // Get sales summary for payment tracking
  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['sales-summary', branchId, appliedFilters],
    queryFn: () => {
      if (!branchId) return Promise.resolve({ summary: {
        totalSales: 0,
        totalAmount: 0,
        fuelSales: { totalLiters: 0, totalAmount: 0 },
        nonFuelSales: { totalItems: 0, totalAmount: 0 },
        paymentBreakdown: [],
      }});

      return salesApi.getSummary(branchId, {
        startDate: appliedFilters.startDate || undefined,
        endDate: appliedFilters.endDate || undefined,
      });
    },
    enabled: !!branchId,
    refetchInterval: 30000, // Refetch every 30 seconds for real-time tracking
  });

  const sales = data?.items ?? [];
  const summary = summaryData?.summary;

  const getSaleType = (sale: any): string => sale.saleType || sale.sale_type || '-';
  const getPaymentMethod = (sale: any): string => sale.paymentMethod || sale.payment_method || '-';
  const getTotalAmount = (sale: any): number => Number(sale.totalAmount || sale.net_amount || 0);
  const prettyPaymentMethod = (method: string): string => {
    const m = (method || '').toLowerCase();
    if (m === 'credit_customer' || m === 'credit') return 'credit';
    if (m === 'credit_card' || m === 'bank_card' || m === 'card') return m;
    return method || '-';
  };

  const handleApplyFilters = () => {
    setAppliedFilters(filters);
    setIsFilterDialogOpen(false);
  };

  const handleClearFilters = () => {
    const emptyFilters = {
      startDate: '',
      endDate: '',
      paymentMethod: '',
      saleType: '',
    };
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setIsFilterDialogOpen(false);
  };

  const hasActiveFilters = Object.values(appliedFilters).some(v => v !== '');

  // Group sales by customer (for customer view mode)
  const groupedByCustomer = () => {
    const grouped = new Map<string, { customer: any; sales: any[]; vehicles: Map<string, any[]> }>();

    sales.forEach((sale: any) => {
      const customerId = sale.customer?.id || 'walk-in';
      const customerName = sale.customer?.name || 'Walk-in Customer';
      const vehicleNumber = sale.vehicleNumber || 'N/A';

      if (!grouped.has(customerId)) {
        grouped.set(customerId, {
          customer: { id: customerId, name: customerName },
          sales: [],
          vehicles: new Map(),
        });
      }

      const customerGroup = grouped.get(customerId)!;
      customerGroup.sales.push(sale);

      if (!customerGroup.vehicles.has(vehicleNumber)) {
        customerGroup.vehicles.set(vehicleNumber, []);
      }
      customerGroup.vehicles.get(vehicleNumber)!.push(sale);
    });

    return Array.from(grouped.values());
  };

  const toggleCustomerExpand = (customerId: string) => {
    const newExpanded = new Set(expandedCustomers);
    if (newExpanded.has(customerId)) {
      newExpanded.delete(customerId);
    } else {
      newExpanded.add(customerId);
    }
    setExpandedCustomers(newExpanded);
  };

  const handleExport = () => {
    if (!sales || sales.length === 0) {
      alert('No sales data to export');
      return;
    }

    // Prepare CSV data
    const headers = ['Date', 'Type', 'Customer', 'Vehicle#', 'Payment Method', 'Amount', 'Status', 'Slip#'];
    const rows = sales.map((sale: any) => [
      formatDateTime(sale.saleDate || sale.createdAt || sale.created_at),
      sale.sale_type || sale.saleType || '-',
      sale.customer?.name || 'Walk-in',
      sale.vehicleNumber || '-',
      sale.payment_method || sale.paymentMethod || '-',
      Number(sale.totalAmount || sale.net_amount || 0).toFixed(2),
      sale.status || 'completed',
      sale.slipNumber || '-',
    ]);

    // Generate CSV content
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sales-export-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Helper to get payment breakdown by method
  const getPaymentAmount = (method: string) => {
    if (!summary) return 0;
    const normalized = method.toLowerCase();
    return summary.paymentBreakdown
      .filter(pb => {
        const m = (pb.method || '').toLowerCase();
        if (normalized === 'credit') return m === 'credit' || m === 'credit_customer';
        if (normalized === 'card') return m === 'card' || m === 'credit_card' || m === 'bank_card';
        return m === normalized;
      })
      .reduce((sum, pb) => sum + (pb.amount || 0), 0);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sales</h1>
          <p className="text-muted-foreground">View and manage sales transactions</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setIsFilterDialogOpen(true)}
            className={hasActiveFilters ? 'border-primary' : ''}
          >
            <Filter className="mr-2 h-4 w-4" />
            Filters
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-2">
                Active
              </Badge>
            )}
          </Button>
          <Button onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Payment Tracking Summary */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {summaryLoading ? (
          <>
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </>
        ) : (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Volume</CardTitle>
                <Fuel className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary?.fuelSales.totalLiters.toFixed(2) || '0.00'} L</div>
                <p className="text-xs text-muted-foreground">Fuel sold</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Amount</CardTitle>
                <Banknote className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(summary?.totalAmount || 0)}</div>
                <p className="text-xs text-muted-foreground">{summary?.totalSales || 0} transactions</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Credit Sales</CardTitle>
                <CreditCard className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(getPaymentAmount('credit'))}</div>
                <p className="text-xs text-muted-foreground">Customer credit</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Card + Cash Sales</CardTitle>
                <Wallet className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(getPaymentAmount('cash') + getPaymentAmount('card') + getPaymentAmount('pso_card'))}
                </div>
                <p className="text-xs text-muted-foreground">Card & cash payments</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Active Filters Display */}
      {hasActiveFilters && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">Active Filters:</span>
              {appliedFilters.startDate && (
                <Badge variant="secondary">
                  From: {appliedFilters.startDate}
                  <X
                    className="ml-1 h-3 w-3 cursor-pointer"
                    onClick={() => {
                      setFilters({ ...filters, startDate: '' });
                      setAppliedFilters({ ...appliedFilters, startDate: '' });
                    }}
                  />
                </Badge>
              )}
              {appliedFilters.endDate && (
                <Badge variant="secondary">
                  To: {appliedFilters.endDate}
                  <X
                    className="ml-1 h-3 w-3 cursor-pointer"
                    onClick={() => {
                      setFilters({ ...filters, endDate: '' });
                      setAppliedFilters({ ...appliedFilters, endDate: '' });
                    }}
                  />
                </Badge>
              )}
              {appliedFilters.paymentMethod && (
                <Badge variant="secondary">
                  Payment: {appliedFilters.paymentMethod}
                  <X
                    className="ml-1 h-3 w-3 cursor-pointer"
                    onClick={() => {
                      setFilters({ ...filters, paymentMethod: '' });
                      setAppliedFilters({ ...appliedFilters, paymentMethod: '' });
                    }}
                  />
                </Badge>
              )}
              {appliedFilters.saleType && (
                <Badge variant="secondary">
                  Type: {appliedFilters.saleType}
                  <X
                    className="ml-1 h-3 w-3 cursor-pointer"
                    onClick={() => {
                      setFilters({ ...filters, saleType: '' });
                      setAppliedFilters({ ...appliedFilters, saleType: '' });
                    }}
                  />
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
              >
                Clear All
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>All Sales</CardTitle>
            <div className="flex gap-2">
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('list')}
              >
                <List className="mr-2 h-4 w-4" />
                List View
              </Button>
              <Button
                variant={viewMode === 'customer' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('customer')}
              >
                <Users className="mr-2 h-4 w-4" />
                Customer View
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : isError ? (
            <div className="py-8 text-center text-muted-foreground">
              Failed to load sales. Check your connection and try again.
            </div>
          ) : sales.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No sales found.
            </div>
          ) : viewMode === 'customer' ? (
            <div className="space-y-4">
              {groupedByCustomer().map((customerGroup) => {
                const isExpanded = expandedCustomers.has(customerGroup.customer.id);
                const totalAmount = customerGroup.sales.reduce((sum, sale) => sum + getTotalAmount(sale), 0);
                const totalTransactions = customerGroup.sales.length;

                return (
                  <div key={customerGroup.customer.id} className="border rounded-lg overflow-hidden">
                    {/* Customer Header */}
                    <div
                      className="flex items-center justify-between p-4 bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors"
                      onClick={() => toggleCustomerExpand(customerGroup.customer.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
                          <Users className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold">{customerGroup.customer.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {totalTransactions} transaction{totalTransactions !== 1 ? 's' : ''} • {customerGroup.vehicles.size} vehicle{customerGroup.vehicles.size !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-2xl font-bold">{formatCurrency(totalAmount)}</div>
                          <div className="text-xs text-muted-foreground">Total</div>
                        </div>
                        {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                      </div>
                    </div>

                    {/* Expanded Vehicle Groups */}
                    {isExpanded && (
                      <div className="divide-y">
                        {Array.from(customerGroup.vehicles.entries()).map(([vehicleNumber, vehicleSales]) => {
                          const vehicleTotal = vehicleSales.reduce((sum, sale) => sum + getTotalAmount(sale), 0);

                          return (
                            <div key={vehicleNumber} className="bg-background">
                              {/* Vehicle Header */}
                              <div className="flex items-center justify-between px-4 py-2 bg-muted/30">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="font-mono">{vehicleNumber}</Badge>
                                  <span className="text-sm text-muted-foreground">{vehicleSales.length} transaction{vehicleSales.length !== 1 ? 's' : ''}</span>
                                </div>
                                <div className="font-semibold">{formatCurrency(vehicleTotal)}</div>
                              </div>

                              {/* Transaction List */}
                              <Table>
                                <TableBody>
                                  {vehicleSales.map((sale: any) => (
                                    <TableRow key={sale.id} className="text-sm">
                                      <TableCell className="w-[140px]">{formatDateTime(sale.saleDate || sale.createdAt || sale.created_at)}</TableCell>
                                      <TableCell>
                                        <Badge variant={getSaleType(sale) === 'fuel' ? 'default' : 'secondary'} className="text-xs">
                                          {getSaleType(sale)}
                                        </Badge>
                                      </TableCell>
                                      <TableCell>
                                        <Badge variant="outline" className="text-xs">{prettyPaymentMethod(getPaymentMethod(sale))}</Badge>
                                      </TableCell>
                                      <TableCell className="font-medium">{formatCurrency(getTotalAmount(sale))}</TableCell>
                                      <TableCell className="w-[80px]">
                                        <Badge variant="success" className="text-xs">{sale.status || 'completed'}</Badge>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Meter</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((sale: any) => (
                  <TableRow key={sale.id}>
                    <TableCell className="text-sm">
                      {formatDateTime(sale.saleDate || sale.createdAt || sale.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getSaleType(sale) === 'fuel' ? 'default' : 'secondary'}>
                        {getSaleType(sale)}
                      </Badge>
                    </TableCell>
                    <TableCell>{sale.customer?.name || sale.customer?.fullName || 'Walk-in'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{prettyPaymentMethod(getPaymentMethod(sale))}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatCurrency(getTotalAmount(sale))}
                    </TableCell>
                    <TableCell>
                      {getSaleType(sale) === 'fuel' && sale.fuelSales?.[0] && (
                        <div className="flex flex-col gap-1 text-xs">
                          {sale.fuelSales[0].previousReading != null && sale.fuelSales[0].currentReading != null ? (
                            <>
                              <div className="flex items-center gap-1">
                                <Camera className="h-3 w-3" />
                                <span>{sale.fuelSales[0].previousReading} → {sale.fuelSales[0].currentReading}</span>
                              </div>
                              {sale.fuelSales[0].imageUrl && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => setMeterImageDialog({
                                    open: true,
                                    imageUrl: sale.fuelSales[0].imageUrl,
                                    sale
                                  })}
                                >
                                  <ImageIcon className="h-3 w-3 mr-1" />
                                  View
                                </Button>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          sale.status === 'completed'
                            ? 'default'
                            : sale.status === 'pending'
                            ? 'secondary'
                            : 'destructive'
                        }
                      >
                        {sale.status || 'completed'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSaleDetailsDialog({ open: true, sale })}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Sale Details Dialog */}
      {saleDetailsDialog && (
        <Dialog open={saleDetailsDialog.open} onOpenChange={(open) => !open && setSaleDetailsDialog(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Sale Details</DialogTitle>
              <DialogDescription>
                Complete transaction information
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Sale ID</Label>
                  <p className="font-mono text-sm">{saleDetailsDialog.sale.id}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Slip Number</Label>
                  <p className="font-medium">{saleDetailsDialog.sale.slipNumber || '-'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Date & Time</Label>
                  <p>{formatDateTime(saleDetailsDialog.sale.saleDate || saleDetailsDialog.sale.createdAt)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Type</Label>
                  <Badge variant={getSaleType(saleDetailsDialog.sale) === 'fuel' ? 'default' : 'secondary'}>
                    {getSaleType(saleDetailsDialog.sale)}
                  </Badge>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Customer</Label>
                  <p>{saleDetailsDialog.sale.customer?.name || 'Walk-in'}</p>
                  {saleDetailsDialog.sale.vehicleNumber && (
                    <p className="text-xs text-muted-foreground">Vehicle: {saleDetailsDialog.sale.vehicleNumber}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Payment Method</Label>
                  <Badge variant="outline">{prettyPaymentMethod(getPaymentMethod(saleDetailsDialog.sale))}</Badge>
                </div>
              </div>

              {/* Fuel Sales Details */}
              {getSaleType(saleDetailsDialog.sale) === 'fuel' && saleDetailsDialog.sale.fuelSales?.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-3">Fuel Sales</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fuel Type</TableHead>
                        <TableHead className="text-right">Quantity (L)</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {saleDetailsDialog.sale.fuelSales.map((fs: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell>{fs.fuelType?.name || '-'}</TableCell>
                          <TableCell className="text-right">{Number(fs.quantityLiters || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(fs.pricePerLiter || 0)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(fs.totalAmount || 0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Non-Fuel Sales Details */}
              {getSaleType(saleDetailsDialog.sale) === 'non_fuel' && saleDetailsDialog.sale.nonFuelSales?.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-3">Non-Fuel Items</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {saleDetailsDialog.sale.nonFuelSales.map((item: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell>{item.product?.name || '-'}</TableCell>
                          <TableCell className="text-right">{item.quantity || 0}</TableCell>
                          <TableCell className="text-right">{formatCurrency(item.unitPrice || 0)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(item.totalAmount || 0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Total Amount */}
              <div className="flex justify-between items-center p-4 bg-muted rounded-lg">
                <span className="font-semibold">Total Amount</span>
                <span className="text-2xl font-bold">{formatCurrency(getTotalAmount(saleDetailsDialog.sale))}</span>
              </div>

              {/* Additional Info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                {saleDetailsDialog.sale.cashier && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Cashier</Label>
                    <p>{saleDetailsDialog.sale.cashier.fullName || saleDetailsDialog.sale.cashier.username}</p>
                  </div>
                )}
                {saleDetailsDialog.sale.shift && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Shift</Label>
                    <p>{saleDetailsDialog.sale.shift.name}</p>
                  </div>
                )}
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge
                      variant={
                        saleDetailsDialog.sale.status === 'completed'
                          ? 'default'
                          : saleDetailsDialog.sale.status === 'pending'
                          ? 'secondary'
                          : 'destructive'
                      }
                    >
                      {saleDetailsDialog.sale.status || 'completed'}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSaleDetailsDialog(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Meter Image Dialog */}
      {meterImageDialog && (
        <Dialog open={meterImageDialog.open} onOpenChange={(open) => !open && setMeterImageDialog(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Meter Reading Image</DialogTitle>
              <DialogDescription>
                {meterImageDialog.sale.fuelSales?.[0] && (
                  <div className="space-y-2 mt-2">
                    <div className="flex justify-between text-sm">
                      <span>Previous Reading:</span>
                      <span className="font-medium">{meterImageDialog.sale.fuelSales[0].previousReading}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Current Reading:</span>
                      <span className="font-medium">{meterImageDialog.sale.fuelSales[0].currentReading}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Calculated Liters:</span>
                      <span className="font-medium">{meterImageDialog.sale.fuelSales[0].calculatedLiters || '-'}</span>
                    </div>
                    {meterImageDialog.sale.fuelSales[0].ocrConfidence && (
                      <div className="flex justify-between text-sm">
                        <span>OCR Confidence:</span>
                        <span className="font-medium">{(meterImageDialog.sale.fuelSales[0].ocrConfidence * 100).toFixed(1)}%</span>
                      </div>
                    )}
                    {meterImageDialog.sale.fuelSales[0].isManualReading && (
                      <Badge variant="secondary">Manual Entry</Badge>
                    )}
                  </div>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <img
                src={meterImageDialog.imageUrl}
                alt="Meter Reading"
                className="w-full rounded-lg border"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMeterImageDialog(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Filter Dialog */}
      <Dialog open={isFilterDialogOpen} onOpenChange={setIsFilterDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filter Sales</DialogTitle>
            <DialogDescription>
              Filter sales by date range, payment method, and sale type
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentMethod">Payment Method</Label>
              <select
                id="paymentMethod"
                value={filters.paymentMethod}
                onChange={(e) => setFilters({ ...filters, paymentMethod: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="">All</option>
                <option value="cash">Cash</option>
                <option value="credit">Credit</option>
                <option value="pso_card">PSO Card</option>
                <option value="bank_card">Bank Card</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="saleType">Sale Type</Label>
              <select
                id="saleType"
                value={filters.saleType}
                onChange={(e) => setFilters({ ...filters, saleType: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="">All</option>
                <option value="fuel">Fuel</option>
                <option value="non_fuel">Non-Fuel</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClearFilters}>
              Clear
            </Button>
            <Button onClick={handleApplyFilters}>
              Apply Filters
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
