import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi } from '../api/endpoints';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { formatCurrency, formatDate } from '../utils/format';
import { toast } from 'sonner';
import { Users, Plus, Search, Edit, Eye } from 'lucide-react';
import type { Customer } from '@shared/types';

export const Customers: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    vehicleNumbers: '',
    creditLimit: '',
    creditDays: '',
  });

  // Fetch customers
  const { data: customersData, isLoading } = useQuery({
    queryKey: ['customers', searchQuery],
    queryFn: () =>
      customersApi.getAll({
        search: searchQuery || undefined,
        isActive: true,
        limit: 50,
      }),
  });

  const customers = customersData?.data.items || [];

  // Create customer mutation
  const createCustomerMutation = useMutation({
    mutationFn: (data: any) => customersApi.create(data),
    onSuccess: () => {
      toast.success('Customer created successfully');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setShowAddForm(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to create customer');
    },
  });

  // Update customer mutation
  const updateCustomerMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      customersApi.update(id, data),
    onSuccess: () => {
      toast.success('Customer updated successfully');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setSelectedCustomer(null);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to update customer');
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      phone: '',
      email: '',
      address: '',
      vehicleNumbers: '',
      creditLimit: '',
      creditDays: '',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const data = {
      name: formData.name,
      phone: formData.phone || undefined,
      email: formData.email || undefined,
      address: formData.address || undefined,
      vehicleNumbers: formData.vehicleNumbers
        ? formData.vehicleNumbers.split(',').map((v) => v.trim())
        : undefined,
      creditLimit: formData.creditLimit ? parseFloat(formData.creditLimit) : undefined,
      creditDays: formData.creditDays ? parseInt(formData.creditDays) : undefined,
    };

    if (selectedCustomer) {
      updateCustomerMutation.mutate({ id: selectedCustomer.id, data });
    } else {
      createCustomerMutation.mutate(data);
    }
  };

  const handleEdit = (customer: Customer) => {
    setSelectedCustomer(customer);
    setFormData({
      name: customer.name,
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      vehicleNumbers: customer.vehicleNumbers?.join(', ') || '',
      creditLimit: customer.creditLimit || '',
      creditDays: customer.creditDays?.toString() || '',
    });
    setShowAddForm(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Customers</h1>
          <p className="mt-1 text-sm text-slate-600">Manage customer database</p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setShowAddForm(true);
            setSelectedCustomer(null);
            resetForm();
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Customer
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Customer List */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Customer List
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Search */}
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
                <Input
                  placeholder="Search by name, phone, or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* List */}
            <div className="space-y-3">
              {isLoading && <p className="text-sm text-slate-500">Loading...</p>}

              {!isLoading && customers.length === 0 && (
                <p className="text-sm text-slate-500">No customers found</p>
              )}

              {customers.map((customer: Customer) => (
                <div
                  key={customer.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 p-4 hover:bg-slate-50"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-slate-900">{customer.name}</p>
                    <div className="mt-1 space-y-1 text-sm text-slate-600">
                      {customer.phone && <p>Phone: {customer.phone}</p>}
                      {customer.email && <p>Email: {customer.email}</p>}
                      {customer.vehicleNumbers && customer.vehicleNumbers.length > 0 && (
                        <p>Vehicles: {customer.vehicleNumbers.join(', ')}</p>
                      )}
                    </div>
                    {customer.creditLimit && (
                      <div className="mt-2 flex items-center gap-4 text-sm">
                        <span className="rounded bg-blue-100 px-2 py-1 font-medium text-blue-700">
                          Credit Limit: {formatCurrency(customer.creditLimit)}
                        </span>
                        {customer.creditDays && (
                          <span className="text-slate-600">
                            {customer.creditDays} days
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleEdit(customer)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Add/Edit Form */}
        {showAddForm && (
          <Card>
            <CardHeader>
              <CardTitle>
                {selectedCustomer ? 'Edit Customer' : 'Add New Customer'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  label="Name *"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />

                <Input
                  label="Phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+965-12345678"
                />

                <Input
                  label="Email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="customer@example.com"
                />

                <Input
                  label="Address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Kuwait City"
                />

                <Input
                  label="Vehicle Numbers (comma-separated)"
                  value={formData.vehicleNumbers}
                  onChange={(e) =>
                    setFormData({ ...formData, vehicleNumbers: e.target.value })
                  }
                  placeholder="ABC-1234, XYZ-5678"
                />

                <Input
                  label="Credit Limit (PKR)"
                  type="number"
                  step="0.001"
                  value={formData.creditLimit}
                  onChange={(e) =>
                    setFormData({ ...formData, creditLimit: e.target.value })
                  }
                  placeholder="50000.000"
                />

                <Input
                  label="Credit Days"
                  type="number"
                  value={formData.creditDays}
                  onChange={(e) =>
                    setFormData({ ...formData, creditDays: e.target.value })
                  }
                  placeholder="30"
                />

                <div className="flex gap-2">
                  <Button
                    type="submit"
                    variant="primary"
                    className="flex-1"
                    isLoading={
                      createCustomerMutation.isPending || updateCustomerMutation.isPending
                    }
                  >
                    {selectedCustomer ? 'Update' : 'Create'} Customer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowAddForm(false);
                      setSelectedCustomer(null);
                      resetForm();
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
