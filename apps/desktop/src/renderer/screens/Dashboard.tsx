import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { salesApi, shiftsApi, productsApi, nozzlesApi, fuelPricesApi } from '../api/endpoints';
import { useAppStore } from '../store/appStore';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { formatCurrency, formatNumber } from '../utils/format';
import {
  DollarSign,
  Fuel,
  ShoppingCart,
  CreditCard,
  AlertTriangle,
  Activity,
} from 'lucide-react';

export const Dashboard: React.FC = () => {
  const { currentBranch, currentShift } = useAppStore();

  // Fetch sales summary
  const { data: salesSummary, isLoading: loadingSummary } = useQuery({
    queryKey: ['sales-summary', currentBranch?.id, currentShift?.id],
    queryFn: () =>
      salesApi.getSummary({
        branchId: currentBranch!.id,
        shiftInstanceId: currentShift?.id,
        startDate: new Date().toISOString().split('T')[0],
      }),
    enabled: !!currentBranch,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch low stock products
  const { data: lowStockData } = useQuery({
    queryKey: ['low-stock', currentBranch?.id],
    queryFn: () => productsApi.getLowStock(currentBranch?.id),
    enabled: !!currentBranch,
  });

  // Fetch active nozzles
  const { data: nozzles } = useQuery({
    queryKey: ['nozzles', currentBranch?.id],
    queryFn: () => nozzlesApi.getAll({ branchId: currentBranch?.id, isActive: true }),
    enabled: !!currentBranch,
  });

  // Fetch current fuel prices
  const { data: fuelPrices } = useQuery({
    queryKey: ['fuel-prices'],
    queryFn: () => fuelPricesApi.getCurrent(),
  });

  const summary = salesSummary?.data.summary;
  const lowStockProducts = lowStockData?.data || [];
  const activeNozzles = nozzles?.data || [];

  const stats = [
    {
      title: 'Total Sales',
      value: summary ? formatCurrency(summary.totalAmount) : 'KWD 0.000',
      subtitle: `${summary?.totalSales || 0} transactions`,
      icon: DollarSign,
      color: 'blue',
    },
    {
      title: 'Fuel Sales',
      value: summary ? formatCurrency(summary.fuelSales.totalAmount) : 'KWD 0.000',
      subtitle: `${summary ? formatNumber(summary.fuelSales.totalLiters) : 0} liters`,
      icon: Fuel,
      color: 'green',
    },
    {
      title: 'Non-Fuel Sales',
      value: summary ? formatCurrency(summary.nonFuelSales.totalAmount) : 'KWD 0.000',
      subtitle: `${summary?.nonFuelSales.totalItems || 0} items`,
      icon: ShoppingCart,
      color: 'purple',
    },
    {
      title: 'Active Nozzles',
      value: activeNozzles.length,
      subtitle: 'Ready for use',
      icon: Activity,
      color: 'orange',
    },
  ];

  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    purple: 'bg-purple-100 text-purple-600',
    orange: 'bg-orange-100 text-orange-600',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          {currentShift
            ? `Current Shift: ${currentShift.shift.name}`
            : 'No active shift'}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">{stat.title}</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{stat.value}</p>
                    <p className="mt-1 text-xs text-slate-500">{stat.subtitle}</p>
                  </div>
                  <div
                    className={`rounded-full p-3 ${
                      colorClasses[stat.color as keyof typeof colorClasses]
                    }`}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Two Column Layout */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Payment Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Payment Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingSummary ? (
              <div className="text-sm text-slate-500">Loading...</div>
            ) : summary?.paymentBreakdown && summary.paymentBreakdown.length > 0 ? (
              <div className="space-y-3">
                {summary.paymentBreakdown.map((payment) => (
                  <div
                    key={payment.method}
                    className="flex items-center justify-between rounded-lg border border-slate-200 p-3"
                  >
                    <div>
                      <p className="font-medium capitalize text-slate-900">
                        {payment.method.replace('_', ' ')}
                      </p>
                      <p className="text-sm text-slate-500">{payment.count} transactions</p>
                    </div>
                    <p className="text-lg font-semibold text-slate-900">
                      {formatCurrency(payment.amount)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-500">No transactions yet</div>
            )}
          </CardContent>
        </Card>

        {/* Low Stock Alerts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              Low Stock Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lowStockProducts.length > 0 ? (
              <div className="space-y-3">
                {lowStockProducts.slice(0, 5).map((stock) => (
                  <div
                    key={stock.id}
                    className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 p-3"
                  >
                    <div>
                      <p className="font-medium text-slate-900">{stock.product.name}</p>
                      <p className="text-sm text-slate-600">SKU: {stock.product.sku}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-orange-600">
                        {stock.quantity}
                      </p>
                      <p className="text-xs text-slate-500">in stock</p>
                    </div>
                  </div>
                ))}
                {lowStockProducts.length > 5 && (
                  <p className="text-sm text-slate-500">
                    +{lowStockProducts.length - 5} more products
                  </p>
                )}
              </div>
            ) : (
              <div className="text-sm text-slate-500">All products are well stocked</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Current Fuel Prices */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fuel className="h-5 w-5" />
            Current Fuel Prices
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {fuelPrices?.data.prices.map((price) => (
              <div
                key={price.fuelType.code}
                className="rounded-lg border border-slate-200 p-4 text-center"
              >
                <p className="text-sm font-medium text-slate-600">
                  {price.fuelType.name}
                </p>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {formatCurrency(price.pricePerLiter)}
                </p>
                <p className="text-xs text-slate-500">per liter</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
