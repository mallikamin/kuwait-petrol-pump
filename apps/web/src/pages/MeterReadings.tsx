import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Gauge, AlertCircle } from 'lucide-react';
import { meterReadingsApi, branchesApi, shiftsApi } from '@/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuthStore } from '@/store/auth';

export function MeterReadings() {
  const [page, setPage] = useState(1);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedNozzleId, setSelectedNozzleId] = useState('');
  const [readingType, setReadingType] = useState<'opening' | 'closing'>('opening');
  const [meterValue, setMeterValue] = useState('');

  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const branchId = user?.branch_id || (user as any)?.branch?.id;

  // Fetch meter readings
  const { data, isLoading } = useQuery({
    queryKey: ['meterReadings', page],
    queryFn: () => meterReadingsApi.getAll({ page, size: 20 }),
  });

  // Fetch nozzles from branches (branches already include nested dispensingUnits.nozzles)
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

  // Fetch current shift
  const { data: currentShift } = useQuery({
    queryKey: ['shifts', 'current', branchId],
    queryFn: () => branchId ? shiftsApi.getCurrent(branchId) : Promise.resolve(null),
    enabled: !!branchId,
  });

  // Get latest reading for selected nozzle (for auto-populate)
  const { data: latestReading, isLoading: isLoadingLatest } = useQuery({
    queryKey: ['meterReadings', 'latest', selectedNozzleId],
    queryFn: () => meterReadingsApi.getLatestForNozzle(selectedNozzleId),
    enabled: !!selectedNozzleId && readingType === 'opening',
  });

  // Create meter reading mutation
  const createMutation = useMutation({
    mutationFn: meterReadingsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meterReadings'] });
      toast.success('Meter reading recorded successfully');
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || 'Failed to record meter reading');
    },
  });

  const resetForm = () => {
    setSelectedNozzleId('');
    setReadingType('opening');
    setMeterValue('');
  };

  const handleSubmit = () => {
    if (!selectedNozzleId || !meterValue || !currentShift) {
      toast.error('Please fill all required fields');
      return;
    }

    createMutation.mutate({
      nozzleId: selectedNozzleId,
      shiftInstanceId: currentShift.id,
      readingType: readingType,
      meterValue: parseFloat(meterValue),
    });
  };

  // Auto-populate opening reading when nozzle is selected
  const handleNozzleChange = (nozzleId: string) => {
    setSelectedNozzleId(nozzleId);

    // If opening reading and we have latest reading, auto-populate
    if (readingType === 'opening' && latestReading && latestReading.reading_type === 'closing') {
      setMeterValue(latestReading.reading_value.toString());
    }
  };

  const selectedNozzle = nozzlesData?.find((n: any) => n.id === selectedNozzleId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Meter Readings</h1>
          <p className="text-muted-foreground">Track fuel meter readings and shifts</p>
        </div>
        <Button onClick={() => setIsDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Record Reading
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Readings</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : data?.items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Gauge className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p>No meter readings found</p>
              <p className="text-sm">Record your first meter reading to get started</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nozzle</TableHead>
                    <TableHead>Fuel Type</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Meter Value</TableHead>
                    <TableHead>Recorded At</TableHead>
                    <TableHead>Recorded By</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.items.map((reading) => (
                    <TableRow key={reading.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center">
                          <Gauge className="mr-2 h-4 w-4 text-muted-foreground" />
                          {reading.nozzle?.nozzleNumber || (reading.nozzle as any)?.nozzle_number || '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {reading.nozzle?.fuelType?.name || (reading.nozzle as any)?.fuel_type?.name || '-'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={reading.reading_type === 'opening' ? 'default' : 'secondary'}>
                          {reading.reading_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">{reading.reading_value} L</TableCell>
                      <TableCell className="text-sm">
                        {reading.created_at ? format(new Date(reading.created_at), 'MMM dd, yyyy HH:mm') : '-'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {(reading as any).created_by?.full_name || (reading as any).created_by?.username || '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={reading.is_verified ? 'default' : 'secondary'}>
                          {reading.is_verified ? 'Verified' : 'Pending'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {data && data.pages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {data.page} of {data.pages} ({data.total} total)
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.min(data.pages, p + 1))}
                      disabled={page === data.pages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Record Reading Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Record Meter Reading</DialogTitle>
            <DialogDescription>
              Enter meter reading for a nozzle. Opening readings will auto-populate from yesterday's closing.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Shift Selection */}
            <div className="grid gap-2">
              <Label htmlFor="shift">Active Shift *</Label>
              {!currentShift ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    No active shift found. Please open a shift first.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="p-3 rounded-lg border bg-muted/50">
                  <p className="text-sm font-medium">
                    {(currentShift as any).shift?.name || `Shift #${(currentShift as any).shift?.shiftNumber}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Opened by {(currentShift as any).openedByUser?.fullName || (currentShift as any).openedByUser?.username || 'Unknown User'}
                  </p>
                </div>
              )}
            </div>

            {/* Nozzle Selection */}
            <div className="grid gap-2">
              <Label htmlFor="nozzle">Nozzle *</Label>
              <Select value={selectedNozzleId} onValueChange={handleNozzleChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select nozzle" />
                </SelectTrigger>
                <SelectContent>
                  {nozzlesData?.map((nozzle: any) => (
                    <SelectItem key={nozzle.id} value={nozzle.id}>
                      Nozzle {nozzle.nozzleNumber} - {nozzle.fuelType?.name || 'Unknown'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Reading Type */}
            <div className="grid gap-2">
              <Label htmlFor="type">Reading Type *</Label>
              <Select value={readingType} onValueChange={(v: 'opening' | 'closing') => setReadingType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opening">Opening</SelectItem>
                  <SelectItem value="closing">Closing</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Meter Value */}
            <div className="grid gap-2">
              <Label htmlFor="value">Meter Reading (Liters) *</Label>
              <Input
                id="value"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={meterValue}
                onChange={(e) => setMeterValue(e.target.value)}
              />
              {isLoadingLatest && readingType === 'opening' && (
                <p className="text-xs text-muted-foreground">Loading previous reading...</p>
              )}
              {latestReading && readingType === 'opening' && (
                <p className="text-xs text-muted-foreground">
                  Previous closing: {latestReading.reading_value} L (auto-populated)
                </p>
              )}
            </div>

            {/* Selected Nozzle Info */}
            {selectedNozzle && (
              <div className="rounded-lg border p-3 bg-muted/50">
                <p className="text-sm font-medium">Selected Nozzle</p>
                <p className="text-xs text-muted-foreground">
                  {selectedNozzle.nozzleNumber || (selectedNozzle as any).nozzle_number} - {selectedNozzle.fuelType?.name || (selectedNozzle as any).fuel_type?.name}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || !selectedNozzleId || !meterValue || !currentShift}
            >
              {createMutation.isPending ? 'Recording...' : 'Record Reading'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
