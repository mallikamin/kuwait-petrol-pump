import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Fuel } from 'lucide-react';
import { fuelPricesApi } from '@/api';
import { formatCurrency } from '@/utils/format';
import { toast } from 'sonner';

export function FuelPrices() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFuelTypeId, setSelectedFuelTypeId] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]);

  const queryClient = useQueryClient();

  const { data: fuelTypes, isLoading: loadingTypes } = useQuery({
    queryKey: ['fuelTypes'],
    queryFn: () => fuelPricesApi.getFuelTypes(),
  });

  const { data: currentPrices, isLoading: loadingCurrentPrices } = useQuery({
    queryKey: ['currentPrices'],
    queryFn: () => fuelPricesApi.getCurrentPrices(),
  });

  const { data: priceHistory, isLoading: loadingHistory } = useQuery({
    queryKey: ['priceHistory', 1],
    queryFn: () => fuelPricesApi.getPriceHistory(undefined, { page: 1, size: 20 }),
  });

  const updateMutation = useMutation({
    mutationFn: fuelPricesApi.updatePrice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentPrices'] });
      queryClient.invalidateQueries({ queryKey: ['priceHistory'] });
      toast.success('Fuel price updated successfully');
      handleCloseDialog();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || 'Failed to update price');
    },
  });

  // Build price lookup: fuelTypeId -> current price
  const priceLookup = new Map<string, number>();
  currentPrices?.forEach((p: any) => {
    if (p.fuelTypeId && p.pricePerLiter) {
      priceLookup.set(p.fuelTypeId, Number(p.pricePerLiter));
    }
  });

  const handleOpenDialog = (fuelTypeId?: string) => {
    if (fuelTypeId) {
      setSelectedFuelTypeId(fuelTypeId);
      const currentPrice = priceLookup.get(fuelTypeId);
      setNewPrice(currentPrice?.toString() || '');
    } else {
      setSelectedFuelTypeId('');
      setNewPrice('');
    }
    setEffectiveDate(new Date().toISOString().split('T')[0]);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedFuelTypeId('');
    setNewPrice('');
  };

  const handleSubmit = () => {
    if (!selectedFuelTypeId || !newPrice) {
      toast.error('Please fill all required fields');
      return;
    }

    updateMutation.mutate({
      fuelTypeId: selectedFuelTypeId,
      price: parseFloat(newPrice),
      effectiveFrom: new Date(effectiveDate).toISOString(),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fuel Prices</h1>
          <p className="text-muted-foreground">Manage fuel pricing and history</p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="mr-2 h-4 w-4" />
          Update Price
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Prices</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingTypes || loadingCurrentPrices ? (
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
                {fuelTypes?.map((fuelType) => {
                  const currentPrice = priceLookup.get(fuelType.id);
                  return (
                    <TableRow key={fuelType.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center">
                          <Fuel className="mr-2 h-4 w-4 text-muted-foreground" />
                          {fuelType.name}
                        </div>
                      </TableCell>
                      <TableCell>{fuelType.code}</TableCell>
                      <TableCell>
                        {currentPrice ? formatCurrency(currentPrice) : <span className="text-muted-foreground">Not set</span>}
                      </TableCell>
                      <TableCell>{fuelType.unit}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenDialog(fuelType.id)}
                        >
                          Update
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
                    <TableCell>{price.fuelType?.name || (price as any).fuel_type?.name || '-'}</TableCell>
                    <TableCell>{formatCurrency(Number(price.pricePerLiter || (price as any).price || 0))}</TableCell>
                    <TableCell>{new Date(price.effectiveFrom || (price as any).effective_from).toLocaleDateString()}</TableCell>
                    <TableCell>-</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Update Price Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Update Fuel Price</DialogTitle>
            <DialogDescription>
              Set a new price for the selected fuel type. This will be recorded in price history.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="fuel-type">Fuel Type *</Label>
              <Select value={selectedFuelTypeId} onValueChange={setSelectedFuelTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select fuel type" />
                </SelectTrigger>
                <SelectContent>
                  {fuelTypes?.map((fuel) => (
                    <SelectItem key={fuel.id} value={fuel.id}>
                      {fuel.name} ({fuel.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="price">Price per Liter *</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="effective-date">Effective Date *</Label>
              <Input
                id="effective-date"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={updateMutation.isPending || !selectedFuelTypeId || !newPrice}
            >
              {updateMutation.isPending ? 'Updating...' : 'Update Price'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
