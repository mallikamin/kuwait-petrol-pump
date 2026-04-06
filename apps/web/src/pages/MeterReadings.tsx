import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, AlertCircle, Clock, User, Calendar, CheckCircle, Edit, Trash2 } from 'lucide-react';
import { meterReadingsApi, branchesApi, shiftsApi } from '@/api';
import { apiClient } from '@/api/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuthStore } from '@/store/auth';
import { MeterReadingCapture, type MeterReadingData } from '@/components/MeterReadingCapture';

// Parse Prisma TIME field (comes as ISO datetime like "1970-01-01T08:00:00.000Z")
function formatShiftTime(timeValue: unknown): string {
  if (!timeValue) return '';
  try {
    const str = String(timeValue);
    // Handle ISO datetime string
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
    }
    // Handle plain time string (HH:MM:SS or HH:MM)
    const match = str.match(/^(\d{2}):(\d{2})/);
    if (match) return `${match[1]}:${match[2]}`;
    return '';
  } catch {
    return '';
  }
}


const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

export function MeterReadings() {
  const [filterDate, setFilterDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Modal state for meter reading capture
  const [isMeterReadingOpen, setIsMeterReadingOpen] = useState(false);
  const [selectedNozzle, setSelectedNozzle] = useState<any>(null);
  const [selectedShiftTemplate, setSelectedShiftTemplate] = useState<any>(null);
  const [selectedReadingType, setSelectedReadingType] = useState<'opening' | 'closing'>('opening');
  const [editingReadingId, setEditingReadingId] = useState<string | null>(null);
  const [editingReadingValue, setEditingReadingValue] = useState<number | undefined>(undefined);

  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const branchId = user?.branch_id || (user as any)?.branch?.id;

  // Fetch current shift
  const { data: currentShift } = useQuery({
    queryKey: ['shifts', 'current', branchId],
    queryFn: () => branchId ? shiftsApi.getCurrent(branchId) : Promise.resolve(null),
    enabled: !!branchId,
  });

  // Fetch shift templates for the branch
  const { data: shiftTemplatesData } = useQuery({
    queryKey: ['shifts', 'templates', branchId],
    queryFn: async () => {
      if (!branchId) return [];
      const res = await shiftsApi.getAll(branchId);
      return res.items;
    },
    enabled: !!branchId,
  });

  // Fetch nozzles from branch dispensing units
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

  // Fetch meter readings for the selected date
  const { data: meterReadingsData, isLoading: loadingReadings } = useQuery({
    queryKey: ['meterReadings', 'by-date', filterDate],
    queryFn: async () => {
      const res = await meterReadingsApi.getAll({ date: filterDate, size: 500 });
      return res.items;
    },
  });

  // Fetch shift instances for the selected date
  const { data: shiftInstancesData } = useQuery({
    queryKey: ['shift-instances-for-date', branchId, filterDate],
    queryFn: async () => {
      const res = await apiClient.get('/api/shifts/instances-for-date', {
        params: {
          branchId: branchId,
          businessDate: filterDate,
        },
      });
      return res.data;
    },
    enabled: !!branchId && !!filterDate,
  });

  // Create meter reading mutation
  const createMeterReadingMutation = useMutation({
    mutationFn: async (data: {
      nozzleId: string;
      shiftInstanceId: string;
      readingType: 'opening' | 'closing';
      meterValue: number;
      imageUrl?: string;
      businessDate: string;
      isManual: boolean;
      shiftId: string;
    }) => {
      return await meterReadingsApi.create({
        nozzleId: data.nozzleId,
        shiftInstanceId: data.shiftInstanceId,
        readingType: data.readingType,
        meterValue: data.meterValue,
        imageUrl: data.imageUrl,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meterReadings'] });
      toast.success('Meter reading saved successfully');
      setIsMeterReadingOpen(false);
      setSelectedNozzle(null);
      setSelectedShiftTemplate(null);
      setEditingReadingId(null);
      setEditingReadingValue(undefined);
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error.message || 'Failed to save meter reading';
      toast.error(errorMsg);
    },
  });

  // Update meter reading mutation (for editing)
  const updateMeterReadingMutation = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number }) => {
      return await meterReadingsApi.verify(id, { verifiedValue: value, isManualOverride: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meterReadings'] });
      toast.success('Meter reading updated successfully');
      setIsMeterReadingOpen(false);
      setSelectedNozzle(null);
      setSelectedShiftTemplate(null);
      setEditingReadingId(null);
      setEditingReadingValue(undefined);
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error.message || 'Failed to update meter reading';
      toast.error(errorMsg);
    },
  });

  // Delete meter reading mutation
  const deleteMeterReadingMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiClient.delete(`/api/meter-readings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meterReadings'] });
      toast.success('Meter reading deleted successfully');
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error.message || 'Failed to delete meter reading';
      toast.error(errorMsg);
    },
  });

  // Get previous reading for a nozzle (from previous shift's closing)
  const getPreviousReading = (nozzleId: string, readingType: 'opening' | 'closing', currentShiftTemplate: any): number => {
    if (!shiftTemplatesData || !meterReadingsData) return 0;

    // For opening readings, get the previous shift's closing
    if (readingType === 'opening') {
      // Find the shift that comes before this one
      const currentShiftNumber = currentShiftTemplate.shiftNumber || currentShiftTemplate.shift_number || 0;
      const previousShiftNumber = currentShiftNumber - 1;

      if (previousShiftNumber <= 0) {
        // This is the first shift of the day - no previous reading
        return 0;
      }

      const previousShift = shiftTemplatesData.find(
        (s: any) => (s.shiftNumber || s.shift_number) === previousShiftNumber
      );

      if (!previousShift) return 0;

      const previousShiftInstance = (shiftInstancesData || []).find(
        (si: any) => si.shiftId === previousShift.id
      );

      if (!previousShiftInstance) return 0;

      // Find closing reading for this nozzle in previous shift
      const previousClosing = (meterReadingsData || []).find(
        (r: any) =>
          r.nozzle_id === nozzleId &&
          r.shift_instance?.id === previousShiftInstance.id &&
          r.reading_type === 'closing'
      );

      if (previousClosing) {
        return toNumber(previousClosing.reading_value);
      }
    }

    return 0;
  };

  // Handle meter reading capture
  const handleMeterReadingCapture = async (data: MeterReadingData) => {
    if (!selectedNozzle || !selectedShiftTemplate) return;

    // Find shift instance for this shift template
    const shiftInstance = (shiftInstancesData || []).find(
      (si: any) => si.shiftId === selectedShiftTemplate.id
    );

    if (!shiftInstance) {
      toast.error('No shift instance found for this date. Please ensure the shift is open.');
      return;
    }

    // If editing existing reading, call UPDATE
    if (editingReadingId) {
      await updateMeterReadingMutation.mutateAsync({
        id: editingReadingId,
        value: data.currentReading,
      });
      return;
    }

    // Otherwise, create new reading
    await createMeterReadingMutation.mutateAsync({
      nozzleId: selectedNozzle.id,
      shiftInstanceId: shiftInstance.id,
      readingType: selectedReadingType,
      meterValue: data.currentReading,
      imageUrl: data.imageUrl,
      businessDate: filterDate,
      isManual: data.isManualReading,
      shiftId: selectedShiftTemplate.id,
    });
  };

  // Open meter reading dialog
  const openMeterReadingDialog = (nozzle: any, shift: any, type: 'opening' | 'closing', reading?: any) => {
    setSelectedNozzle(nozzle);
    setSelectedShiftTemplate(shift);
    setSelectedReadingType(type);
    if (reading) {
      setEditingReadingId(reading.id);
      setEditingReadingValue(toNumber(reading.reading_value));
    } else {
      setEditingReadingId(null);
      setEditingReadingValue(undefined);
    }
    setIsMeterReadingOpen(true);
  };

  // Handle delete reading
  const handleDeleteReading = async (readingId: string) => {
    if (!confirm('Are you sure you want to delete this reading?')) return;
    await deleteMeterReadingMutation.mutateAsync(readingId);
  };

  // Format shift time range for section headers
  const formatShiftTimeRange = (shiftTemplate: any): string => {
    if (!shiftTemplate) return '';
    const start = formatShiftTime(shiftTemplate.startTime || shiftTemplate.start_time);
    const end = formatShiftTime(shiftTemplate.endTime || shiftTemplate.end_time);
    if (start && end) return `${start} - ${end}`;
    if (start) return `From ${start}`;
    return 'Time not configured';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Meter Readings</h1>
          <p className="text-muted-foreground">
            Record meter readings for all nozzles by shift
          </p>
        </div>
      </div>

      {/* Current Shift Info */}
      {currentShift ? (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-600">
                  <Clock className="h-6 w-6 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-green-900">
                      {(() => {
                        const shift = (currentShift as any).shift;
                        const shiftNum = shift?.shiftNumber || shift?.shift_number;
                        return shift?.name || (shiftNum ? `Shift #${shiftNum}` : 'Active Shift');
                      })()}
                    </h3>
                    <Badge className="bg-green-600 text-white">Active</Badge>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-green-700">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {(() => {
                        const start = formatShiftTime((currentShift as any).shift?.startTime);
                        const end = formatShiftTime((currentShift as any).shift?.endTime);
                        if (start && end) return `${start} - ${end}`;
                        if (start) return `From ${start}`;
                        return 'Time not configured';
                      })()}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      Opened by: {(currentShift as any).openedByUser?.fullName || (currentShift as any).openedByUser?.username || 'Unknown'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {(() => {
                        const dateValue = (currentShift as any).date;
                        if (!dateValue) return 'N/A';
                        try {
                          return format(new Date(dateValue), 'dd MMM yyyy');
                        } catch {
                          return 'Invalid Date';
                        }
                      })()}
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-green-600 mb-1">Shift Duration</div>
                <div className="text-2xl font-bold text-green-900">
                  {(currentShift as any).openedAt ? (() => {
                    const duration = Math.floor((new Date().getTime() - new Date((currentShift as any).openedAt).getTime()) / 1000 / 60);
                    const hours = Math.floor(duration / 60);
                    const mins = duration % 60;

                    if (hours > 24) {
                      return <span className="text-red-600 text-base">Shift overdue - please close</span>;
                    }

                    return `${hours}h ${mins}m`;
                  })() : 'N/A'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Alert className="border-orange-200 bg-orange-50">
          <AlertCircle className="h-4 w-4 text-orange-600" />
          <AlertDescription className="text-orange-900">
            <strong>No Active Shift:</strong> Please open a shift before recording meter readings.
          </AlertDescription>
        </Alert>
      )}

      {/* Date Filter */}
      <Card>
        <CardHeader>
          <CardTitle>Filter by Date</CardTitle>
        </CardHeader>
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
                  onClick={() => {
                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    setFilterDate(format(yesterday, 'yyyy-MM-dd'));
                  }}
                >
                  Yesterday
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Meter Readings by Shift */}
      <Card>
        <CardHeader>
          <CardTitle>Meter Readings - {filterDate ? (() => {
            try {
              const date = new Date(filterDate);
              return isNaN(date.getTime()) ? 'All Dates' : format(date, 'MMM dd, yyyy');
            } catch {
              return 'All Dates';
            }
          })() : 'All Dates'}</CardTitle>
          <p className="text-sm text-muted-foreground">All nozzles grouped by shift</p>
        </CardHeader>
        <CardContent>
          {loadingReadings ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          ) : (!shiftTemplatesData || shiftTemplatesData.length === 0) ? (
            <Alert className="border-red-200 bg-red-50">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-sm text-red-900">
                <strong>No shift templates configured for this branch.</strong> Please configure shifts in Shift Management first.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
              {shiftTemplatesData.map((shiftTemplate: any) => {
                // Find shift instance for this shift template on the selected business date
                const shiftInstance = (shiftInstancesData || []).find(
                  (si: any) => si.shiftId === shiftTemplate.id
                );

                const timeRange = formatShiftTimeRange(shiftTemplate);

                return (
                  <div key={shiftTemplate.id} className="border-2 border-blue-300 rounded-lg p-4 bg-blue-50/30">
                    {/* Shift Header */}
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-blue-200">
                      <div>
                        <h3 className="font-semibold text-lg text-blue-900">{shiftTemplate.name}</h3>
                        <p className="text-sm text-blue-700">{timeRange}</p>
                      </div>
                      <Badge variant="outline" className="text-blue-700 border-blue-600">
                        Shift {shiftTemplate.shiftNumber || shiftTemplate.shift_number}
                      </Badge>
                    </div>

                    {/* Nozzles for this shift */}
                    <div className="space-y-3">
                      {(nozzlesData || []).map((nozzle: any) => {
                        // Get readings for this nozzle in this shift instance
                        const nozzleReadings = (meterReadingsData || []).filter(
                          (r: any) =>
                            r.nozzle_id === nozzle.id &&
                            shiftInstance &&
                            r.shift_instance?.id === shiftInstance.id
                        );

                        const hasOpening = nozzleReadings.some((r: any) => r.reading_type === 'opening');
                        const hasClosing = nozzleReadings.some((r: any) => r.reading_type === 'closing');
                        const openingReading = nozzleReadings.find((r: any) => r.reading_type === 'opening');
                        const closingReading = nozzleReadings.find((r: any) => r.reading_type === 'closing');

                        // Compute auto-fill opening value from previous shift's closing
                        const computedOpening = !hasOpening ? getPreviousReading(nozzle.id, 'opening', shiftTemplate) : 0;
                        const showComputedOpening = !hasOpening && computedOpening > 0;

                        // Determine row state (consider computed opening as valid)
                        const effectiveHasOpening = hasOpening || showComputedOpening;

                        // Calculate sales (closing - opening)
                        const openingValue = hasOpening && openingReading
                          ? toNumber(openingReading.reading_value)
                          : showComputedOpening
                          ? computedOpening
                          : 0;
                        const closingValue = hasClosing && closingReading
                          ? toNumber(closingReading.reading_value)
                          : 0;
                        const salesLiters = effectiveHasOpening && hasClosing ? closingValue - openingValue : 0;

                        let rowState = 'Both Missing';
                        let statusColor = 'bg-amber-50 border-amber-200';
                        if (effectiveHasOpening && hasClosing) {
                          rowState = '✓ Complete';
                          statusColor = 'bg-green-50 border-green-300';
                        } else if (effectiveHasOpening && !hasClosing) {
                          rowState = 'Closing Missing';
                          statusColor = 'bg-amber-50 border-amber-300';
                        } else if (!effectiveHasOpening && hasClosing) {
                          rowState = 'Opening Missing';
                          statusColor = 'bg-amber-50 border-amber-300';
                        }

                        return (
                          <div key={nozzle.id} className={`border rounded-lg p-3 ${statusColor}`}>
                            {/* Nozzle Header */}
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <div className="font-semibold text-base">
                                  {nozzle.name || `Nozzle ${nozzle.nozzleNumber}`}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {nozzle.fuelType?.name || 'Unknown'}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={hasOpening && hasClosing ? 'default' : 'secondary'}
                                  className={
                                    hasOpening && hasClosing
                                      ? 'bg-green-600 text-xs'
                                      : 'bg-amber-600 text-xs'
                                  }
                                >
                                  {rowState}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {nozzle.fuelType?.code || 'N/A'}
                                </Badge>
                              </div>
                            </div>

                            {/* Reading Inputs */}
                            <div className="grid grid-cols-3 gap-2">
                              {/* Opening Reading */}
                              <div className="space-y-1">
                                <div className="text-xs font-medium text-muted-foreground">Opening</div>
                                {hasOpening ? (
                                  <div className="flex items-center gap-2 justify-between">
                                    <div className="flex items-center gap-2">
                                      <CheckCircle className="h-4 w-4 text-green-600" />
                                      <span className="font-mono font-semibold text-sm">
                                        {openingReading ? toNumber(openingReading.reading_value).toFixed(3) : '0.000'}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() =>
                                          openMeterReadingDialog(nozzle, shiftTemplate, 'opening', openingReading)
                                        }
                                        className="h-7 w-7 p-0"
                                        title="Edit opening"
                                      >
                                        <Edit className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => openingReading && handleDeleteReading(openingReading.id)}
                                        className="h-7 w-7 p-0"
                                        title="Delete opening"
                                      >
                                        <Trash2 className="h-3 w-3 text-red-600" />
                                      </Button>
                                    </div>
                                  </div>
                                ) : showComputedOpening ? (
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2 justify-between">
                                      <span className="font-mono text-sm text-muted-foreground italic">
                                        {computedOpening.toFixed(3)}
                                      </span>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => openMeterReadingDialog(nozzle, shiftTemplate, 'opening')}
                                        className="h-7 w-7 p-0"
                                        title="Edit"
                                      >
                                        <Edit className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openMeterReadingDialog(nozzle, shiftTemplate, 'opening')}
                                    className="w-full h-11 text-sm border-amber-600 text-amber-700 hover:bg-amber-100"
                                  >
                                    <Plus className="h-4 w-4 mr-1" />
                                    Add
                                  </Button>
                                )}
                              </div>

                              {/* Closing Reading */}
                              <div className="space-y-1">
                                <div className="text-xs font-medium text-muted-foreground">Closing</div>
                                {hasClosing ? (
                                  <div className="flex items-center gap-2 justify-between">
                                    <div className="flex items-center gap-2">
                                      <CheckCircle className="h-4 w-4 text-green-600" />
                                      <span className="font-mono font-semibold text-sm">
                                        {closingReading ? toNumber(closingReading.reading_value).toFixed(3) : '0.000'}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() =>
                                          openMeterReadingDialog(nozzle, shiftTemplate, 'closing', closingReading)
                                        }
                                        className="h-7 w-7 p-0"
                                        title="Edit closing"
                                      >
                                        <Edit className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => closingReading && handleDeleteReading(closingReading.id)}
                                        className="h-7 w-7 p-0"
                                        title="Delete closing"
                                      >
                                        <Trash2 className="h-3 w-3 text-red-600" />
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openMeterReadingDialog(nozzle, shiftTemplate, 'closing')}
                                    className="w-full h-11 text-sm border-amber-600 text-amber-700 hover:bg-amber-100"
                                  >
                                    <Plus className="h-4 w-4 mr-1" />
                                    Add
                                  </Button>
                                )}
                              </div>

                              {/* Sales Calculation */}
                              <div className="space-y-1">
                                <div className="text-xs font-medium text-muted-foreground">Sales (L)</div>
                                <div className="flex items-center h-11">
                                  {effectiveHasOpening && hasClosing ? (
                                    <span className="font-mono font-semibold text-sm text-blue-700">
                                      {salesLiters.toFixed(3)}
                                    </span>
                                  ) : (
                                    <span className="text-sm text-muted-foreground">-</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Meter Reading Capture Dialog */}
      <Dialog open={isMeterReadingOpen} onOpenChange={setIsMeterReadingOpen}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle>
              {editingReadingId ? 'Edit' : 'Record'} {selectedReadingType === 'opening' ? 'Opening' : 'Closing'} Reading
            </DialogTitle>
            <DialogDescription>
              {selectedNozzle && selectedShiftTemplate && (
                <>
                  {selectedShiftTemplate.name} – {selectedNozzle.name || `Nozzle ${selectedNozzle.nozzleNumber}`} ({selectedNozzle.fuelType?.name || 'Unknown'})
                  {' • '}
                  Business Date: {filterDate}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedNozzle && selectedShiftTemplate && (
            <MeterReadingCapture
              nozzleId={selectedNozzle.id}
              nozzleName={`${selectedShiftTemplate.name} – ${selectedNozzle.name || `Nozzle ${selectedNozzle.nozzleNumber}`} (${selectedNozzle.fuelType?.name || 'Unknown'})`}
              previousReading={editingReadingValue ?? getPreviousReading(selectedNozzle.id, selectedReadingType, selectedShiftTemplate)}
              onCapture={handleMeterReadingCapture}
              onCancel={() => {
                setIsMeterReadingOpen(false);
                setSelectedNozzle(null);
                setSelectedShiftTemplate(null);
                setEditingReadingId(null);
                setEditingReadingValue(undefined);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
