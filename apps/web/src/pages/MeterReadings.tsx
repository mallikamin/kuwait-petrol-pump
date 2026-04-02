import { useState, useEffect } from 'react';
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
import { Plus, Gauge, AlertCircle, Filter } from 'lucide-react';
import { meterReadingsApi, branchesApi, shiftsApi } from '@/api';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuthStore } from '@/store/auth';

export function MeterReadings() {
  const [page, setPage] = useState(1);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedNozzleId, setSelectedNozzleId] = useState('');
  const [readingType, setReadingType] = useState<'opening' | 'closing'>('opening');
  const [meterValue, setMeterValue] = useState('');
  const [filterDate, setFilterDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showFilters, setShowFilters] = useState(false);

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

  // Get latest CLOSING reading for selected nozzle (for auto-populate)
  const { data: latestReading, isLoading: isLoadingLatest } = useQuery({
    queryKey: ['meterReadings', 'latest', selectedNozzleId],
    queryFn: () => meterReadingsApi.getLatestForNozzle(selectedNozzleId),
    enabled: !!selectedNozzleId,
  });

  // Auto-populate opening reading when latest reading loads
  useEffect(() => {
    if (readingType === 'opening' && latestReading && latestReading.reading_type === 'closing') {
      setMeterValue(latestReading.reading_value.toString());
    } else if (readingType === 'closing') {
      setMeterValue(''); // Clear for closing
    }
  }, [latestReading, readingType]);

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

  const handleNozzleChange = (nozzleId: string) => {
    setSelectedNozzleId(nozzleId);
    setMeterValue(''); // Clear value, useEffect will populate if opening
  };

  const selectedNozzle = nozzlesData?.find((n: any) => n.id === selectedNozzleId);

  // Group readings by nozzle and shift for consolidated view
  const groupedReadings = (data?.items || []).reduce((acc: any, reading) => {
    const key = `${reading.nozzle_id}_${reading.shift_id || 'unknown'}`;
    if (!acc[key]) {
      acc[key] = {
        nozzle: reading.nozzle,
        nozzle_id: reading.nozzle_id,
        shift_id: reading.shift_id,
        opening: null,
        closing: null,
        date: reading.created_at,
      };
    }
    if (reading.reading_type === 'opening') {
      acc[key].opening = reading;
    } else {
      acc[key].closing = reading;
    }
    return acc;
  }, {});

  const consolidatedReadings = Object.values(groupedReadings);

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

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Filters</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowFilters(!showFilters)}>
              <Filter className="mr-2 h-4 w-4" />
              {showFilters ? 'Hide' : 'Show'} Filters
            </Button>
          </div>
        </CardHeader>
        {showFilters && (
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="filter-date">Date</Label>
                <Input
                  id="filter-date"
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                />
              </div>
              <div>
                <Label>Quick Filters</Label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFilterDate(format(new Date(), 'yyyy-MM-dd'))}
                  >
                    Today
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFilterDate(format(subDays(new Date(), 1), 'yyyy-MM-dd'))}
                  >
                    Yesterday
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Consolidated Readings Table */}
      <Card>
        <CardHeader>
          <CardTitle>Meter Readings - {format(new Date(filterDate), 'MMM dd, yyyy')}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Opening and closing readings grouped by nozzle
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : consolidatedReadings.length === 0 ? (
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
                    <TableHead>Opening Reading</TableHead>
                    <TableHead>Opening Time</TableHead>
                    <TableHead>Closing Reading</TableHead>
                    <TableHead>Closing Time</TableHead>
                    <TableHead>Variance (L)</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consolidatedReadings.map((row: any, idx) => {
                    const variance = row.opening && row.closing
                      ? row.closing.reading_value - row.opening.reading_value
                      : null;
                    const isMismatch = row.opening && row.closing && variance !== null && variance < 0;

                    return (
                      <TableRow key={idx} className={isMismatch ? 'bg-destructive/10' : ''}>
                        <TableCell className="font-medium">
                          <div className="flex items-center">
                            <Gauge className="mr-2 h-4 w-4 text-muted-foreground" />
                            {row.nozzle?.name || row.nozzle?.nozzle_number || '-'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {row.nozzle?.fuel_type?.name || '-'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">
                          {row.opening ? (
                            <span className="text-green-600 font-semibold">
                              {row.opening.reading_value} L
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.opening?.created_at
                            ? format(new Date(row.opening.created_at), 'HH:mm')
                            : '-'}
                        </TableCell>
                        <TableCell className="font-mono">
                          {row.closing ? (
                            <span className="text-red-600 font-semibold">
                              {row.closing.reading_value} L
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.closing?.created_at
                            ? format(new Date(row.closing.created_at), 'HH:mm')
                            : '-'}
                        </TableCell>
                        <TableCell className="font-mono">
                          {variance !== null ? (
                            <span className={variance < 0 ? 'text-destructive font-semibold' : ''}>
                              {variance.toFixed(2)} L
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {!row.opening && !row.closing ? (
                            <Badge variant="secondary">No Data</Badge>
                          ) : !row.opening ? (
                            <Badge variant="destructive">Missing Opening</Badge>
                          ) : !row.closing ? (
                            <Badge variant="default">Open</Badge>
                          ) : isMismatch ? (
                            <Badge variant="destructive">Error</Badge>
                          ) : (
                            <Badge variant="default">Complete</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              {data && data.pages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {data.page} of {data.pages} ({data.total} total readings)
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
              Enter meter reading for a nozzle. Opening readings will auto-populate from the latest closing reading.
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
                      {nozzle.name || `Nozzle ${nozzle.nozzleNumber}`} - {nozzle.fuelType?.name || 'Unknown'}
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
                <p className="text-xs text-muted-foreground">Loading latest reading...</p>
              )}
              {latestReading && readingType === 'opening' && latestReading.reading_type === 'closing' && (
                <p className="text-xs text-green-600">
                  ✓ Auto-populated from latest closing: {latestReading.reading_value} L
                </p>
              )}
            </div>

            {/* Selected Nozzle Info */}
            {selectedNozzle && (
              <div className="rounded-lg border p-3 bg-muted/50">
                <p className="text-sm font-medium">Selected Nozzle</p>
                <p className="text-xs text-muted-foreground">
                  {(selectedNozzle as any).name || `Nozzle ${selectedNozzle.nozzleNumber || (selectedNozzle as any).nozzle_number}`} - {selectedNozzle.fuelType?.name || (selectedNozzle as any).fuel_type?.name}
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
