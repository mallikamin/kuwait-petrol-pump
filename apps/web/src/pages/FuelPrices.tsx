import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Fuel } from 'lucide-react';
import { fuelPricesApi } from '@/api';
import { formatCurrency } from '@/utils/format';

export function FuelPrices() {
  const { data: fuelTypes, isLoading: loadingTypes } = useQuery({
    queryKey: ['fuelTypes'],
    queryFn: () => fuelPricesApi.getFuelTypes(),
  });

  const { data: priceHistory, isLoading: loadingHistory } = useQuery({
    queryKey: ['priceHistory', 1],
    queryFn: () => fuelPricesApi.getPriceHistory(undefined, { page: 1, size: 20 }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fuel Prices</h1>
          <p className="text-muted-foreground">Manage fuel pricing and history</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Update Price
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Prices</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingTypes ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fuel Type</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Current Price</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fuelTypes?.map((fuelType) => (
                  <TableRow key={fuelType.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center">
                        <Fuel className="mr-2 h-4 w-4 text-muted-foreground" />
                        {fuelType.name}
                      </div>
                    </TableCell>
                    <TableCell>{fuelType.code}</TableCell>
                    <TableCell>-</TableCell>
                    <TableCell>{fuelType.unit}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm">
                        Update
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Price History</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingHistory ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fuel Type</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Effective From</TableHead>
                  <TableHead>Changed By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {priceHistory?.items.map((price) => (
                  <TableRow key={price.id}>
                    <TableCell>{price.fuel_type?.name || '-'}</TableCell>
                    <TableCell>{formatCurrency(Number(price.price))}</TableCell>
                    <TableCell>{new Date(price.effective_from).toLocaleDateString()}</TableCell>
                    <TableCell>-</TableCell>
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
