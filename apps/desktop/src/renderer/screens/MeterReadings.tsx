import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nozzlesApi, meterReadingsApi } from '../api/endpoints';
import { useAppStore } from '../store/appStore';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { formatNumber, formatDateTime } from '../utils/format';
import { toast } from 'sonner';
import { Gauge, Camera, CheckCircle, AlertCircle } from 'lucide-react';
import type { Nozzle } from '@shared/types';

export const MeterReadings: React.FC = () => {
  const queryClient = useQueryClient();
  const { currentBranch, currentShift } = useAppStore();
  const [selectedNozzle, setSelectedNozzle] = useState<Nozzle | null>(null);
  const [readingType, setReadingType] = useState<'opening' | 'closing'>('opening');
  const [meterValue, setMeterValue] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  // Fetch nozzles
  const { data: nozzlesData } = useQuery({
    queryKey: ['nozzles', currentBranch?.id],
    queryFn: () => nozzlesApi.getAll({ branchId: currentBranch?.id, isActive: true }),
    enabled: !!currentBranch,
  });

  // Fetch shift readings
  const { data: shiftReadings } = useQuery({
    queryKey: ['shift-readings', currentShift?.id],
    queryFn: () => meterReadingsApi.getByShift(currentShift!.id),
    enabled: !!currentShift,
  });

  const nozzles = nozzlesData?.data || [];
  const readings = shiftReadings?.data || [];

  // Create meter reading mutation
  const createReadingMutation = useMutation({
    mutationFn: (data: any) => meterReadingsApi.create(data),
    onSuccess: () => {
      toast.success('Meter reading recorded successfully');
      queryClient.invalidateQueries({ queryKey: ['shift-readings'] });
      queryClient.invalidateQueries({ queryKey: ['nozzles'] });
      setMeterValue('');
      setImageUrl('');
      setSelectedNozzle(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to record reading');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentShift) {
      toast.error('Please open a shift first');
      return;
    }

    if (!selectedNozzle) {
      toast.error('Please select a nozzle');
      return;
    }

    if (!meterValue || parseFloat(meterValue) < 0) {
      toast.error('Please enter a valid meter reading');
      return;
    }

    createReadingMutation.mutate({
      nozzleId: selectedNozzle.id,
      shiftInstanceId: currentShift.id,
      readingType,
      meterValue: parseFloat(meterValue),
      imageUrl: imageUrl || undefined,
      isManualOverride: false,
    });
  };

  const getNozzleReading = (nozzleId: string, type: 'opening' | 'closing') => {
    return readings.find(
      (r) => r.nozzle.id === nozzleId && r.readingType === type
    );
  };

  if (!currentShift) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-lg text-slate-600">
              Please open a shift before recording meter readings
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Meter Readings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Record opening and closing meter readings for nozzles
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Record Reading Form */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Record Reading</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Select Nozzle
                </label>
                <div className="space-y-2">
                  {nozzles.map((nozzle) => (
                    <button
                      key={nozzle.id}
                      type="button"
                      onClick={() => setSelectedNozzle(nozzle)}
                      className={`w-full rounded-lg border-2 p-3 text-left transition-colors ${
                        selectedNozzle?.id === nozzle.id
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-slate-900">
                            Nozzle {nozzle.nozzleNumber}
                          </p>
                          <p className="text-sm text-slate-600">
                            {nozzle.fuelType.name}
                          </p>
                        </div>
                        <Gauge className="h-5 w-5 text-blue-600" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Reading Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setReadingType('opening')}
                    className={`rounded-lg border-2 px-4 py-2 font-medium transition-colors ${
                      readingType === 'opening'
                        ? 'border-green-600 bg-green-50 text-green-900'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    Opening
                  </button>
                  <button
                    type="button"
                    onClick={() => setReadingType('closing')}
                    className={`rounded-lg border-2 px-4 py-2 font-medium transition-colors ${
                      readingType === 'closing'
                        ? 'border-red-600 bg-red-50 text-red-900'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    Closing
                  </button>
                </div>
              </div>

              <Input
                type="number"
                label="Meter Value"
                value={meterValue}
                onChange={(e) => setMeterValue(e.target.value)}
                placeholder="314012.50"
                step="0.01"
                min="0"
                required
              />

              <Input
                label="Image URL (Optional)"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="Upload or paste image URL"
              />

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                isLoading={createReadingMutation.isPending}
                disabled={!selectedNozzle}
              >
                <Camera className="mr-2 h-4 w-4" />
                Record Reading
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Readings List */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Current Shift Readings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {nozzles.map((nozzle) => {
                const openingReading = getNozzleReading(nozzle.id, 'opening');
                const closingReading = getNozzleReading(nozzle.id, 'closing');

                return (
                  <div
                    key={nozzle.id}
                    className="rounded-lg border border-slate-200 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-slate-900">
                          Nozzle {nozzle.nozzleNumber} - {nozzle.fuelType.name}
                        </p>
                        <p className="text-sm text-slate-600">
                          Unit {nozzle.dispensingUnit.unitNumber}
                        </p>
                      </div>
                      {openingReading && closingReading && (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      )}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {/* Opening Reading */}
                      <div
                        className={`rounded-lg border p-3 ${
                          openingReading
                            ? 'border-green-200 bg-green-50'
                            : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <p className="text-sm font-medium text-slate-600">
                          Opening Reading
                        </p>
                        {openingReading ? (
                          <>
                            <p className="mt-1 text-2xl font-bold text-slate-900">
                              {formatNumber(openingReading.meterValue, 2)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatDateTime(openingReading.recordedAt)}
                            </p>
                          </>
                        ) : (
                          <p className="mt-1 text-sm text-slate-500">
                            Not recorded
                          </p>
                        )}
                      </div>

                      {/* Closing Reading */}
                      <div
                        className={`rounded-lg border p-3 ${
                          closingReading
                            ? 'border-red-200 bg-red-50'
                            : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <p className="text-sm font-medium text-slate-600">
                          Closing Reading
                        </p>
                        {closingReading ? (
                          <>
                            <p className="mt-1 text-2xl font-bold text-slate-900">
                              {formatNumber(closingReading.meterValue, 2)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatDateTime(closingReading.recordedAt)}
                            </p>
                          </>
                        ) : (
                          <p className="mt-1 text-sm text-slate-500">
                            Not recorded
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Variance */}
                    {openingReading && closingReading && (
                      <div className="mt-3 rounded-lg bg-blue-50 p-3">
                        <p className="text-sm font-medium text-slate-600">
                          Variance
                        </p>
                        <p className="text-xl font-bold text-blue-900">
                          {formatNumber(
                            parseFloat(closingReading.meterValue) -
                              parseFloat(openingReading.meterValue),
                            2
                          )}{' '}
                          liters
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
