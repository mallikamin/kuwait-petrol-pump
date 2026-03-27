import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { shiftsApi, salesApi } from '../api/endpoints';
import { useAppStore } from '../store/appStore';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Input } from '../components/ui/Input';
import { formatCurrency, formatDateTime, formatTime } from '../utils/format';
import { toast } from 'sonner';
import { Clock, PlayCircle, StopCircle, History } from 'lucide-react';
import type { Shift } from '@shared/types';

export const ShiftManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const { currentBranch, currentShift, setCurrentShift } = useAppStore();
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  // Fetch available shifts
  const { data: shiftsData } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => shiftsApi.getAllShifts(),
  });

  // Fetch current shift
  const { data: currentShiftData, refetch: refetchCurrentShift } = useQuery({
    queryKey: ['current-shift', currentBranch?.id],
    queryFn: () => shiftsApi.getCurrent(currentBranch!.id),
    enabled: !!currentBranch,
    retry: false,
  });

  // Fetch shift history
  const { data: historyData } = useQuery({
    queryKey: ['shift-history', currentBranch?.id],
    queryFn: () =>
      shiftsApi.getHistory({
        branchId: currentBranch!.id,
        limit: 10,
      }),
    enabled: !!currentBranch && showHistory,
  });

  // Fetch shift summary
  const { data: shiftSummary } = useQuery({
    queryKey: ['shift-summary', currentShift?.id],
    queryFn: () =>
      salesApi.getSummary({
        branchId: currentBranch!.id,
        shiftInstanceId: currentShift!.id,
      }),
    enabled: !!currentBranch && !!currentShift,
    refetchInterval: 30000,
  });

  const shifts = shiftsData?.data || [];
  const shiftHistory = historyData?.data.items || [];
  const summary = shiftSummary?.data.summary;

  // Open shift mutation
  const openShiftMutation = useMutation({
    mutationFn: () => shiftsApi.open(currentBranch!.id, selectedShiftId),
    onSuccess: (response) => {
      setCurrentShift(response.data);
      toast.success('Shift opened successfully');
      refetchCurrentShift();
      queryClient.invalidateQueries({ queryKey: ['current-shift'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to open shift');
    },
  });

  // Close shift mutation
  const closeShiftMutation = useMutation({
    mutationFn: () => shiftsApi.close(currentShift!.id, closeNotes),
    onSuccess: () => {
      setCurrentShift(null);
      setCloseNotes('');
      toast.success('Shift closed successfully');
      refetchCurrentShift();
      queryClient.invalidateQueries({ queryKey: ['current-shift'] });
      queryClient.invalidateQueries({ queryKey: ['shift-history'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to close shift');
    },
  });

  const handleOpenShift = () => {
    if (!currentBranch) {
      toast.error('Please select a branch');
      return;
    }

    if (!selectedShiftId) {
      toast.error('Please select a shift');
      return;
    }

    openShiftMutation.mutate();
  };

  const handleCloseShift = () => {
    if (!currentShift) {
      return;
    }

    if (window.confirm('Are you sure you want to close this shift?')) {
      closeShiftMutation.mutate();
    }
  };

  const getShiftDuration = () => {
    if (!currentShift) return '00:00:00';

    const start = new Date(currentShift.openedAt);
    const now = new Date();
    const diff = now.getTime() - start.getTime();

    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const [shiftTimer, setShiftTimer] = React.useState(getShiftDuration());

  React.useEffect(() => {
    const interval = setInterval(() => {
      setShiftTimer(getShiftDuration());
    }, 1000);

    return () => clearInterval(interval);
  }, [currentShift]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Shift Management</h1>
          <p className="mt-1 text-sm text-slate-600">Manage shift operations</p>
        </div>
        <Button
          variant="outline"
          onClick={() => setShowHistory(!showHistory)}
        >
          <History className="mr-2 h-4 w-4" />
          {showHistory ? 'Hide' : 'Show'} History
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Current Shift Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Current Shift Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {currentShift ? (
              <div className="space-y-4">
                {/* Active Shift Info */}
                <div className="rounded-lg bg-green-50 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-600">Active Shift</p>
                      <p className="text-2xl font-bold text-green-900">
                        {currentShift.shift.name}
                      </p>
                    </div>
                    <div className="h-3 w-3 animate-pulse rounded-full bg-green-600" />
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-slate-600">
                    <p>Opened by: {currentShift.openedBy.name}</p>
                    <p>Started: {formatDateTime(currentShift.openedAt)}</p>
                    <p className="text-lg font-mono font-semibold text-green-900">
                      Duration: {shiftTimer}
                    </p>
                  </div>
                </div>

                {/* Shift Summary */}
                {summary && (
                  <div className="space-y-3">
                    <p className="font-medium text-slate-900">Shift Summary</p>
                    <div className="grid gap-3">
                      <div className="rounded-lg border border-slate-200 p-3">
                        <p className="text-sm text-slate-600">Total Sales</p>
                        <p className="text-xl font-bold text-slate-900">
                          {formatCurrency(summary.totalAmount)}
                        </p>
                        <p className="text-sm text-slate-500">
                          {summary.totalSales} transactions
                        </p>
                      </div>

                      <div className="rounded-lg border border-slate-200 p-3">
                        <p className="text-sm text-slate-600">Fuel Sales</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatCurrency(summary.fuelSales.totalAmount)}
                        </p>
                        <p className="text-sm text-slate-500">
                          {summary.fuelSales.totalLiters} liters
                        </p>
                      </div>

                      <div className="rounded-lg border border-slate-200 p-3">
                        <p className="text-sm text-slate-600">Non-Fuel Sales</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatCurrency(summary.nonFuelSales.totalAmount)}
                        </p>
                        <p className="text-sm text-slate-500">
                          {summary.nonFuelSales.totalItems} items
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Close Shift Form */}
                <div className="space-y-3 border-t border-slate-200 pt-4">
                  <Input
                    label="Closing Notes (Optional)"
                    value={closeNotes}
                    onChange={(e) => setCloseNotes(e.target.value)}
                    placeholder="Enter any notes about this shift..."
                  />

                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={handleCloseShift}
                    isLoading={closeShiftMutation.isPending}
                  >
                    <StopCircle className="mr-2 h-4 w-4" />
                    Close Shift
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg bg-slate-50 p-6 text-center">
                  <Clock className="mx-auto h-12 w-12 text-slate-400" />
                  <p className="mt-2 font-medium text-slate-900">No Active Shift</p>
                  <p className="text-sm text-slate-600">Open a shift to start operations</p>
                </div>

                <Select
                  label="Select Shift"
                  value={selectedShiftId}
                  onChange={(e) => setSelectedShiftId(e.target.value)}
                  options={[
                    { value: '', label: 'Choose a shift' },
                    ...shifts.map((shift: Shift) => ({
                      value: shift.id,
                      label: `${shift.name} (${shift.startTime} - ${shift.endTime})`,
                    })),
                  ]}
                />

                <Button
                  variant="primary"
                  className="w-full"
                  onClick={handleOpenShift}
                  isLoading={openShiftMutation.isPending}
                  disabled={!selectedShiftId}
                >
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Open Shift
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Shift History */}
        {showHistory && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Shifts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {shiftHistory.length === 0 ? (
                  <p className="text-sm text-slate-500">No shift history</p>
                ) : (
                  shiftHistory.map((shift) => (
                    <div
                      key={shift.id}
                      className="rounded-lg border border-slate-200 p-3"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-slate-900">
                            {shift.shift.name}
                          </p>
                          <p className="text-sm text-slate-600">
                            {formatDateTime(shift.openedAt)}
                          </p>
                          {shift.closedAt && (
                            <p className="text-sm text-slate-600">
                              Closed: {formatDateTime(shift.closedAt)}
                            </p>
                          )}
                          <p className="text-xs text-slate-500">
                            By: {shift.openedBy.name}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium ${
                            shift.status === 'open'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {shift.status}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
