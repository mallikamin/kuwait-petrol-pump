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
    // TODO: Implement CSV export
    alert('Export functionality will be implemented');
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
                      <Button variant="ghost" size="sm">
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
