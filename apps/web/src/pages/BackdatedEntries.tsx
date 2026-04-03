import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar, DollarSign, AlertCircle, CheckCircle, History } from 'lucide-react';
import { apiClient } from '@/api/client';
import { branchesApi } from '@/api';
import { toast } from 'sonner';
import { format } from 'date-fns';

export function BackdatedEntries() {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedNozzleId, setSelectedNozzleId] = useState('');
  const [openingReading, setOpeningReading] = useState('');
  const [closingReading, setClosingReading] = useState('');
  const [creditCardSales, setCreditCardSales] = useState('0');
  const [bankCardSales, setBankCardSales] = useState('0');
  const [psoCardSales, setPsoCardSales] = useState('0');
  const [notes, setNotes] = useState('');

  const queryClient = useQueryClient();

  // Fetch nozzles
  const { data: nozzlesData } = useQuery({
    queryKey: ['branches', 'dispensing-units'],
    queryFn: async () => {
      const branches = await branchesApi.getAll();
      if (branches.items.length > 0 && (branches.items[0] as any).dispensingUnits) {
        return (branches.items[0] as any).dispensingUnits.flatMap((unit: any) => unit.nozzles || []);
      }
      return [];
    },
  });

  // Fetch backdated entries history
  const { data: entriesData, isLoading: entriesLoading } = useQuery({
    queryKey: ['backdated-entries'],
    queryFn: async () => {
      const res = await apiClient.get('/api/backdated-entries');
      return res.data;
    },
  });

  // Fetch fuel prices to calculate total sales
  const selectedNozzle = nozzlesData?.find((n: any) => n.id === selectedNozzleId);

  // Calculate values
  const salesVolume = closingReading && openingReading
    ? parseFloat(closingReading) - parseFloat(openingReading)
    : 0;

  const fuelPrice = selectedNozzle?.fuelType?.code === 'HSD' ? 0.280 : 0.463; // TODO: Fetch from API
  const totalSalesAmount = salesVolume * fuelPrice;

  const totalCardSales =
    parseFloat(creditCardSales || '0') +
    parseFloat(bankCardSales || '0') +
    parseFloat(psoCardSales || '0');

  const cashSales = totalSalesAmount - totalCardSales;

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiClient.post('/api/backdated-entries', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backdated-entries'] });
      toast.success('Backdated entry created successfully');
      resetForm();
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || 'Failed to create backdated entry';
      toast.error(errorMsg);
    },
  });

  const resetForm = () => {
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setSelectedNozzleId('');
    setOpeningReading('');
    setClosingReading('');
    setCreditCardSales('0');
    setBankCardSales('0');
    setPsoCardSales('0');
    setNotes('');
  };

  const handleSubmit = () => {
    if (!selectedNozzleId || !openingReading || !closingReading) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (parseFloat(closingReading) <= parseFloat(openingReading)) {
      toast.error('Closing reading must be greater than opening reading');
      return;
    }

    if (cashSales < 0) {
      toast.error(`Card sales (${totalCardSales.toFixed(2)}) exceed total sales (${totalSalesAmount.toFixed(2)})`);
      return;
    }

    createMutation.mutate({
      date: new Date(date).toISOString(),
      nozzleId: selectedNozzleId,
      openingReading: parseFloat(openingReading),
      closingReading: parseFloat(closingReading),
      creditCardSales: parseFloat(creditCardSales || '0'),
      bankCardSales: parseFloat(bankCardSales || '0'),
      psoCardSales: parseFloat(psoCardSales || '0'),
      notes,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Backdated Entries</h1>
          <p className="text-muted-foreground">Post historical meter readings and transactions</p>
        </div>
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-orange-600" />
          <span className="text-sm text-orange-600 font-medium">No Shift Required</span>
        </div>
      </div>

      {/* Info Alert */}
      <Alert className="border-orange-200 bg-orange-50">
        <AlertCircle className="h-4 w-4 text-orange-600" />
        <AlertDescription className="text-sm text-orange-900">
          <strong>Note:</strong> Backdated entries bypass shift validation and are intended for accountant backlog processing only.
          Closing readings automatically become the next day's opening readings.
        </AlertDescription>
      </Alert>

      {/* Transaction History - POS Style */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Transaction History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entriesLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : !entriesData?.items || entriesData.items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="mx-auto h-12 w-12 mb-3 opacity-30" />
              <p>No backdated entries yet</p>
              <p className="text-sm">Create your first entry below</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Nozzle</TableHead>
                  <TableHead>Opening</TableHead>
                  <TableHead>Closing</TableHead>
                  <TableHead>Sales (L)</TableHead>
                  <TableHead>Cash</TableHead>
                  <TableHead>Card Sales</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entriesData.items.map((entry: any) => {
                  const sales = entry.closingReading - entry.openingReading;
                  const total = (entry.creditCardSales || 0) + (entry.bankCardSales || 0) + (entry.psoCardSales || 0);
                  const cash = entry.totalAmount - total;
                  const nozzle = nozzlesData?.find((n: any) => n.id === entry.nozzleId);

                  return (
                    <TableRow key={entry.id} className="font-mono text-sm">
                      <TableCell className="font-normal">{format(new Date(entry.date), 'dd MMM yyyy')}</TableCell>
                      <TableCell className="font-medium">
                        {nozzle?.name || `Nozzle ${nozzle?.nozzleNumber || '?'}`}
                        <span className="text-xs text-muted-foreground ml-1">
                          ({nozzle?.fuelType?.code || '-'})
                        </span>
                      </TableCell>
                      <TableCell className="text-green-600">{entry.openingReading.toFixed(2)}</TableCell>
                      <TableCell className="text-red-600">{entry.closingReading.toFixed(2)}</TableCell>
                      <TableCell className="font-semibold">{sales.toFixed(2)} L</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          {cash.toFixed(2)} KWD
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs space-y-1">
                          {entry.creditCardSales > 0 && <div>CC: {entry.creditCardSales.toFixed(2)}</div>}
                          {entry.bankCardSales > 0 && <div>Bank: {entry.bankCardSales.toFixed(2)}</div>}
                          {entry.psoCardSales > 0 && <div>PSO: {entry.psoCardSales.toFixed(2)}</div>}
                        </div>
                      </TableCell>
                      <TableCell className="font-bold">{entry.totalAmount.toFixed(2)} KWD</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Main Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Meter Reading Entry
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Date and Nozzle Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                max={format(new Date(), 'yyyy-MM-dd')}
              />
            </div>

            <div className="space-y-2">
              <Label>Nozzle *</Label>
              <Select value={selectedNozzleId} onValueChange={setSelectedNozzleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select nozzle" />
                </SelectTrigger>
                <SelectContent>
                  {nozzlesData?.map((nozzle: any) => (
                    <SelectItem key={nozzle.id} value={nozzle.id}>
                      {nozzle.name || `Nozzle ${nozzle.nozzleNumber}`} - {nozzle.fuelType?.name || 'Unknown'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Meter Readings */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Opening Reading *</Label>
              <Input
                type="number"
                step="0.01"
                value={openingReading}
                onChange={(e) => setOpeningReading(e.target.value)}
                placeholder="1000000"
              />
            </div>

            <div className="space-y-2">
              <Label>Closing Reading *</Label>
              <Input
                type="number"
                step="0.01"
                value={closingReading}
                onChange={(e) => setClosingReading(e.target.value)}
                placeholder="1001250"
              />
            </div>

            <div className="space-y-2">
              <Label>Sales (Auto-calculated)</Label>
              <Input
                type="number"
                value={salesVolume.toFixed(2)}
                readOnly
                className="bg-muted font-semibold text-blue-600"
              />
            </div>
          </div>

          {/* Sales Summary */}
          {salesVolume > 0 && selectedNozzle && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-xs text-blue-600 mb-1">Fuel Type</div>
                  <div className="font-semibold">{selectedNozzle.fuelType?.name}</div>
                </div>
                <div>
                  <div className="text-xs text-blue-600 mb-1">Volume</div>
                  <div className="font-semibold">{salesVolume.toFixed(2)} L</div>
                </div>
                <div>
                  <div className="text-xs text-blue-600 mb-1">Price/Liter</div>
                  <div className="font-semibold">KWD {fuelPrice.toFixed(3)}</div>
                </div>
                <div>
                  <div className="text-xs text-blue-600 mb-1">Total Sales</div>
                  <div className="font-semibold text-lg">KWD {totalSalesAmount.toFixed(2)}</div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Bifurcation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Payment Bifurcation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Credit Card Sales</Label>
              <Input
                type="number"
                step="0.01"
                value={creditCardSales}
                onChange={(e) => setCreditCardSales(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <Label>Bank Card Sales</Label>
              <Input
                type="number"
                step="0.01"
                value={bankCardSales}
                onChange={(e) => setBankCardSales(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <Label>PSO Card Sales</Label>
              <Input
                type="number"
                step="0.01"
                value={psoCardSales}
                onChange={(e) => setPsoCardSales(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <Label>Cash Sales (Auto)</Label>
              <Input
                type="number"
                value={cashSales.toFixed(2)}
                readOnly
                className={`font-semibold ${cashSales < 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}
              />
            </div>
          </div>

          {/* Bifurcation Summary */}
          {totalSalesAmount > 0 && (
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Total Sales Amount:</span>
                <span className="text-lg font-bold">KWD {totalSalesAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm">Total Card Sales:</span>
                <span className="font-semibold">KWD {totalCardSales.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t">
                <span className="text-sm font-medium">Cash Sales:</span>
                <span className={`text-lg font-bold ${cashSales < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  KWD {cashSales.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {cashSales < 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Card sales exceed total sales. Please verify the amounts.
              </AlertDescription>
            </Alert>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (Optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any additional notes about this entry..."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={resetForm}>
          Reset Form
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={createMutation.isPending || !selectedNozzleId || !openingReading || !closingReading || cashSales < 0}
          className="bg-orange-600 hover:bg-orange-700"
        >
          {createMutation.isPending ? (
            <>Processing...</>
          ) : (
            <>
              <CheckCircle className="mr-2 h-4 w-4" />
              Post Backdated Entry
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
