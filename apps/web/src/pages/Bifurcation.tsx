import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Calculator } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency, formatDate } from '@/utils/format';
import { apiClient } from '@/api/client';

interface BifurcationFormData {
  date: string;
  totalPMGLiters: number;
  totalHSDLiters: number;
  creditSales: number;
  psoCardSales: number;
  bankCardSales: number;
  cashSales: number;
  notes: string;
}

export function Bifurcation() {
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<BifurcationFormData>({
    date: new Date().toISOString().split('T')[0],
    totalPMGLiters: 0,
    totalHSDLiters: 0,
    creditSales: 0,
    psoCardSales: 0,
    bankCardSales: 0,
    cashSales: 0,
    notes: '',
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch bifurcation records
  const { data: bifurcations, isLoading } = useQuery({
    queryKey: ['bifurcations'],
    queryFn: async () => {
      const response = await apiClient.get('/api/bifurcation');
      return response.data;
    },
  });

  const createBifurcation = useMutation({
    mutationFn: async (data: BifurcationFormData) => {
      const response = await apiClient.post('/api/bifurcation', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bifurcations'] });
      setIsWizardOpen(false);
      resetForm();
      toast({
        title: 'Success',
        description: 'Bifurcation record created successfully',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.response?.data?.message || 'Failed to create bifurcation',
        variant: 'destructive',
      });
    },
  });

  const resetForm = () => {
    setFormData({
      date: new Date().toISOString().split('T')[0],
      totalPMGLiters: 0,
      totalHSDLiters: 0,
      creditSales: 0,
      psoCardSales: 0,
      bankCardSales: 0,
      cashSales: 0,
      notes: '',
    });
    setCurrentStep(1);
  };

  const handleNext = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = () => {
    createBifurcation.mutate(formData);
  };

  const totalSales = formData.creditSales + formData.psoCardSales + formData.bankCardSales + formData.cashSales;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bifurcation</h1>
          <p className="text-muted-foreground">End-of-day sales allocation (Cash/Credit/Card)</p>
        </div>
        <Button onClick={() => setIsWizardOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Bifurcation
        </Button>
      </div>

      <Tabs defaultValue="records" className="space-y-4">
        <TabsList>
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="guide">How It Works</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Bifurcation Records</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-16" />
                  ))}
                </div>
              ) : !bifurcations || bifurcations.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  No bifurcation records yet. Click "New Bifurcation" to create one.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>PMG (L)</TableHead>
                      <TableHead>HSD (L)</TableHead>
                      <TableHead>Credit</TableHead>
                      <TableHead>PSO Card</TableHead>
                      <TableHead>Bank Card</TableHead>
                      <TableHead>Cash</TableHead>
                      <TableHead>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bifurcations.map((record: any) => (
                      <TableRow key={record.id}>
                        <TableCell>{formatDate(record.date)}</TableCell>
                        <TableCell>{record.totalPMGLiters || 0}</TableCell>
                        <TableCell>{record.totalHSDLiters || 0}</TableCell>
                        <TableCell>{formatCurrency(record.creditSales)}</TableCell>
                        <TableCell>{formatCurrency(record.psoCardSales)}</TableCell>
                        <TableCell>{formatCurrency(record.bankCardSales)}</TableCell>
                        <TableCell>{formatCurrency(record.cashSales)}</TableCell>
                        <TableCell className="font-medium">
                          {formatCurrency(
                            record.creditSales + record.psoCardSales + record.bankCardSales + record.cashSales
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="guide">
          <Card>
            <CardHeader>
              <CardTitle>Bifurcation Process</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start space-x-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  1
                </div>
                <div>
                  <h3 className="font-semibold">Record Total Sales</h3>
                  <p className="text-sm text-muted-foreground">Enter total PMG and HSD liters sold</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  2
                </div>
                <div>
                  <h3 className="font-semibold">Review Credit Sales</h3>
                  <p className="text-sm text-muted-foreground">Accountant reviews all credit sale invoices (petrol pump slips)</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  3
                </div>
                <div>
                  <h3 className="font-semibold">Enter Card Transactions</h3>
                  <p className="text-sm text-muted-foreground">Enter bank cards and PSO pump cards</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  4
                </div>
                <div>
                  <h3 className="font-semibold">Calculate Cash</h3>
                  <p className="text-sm text-muted-foreground">Remaining balance is automatically allocated to cash</p>
                </div>
              </div>

              <div className="pt-4">
                <Button className="w-full" size="lg" onClick={() => setIsWizardOpen(true)}>
                  <Calculator className="mr-2 h-5 w-5" />
                  Start Bifurcation Wizard
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Bifurcation Wizard Dialog */}
      <Dialog open={isWizardOpen} onOpenChange={setIsWizardOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bifurcation Wizard - Step {currentStep} of 4</DialogTitle>
            <DialogDescription>
              {currentStep === 1 && 'Enter total fuel sales for the day'}
              {currentStep === 2 && 'Enter credit sales amount'}
              {currentStep === 3 && 'Enter card transaction amounts'}
              {currentStep === 4 && 'Review and confirm bifurcation'}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {/* Step 1: Total Sales */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="date">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="pmg">Total PMG Liters</Label>
                    <Input
                      id="pmg"
                      type="number"
                      step="0.01"
                      value={formData.totalPMGLiters}
                      onChange={(e) =>
                        setFormData({ ...formData, totalPMGLiters: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hsd">Total HSD Liters</Label>
                    <Input
                      id="hsd"
                      type="number"
                      step="0.01"
                      value={formData.totalHSDLiters}
                      onChange={(e) =>
                        setFormData({ ...formData, totalHSDLiters: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Credit Sales */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="credit">Credit Sales Amount</Label>
                  <Input
                    id="credit"
                    type="number"
                    step="0.01"
                    value={formData.creditSales}
                    onChange={(e) =>
                      setFormData({ ...formData, creditSales: parseFloat(e.target.value) || 0 })
                    }
                    placeholder="0.00"
                  />
                  <p className="text-sm text-muted-foreground">
                    Total amount from all credit sale invoices
                  </p>
                </div>
              </div>
            )}

            {/* Step 3: Card Transactions */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="psoCard">PSO Card Sales</Label>
                  <Input
                    id="psoCard"
                    type="number"
                    step="0.01"
                    value={formData.psoCardSales}
                    onChange={(e) =>
                      setFormData({ ...formData, psoCardSales: parseFloat(e.target.value) || 0 })
                    }
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bankCard">Bank Card Sales</Label>
                  <Input
                    id="bankCard"
                    type="number"
                    step="0.01"
                    value={formData.bankCardSales}
                    onChange={(e) =>
                      setFormData({ ...formData, bankCardSales: parseFloat(e.target.value) || 0 })
                    }
                    placeholder="0.00"
                  />
                </div>
              </div>
            )}

            {/* Step 4: Review & Confirm */}
            {currentStep === 4 && (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Date:</span>
                      <span className="font-medium">{formatDate(formData.date)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">PMG Liters:</span>
                      <span className="font-medium">{formData.totalPMGLiters}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">HSD Liters:</span>
                      <span className="font-medium">{formData.totalHSDLiters}</span>
                    </div>
                    <div className="border-t pt-3 mt-3">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Credit Sales:</span>
                        <span>{formatCurrency(formData.creditSales)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">PSO Card:</span>
                        <span>{formatCurrency(formData.psoCardSales)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Bank Card:</span>
                        <span>{formatCurrency(formData.bankCardSales)}</span>
                      </div>
                      <div className="flex justify-between font-medium text-lg border-t pt-2 mt-2">
                        <span>Total:</span>
                        <span>{formatCurrency(totalSales)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes (Optional)</Label>
                  <Input
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Any additional notes..."
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex justify-between">
            <div>
              {currentStep > 1 && (
                <Button variant="outline" onClick={handleBack}>
                  Back
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsWizardOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              {currentStep < 4 ? (
                <Button onClick={handleNext}>Next</Button>
              ) : (
                <Button onClick={handleSubmit} disabled={createBifurcation.isPending}>
                  {createBifurcation.isPending ? 'Saving...' : 'Save Bifurcation'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
