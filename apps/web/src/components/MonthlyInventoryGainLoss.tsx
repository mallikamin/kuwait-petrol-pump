import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface GainLossEntry {
  id: string;
  branchId: string;
  fuelTypeId: string;
  month: string;
  quantity: number;
  remarks: string | null;
  recordedBy: string;
  recordedAt: string;
  fuel?: {
    code: string;
    name: string;
  };
  recordedByUser?: {
    id: string;
    username: string;
    fullName: string | null;
  };
}

interface MonthlyGainLossProps {
  branchId: string;
}

export function MonthlyInventoryGainLoss({ branchId }: MonthlyGainLossProps) {
  const [selectedMonth, setSelectedMonth] = useState<string>(
    new Date().toISOString().substring(0, 7)
  );
  const [quantity, setQuantity] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');
  const [selectedFuelId, setSelectedFuelId] = useState<string>('');

  const queryClient = useQueryClient();

  // Get fuel types. Canonical endpoint is /api/fuel-prices/fuel-types — the
  // bare /fuel-types path 404s in production (no such route mounted).
  const { data: fuelTypes = [] } = useQuery({
    queryKey: ['fuelTypes'],
    queryFn: async () => {
      const response = await apiClient.get('/fuel-prices/fuel-types');
      return response.data;
    },
  });

  // Get entries for selected month
  const { data: entriesResponse } = useQuery({
    queryKey: ['monthlyGainLoss', branchId, selectedMonth],
    queryFn: async () => {
      const response = await apiClient.get('/inventory/monthly-gain-loss', {
        params: {
          branchId,
          month: selectedMonth,
        },
      });
      return response.data;
    },
  });

  const entries: GainLossEntry[] = entriesResponse?.entries || [];

  // Create entry mutation
  const createMutation = useMutation({
    mutationFn: async (data: {
      fuelTypeId: string;
      quantity: number;
      remarks: string;
    }) => {
      const response = await apiClient.post('/inventory/monthly-gain-loss', {
        branchId,
        fuelTypeId: data.fuelTypeId,
        month: selectedMonth,
        quantity: data.quantity,
        remarks: data.remarks || undefined,
      });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Gain/Loss entry recorded');
      setQuantity('');
      setRemarks('');
      setSelectedFuelId('');
      queryClient.invalidateQueries({
        queryKey: ['monthlyGainLoss', branchId, selectedMonth],
      });
    },
    onError: (error: any) => {
      const message =
        error.response?.data?.error || 'Failed to record entry';
      toast.error(message);
    },
  });

  // Delete entry mutation
  const deleteMutation = useMutation({
    mutationFn: async (entryId: string) => {
      await apiClient.delete(`/inventory/monthly-gain-loss/${entryId}`);
    },
    onSuccess: () => {
      toast.success('Entry deleted');
      queryClient.invalidateQueries({
        queryKey: ['monthlyGainLoss', branchId, selectedMonth],
      });
    },
    onError: (error: any) => {
      const message =
        error.response?.data?.error || 'Failed to delete entry';
      toast.error(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedFuelId) {
      toast.error('Please select a fuel type');
      return;
    }

    if (!quantity || isNaN(parseFloat(quantity))) {
      toast.error('Please enter a valid quantity');
      return;
    }

    createMutation.mutate({
      fuelTypeId: selectedFuelId,
      quantity: parseFloat(quantity),
      remarks,
    });
  };

  const totalGainLoss = entries.reduce((sum, entry) => sum + entry.quantity, 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Monthly Inventory Gain/Loss</CardTitle>
          <CardDescription>
            Record month-end fuel count adjustments for reconciliation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Entry Form */}
          <form onSubmit={handleSubmit} className="space-y-4 border-b pb-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Month
                </label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  disabled={createMutation.isPending}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Fuel Type
                </label>
                <select
                  value={selectedFuelId}
                  onChange={(e) => setSelectedFuelId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  disabled={createMutation.isPending}
                >
                  <option value="">Select fuel type...</option>
                  {fuelTypes.map((fuel: any) => (
                    <option key={fuel.id} value={fuel.id}>
                      {fuel.code} - {fuel.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Quantity (Liters)
                </label>
                <Input
                  type="number"
                  placeholder="100 (gain) or -50 (loss)"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  step="0.01"
                  disabled={createMutation.isPending}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Remarks (Optional)
                </label>
                <Input
                  type="text"
                  placeholder="e.g., physical count variance"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  disabled={createMutation.isPending}
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={createMutation.isPending}
              className="w-full"
            >
              {createMutation.isPending ? 'Recording...' : 'Record Entry'}
            </Button>
          </form>

          {/* Summary Stats */}
          {entries.length > 0 && (
            <div className="grid grid-cols-3 gap-4 py-4">
              <Card className="bg-blue-50">
                <CardContent className="pt-4">
                  <div className="text-sm text-gray-600">Total Gain/Loss</div>
                  <div className="text-2xl font-bold">
                    {totalGainLoss > 0 ? '+' : ''}{totalGainLoss.toFixed(2)}L
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {entries.length} fuel type{entries.length !== 1 ? 's' : ''}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-green-50">
                <CardContent className="pt-4">
                  <div className="text-sm text-gray-600">Total Gains</div>
                  <div className="text-2xl font-bold text-green-600">
                    +
                    {entries
                      .filter((e) => e.quantity > 0)
                      .reduce((sum, e) => sum + e.quantity, 0)
                      .toFixed(2)}
                    L
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-red-50">
                <CardContent className="pt-4">
                  <div className="text-sm text-gray-600">Total Losses</div>
                  <div className="text-2xl font-bold text-red-600">
                    {entries
                      .filter((e) => e.quantity < 0)
                      .reduce((sum, e) => sum + e.quantity, 0)
                      .toFixed(2)}
                    L
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Entries Table */}
          {entries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-4 py-2 text-left font-medium">Fuel</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Quantity
                    </th>
                    <th className="px-4 py-2 text-left font-medium">Remarks</th>
                    <th className="px-4 py-2 text-left font-medium">
                      Recorded By
                    </th>
                    <th className="px-4 py-2 text-left font-medium">Date</th>
                    <th className="px-4 py-2 text-center font-medium">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">
                        {entry.fuel?.code} - {entry.fuel?.name}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono ${
                          entry.quantity > 0
                            ? 'text-green-600'
                            : 'text-red-600'
                        }`}
                      >
                        {entry.quantity > 0 ? '+' : ''}
                        {entry.quantity.toFixed(2)}L
                      </td>
                      <td className="px-4 py-2 text-gray-600">
                        {entry.remarks || '-'}
                      </td>
                      <td className="px-4 py-2 text-sm">
                        <div className="font-medium">
                          {entry.recordedByUser?.username}
                        </div>
                        <div className="text-gray-500">
                          {entry.recordedByUser?.fullName}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-500">
                        {new Date(entry.recordedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(entry.id)}
                          disabled={deleteMutation.isPending}
                          className="text-red-600 hover:text-red-700"
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-gray-500">
              No entries for {selectedMonth}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
