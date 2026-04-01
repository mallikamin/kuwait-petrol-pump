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
import { Sun, Moon, PlayCircle, StopCircle, AlertCircle } from 'lucide-react';
import { shiftsApi } from '@/api';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth';
import { Alert, AlertDescription } from '@/components/ui/alert';

// ============================================================
// UAT TEMPORARY: Hardcoded shift data from DB seed (2026-04-01)
// Will be replaced by GET /api/shifts endpoint in Stage 2.
// ============================================================
const SEEDED_SHIFTS = [
  {
    id: '2cf99710-4971-4357-9673-d5f1ebf4d256',
    shift_number: 1,
    name: 'Day Shift',
    start_time: '06:00',
    end_time: '18:00',
    is_active: true,
  },
  {
    id: '3a86cb44-b352-45bc-8dc5-bab29425870d',
    shift_number: 2,
    name: 'Night Shift',
    start_time: '18:00',
    end_time: '06:00',
    is_active: true,
  },
];

export function Shifts() {
  const [openDialogShiftId, setOpenDialogShiftId] = useState<string | null>(null);
  const [closeDialogId, setCloseDialogId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const branchId = user?.branch_id || (user as any)?.branch?.id;

  // Check if there's a current open shift
  // UAT: getCurrent returns ShiftInstance (not Shift), using 'any' until types are aligned
  const { data: currentShift, isLoading } = useQuery<any>({
    queryKey: ['shifts', 'current', branchId],
    queryFn: () => (branchId ? shiftsApi.getCurrent(branchId) : Promise.resolve(null)),
    enabled: !!branchId,
    refetchInterval: 30000,
  });

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
    SEEDED_SHIFTS.find((s) => s.id === openDialogShiftId)?.name || 'Shift';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Shifts</h1>
        <p className="text-muted-foreground">Open or close shifts for your branch</p>
      </div>

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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {SEEDED_SHIFTS.map((shift) => {
          const isCurrentShift = currentShift?.shift?.id === shift.id;
          const hasOpenShift = !!currentShift;

          return (
            <Card key={shift.id} className={isCurrentShift ? 'border-green-400 ring-2 ring-green-200' : ''}>
              <CardHeader className="flex flex-row items-center gap-4 pb-2">
                <div className="rounded-full bg-primary/10 p-3">
                  {shift.shift_number === 1 ? (
                    <Sun className="h-6 w-6 text-yellow-500" />
                  ) : (
                    <Moon className="h-6 w-6 text-blue-500" />
                  )}
                </div>
                <div className="flex-1">
                  <CardTitle className="text-xl">{shift.name}</CardTitle>
                  <CardDescription>
                    {shift.start_time} &ndash; {shift.end_time} (12 hours)
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
