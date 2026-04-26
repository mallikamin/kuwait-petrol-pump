import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Calculator, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatCurrency, formatDate } from '@/utils/format';
import { bifurcationsApi } from '@/api/bifurcations';
import { useAuthStore } from '@/store/auth';
import { useEffectiveBranchId } from '@/hooks/useEffectiveBranch';

interface BifurcationFormData {
  branchId: string;
  date: string;
  pmgTotalLiters: number;
  pmgTotalAmount: number;
  hsdTotalLiters: number;
  hsdTotalAmount: number;
  cashAmount: number;
  creditAmount: number;
  cardAmount: number;
  psoCardAmount: number;
  expectedTotal: number;
  actualTotal: number;
  varianceNotes: string;
  creditVerified: boolean;
  cardVerified: boolean;
}

export function Bifurcation() {
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Store meter readings and POS data separately
  const [meterData, setMeterData] = useState<any>(null);
  const [posData, setPosData] = useState<any>(null);
  const [lagData, setLagData] = useState<any>(null);

  const [formData, setFormData] = useState<BifurcationFormData>({
    branchId: '',
    date: new Date().toISOString().split('T')[0],
    pmgTotalLiters: 0,
    pmgTotalAmount: 0,
    hsdTotalLiters: 0,
    hsdTotalAmount: 0,
    cashAmount: 0,
    creditAmount: 0,
    cardAmount: 0,
    psoCardAmount: 0,
    expectedTotal: 0,
    actualTotal: 0,
    varianceNotes: '',
    creditVerified: false,
    cardVerified: false,
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  // Active branch from the top-bar org/branch switcher; falls back to JWT
  // branch for single-org users (zero behavior change for them).
  const branchId = useEffectiveBranchId();

  // Fetch bifurcation history
  const { data: bifurcationsData, isLoading } = useQuery({
    queryKey: ['bifurcations', 'history', branchId],
    queryFn: async () => {
      if (!branchId) return { bifurcations: [], pagination: { total: 0 } };
      const response = await bifurcationsApi.getAll({
        branchId,
      });
      return response;
    },
    enabled: !!branchId,
  });

  // Load daily summary when wizard opens
  useEffect(() => {
    if (isWizardOpen && branchId && currentStep === 1) {
      loadDailySummary();
    }
  }, [isWizardOpen, branchId]);

  const loadDailySummary = async () => {
    if (!branchId) {
      toast({
        title: 'Error',
        description: 'Branch not found. Please log in again.',
        variant: 'destructive',
      });
      return;
    }

    setLoadingSummary(true);
    setSummaryError(null);

    try {
      const summary = await bifurcationsApi.getSummary({
        date: formData.date,
        branchId,
      });

      // Store meter readings and POS data separately
      setMeterData(summary.meterReadings);
      setPosData(summary.pos);
      setLagData(summary.lag);

      // Auto-populate form with data from METER READINGS (source of truth)
      const useMeter = summary.meterReadings !== null;
      setFormData(prev => ({
        ...prev,
        branchId,
        pmgTotalLiters: useMeter && summary.meterReadings ? summary.meterReadings.pmgTotalLiters : summary.pos.pmgTotalLiters,
        pmgTotalAmount: useMeter && summary.meterReadings ? summary.meterReadings.pmgTotalAmount : summary.pos.pmgTotalAmount,
        hsdTotalLiters: useMeter && summary.meterReadings ? summary.meterReadings.hsdTotalLiters : summary.pos.hsdTotalLiters,
        hsdTotalAmount: useMeter && summary.meterReadings ? summary.meterReadings.hsdTotalAmount : summary.pos.hsdTotalAmount,
        cashAmount: summary.pos.cashAmount,
        creditAmount: summary.pos.creditAmount,
        cardAmount: summary.pos.cardAmount,
        psoCardAmount: summary.pos.psoCardAmount,
        expectedTotal: summary.expectedTotal,
      }));

      toast({
        title: 'Summary Loaded',
        description: useMeter && summary.meterReadings
          ? `Loaded meter readings: ${summary.meterReadings.pmgTotalLiters.toFixed(0)}L PMG + ${summary.meterReadings.hsdTotalLiters.toFixed(0)}L HSD`
          : `Loaded ${summary.pos.salesCount} POS sales for ${formatDate(summary.date)}`,
      });
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || 'Failed to load sales summary';
      setSummaryError(errorMsg);
      toast({
        title: 'Error',
        description: errorMsg,
        variant: 'destructive',
      });
    } finally {
      setLoadingSummary(false);
    }
  };

  const createBifurcation = useMutation({
    mutationFn: async (data: BifurcationFormData) => {
      const response = await bifurcationsApi.create({
        branchId: data.branchId,
        date: new Date(data.date).toISOString(),
        pmgTotalLiters: data.pmgTotalLiters,
        pmgTotalAmount: data.pmgTotalAmount,
        hsdTotalLiters: data.hsdTotalLiters,
        hsdTotalAmount: data.hsdTotalAmount,
        cashAmount: data.cashAmount,
        creditAmount: data.creditAmount,
        cardAmount: data.cardAmount,
        psoCardAmount: data.psoCardAmount,
        expectedTotal: data.expectedTotal,
        actualTotal: data.actualTotal,
        varianceNotes: data.varianceNotes || undefined,
      });
      return response;
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
      branchId: user?.branch_id || '',
      date: new Date().toISOString().split('T')[0],
      pmgTotalLiters: 0,
      pmgTotalAmount: 0,
      hsdTotalLiters: 0,
      hsdTotalAmount: 0,
      cashAmount: 0,
      creditAmount: 0,
      cardAmount: 0,
      psoCardAmount: 0,
      expectedTotal: 0,
      actualTotal: 0,
      varianceNotes: '',
      creditVerified: false,
      cardVerified: false,
    });
    setCurrentStep(1);
    setSummaryError(null);
  };

  const handleNext = () => {
    // Validation before moving to next step
    if (currentStep === 2 && !formData.creditVerified) {
      toast({
        title: 'Verification Required',
        description: 'Please verify credit sales before proceeding',
        variant: 'destructive',
      });
      return;
    }

    if (currentStep === 3 && !formData.cardVerified) {
      toast({
        title: 'Verification Required',
        description: 'Please verify card sales before proceeding',
        variant: 'destructive',
      });
      return;
    }

    if (currentStep === 4) {
      // Validate variance notes if variance is significant
      const variance = formData.actualTotal - formData.expectedTotal;
      if (Math.abs(variance) > 5000 && !formData.varianceNotes.trim()) {
        toast({
          title: 'Variance Notes Required',
          description: 'Please explain the variance greater than 5000 PKR',
          variant: 'destructive',
        });
        return;
      }
    }

    if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = () => {
    // Final validation
    if (!formData.branchId) {
      toast({
        title: 'Error',
        description: 'Branch ID is missing',
        variant: 'destructive',
      });
      return;
    }

    if (formData.actualTotal === 0) {
      toast({
        title: 'Error',
        description: 'Please enter the actual total cash counted',
        variant: 'destructive',
      });
      return;
    }

    createBifurcation.mutate(formData);
  };

  const handleDateChange = (newDate: string) => {
    setFormData(prev => ({ ...prev, date: newDate }));
    // Don't auto-reload on date change, user must click "Load Summary" button
  };

  const variance = formData.actualTotal - formData.expectedTotal;
  const varianceColor = variance === 0 ? 'text-green-600' : variance < 0 ? 'text-red-600' : 'text-yellow-600';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bifurcation</h1>
          <p className="text-muted-foreground">End-of-day sales reconciliation and cash variance tracking</p>
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
              <CardTitle>Bifurcation History</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-16" />
                  ))}
                </div>
              ) : !bifurcationsData?.bifurcations || bifurcationsData.bifurcations.length === 0 ? (
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
                      <TableHead>Expected Total</TableHead>
                      <TableHead>Actual Total</TableHead>
                      <TableHead>Variance</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bifurcationsData.bifurcations.map((record: any) => {
                      const recordVariance = (record.actualTotal || 0) - (record.expectedTotal || 0);
                      return (
                        <TableRow key={record.id}>
                          <TableCell>{formatDate(record.date)}</TableCell>
                          <TableCell>{record.pmgTotalLiters?.toFixed(2) || '0.00'}</TableCell>
                          <TableCell>{record.hsdTotalLiters?.toFixed(2) || '0.00'}</TableCell>
                          <TableCell>{formatCurrency(record.expectedTotal)}</TableCell>
                          <TableCell>{formatCurrency(record.actualTotal)}</TableCell>
                          <TableCell className={recordVariance === 0 ? 'text-green-600' : recordVariance < 0 ? 'text-red-600' : 'text-yellow-600'}>
                            {formatCurrency(recordVariance)}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              record.status === 'verified' ? 'bg-green-100 text-green-800' :
                              record.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {record.status}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
                  <h3 className="font-semibold">Load Daily Summary</h3>
                  <p className="text-sm text-muted-foreground">System auto-loads all sales posted for the day (PMG/HSD liters and amounts by payment method)</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  2
                </div>
                <div>
                  <h3 className="font-semibold">Verify Credit Sales</h3>
                  <p className="text-sm text-muted-foreground">Review all credit sale invoices against physical slips. Edit if mismatch found.</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  3
                </div>
                <div>
                  <h3 className="font-semibold">Verify Card Transactions</h3>
                  <p className="text-sm text-muted-foreground">Match PSO card and bank card amounts against terminal reports. Edit if needed.</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  4
                </div>
                <div>
                  <h3 className="font-semibold">Physical Cash Count</h3>
                  <p className="text-sm text-muted-foreground">Count actual cash in drawer. System calculates variance automatically.</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  5
                </div>
                <div>
                  <h3 className="font-semibold">Review & Submit</h3>
                  <p className="text-sm text-muted-foreground">Final review of all amounts and variance. Explain any significant discrepancies.</p>
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bifurcation Wizard - Step {currentStep} of 5</DialogTitle>
            <DialogDescription>
              {currentStep === 1 && 'Load daily sales summary from POS'}
              {currentStep === 2 && 'Verify credit sales against physical invoices'}
              {currentStep === 3 && 'Verify card transactions against terminal reports'}
              {currentStep === 4 && 'Count physical cash and calculate variance'}
              {currentStep === 5 && 'Review all amounts and submit'}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {/* Step 1: Auto-Load Summary */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="date">Bifurcation Date</Label>
                    <Input
                      id="date"
                      type="date"
                      value={formData.date}
                      onChange={(e) => handleDateChange(e.target.value)}
                      max={new Date().toISOString().split('T')[0]}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      onClick={loadDailySummary}
                      disabled={loadingSummary}
                      className="w-full"
                    >
                      {loadingSummary ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        'Load Summary'
                      )}
                    </Button>
                  </div>
                </div>

                {summaryError && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{summaryError}</AlertDescription>
                  </Alert>
                )}

                {formData.expectedTotal > 0 && (
                  <div className="space-y-4">
                    {/* Reconciliation Table: Meter Readings vs POS Posted */}
                    <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Calculator className="h-5 w-5 text-blue-600" />
                          Reconciliation: Meter Readings vs POS Posted
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[120px]">Fuel Type</TableHead>
                                <TableHead className="text-right">Meter Readings<br/><span className="text-xs text-muted-foreground">(Source of Truth)</span></TableHead>
                                <TableHead className="text-right">POS Posted<br/><span className="text-xs text-muted-foreground">(System Records)</span></TableHead>
                                <TableHead className="text-right">Lag<br/><span className="text-xs text-muted-foreground">(Missing Entries)</span></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {meterData ? (
                                <>
                                  <TableRow>
                                    <TableCell className="font-medium">PMG (Liters)</TableCell>
                                    <TableCell className="text-right font-bold text-green-700">
                                      {meterData.pmgTotalLiters.toFixed(2)} L
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {posData.pmgTotalLiters.toFixed(2)} L
                                    </TableCell>
                                    <TableCell className={`text-right font-semibold ${lagData.pmgLiters > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                      {lagData.pmgLiters > 0 && '+'}
                                      {lagData.pmgLiters.toFixed(2)} L
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell className="font-medium">PMG (Amount)</TableCell>
                                    <TableCell className="text-right font-bold text-green-700">
                                      {formatCurrency(meterData.pmgTotalAmount)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {formatCurrency(posData.pmgTotalAmount)}
                                    </TableCell>
                                    <TableCell className={`text-right font-semibold ${lagData.pmgAmount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                      {lagData.pmgAmount > 0 && '+'}
                                      {formatCurrency(lagData.pmgAmount)}
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell className="font-medium">HSD (Liters)</TableCell>
                                    <TableCell className="text-right font-bold text-green-700">
                                      {meterData.hsdTotalLiters.toFixed(2)} L
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {posData.hsdTotalLiters.toFixed(2)} L
                                    </TableCell>
                                    <TableCell className={`text-right font-semibold ${lagData.hsdLiters > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                      {lagData.hsdLiters > 0 && '+'}
                                      {lagData.hsdLiters.toFixed(2)} L
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell className="font-medium">HSD (Amount)</TableCell>
                                    <TableCell className="text-right font-bold text-green-700">
                                      {formatCurrency(meterData.hsdTotalAmount)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {formatCurrency(posData.hsdTotalAmount)}
                                    </TableCell>
                                    <TableCell className={`text-right font-semibold ${lagData.hsdAmount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                      {lagData.hsdAmount > 0 && '+'}
                                      {formatCurrency(lagData.hsdAmount)}
                                    </TableCell>
                                  </TableRow>
                                  <TableRow className="bg-blue-100 font-bold">
                                    <TableCell>TOTAL</TableCell>
                                    <TableCell className="text-right text-green-700">
                                      {formatCurrency(meterData.totalAmount)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {formatCurrency(posData.totalAmount)}
                                    </TableCell>
                                    <TableCell className={`text-right ${lagData.totalAmount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                      {lagData.totalAmount > 0 && '+'}
                                      {formatCurrency(lagData.totalAmount)}
                                    </TableCell>
                                  </TableRow>
                                </>
                              ) : (
                                <TableRow>
                                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                                    No meter readings available for this date. Using POS sales as source.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>

                        {lagData && lagData.totalAmount > 0 && (
                          <Alert variant="destructive" className="mt-4">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>
                              <strong>POS Entry Lag Detected:</strong> {formatCurrency(lagData.totalAmount)} worth of sales ({lagData.pmgLiters.toFixed(2)}L PMG + {lagData.hsdLiters.toFixed(2)}L HSD) not posted in POS.
                              Reconciliation will use meter readings as source of truth.
                            </AlertDescription>
                          </Alert>
                        )}

                        {lagData && lagData.totalAmount === 0 && (
                          <Alert className="mt-4">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <AlertDescription className="text-green-700">
                              <strong>Perfect Match!</strong> Meter readings match POS posted sales exactly. No lag detected.
                            </AlertDescription>
                          </Alert>
                        )}
                      </CardContent>
                    </Card>

                    {/* Payment Methods Breakdown */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Payment Methods (From POS)</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Credit Sales:</span>
                          <span className="font-medium">{formatCurrency(formData.creditAmount)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">PSO Card:</span>
                          <span className="font-medium">{formatCurrency(formData.psoCardAmount)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Bank Card:</span>
                          <span className="font-medium">{formatCurrency(formData.cardAmount)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Cash (POS Posted):</span>
                          <span className="font-medium">{formatCurrency(formData.cashAmount)}</span>
                        </div>
                        <div className="flex justify-between text-lg font-bold border-t pt-2 mt-2 bg-blue-50 p-2 rounded">
                          <span>Expected Cash (From Meters):</span>
                          <span className="text-blue-700">{formatCurrency(formData.expectedTotal - formData.creditAmount - formData.cardAmount - formData.psoCardAmount)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground pt-2">
                          Formula: Meter Total - Credit - Cards = Expected Cash for Walk-in Customers
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Verify Credit Sales */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <Alert>
                  <AlertDescription>
                    Review all credit sale invoices (petrol pump slips) and verify the total matches system records
                  </AlertDescription>
                </Alert>

                <Card>
                  <CardContent className="pt-6 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="creditAmount">Credit Sales Amount</Label>
                      <Input
                        id="creditAmount"
                        type="number"
                        step="0.01"
                        value={formData.creditAmount}
                        onChange={(e) =>
                          setFormData({ ...formData, creditAmount: parseFloat(e.target.value) || 0 })
                        }
                      />
                      <p className="text-sm text-muted-foreground">
                        Pre-filled from POS sales. Edit if physical invoices show different total.
                      </p>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="creditVerified"
                        checked={formData.creditVerified}
                        onCheckedChange={(checked) =>
                          setFormData({ ...formData, creditVerified: checked === true })
                        }
                      />
                      <label
                        htmlFor="creditVerified"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        I have reviewed all credit sale invoices and verified this amount
                      </label>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Step 3: Verify Card Sales */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <Alert>
                  <AlertDescription>
                    Match card terminal reports against system totals. Edit if terminal shows different amounts.
                  </AlertDescription>
                </Alert>

                <Card>
                  <CardContent className="pt-6 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="psoCardAmount">PSO Card Sales</Label>
                      <Input
                        id="psoCardAmount"
                        type="number"
                        step="0.01"
                        value={formData.psoCardAmount}
                        onChange={(e) =>
                          setFormData({ ...formData, psoCardAmount: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="cardAmount">Bank Card Sales</Label>
                      <Input
                        id="cardAmount"
                        type="number"
                        step="0.01"
                        value={formData.cardAmount}
                        onChange={(e) =>
                          setFormData({ ...formData, cardAmount: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="cardVerified"
                        checked={formData.cardVerified}
                        onCheckedChange={(checked) =>
                          setFormData({ ...formData, cardVerified: checked === true })
                        }
                      />
                      <label
                        htmlFor="cardVerified"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        I have verified card amounts against terminal reports
                      </label>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Step 4: Physical Cash Count */}
            {currentStep === 4 && (
              <div className="space-y-4">
                <Alert>
                  <AlertDescription>
                    Count all physical cash in the drawer and enter the actual amount
                  </AlertDescription>
                </Alert>

                <Card>
                  <CardContent className="pt-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-muted-foreground">Expected Cash</Label>
                        <p className="text-2xl font-bold">{formatCurrency(formData.cashAmount)}</p>
                        <p className="text-xs text-muted-foreground">From system records</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="actualTotal">Actual Cash Counted *</Label>
                        <Input
                          id="actualTotal"
                          type="number"
                          step="0.01"
                          value={formData.actualTotal || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, actualTotal: parseFloat(e.target.value) || 0 })
                          }
                          placeholder="Enter counted amount"
                          className="text-xl font-bold"
                        />
                      </div>
                    </div>

                    {formData.actualTotal > 0 && (
                      <div className={`p-4 rounded-lg border-2 ${
                        variance === 0 ? 'bg-green-50 border-green-200' :
                        variance < 0 ? 'bg-red-50 border-red-200' :
                        'bg-yellow-50 border-yellow-200'
                      }`}>
                        <div className="flex justify-between items-center">
                          <span className="font-semibold">Variance:</span>
                          <span className={`text-3xl font-bold ${varianceColor}`}>
                            {formatCurrency(variance)}
                          </span>
                        </div>
                        {variance !== 0 && (
                          <p className="text-sm mt-2 text-muted-foreground">
                            {variance < 0 ? 'Cash SHORT' : 'Cash OVER'}
                          </p>
                        )}
                      </div>
                    )}

                    {Math.abs(variance) > 5000 && (
                      <div className="space-y-2">
                        <Label htmlFor="varianceNotes">
                          Variance Explanation * <span className="text-red-600">(Required for variance &gt; 5000)</span>
                        </Label>
                        <Textarea
                          id="varianceNotes"
                          value={formData.varianceNotes}
                          onChange={(e) => setFormData({ ...formData, varianceNotes: e.target.value })}
                          placeholder="Explain the reason for this variance..."
                          rows={4}
                          className={!formData.varianceNotes.trim() ? 'border-red-500' : ''}
                        />
                      </div>
                    )}

                    {Math.abs(variance) <= 5000 && variance !== 0 && (
                      <div className="space-y-2">
                        <Label htmlFor="varianceNotes">Variance Notes (Optional)</Label>
                        <Textarea
                          id="varianceNotes"
                          value={formData.varianceNotes}
                          onChange={(e) => setFormData({ ...formData, varianceNotes: e.target.value })}
                          placeholder="Optional notes about this variance..."
                          rows={3}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Step 5: Review & Submit */}
            {currentStep === 5 && (
              <div className="space-y-4">
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    Final review before submitting bifurcation record
                  </AlertDescription>
                </Alert>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Bifurcation Summary for {formatDate(formData.date)}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 pb-4 border-b">
                      <div>
                        <p className="text-sm text-muted-foreground">PMG Total</p>
                        <p className="text-lg font-semibold">{formData.pmgTotalLiters.toFixed(2)} L</p>
                        <p className="text-sm">{formatCurrency(formData.pmgTotalAmount)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">HSD Total</p>
                        <p className="text-lg font-semibold">{formData.hsdTotalLiters.toFixed(2)} L</p>
                        <p className="text-sm">{formatCurrency(formData.hsdTotalAmount)}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cash Sales:</span>
                        <span className="font-medium">{formatCurrency(formData.cashAmount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Credit Sales:</span>
                        <span className="font-medium">{formatCurrency(formData.creditAmount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Bank Card:</span>
                        <span className="font-medium">{formatCurrency(formData.cardAmount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">PSO Card:</span>
                        <span className="font-medium">{formatCurrency(formData.psoCardAmount)}</span>
                      </div>
                    </div>

                    <div className="border-t pt-4 space-y-2">
                      <div className="flex justify-between text-lg font-semibold">
                        <span>Expected Total:</span>
                        <span>{formatCurrency(formData.expectedTotal)}</span>
                      </div>
                      <div className="flex justify-between text-lg font-semibold">
                        <span>Actual Cash Counted:</span>
                        <span>{formatCurrency(formData.actualTotal)}</span>
                      </div>
                      <div className={`flex justify-between text-xl font-bold border-t pt-2 ${varianceColor}`}>
                        <span>Variance:</span>
                        <span>{formatCurrency(variance)}</span>
                      </div>
                    </div>

                    {formData.varianceNotes && (
                      <div className="bg-muted p-4 rounded-lg">
                        <p className="text-sm font-medium mb-1">Variance Notes:</p>
                        <p className="text-sm text-muted-foreground">{formData.varianceNotes}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>

          <DialogFooter className="flex justify-between">
            <div>
              {currentStep > 1 && (
                <Button variant="outline" onClick={handleBack} disabled={createBifurcation.isPending}>
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
                disabled={createBifurcation.isPending}
              >
                Cancel
              </Button>
              {currentStep < 5 ? (
                <Button onClick={handleNext} disabled={formData.expectedTotal === 0 && currentStep === 1}>
                  Next
                </Button>
              ) : (
                <Button onClick={handleSubmit} disabled={createBifurcation.isPending}>
                  {createBifurcation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Submit Bifurcation'
                  )}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
