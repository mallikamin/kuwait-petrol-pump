import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nozzlesApi, salesApi, customersApi } from '../api/endpoints';
import { useAppStore } from '../store/appStore';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { formatCurrency, formatNumber } from '../utils/format';
import { toast } from 'sonner';
import { Fuel, Printer } from 'lucide-react';
import type { Nozzle, PaymentMethod } from '@shared/types';

export const FuelSales: React.FC = () => {
  const queryClient = useQueryClient();
  const { currentBranch, currentShift } = useAppStore();

  const [selectedNozzle, setSelectedNozzle] = useState<Nozzle | null>(null);
  const [liters, setLiters] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [slipNumber, setSlipNumber] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');

  // Fetch nozzles
  const { data: nozzlesData } = useQuery({
    queryKey: ['nozzles', currentBranch?.id],
    queryFn: () => nozzlesApi.getAll({ branchId: currentBranch?.id, isActive: true }),
    enabled: !!currentBranch,
  });

  // Fetch customers
  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customersApi.getAll({ isActive: true, limit: 100 }),
  });

  const nozzles = nozzlesData?.data || [];
  const customers = customersData?.data.items || [];

  const pricePerLiter = selectedNozzle
    ? parseFloat(selectedNozzle.currentPrice || '0')
    : 0;

  // Auto-calculate amount when liters change
  useEffect(() => {
    if (liters && pricePerLiter > 0) {
      const calculatedAmount = parseFloat(liters) * pricePerLiter;
      setAmount(calculatedAmount.toFixed(3));
    }
  }, [liters, pricePerLiter]);

  // Auto-calculate liters when amount changes
  const handleAmountChange = (value: string) => {
    setAmount(value);
    if (value && pricePerLiter > 0) {
      const calculatedLiters = parseFloat(value) / pricePerLiter;
      setLiters(calculatedLiters.toFixed(2));
    }
  };

  // Create fuel sale mutation
  const createSaleMutation = useMutation({
    mutationFn: (data: any) => salesApi.createFuelSale(data),
    onSuccess: (response) => {
      toast.success('Fuel sale recorded successfully');
      queryClient.invalidateQueries({ queryKey: ['sales-summary'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });

      // Print receipt
      if (window.api) {
        window.api.printReceipt(response.data);
      }

      // Reset form
      setLiters('');
      setAmount('');
      setVehicleNumber('');
      setSlipNumber('');
      setSelectedCustomerId('');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to record sale');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentBranch) {
      toast.error('Please select a branch');
      return;
    }

    if (!selectedNozzle) {
      toast.error('Please select a nozzle');
      return;
    }

    if (!liters || parseFloat(liters) <= 0) {
      toast.error('Please enter valid liters');
      return;
    }

    createSaleMutation.mutate({
      branchId: currentBranch.id,
      shiftInstanceId: currentShift?.id,
      nozzleId: selectedNozzle.id,
      fuelTypeId: selectedNozzle.fuelType.id,
      quantityLiters: parseFloat(liters),
      pricePerLiter,
      paymentMethod,
      vehicleNumber: vehicleNumber || undefined,
      slipNumber: slipNumber || undefined,
      customerId: selectedCustomerId || undefined,
    });
  };

  if (!currentShift) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-lg text-slate-600">
              Please open a shift before recording fuel sales
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Fuel Sales</h1>
        <p className="mt-1 text-sm text-slate-600">Record fuel dispensing transactions</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Nozzle Selection */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Select Nozzle</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {nozzles.map((nozzle) => (
                <button
                  key={nozzle.id}
                  onClick={() => setSelectedNozzle(nozzle)}
                  className={`w-full rounded-lg border-2 p-4 text-left transition-colors ${
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
                      <p className="text-sm text-slate-600">{nozzle.fuelType.name}</p>
                    </div>
                    <Fuel className="h-6 w-6 text-blue-600" />
                  </div>
                  <p className="mt-2 text-lg font-bold text-slate-900">
                    {formatCurrency(nozzle.currentPrice || '0')}
                    <span className="text-sm font-normal text-slate-500">/liter</span>
                  </p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Sale Form */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Record Sale</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {selectedNozzle && (
                <div className="rounded-lg bg-blue-50 p-4">
                  <p className="text-sm text-slate-600">Selected Nozzle</p>
                  <p className="text-lg font-semibold text-slate-900">
                    Nozzle {selectedNozzle.nozzleNumber} - {selectedNozzle.fuelType.name}
                  </p>
                  <p className="text-sm text-slate-600">
                    {formatCurrency(selectedNozzle.currentPrice || '0')} per liter
                  </p>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  type="number"
                  label="Liters"
                  value={liters}
                  onChange={(e) => setLiters(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  required
                  disabled={!selectedNozzle}
                />

                <Input
                  type="number"
                  label="Amount (KWD)"
                  value={amount}
                  onChange={(e) => handleAmountChange(e.target.value)}
                  placeholder="0.000"
                  step="0.001"
                  min="0"
                  required
                  disabled={!selectedNozzle}
                />
              </div>

              <Select
                label="Payment Method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                options={[
                  { value: 'cash', label: 'Cash' },
                  { value: 'credit', label: 'Credit' },
                  { value: 'card', label: 'Card' },
                  { value: 'pso_card', label: 'PSO Card' },
                ]}
              />

              <Input
                label="Vehicle Number (Optional)"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
                placeholder="ABC-1234"
              />

              <Input
                label="Slip Number (Optional)"
                value={slipNumber}
                onChange={(e) => setSlipNumber(e.target.value)}
                placeholder="12345"
              />

              <Select
                label="Customer (Optional)"
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                options={[
                  { value: '', label: 'Select customer' },
                  ...customers.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />

              {/* Summary */}
              {liters && amount && (
                <div className="rounded-lg border-2 border-blue-600 bg-blue-50 p-4">
                  <p className="text-sm font-medium text-slate-600">Total Amount</p>
                  <p className="text-3xl font-bold text-blue-600">
                    {formatCurrency(amount)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatNumber(liters)} liters @ {formatCurrency(pricePerLiter)}/liter
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  type="submit"
                  variant="primary"
                  className="flex-1"
                  isLoading={createSaleMutation.isPending}
                  disabled={!selectedNozzle}
                >
                  Record Sale
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setLiters('');
                    setAmount('');
                    setVehicleNumber('');
                    setSlipNumber('');
                    setSelectedCustomerId('');
                  }}
                >
                  Clear
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
