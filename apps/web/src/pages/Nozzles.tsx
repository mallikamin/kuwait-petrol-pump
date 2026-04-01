import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Gauge, AlertCircle, Edit, Loader2 } from 'lucide-react';
import { branchesApi, fuelPricesApi } from '@/api';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Nozzle, DispensingUnit } from '@/types';

export function Nozzles() {
  const [unitDialogOpen, setUnitDialogOpen] = useState(false);
  const [nozzleDialogOpen, setNozzleDialogOpen] = useState(false);
  const [editingNozzle, setEditingNozzle] = useState<Nozzle | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');

  // Form states for dispensing unit
  const [unitName, setUnitName] = useState('');
  const [unitNumber, setUnitNumber] = useState('');

  // Form states for nozzle
  const [nozzleNumber, setNozzleNumber] = useState('');
  const [fuelTypeId, setFuelTypeId] = useState('');
  const [meterType, setMeterType] = useState('digital');

  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const branchId = user?.branch_id || (user as any)?.branch?.id;

  // Fetch branches with nested dispensing units and nozzles
  const { data: branchesData, isLoading: branchesLoading } = useQuery({
    queryKey: ['branches', 'with-units'],
    queryFn: async () => {
      const response = await branchesApi.getAll();
      return response.items;
    },
  });

  // Fetch fuel types
  const { data: fuelTypesData } = useQuery({
    queryKey: ['fuelTypes'],
    queryFn: () => fuelPricesApi.getFuelTypes(),
  });

  // Get current branch
  const currentBranch = branchesData?.find((b) => b.id === branchId);
  const dispensingUnits: DispensingUnit[] = (currentBranch as any)?.dispensingUnits || [];
  const fuelTypes = fuelTypesData || [];

  // Create dispensing unit mutation
  const createUnitMutation = useMutation({
    mutationFn: (data: { name: string; unitNumber: number }) =>
      branchesApi.createDispensingUnit(branchId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success('Dispensing unit created successfully');
      setUnitDialogOpen(false);
      resetUnitForm();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || 'Failed to create dispensing unit');
    },
  });

  // Create nozzle mutation
  const createNozzleMutation = useMutation({
    mutationFn: (data: { unitId: string; nozzleNumber: number; fuelTypeId: string; meterType: string }) =>
      branchesApi.createNozzle(data.unitId, {
        nozzleNumber: data.nozzleNumber,
        fuelTypeId: data.fuelTypeId,
        meterType: data.meterType,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success('Nozzle created successfully');
      setNozzleDialogOpen(false);
      resetNozzleForm();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || 'Failed to create nozzle');
    },
  });

  // Update nozzle mutation
  const updateNozzleMutation = useMutation({
    mutationFn: (data: { nozzleId: string; updates: Partial<{ nozzleNumber: number; fuelTypeId: string; meterType: string; isActive: boolean }> }) =>
      branchesApi.updateNozzle(data.nozzleId, data.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success('Nozzle updated successfully');
      setNozzleDialogOpen(false);
      setEditingNozzle(null);
      resetNozzleForm();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || 'Failed to update nozzle');
    },
  });

  const resetUnitForm = () => {
    setUnitName('');
    setUnitNumber('');
  };

  const resetNozzleForm = () => {
    setNozzleNumber('');
    setFuelTypeId('');
    setMeterType('digital');
    setSelectedUnitId('');
    setEditingNozzle(null);
  };

  const handleCreateUnit = () => {
    if (!unitName || !unitNumber) {
      toast.error('Please fill all required fields');
      return;
    }

    createUnitMutation.mutate({
      name: unitName,
      unitNumber: parseInt(unitNumber),
    });
  };

  const handleCreateNozzle = () => {
    if (!selectedUnitId || !nozzleNumber || !fuelTypeId) {
      toast.error('Please fill all required fields');
      return;
    }

    if (editingNozzle) {
      updateNozzleMutation.mutate({
        nozzleId: editingNozzle.id,
        updates: {
          nozzleNumber: parseInt(nozzleNumber),
          fuelTypeId,
          meterType,
        },
      });
    } else {
      createNozzleMutation.mutate({
        unitId: selectedUnitId,
        nozzleNumber: parseInt(nozzleNumber),
        fuelTypeId,
        meterType,
      });
    }
  };

  const handleEditNozzle = (nozzle: Nozzle, unitId: string) => {
    setEditingNozzle(nozzle);
    setSelectedUnitId(unitId);
    setNozzleNumber(nozzle.nozzleNumber?.toString() || '');
    setFuelTypeId(nozzle.fuelTypeId);
    setMeterType(nozzle.meterType || 'digital');
    setNozzleDialogOpen(true);
  };

  const handleToggleNozzle = async (nozzle: Nozzle) => {
    try {
      await branchesApi.updateNozzleStatus(nozzle.id, !nozzle.isActive);
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success(`Nozzle ${nozzle.isActive ? 'deactivated' : 'activated'} successfully`);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Failed to toggle nozzle status');
    }
  };

  const openNozzleDialog = (unitId: string) => {
    setSelectedUnitId(unitId);
    setNozzleDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nozzles Management</h1>
          <p className="text-muted-foreground">Manage dispensing units and nozzles</p>
        </div>
        <Button onClick={() => setUnitDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Dispensing Unit
        </Button>
      </div>

      {/* Loading State */}
      {branchesLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">Loading nozzles...</span>
        </div>
      )}

      {/* No Branch State */}
      {!branchesLoading && !currentBranch && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No branch found for your account. Please contact your administrator.
          </AlertDescription>
        </Alert>
      )}

      {/* Dispensing Units and Nozzles */}
      {!branchesLoading && currentBranch && (
        <>
          {dispensingUnits.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Gauge className="mx-auto h-12 w-12 mb-4 opacity-50 text-muted-foreground" />
                <p className="text-muted-foreground">No dispensing units found</p>
                <p className="text-sm text-muted-foreground">Add your first dispensing unit to get started</p>
                <Button onClick={() => setUnitDialogOpen(true)} className="mt-4">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Dispensing Unit
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {dispensingUnits.map((unit) => {
                const nozzles = unit.nozzles || [];

                return (
                  <Card key={unit.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <Gauge className="h-5 w-5" />
                            {unit.name || `Unit ${unit.unitNumber}`}
                          </CardTitle>
                          <CardDescription>
                            {nozzles.length} nozzle{nozzles.length !== 1 ? 's' : ''}
                          </CardDescription>
                        </div>
                        <Button onClick={() => openNozzleDialog(unit.id)}>
                          <Plus className="mr-2 h-4 w-4" />
                          Add Nozzle
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {nozzles.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <p>No nozzles configured for this unit</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openNozzleDialog(unit.id)}
                            className="mt-2"
                          >
                            <Plus className="mr-2 h-3 w-3" />
                            Add First Nozzle
                          </Button>
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Nozzle #</TableHead>
                              <TableHead>Fuel Type</TableHead>
                              <TableHead>Meter Type</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {nozzles.map((nozzle) => (
                              <TableRow key={nozzle.id}>
                                <TableCell className="font-medium">
                                  <div className="flex items-center">
                                    <Gauge className="mr-2 h-4 w-4 text-muted-foreground" />
                                    Nozzle {nozzle.nozzleNumber}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline">
                                    {nozzle.fuelType?.name || 'Unknown'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="capitalize">
                                  {nozzle.meterType || 'digital'}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={nozzle.isActive ? 'default' : 'secondary'}>
                                    {nozzle.isActive ? 'Active' : 'Inactive'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right space-x-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleEditNozzle(nozzle, unit.id)}
                                  >
                                    <Edit className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant={nozzle.isActive ? 'secondary' : 'default'}
                                    size="sm"
                                    onClick={() => handleToggleNozzle(nozzle)}
                                  >
                                    {nozzle.isActive ? 'Deactivate' : 'Activate'}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Add Dispensing Unit Dialog */}
      <Dialog open={unitDialogOpen} onOpenChange={setUnitDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add Dispensing Unit</DialogTitle>
            <DialogDescription>
              Create a new dispensing unit (pump station/machine) for your branch.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="unit-name">Unit Name *</Label>
              <Input
                id="unit-name"
                placeholder="e.g., Pump Station 1, Machine A"
                value={unitName}
                onChange={(e) => setUnitName(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="unit-number">Unit Number *</Label>
              <Input
                id="unit-number"
                type="number"
                placeholder="e.g., 1, 2, 3"
                value={unitNumber}
                onChange={(e) => setUnitNumber(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setUnitDialogOpen(false); resetUnitForm(); }}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateUnit}
              disabled={createUnitMutation.isPending || !unitName || !unitNumber}
            >
              {createUnitMutation.isPending ? 'Creating...' : 'Create Unit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Nozzle Dialog */}
      <Dialog open={nozzleDialogOpen} onOpenChange={(open) => {
        setNozzleDialogOpen(open);
        if (!open) resetNozzleForm();
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingNozzle ? 'Edit Nozzle' : 'Add Nozzle'}</DialogTitle>
            <DialogDescription>
              {editingNozzle ? 'Update nozzle details.' : 'Add a new nozzle to the selected dispensing unit.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {!editingNozzle && (
              <div className="grid gap-2">
                <Label htmlFor="dispensing-unit">Dispensing Unit *</Label>
                <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select dispensing unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {dispensingUnits.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name || `Unit ${unit.unitNumber}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="nozzle-number">Nozzle Number *</Label>
              <Input
                id="nozzle-number"
                type="number"
                placeholder="e.g., 1, 2, 3"
                value={nozzleNumber}
                onChange={(e) => setNozzleNumber(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="fuel-type">Fuel Type *</Label>
              <Select value={fuelTypeId} onValueChange={setFuelTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select fuel type" />
                </SelectTrigger>
                <SelectContent>
                  {fuelTypes.map((fuel) => (
                    <SelectItem key={fuel.id} value={fuel.id}>
                      {fuel.name} ({fuel.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="meter-type">Meter Type *</Label>
              <Select value={meterType} onValueChange={setMeterType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="digital">Digital</SelectItem>
                  <SelectItem value="analog">Analog</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setNozzleDialogOpen(false); resetNozzleForm(); }}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateNozzle}
              disabled={createNozzleMutation.isPending || updateNozzleMutation.isPending || !nozzleNumber || !fuelTypeId || (!editingNozzle && !selectedUnitId)}
            >
              {(createNozzleMutation.isPending || updateNozzleMutation.isPending)
                ? (editingNozzle ? 'Updating...' : 'Creating...')
                : (editingNozzle ? 'Update Nozzle' : 'Create Nozzle')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
