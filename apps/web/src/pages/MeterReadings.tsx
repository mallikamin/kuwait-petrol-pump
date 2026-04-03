import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Gauge, AlertCircle, Filter, Camera, Upload, Edit2, CheckCircle, Loader2, X, Eye, Clock, User } from 'lucide-react';
import { meterReadingsApi, branchesApi, shiftsApi } from '@/api';
import { apiClient } from '@/api/client';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuthStore } from '@/store/auth';

type Step = 'choose' | 'camera' | 'processing' | 'review' | 'form';

export function MeterReadings() {
  const [page, setPage] = useState(1);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [filterDate, setFilterDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showFilters, setShowFilters] = useState(false);

  // New OCR flow state
  const [step, setStep] = useState<Step>('choose');
  const [selectedNozzleId, setSelectedNozzleId] = useState('');
  const [readingType, setReadingType] = useState<'opening' | 'closing'>('opening');
  const [meterValue, setMeterValue] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [serverImageUrl, setServerImageUrl] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<{ extractedValue: number | null; confidence: number; rawText: string; error?: string } | null>(null);
  const [_processing, setProcessing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isOcrReading, setIsOcrReading] = useState(false);
  const [ocrConfidence, setOcrConfidence] = useState<number | undefined>(undefined);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const branchId = user?.branch_id || (user as any)?.branch?.id;

  // Fetch meter readings
  const { data, isLoading } = useQuery({
    queryKey: ['meterReadings', page],
    queryFn: () => meterReadingsApi.getAll({ page, size: 20 }),
  });

  // Fetch nozzles
  const { data: nozzlesData } = useQuery({
    queryKey: ['branches', 'dispensing-units'],
    queryFn: async () => {
      const branches = await branchesApi.getAll();
      if (branches.items.length > 0 && (branches.items[0] as any).dispensingUnits) {
        return (branches.items[0] as any).dispensingUnits.flatMap((unit: any) => unit.nozzles || []);
      }
      return [];
    },
  });

  // Filter available nozzles based on existing readings for today
  const availableNozzles = (nozzlesData || []).filter((nozzle: any) => {
    // Find readings for this nozzle in today's data
    const nozzleReadings = (data?.items || []).filter((r: any) => r.nozzle_id === nozzle.id);

    // Check if readings exist for the selected reading type
    if (readingType === 'opening') {
      // Don't show if opening already exists
      return !nozzleReadings.some((r: any) => r.reading_type === 'opening');
    } else {
      // For closing: don't show if closing already exists
      return !nozzleReadings.some((r: any) => r.reading_type === 'closing');
    }
  });

  // Fetch current shift
  const { data: currentShift } = useQuery({
    queryKey: ['shifts', 'current', branchId],
    queryFn: () => branchId ? shiftsApi.getCurrent(branchId) : Promise.resolve(null),
    enabled: !!branchId,
  });

  // Latest reading for selected nozzle
  const { data: latestReading } = useQuery({
    queryKey: ['meterReadings', 'latest', selectedNozzleId],
    queryFn: () => meterReadingsApi.getLatestForNozzle(selectedNozzleId),
    enabled: !!selectedNozzleId,
  });

  // Auto-populate opening from last closing
  useEffect(() => {
    if (step === 'form' && !isOcrReading && readingType === 'opening' && latestReading && latestReading.reading_type === 'closing') {
      setMeterValue(latestReading.reading_value.toString());
    }
  }, [latestReading, readingType, step, isOcrReading]);

  // OCR quota
  const { data: ocrQuota } = useQuery({
    queryKey: ['ocr-quota'],
    queryFn: async () => {
      const res = await apiClient.get<{ used: number; remaining: number; total: number; resetAt: string }>('/api/meter-readings/ocr/quota');
      return res.data;
    },
  });

  // Create meter reading mutation
  const createMutation = useMutation({
    mutationFn: meterReadingsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meterReadings'] });
      queryClient.invalidateQueries({ queryKey: ['ocr-quota'] });
      toast.success('Meter reading recorded successfully');
      closeDialog();
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to record meter reading';
      console.error('Meter reading submission error:', errorMsg, error?.response?.data);
      toast.error(errorMsg, { duration: 5000 });
    },
  });

  const resetForm = () => {
    setStep('choose');
    setSelectedNozzleId('');
    setReadingType('opening');
    setMeterValue('');
    setImageDataUrl(null);
    setServerImageUrl(null);
    setOcrResult(null);
    setProcessing(false);
    setCaptureError(null);
    setIsOcrReading(false);
    setOcrConfidence(undefined);
  };

  const closeDialog = () => {
    stopCamera();
    resetForm();
    setIsDialogOpen(false);
  };

  // Camera
  const startCamera = async () => {
    try {
      setStep('camera');
      setCaptureError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      setCaptureError(err.message || 'Failed to access camera');
      setStep('choose');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => {
    return () => { stopCamera(); };
  }, []);

  // Compress image
  const compressImage = (dataUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not available')); return; }
        const maxWidth = 1024;
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let quality = 0.8;
        let compressed = canvas.toDataURL('image/jpeg', quality);
        while (compressed.length > 300000 && quality > 0.3) {
          quality -= 0.1;
          compressed = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(compressed);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    });
  };

  // Capture photo from camera
  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    stopCamera();
    setImageDataUrl(dataUrl);
    await processOCR(dataUrl);
  };

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setImageDataUrl(dataUrl);
      await processOCR(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  // Process OCR
  const processOCR = async (dataUrl: string) => {
    setStep('processing');
    setProcessing(true);
    setCaptureError(null);

    try {
      const compressed = await compressImage(dataUrl);

      // Upload image
      const uploadRes = await apiClient.post<{ success: boolean; imageUrl: string; size: number }>(
        '/api/meter-readings/upload',
        { imageBase64: compressed }
      );
      setServerImageUrl(uploadRes.data.imageUrl);

      // Call OCR
      const ocrRes = await apiClient.post<{ extractedValue: number | null; confidence: number; rawText: string; error?: string; quota?: any }>(
        '/api/meter-readings/ocr',
        { imageBase64: compressed }
      );

      setOcrResult(ocrRes.data);

      if (ocrRes.data.extractedValue && !ocrRes.data.error) {
        setMeterValue(ocrRes.data.extractedValue.toString());
        setIsOcrReading(true);
        setOcrConfidence(ocrRes.data.confidence);
      } else {
        setCaptureError(ocrRes.data.error || 'Could not extract reading');
      }

      setStep('review');
    } catch (err: any) {
      setCaptureError(err.response?.data?.error || 'Failed to process image');
      setStep('review');
    } finally {
      setProcessing(false);
    }
  };

  // Approve OCR result → go to form
  const approveReading = () => {
    setStep('form');
  };

  // Revise → allow manual edit then go to form
  const reviseReading = () => {
    setIsOcrReading(false);
    setStep('form');
  };

  // Submit
  const handleSubmit = () => {
    if (!selectedNozzleId || !meterValue || !currentShift) {
      toast.error('Please fill all required fields');
      return;
    }

    const reading = parseFloat(meterValue);
    if (isNaN(reading) || reading < 1000000) {
      toast.error('Meter reading must be at least 7 digits (1,000,000 or higher)');
      return;
    }

    createMutation.mutate({
      nozzleId: selectedNozzleId,
      shiftInstanceId: currentShift.id,
      readingType,
      meterValue: parseFloat(meterValue),
      imageUrl: serverImageUrl || undefined,
    });
  };

  // Group readings by nozzle + shift
  const groupedReadings = (data?.items || []).reduce((acc: any, reading: any) => {
    const key = `${reading.nozzle_id}_${reading.shift_id || 'unknown'}`;
    if (!acc[key]) {
      acc[key] = { nozzle: reading.nozzle, nozzle_id: reading.nozzle_id, shift_id: reading.shift_id, opening: null, closing: null, date: reading.created_at };
    }
    if (reading.reading_type === 'opening') acc[key].opening = reading;
    else acc[key].closing = reading;
    return acc;
  }, {});

  const consolidatedReadings = Object.values(groupedReadings);

  // Render dialog content by step
  const renderDialogContent = () => {
    // Step 1: Choose capture method
    if (step === 'choose') {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Record Meter Reading</DialogTitle>
            <DialogDescription>
              Take a photo for automatic OCR reading or enter manually.
              {ocrQuota && (
                <span className="block mt-1 text-xs">
                  OCR quota: {ocrQuota.remaining}/{ocrQuota.total} remaining today
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-3 py-4">
            <Button
              variant="outline"
              className="h-24 flex flex-col gap-2"
              onClick={startCamera}
              disabled={ocrQuota?.remaining === 0}
            >
              <Camera className="h-8 w-8" />
              <span className="text-xs">Camera</span>
            </Button>

            <Button
              variant="outline"
              className="h-24 flex flex-col gap-2"
              onClick={() => fileInputRef.current?.click()}
              disabled={ocrQuota?.remaining === 0}
            >
              <Upload className="h-8 w-8" />
              <span className="text-xs">Upload Photo</span>
            </Button>

            <Button
              variant="outline"
              className="h-24 flex flex-col gap-2"
              onClick={() => { setIsOcrReading(false); setStep('form'); }}
            >
              <Edit2 className="h-8 w-8" />
              <span className="text-xs">Manual</span>
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileUpload}
          />

          {captureError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{captureError}</AlertDescription>
            </Alert>
          )}
        </>
      );
    }

    // Step 2: Camera live view
    if (step === 'camera') {
      return (
        <>
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              Capture Meter Photo
              <Button variant="ghost" size="sm" onClick={() => { stopCamera(); setStep('choose'); }}>
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>

          <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <Button size="lg" className="w-full mt-3" onClick={capturePhoto}>
            <Camera className="mr-2 h-5 w-5" />
            Capture
          </Button>
        </>
      );
    }

    // Step 3: Processing OCR
    if (step === 'processing') {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Processing Image</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col items-center py-8 gap-4">
            {imageDataUrl && (
              <img src={imageDataUrl} alt="Captured" className="w-full max-h-48 object-contain rounded-lg" />
            )}
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Extracting meter reading with AI...</p>
          </div>
        </>
      );
    }

    // Step 4: Review OCR result - approve or revise
    if (step === 'review') {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Review Extracted Reading</DialogTitle>
            <DialogDescription>Verify the OCR result before proceeding</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Image preview */}
            {imageDataUrl && (
              <div className="relative w-full">
                <img src={imageDataUrl} alt="Meter" className="w-full max-h-48 object-contain rounded-lg border" />
              </div>
            )}

            {/* OCR Result */}
            {ocrResult?.extractedValue && !captureError ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 bg-primary/10 rounded-lg">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Extracted Reading</p>
                    <p className="text-3xl font-bold text-primary">{ocrResult.extractedValue}</p>
                  </div>
                  <Badge variant={ocrResult.confidence >= 0.8 ? 'default' : 'secondary'}>
                    {Math.round(ocrResult.confidence * 100)}% confidence
                  </Badge>
                </div>

                {ocrResult.confidence < 0.8 && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>Low confidence - please verify this reading carefully</AlertDescription>
                  </Alert>
                )}

                {/* Editable value */}
                <div className="space-y-2">
                  <Label>Reading Value (edit if needed)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={meterValue}
                    onChange={(e) => setMeterValue(e.target.value)}
                    className="text-xl font-semibold"
                  />
                </div>

                <div className="flex gap-2">
                  <Button className="flex-1" onClick={approveReading}>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Approve
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => { setStep('choose'); setImageDataUrl(null); setOcrResult(null); setMeterValue(''); }}>
                    Retake
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{captureError || 'Could not extract reading from image'}</AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label>Enter reading manually</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Enter meter reading"
                    value={meterValue}
                    onChange={(e) => setMeterValue(e.target.value)}
                    className="text-xl font-semibold"
                  />
                </div>

                <div className="flex gap-2">
                  <Button className="flex-1" onClick={reviseReading} disabled={!meterValue}>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Use Manual Value
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => { setStep('choose'); setImageDataUrl(null); setOcrResult(null); setCaptureError(null); }}>
                    Retake
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      );
    }

    // Step 5: Entry form - select nozzle, shift, type
    if (step === 'form') {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Submit Meter Reading</DialogTitle>
            <DialogDescription>
              {isOcrReading ? `OCR reading: ${meterValue} (${Math.round((ocrConfidence || 0) * 100)}% confidence)` : 'Manual entry'}
              {serverImageUrl && ' - Photo attached'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Reading value (read-only summary or editable) */}
            <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg">
              <div>
                <p className="text-xs text-muted-foreground">Reading Value</p>
                <p className="text-2xl font-bold">{parseFloat(meterValue || '0').toFixed(2)}</p>
              </div>
              {isOcrReading && (
                <Badge variant="default">
                  <Camera className="mr-1 h-3 w-3" /> OCR
                </Badge>
              )}
              {!isOcrReading && serverImageUrl && (
                <Badge variant="secondary">
                  <Eye className="mr-1 h-3 w-3" /> Photo + Manual
                </Badge>
              )}
              {!isOcrReading && !serverImageUrl && (
                <Badge variant="outline">
                  <Edit2 className="mr-1 h-3 w-3" /> Manual
                </Badge>
              )}
            </div>

            {/* Editable value */}
            <div className="grid gap-2">
              <Label>Meter Reading *</Label>
              <Input
                type="number"
                step="0.01"
                value={meterValue}
                onChange={(e) => setMeterValue(e.target.value)}
                className="text-lg"
              />
            </div>

            {/* Shift */}
            <div className="grid gap-2">
              <Label>Active Shift *</Label>
              {!currentShift ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>No active shift. Please open a shift first.</AlertDescription>
                </Alert>
              ) : (
                <div className="p-3 rounded-lg border bg-muted/50">
                  <p className="text-sm font-medium">
                    {(currentShift as any).shift?.name || `Shift #${(currentShift as any).shift?.shiftNumber}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Opened by {(currentShift as any).openedByUser?.fullName || (currentShift as any).openedByUser?.username || 'Unknown'}
                  </p>
                </div>
              )}
            </div>

            {/* Nozzle */}
            <div className="grid gap-2">
              <Label>Nozzle *</Label>
              <Select value={selectedNozzleId} onValueChange={setSelectedNozzleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select nozzle" />
                </SelectTrigger>
                <SelectContent>
                  {availableNozzles.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground text-center">
                      All nozzles have {readingType} readings for today
                    </div>
                  ) : (
                    availableNozzles.map((nozzle: any) => (
                      <SelectItem key={nozzle.id} value={nozzle.id}>
                        {nozzle.name || `Nozzle ${nozzle.nozzleNumber}`} - {nozzle.fuelType?.name || 'Unknown'}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Reading Type */}
            <div className="grid gap-2">
              <Label>Reading Type *</Label>
              <Select value={readingType} onValueChange={(v: 'opening' | 'closing') => setReadingType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opening">Opening</SelectItem>
                  <SelectItem value="closing">Closing</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Optional Photo Attachment */}
            {!isOcrReading && (
              <div className="grid gap-2">
                <Label>Photo Attachment (Optional)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          const dataUrl = event.target?.result as string;
                          compressImage(dataUrl).then((compressed) => {
                            setImageDataUrl(compressed);
                            uploadImageToServer(compressed);
                          }).catch(() => {
                            toast.error('Failed to compress image');
                          });
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                    className="flex-1"
                  />
                  {imageDataUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setImageDataUrl(null);
                        setServerImageUrl(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {imageDataUrl && (
                  <div className="relative w-32 h-32 border rounded-lg overflow-hidden">
                    <img src={imageDataUrl} alt="Attachment" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
            )}

            {/* Audit info */}
            <div className="p-3 rounded-lg border bg-muted/30 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase">Audit Trail</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                <span>Entered by: {user?.full_name || user?.username || (user as any)?.fullName || 'Current User'}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>Timestamp: {format(new Date(), 'dd MMM yyyy HH:mm:ss')}</span>
              </div>
              {isOcrReading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Camera className="h-3 w-3" />
                  <span>Method: OCR ({Math.round((ocrConfidence || 0) * 100)}% confidence)</span>
                </div>
              )}
              {!isOcrReading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Edit2 className="h-3 w-3" />
                  <span>Method: Manual entry</span>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || !selectedNozzleId || !meterValue || !currentShift}
            >
              {createMutation.isPending ? 'Submitting...' : 'Submit Reading'}
            </Button>
          </DialogFooter>
        </>
      );
    }

    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Meter Readings</h1>
          <p className="text-muted-foreground">Track fuel meter readings with OCR or manual entry</p>
        </div>
        <Button onClick={() => setIsDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Record Reading
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Filters</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowFilters(!showFilters)}>
              <Filter className="mr-2 h-4 w-4" />
              {showFilters ? 'Hide' : 'Show'} Filters
            </Button>
          </div>
        </CardHeader>
        {showFilters && (
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="filter-date">Date</Label>
                <Input id="filter-date" type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
              </div>
              <div>
                <Label>Quick Filters</Label>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setFilterDate(format(new Date(), 'yyyy-MM-dd'))}>
                    Today
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setFilterDate(format(subDays(new Date(), 1), 'yyyy-MM-dd'))}>
                    Yesterday
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Readings Table */}
      <Card>
        <CardHeader>
          <CardTitle>Meter Readings - {filterDate ? format(new Date(filterDate), 'MMM dd, yyyy') : 'All Dates'}</CardTitle>
          <p className="text-sm text-muted-foreground">Opening and closing readings grouped by nozzle</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : consolidatedReadings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Gauge className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p>No meter readings found</p>
              <p className="text-sm">Record your first meter reading to get started</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nozzle</TableHead>
                    <TableHead>Fuel Type</TableHead>
                    <TableHead>Opening</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Closing</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Sales (L)</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consolidatedReadings.map((row: any, idx) => {
                    const sales = row.opening && row.closing
                      ? row.closing.reading_value - row.opening.reading_value
                      : null;
                    const isMismatch = sales !== null && sales < 0;

                    return (
                      <TableRow key={idx} className={isMismatch ? 'bg-destructive/10' : ''}>
                        <TableCell className="font-medium">
                          <div className="flex items-center">
                            <Gauge className="mr-2 h-4 w-4 text-muted-foreground" />
                            {row.nozzle?.name || row.nozzle?.nozzle_number || '-'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{row.nozzle?.fuel_type?.name || '-'}</Badge>
                        </TableCell>
                        <TableCell className="font-mono">
                          {row.opening ? (
                            <span className="text-green-600 font-semibold">{row.opening.reading_value} L</span>
                          ) : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.opening?.created_at ? format(new Date(row.opening.created_at), 'HH:mm') : '-'}
                        </TableCell>
                        <TableCell className="font-mono">
                          {row.closing ? (
                            <span className="text-red-600 font-semibold">{row.closing.reading_value} L</span>
                          ) : row.opening ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto p-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                              onClick={() => {
                                setSelectedNozzleId(row.nozzle_id);
                                setReadingType('closing');
                                setStep('form');
                                setIsDialogOpen(true);
                              }}
                              title="Click to add closing reading"
                            >
                              + Add Closing
                            </Button>
                          ) : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.closing?.created_at ? format(new Date(row.closing.created_at), 'HH:mm') : '-'}
                        </TableCell>
                        <TableCell className="font-mono">
                          {sales !== null ? (
                            <span className={sales < 0 ? 'text-destructive font-semibold' : ''}>{sales.toFixed(2)} L</span>
                          ) : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell>
                          {(row.opening?.image_url || row.closing?.image_url) ? (
                            <Badge variant="secondary" className="text-xs">
                              <Camera className="mr-1 h-3 w-3" /> OCR
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              <Edit2 className="mr-1 h-3 w-3" /> Manual
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {!row.opening && !row.closing ? (
                            <Badge variant="secondary">No Data</Badge>
                          ) : !row.opening ? (
                            <Badge variant="destructive">Missing Opening</Badge>
                          ) : !row.closing ? (
                            <Badge variant="default">Open</Badge>
                          ) : isMismatch ? (
                            <Badge variant="destructive">Error</Badge>
                          ) : (
                            <Badge variant="default">Complete</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {data && data.pages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">Page {data.page} of {data.pages} ({data.total} total)</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                      Previous
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page === data.pages}>
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Multi-step Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); else setIsDialogOpen(true); }}>
        <DialogContent className="sm:max-w-[550px]">
          {renderDialogContent()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
