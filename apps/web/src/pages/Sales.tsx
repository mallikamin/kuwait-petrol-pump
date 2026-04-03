import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Filter, X, Camera, Image as ImageIcon } from 'lucide-react';
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

export function Sales() {
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [meterImageDialog, setMeterImageDialog] = useState<{ open: boolean; imageUrl: string; sale: any } | null>(null);
  const [saleDetailsDialog, setSaleDetailsDialog] = useState<{ open: boolean; sale: any } | null>(null);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    paymentMethod: '',
    saleType: '',
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const page = 1; // TODO: Add pagination

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sales', page, appliedFilters],
    queryFn: () => salesApi.getAll({
      page,
      size: 20,
      ...appliedFilters,
    }),
  });

  const sales = data?.items ?? [];

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
          <CardTitle>All Sales</CardTitle>
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
                      <Badge variant={(sale.sale_type || sale.sale_type) === 'fuel' ? 'default' : 'secondary'}>
                        {sale.sale_type || sale.sale_type || '-'}
                      </Badge>
                    </TableCell>
                    <TableCell>{sale.customer?.name || sale.customer?.fullName || 'Walk-in'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{sale.payment_method || sale.payment_method || '-'}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatCurrency(Number(sale.totalAmount || sale.net_amount || 0))}
                    </TableCell>
                    <TableCell>
                      {(sale.sale_type || sale.sale_type) === 'fuel' && sale.fuelSales?.[0] && (
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
                  <Badge variant={(saleDetailsDialog.sale.sale_type || saleDetailsDialog.sale.saleType) === 'fuel' ? 'default' : 'secondary'}>
                    {saleDetailsDialog.sale.sale_type || saleDetailsDialog.sale.saleType || '-'}
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
                  <Badge variant="outline">{saleDetailsDialog.sale.payment_method || saleDetailsDialog.sale.paymentMethod || '-'}</Badge>
                </div>
              </div>

              {/* Fuel Sales Details */}
              {(saleDetailsDialog.sale.sale_type || saleDetailsDialog.sale.saleType) === 'fuel' && saleDetailsDialog.sale.fuelSales?.length > 0 && (
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
              {(saleDetailsDialog.sale.sale_type || saleDetailsDialog.sale.saleType) === 'non_fuel' && saleDetailsDialog.sale.nonFuelSales?.length > 0 && (
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
                <span className="text-2xl font-bold">{formatCurrency(Number(saleDetailsDialog.sale.totalAmount || saleDetailsDialog.sale.net_amount || 0))}</span>
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
