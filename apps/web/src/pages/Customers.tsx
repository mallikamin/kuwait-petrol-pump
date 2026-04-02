import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Users, Edit } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { customersApi } from '@/api';
import { formatCurrency } from '@/utils/format';
import { useToast } from '@/components/ui/use-toast';

interface CustomerFormData {
  name: string;
  phone: string;
  email: string;
  address: string;
  vehicleNumbers: string[];
  creditLimit: number;
  creditDays: number;
  isActive: boolean;
}

export function Customers() {
  const page = 1; // TODO: Add pagination
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CustomerFormData>({
    name: '',
    phone: '',
    email: '',
    address: '',
    vehicleNumbers: [],
    creditLimit: 0,
    creditDays: 0,
    isActive: true,
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['customers', page],
    queryFn: () => customersApi.getAll({ page, size: 20 }),
  });

  const createMutation = useMutation({
    mutationFn: (data: CustomerFormData) => customersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: 'Success',
        description: 'Customer created successfully',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.response?.data?.message || 'Failed to create customer',
        variant: 'destructive',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CustomerFormData> }) =>
      customersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setIsEditDialogOpen(false);
      setSelectedCustomerId(null);
      resetForm();
      toast({
        title: 'Success',
        description: 'Customer updated successfully',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.response?.data?.message || 'Failed to update customer',
        variant: 'destructive',
      });
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      phone: '',
      email: '',
      address: '',
      vehicleNumbers: [],
      creditLimit: 0,
      creditDays: 0,
      isActive: true,
    });
  };

  const handleAdd = () => {
    resetForm();
    setIsAddDialogOpen(true);
  };

  const handleEdit = (customer: any) => {
    setSelectedCustomerId(customer.id);
    setFormData({
      name: customer.name,
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      vehicleNumbers: customer.vehicleNumbers || [],
      creditLimit: customer.creditLimit || 0,
      creditDays: customer.creditDays || 0,
      isActive: customer.isActive,
    });
    setIsEditDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.name) {
      toast({
        title: 'Validation Error',
        description: 'Name is required',
        variant: 'destructive',
      });
      return;
    }

    if (selectedCustomerId) {
      updateMutation.mutate({ id: selectedCustomerId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleToggleActive = (customer: any) => {
    updateMutation.mutate({
      id: customer.id,
      data: { isActive: !customer.isActive },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground">Manage customer accounts and credit</p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add Customer
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Customers</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Credit Limit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items?.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center">
                        <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                        {customer.name}
                      </div>
                    </TableCell>
                    <TableCell>{customer.phone || 'N/A'}</TableCell>
                    <TableCell>{customer.email || 'N/A'}</TableCell>
                    <TableCell>{formatCurrency(customer.creditLimit || 0)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={customer.isActive ? 'success' : 'destructive'}>
                          {customer.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                        <Switch
                          checked={customer.isActive}
                          onCheckedChange={() => handleToggleActive(customer)}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(customer)}
                      >
                        <Edit className="mr-1 h-3 w-3" />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Customer Dialog */}
      <Dialog
        open={isAddDialogOpen || isEditDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsAddDialogOpen(false);
            setIsEditDialogOpen(false);
            setSelectedCustomerId(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedCustomerId ? 'Edit Customer' : 'Add New Customer'}
            </DialogTitle>
            <DialogDescription>
              {selectedCustomerId
                ? 'Update customer information'
                : 'Create a new customer account'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Customer name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="Phone number"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="Email address"
              />
            </div>

            <div className="space-y-2 col-span-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Customer address"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="creditLimit">Credit Limit</Label>
              <Input
                id="creditLimit"
                type="number"
                value={formData.creditLimit}
                onChange={(e) =>
                  setFormData({ ...formData, creditLimit: parseFloat(e.target.value) || 0 })
                }
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="creditDays">Credit Days</Label>
              <Input
                id="creditDays"
                type="number"
                value={formData.creditDays}
                onChange={(e) =>
                  setFormData({ ...formData, creditDays: parseInt(e.target.value) || 0 })
                }
                placeholder="0"
              />
            </div>

            <div className="flex items-center space-x-2 col-span-2">
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, isActive: checked })
                }
              />
              <Label htmlFor="isActive">Active</Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAddDialogOpen(false);
                setIsEditDialogOpen(false);
                setSelectedCustomerId(null);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending
                ? 'Saving...'
                : selectedCustomerId
                ? 'Update'
                : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
