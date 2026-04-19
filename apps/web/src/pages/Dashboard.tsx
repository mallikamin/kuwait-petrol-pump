import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertCircle, Banknote, Fuel, Package, ShoppingBag, Users, Droplet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { SalesChart } from '@/components/charts/SalesChart';
import { PaymentPieChart } from '@/components/charts/PaymentPieChart';
import { dashboardApi } from '@/api';
import { formatCurrency, formatDateTime } from '@/utils/format';

function StatCard({ title, value, icon, trend }: { title: string; value: string | number; icon: React.ReactNode; trend?: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {trend && <p className="text-xs text-muted-foreground">{trend}</p>}
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: dashboardApi.getStats,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const { data: salesChartData, isLoading: salesChartLoading } = useQuery({
    queryKey: ['dashboard-sales-chart'],
    queryFn: () => dashboardApi.getSalesChart(),
    refetchInterval: 60000,
  });

  const { data: paymentStats, isLoading: paymentStatsLoading } = useQuery({
    queryKey: ['dashboard-payment-stats'],
    queryFn: dashboardApi.getPaymentStats,
    refetchInterval: 60000,
  });

  const { data: recentTransactions, isLoading: transactionsLoading } = useQuery({
    queryKey: ['dashboard-recent-transactions'],
    queryFn: () => dashboardApi.getRecentTransactions(10),
    refetchInterval: 30000,
  });

  const { data: lowStockProducts, isLoading: lowStockLoading } = useQuery({
    queryKey: ['dashboard-low-stock'],
    queryFn: dashboardApi.getLowStockProducts,
    refetchInterval: 300000, // 5 minutes
  });

  const { data: topCustomers, isLoading: topCustomersLoading } = useQuery({
    queryKey: ['dashboard-top-customers'],
    queryFn: () => dashboardApi.getTopCustomers(5),
    refetchInterval: 300000,
  });

  const { data: litersSold, isLoading: litersSoldLoading } = useQuery({
    queryKey: ['dashboard-liters-sold'],
    queryFn: dashboardApi.getLitersSold,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your petrol pump operations</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-3">
        {statsLoading ? (
          <>
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </>
        ) : (
          <>
            <StatCard
              title="Today's Sales"
              value={formatCurrency(stats?.today_sales || 0)}
              icon={<Banknote className="h-4 w-4 text-muted-foreground" />}
              trend="Total revenue today"
            />
            <StatCard
              title="Fuel Sales"
              value={formatCurrency(stats?.today_fuel_sales || 0)}
              icon={<Fuel className="h-4 w-4 text-muted-foreground" />}
              trend="Fuel revenue today"
            />
            <StatCard
              title="Product Sales"
              value={formatCurrency(stats?.today_product_sales || 0)}
              icon={<ShoppingBag className="h-4 w-4 text-muted-foreground" />}
              trend="Non-fuel revenue today"
            />
          </>
        )}
      </div>

      {/* Secondary Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        {statsLoading ? (
          <>
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </>
        ) : (
          <>
            <Link to="/reconciliation" className="block transition-opacity hover:opacity-80">
              <StatCard
                title="Pending Bifurcations"
                value={stats?.pending_bifurcations || 0}
                icon={<AlertCircle className="h-4 w-4 text-yellow-500" />}
                trend="Click to open Reconciliation"
              />
            </Link>
            <StatCard
              title="Low Stock Items"
              value={stats?.low_stock_products || 0}
              icon={<Package className="h-4 w-4 text-red-500" />}
              trend="Below minimum level"
            />
            <StatCard
              title="Total Customers"
              value={stats?.total_customers || 0}
              icon={<Users className="h-4 w-4 text-muted-foreground" />}
              trend="Registered customers"
            />
          </>
        )}
      </div>

      {/* Fuel Sold Stats */}
      <div className="grid gap-4 md:grid-cols-2">
        {litersSoldLoading ? (
          <>
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </>
        ) : (
          <>
            <StatCard
              title="PMG Sold"
              value={`${litersSold?.pmg_sold || 0} Liters`}
              icon={<Droplet className="h-4 w-4 text-green-500" />}
              trend="Current shift"
            />
            <StatCard
              title="HSD Sold"
              value={`${litersSold?.hsd_sold || 0} Liters`}
              icon={<Droplet className="h-4 w-4 text-blue-500" />}
              trend="Current shift"
            />
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        {salesChartLoading ? (
          <Skeleton className="h-[400px]" />
        ) : (
          <SalesChart data={salesChartData || []} />
        )}
        {paymentStatsLoading ? (
          <Skeleton className="h-[400px]" />
        ) : (
          <PaymentPieChart data={paymentStats || []} />
        )}
      </div>

      {/* Tables Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Recent Transactions */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            {transactionsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Payment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentTransactions?.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell className="text-xs">
                        {formatDateTime(transaction.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={transaction.sale_type === 'fuel' ? 'default' : 'secondary'}>
                          {transaction.sale_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(transaction.net_amount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{transaction.payment_method}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Low Stock Products */}
        <Card>
          <CardHeader>
            <CardTitle>Low Stock Alert</CardTitle>
          </CardHeader>
          <CardContent>
            {lowStockLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : lowStockProducts && lowStockProducts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Min Level</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowStockProducts.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell>{product.sku}</TableCell>
                      <TableCell>{product.lowStockThreshold || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="destructive">Low Stock</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                All products are well stocked
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Customers */}
      <Card>
        <CardHeader>
          <CardTitle>Top Customers</CardTitle>
        </CardHeader>
        <CardContent>
          {topCustomersLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Credit Limit</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topCustomers?.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell>{customer.phone || 'N/A'}</TableCell>
                    <TableCell>{customer.email || 'N/A'}</TableCell>
                    <TableCell>{formatCurrency(customer.creditLimit || 0)}</TableCell>
                    <TableCell>
                      <Badge variant={customer.isActive ? 'success' : 'secondary'}>
                        {customer.isActive ? 'Active' : 'Inactive'}
                      </Badge>
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
