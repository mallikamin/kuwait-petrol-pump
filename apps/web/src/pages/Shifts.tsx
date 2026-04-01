import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Sun, Moon, PlayCircle, StopCircle, AlertCircle, Loader2 } from 'lucide-react';
import { shiftsApi } from '@/api';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShiftTemplate } from '@/types';

export function Shifts() {
  const [openDialogShiftId, setOpenDialogShiftId] = useState<string | null>(null);
  const [closeDialogId, setCloseDialogId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const branchId = user?.branch_id || (user as any)?.branch?.id;

  // Fetch shift templates from API (replaces hardcoded SEEDED_SHIFTS)
  const { data: shiftsResponse, isLoading: shiftsLoading, error: shiftsError } = useQuery({
    queryKey: ['shifts', 'templates', branchId],
    queryFn: () => shiftsApi.getAll({ branch_id: branchId }),
    enabled: !!branchId,
  });

  // Check if there's a current open shift
  const { data: currentShift, isLoading: currentShiftLoading } = useQuery<any>({
    queryKey: ['shifts', 'current', branchId],
    queryFn: () => (branchId ? shiftsApi.getCurrent(branchId) : Promise.resolve(null)),
    enabled: !!branchId,
    refetchInterval: 30000,
  });

  // Convert backend camelCase to component-friendly format
  const shiftTemplates: ShiftTemplate[] = shiftsResponse?.items || [];
  const isLoading = shiftsLoading || currentShiftLoading;

  // Open shift mutation
  const openShiftMutation = useMutation({
    mutationFn: ({ shiftId, branchId }: { shiftId: string; branchId: string }) =>
      shiftsApi.openShift({ branch_id: branchId, shift_id: shiftId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Shift opened successfully');
      setOpenDialogShiftId(null);
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || 'Failed to open shift');
    },
  });

  // Close shift mutation
  const closeShiftMutation = useMutation({
    mutationFn: (shiftInstanceId: string) =>
      shiftsApi.closeShift(shiftInstanceId, { closing_cash: 0 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Shift closed successfully');
      setCloseDialogId(null);
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || 'Failed to close shift');
    },
  });

  const handleOpenShift = () => {
    if (!openDialogShiftId || !branchId) {
      toast.error('Missing shift or branch information');
      return;
    }
    openShiftMutation.mutate({ shiftId: openDialogShiftId, branchId });
  };

  const selectedShiftName =
    shiftTemplates.find((s) => s.id === openDialogShiftId)?.name || 'Shift';

  // Helper function to format time from ISO datetime
  const formatTime = (isoTime: string): string => {
    try {
      const date = new Date(isoTime);
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch {
      return isoTime;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Shifts</h1>
        <p className="text-muted-foreground">Open or close shifts for your branch</p>
      </div>

      {/* Error State */}
      {shiftsError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load shift templates. Please refresh the page or contact support.
          </AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">Loading shifts...</span>
        </div>
      )}

      {/* Current Shift Status */}
      {currentShift ? (
        <Alert className="border-green-300 bg-green-50">
          <PlayCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              <strong className="text-green-700">Current Shift:</strong>{' '}
              {currentShift.shift?.name || `Shift #${currentShift.shift?.shiftNumber}`} &mdash;{' '}
              opened by {currentShift.openedByUser?.fullName || currentShift.openedByUser?.username || 'Unknown'}{' '}
              at {new Date(currentShift.openedAt).toLocaleTimeString()}
            </span>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setCloseDialogId(currentShift.id)}
            >
              <StopCircle className="mr-2 h-3 w-3" />
              Close Shift
            </Button>
          </AlertDescription>
        </Alert>
      ) : !isLoading ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No shift is currently open. Open a shift below to start recording sales and meter
            readings.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Shift Cards */}
      {!isLoading && !shiftsError && (
        <>
          {shiftTemplates.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No shift templates configured. Contact your administrator to create shift schedules.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {shiftTemplates.map((shift) => {
                const isCurrentShift = currentShift?.shift?.id === shift.id;
                const hasOpenShift = !!currentShift;

                return (
                  <Card key={shift.id} className={isCurrentShift ? 'border-green-400 ring-2 ring-green-200' : ''}>
                    <CardHeader className="flex flex-row items-center gap-4 pb-2">
                      <div className="rounded-full bg-primary/10 p-3">
                        {shift.shiftNumber === 1 ? (
                          <Sun className="h-6 w-6 text-yellow-500" />
                        ) : (
                          <Moon className="h-6 w-6 text-blue-500" />
                        )}
                      </div>
                      <div className="flex-1">
                        <CardTitle className="text-xl">{shift.name}</CardTitle>
                        <CardDescription>
                          {formatTime(shift.startTime)} &ndash; {formatTime(shift.endTime)}
                        </CardDescription>
                      </div>
                      <Badge variant={isCurrentShift ? 'default' : 'secondary'}>
                        {isCurrentShift ? 'Open' : 'Available'}
                      </Badge>
                    </CardHeader>
                    <CardContent>
                      {isCurrentShift ? (
                        <Button
                          className="w-full"
                          variant="destructive"
                          onClick={() => setCloseDialogId(currentShift!.id)}
                        >
                          <StopCircle className="mr-2 h-4 w-4" />
                          Close This Shift
                        </Button>
                      ) : (
                        <Button
                          className="w-full"
                          onClick={() => setOpenDialogShiftId(shift.id)}
                          disabled={hasOpenShift}
                        >
                          <PlayCircle className="mr-2 h-4 w-4" />
                          {hasOpenShift ? 'Close current shift first' : 'Open Shift'}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Open Shift Confirmation Dialog */}
      <Dialog open={!!openDialogShiftId} onOpenChange={() => setOpenDialogShiftId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open {selectedShiftName}?</DialogTitle>
            <DialogDescription>
              This will start the shift. Meter readings and sales can be recorded while the shift is
              open.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialogShiftId(null)}>
              Cancel
            </Button>
            <Button onClick={handleOpenShift} disabled={openShiftMutation.isPending}>
              {openShiftMutation.isPending ? 'Opening...' : 'Open Shift'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Shift Confirmation Dialog */}
      <Dialog open={!!closeDialogId} onOpenChange={() => setCloseDialogId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close Current Shift?</DialogTitle>
            <DialogDescription>
              This will close the current shift. Make sure all meter readings and sales are recorded
              before closing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialogId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => closeDialogId && closeShiftMutation.mutate(closeDialogId)}
              disabled={closeShiftMutation.isPending}
            >
              {closeShiftMutation.isPending ? 'Closing...' : 'Close Shift'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
