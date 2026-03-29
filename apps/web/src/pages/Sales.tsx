import { useQuery } from '@tanstack/react-query';
import { Download, Filter } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { salesApi } from '@/api';
import { formatCurrency, formatDateTime } from '@/utils/format';

export function Sales() {
  const page = 1; // TODO: Add pagination

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sales', page],
    queryFn: () => salesApi.getAll({ page, size: 20 }),
  });

  const sales = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sales</h1>
          <p className="text-muted-foreground">View and manage sales transactions</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Filter className="mr-2 h-4 w-4" />
            Filters
          </Button>
          <Button>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

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
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell className="text-sm">
                      {formatDateTime(sale.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={sale.sale_type === 'fuel' ? 'default' : 'secondary'}>
                        {sale.sale_type}
                      </Badge>
                    </TableCell>
                    <TableCell>{sale.customer?.name || 'Walk-in'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{sale.payment_method}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatCurrency(sale.net_amount)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          sale.status === 'completed'
                            ? 'success'
                            : sale.status === 'pending'
                            ? 'warning'
                            : 'destructive'
                        }
                      >
                        {sale.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm">
                        View Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
