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
import { Plus, Gauge, AlertCircle, Filter, Camera, Upload, Edit2, CheckCircle, Loader2, X, Eye, Clock, User, Calendar, Pencil } from 'lucide-react';
import { meterReadingsApi, branchesApi, shiftsApi } from '@/api';
import { apiClient } from '@/api/client';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuthStore } from '@/store/auth';

type Step = 'choose' | 'camera' | 'processing' | 'review' | 'form';

// Parse Prisma TIME field (comes as ISO datetime like "1970-01-01T08:00:00.000Z")
function formatShiftTime(timeValue: unknown): string {
  if (!timeValue) return '';
  try {
    const str = String(timeValue);
    // Handle ISO datetime string
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
    }
    // Handle plain time string (HH:MM:SS or HH:MM)
    const match = str.match(/^(\d{2}):(\d{2})/);
    if (match) return `${match[1]}:${match[2]}`;
    return '';
  } catch {
    return '';
  }
}

// Format nozzle display name
function formatNozzleName(nozzle: any): string {
  if (!nozzle) return '-';
  const name = nozzle.name || nozzle.nozzle_number;
  const unitName = nozzle.dispensing_unit?.name || (nozzle.dispensing_unit?.unit_number ? `Unit ${nozzle.dispensing_unit.unit_number}` : '');
  const fuelName = nozzle.fuel_type?.name || '';
  if (unitName && fuelName) return `${unitName} N${nozzle.nozzle_number} - ${fuelName}`;
  if (name && fuelName) return `Nozzle ${name} - ${fuelName}`;
  if (fuelName) return `Nozzle ${nozzle.nozzle_number} - ${fuelName}`;
  return nozzle.name || `Nozzle ${nozzle.nozzle_number}`;
}

export function MeterReadings() {
  const [page, setPage] = useState(1);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [filterDate, setFilterDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showFilters, setShowFilters] = useState(false);

  // OCR flow state
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

  // Closing entry lock state (Tasks 5 & 6)
  const [lockedNozzleId, setLockedNozzleId] = useState<string | null>(null);
  const [lockedReadingType, setLockedReadingType] = useState<boolean>(false);
  const [editingReadingId, setEditingReadingId] = useState<string | null>(null);

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
    const nozzleReadings = (data?.items || []).filter((r: any) => r.nozzle_id === nozzle.id);
    if (readingType === 'opening') {
      return !nozzleReadings.some((r: any) => r.reading_type === 'opening');
    } else {
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

  // Edit closing mutation (uses verify endpoint)
  const editClosingMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: number }) =>
      meterReadingsApi.verify(id, { verifiedValue: value, isManualOverride: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meterReadings'] });
      toast.success('Closing reading updated successfully');
      closeDialog();
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to update closing reading';
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
    setLockedNozzleId(null);
    setLockedReadingType(false);
    setEditingReadingId(null);
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

      const uploadRes = await apiClient.post<{ success: boolean; imageUrl: string; size: number }>(
        '/api/meter-readings/upload',
        { imageBase64: compressed }
      );
      setServerImageUrl(uploadRes.data.imageUrl);

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

  const approveReading = () => {
    setStep('form');
  };

  const reviseReading = () => {
    setIsOcrReading(false);
    setStep('form');
  };

  // Submit (create or edit)
  const handleSubmit = () => {
    if (!selectedNozzleId || !meterValue) {
      toast.error('Please fill all required fields');
      return;
    }

    const reading = parseFloat(meterValue);
    if (isNaN(reading) || reading < 1000000) {
      toast.error('Meter reading must be at least 7 digits (1,000,000 or higher)');
      return;
    }

    // Edit existing closing
    if (editingReadingId) {
      editClosingMutation.mutate({ id: editingReadingId, value: reading });
      return;
    }

    if (!currentShift) {
      toast.error('No active shift');
      return;
    }

    createMutation.mutate({
      nozzleId: selectedNozzleId,
      shiftInstanceId: currentShift.id,
      readingType,
      meterValue: reading,
      imageUrl: serverImageUrl || undefined,
    });
  };

  // Open "Add Closing" with locked context (Task 5)
  const openAddClosing = (nozzleId: string) => {
    setSelectedNozzleId(nozzleId);
    setReadingType('closing');
    setLockedNozzleId(nozzleId);
    setLockedReadingType(true);
    setEditingReadingId(null);
    setStep('choose');
    setIsDialogOpen(true);
  };

  // Open "Edit Closing" with existing value (Task 6)
  const openEditClosing = (readingId: string, nozzleId: string, currentValue: number) => {
    setSelectedNozzleId(nozzleId);
    setReadingType('closing');
    setLockedNozzleId(nozzleId);
    setLockedReadingType(true);
    setEditingReadingId(readingId);
    setMeterValue(currentValue.toString());
    setStep('form');
    setIsDialogOpen(true);
  };

  // Group readings by shift instance, then by nozzle within each shift (Task 3)
  const groupReadingsByShift = () => {
    const items = data?.items || [];
    // First, group by nozzle+shift for opening/closing pairing
    const paired: Record<string, any> = {};
    for (const reading of items) {
      const key = `${reading.nozzle_id}_${reading.shift_id || 'unknown'}`;
      if (!paired[key]) {
        paired[key] = {
          nozzle: reading.nozzle,
          nozzle_id: reading.nozzle_id,
          shift_id: reading.shift_id,
          shift_instance: (reading as any).shift_instance || null,
          opening: null,
          closing: null,
          date: reading.created_at,
        };
      }
      if (reading.reading_type === 'opening') paired[key].opening = reading;
      else paired[key].closing = reading;
    }

    // Now group paired readings by shift_id
    const shiftGroups: Record<string, { shiftInfo: any; rows: any[] }> = {};
    for (const row of Object.values(paired)) {
      const shiftKey = row.shift_id || 'unknown';
      if (!shiftGroups[shiftKey]) {
        shiftGroups[shiftKey] = {
          shiftInfo: row.shift_instance,
          rows: [],
        };
      }
      shiftGroups[shiftKey].rows.push(row);
    }

    // Sort shift groups by opened_at (most recent first)
    return Object.entries(shiftGroups).sort((a, b) => {
      const aTime = a[1].shiftInfo?.opened_at || '';
      const bTime = b[1].shiftInfo?.opened_at || '';
      return bTime.localeCompare(aTime);
    });
  };

  const shiftGroups = groupReadingsByShift();
  const hasReadings = shiftGroups.some(([, g]) => g.rows.length > 0);

  // Render dialog content by step
  const renderDialogContent = () => {
    // Step 1: Choose capture method
    if (step === 'choose') {
      return (
        <>
          <DialogHeader>
            <DialogTitle>{editingReadingId ? 'Edit Closing Reading' : 'Record Meter Reading'}</DialogTitle>
            <DialogDescription>
              {lockedReadingType ? 'Add closing reading for this nozzle.' : 'Take a photo for automatic OCR reading or enter manually.'}
              {ocrQuota && !editingReadingId && (
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

    // Step 4: Review OCR result
    if (step === 'review') {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Review Extracted Reading</DialogTitle>
            <DialogDescription>Verify the OCR result before proceeding</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {imageDataUrl && (
              <div className="relative w-full">
                <img src={imageDataUrl} alt="Meter" className="w-full max-h-48 object-contain rounded-lg border" />
              </div>
            )}

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

    // Step 5: Entry form
    if (step === 'form') {
      const isEditing = !!editingReadingId;
      const isLocked = !!lockedNozzleId;
      const isPending = createMutation.isPending || editClosingMutation.isPending;

      // Find nozzle name for locked display
      const lockedNozzle = isLocked
        ? (nozzlesData || []).find((n: any) => n.id === lockedNozzleId)
        : null;

      return (
        <>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Closing Reading' : 'Submit Meter Reading'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the closing meter value.'
                : isOcrReading
                  ? `OCR reading: ${meterValue} (${Math.round((ocrConfidence || 0) * 100)}% confidence)`
                  : 'Manual entry'}
              {serverImageUrl && ' - Photo attached'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Reading value summary */}
            <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg">
              <div>
                <p className="text-xs text-muted-foreground">{isEditing ? 'Updated Value' : 'Reading Value'}</p>
                <p className="text-2xl font-bold">{parseFloat(meterValue || '0').toFixed(2)}</p>
              </div>
              {isEditing && (
                <Badge variant="warning">
                  <Pencil className="mr-1 h-3 w-3" /> Editing
                </Badge>
              )}
              {!isEditing && isOcrReading && (
                <Badge variant="default">
                  <Camera className="mr-1 h-3 w-3" /> OCR
                </Badge>
              )}
              {!isEditing && !isOcrReading && serverImageUrl && (
                <Badge variant="secondary">
                  <Eye className="mr-1 h-3 w-3" /> Photo + Manual
                </Badge>
              )}
              {!isEditing && !isOcrReading && !serverImageUrl && (
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

            {/* Shift (not shown for edit) */}
            {!isEditing && (
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
            )}

            {/* Nozzle - locked or selectable */}
            <div className="grid gap-2">
              <Label>Nozzle *</Label>
              {isLocked && lockedNozzle ? (
                <div className="p-3 rounded-lg border bg-muted/50">
                  <p className="text-sm font-medium">
                    {lockedNozzle.name || `Nozzle ${lockedNozzle.nozzleNumber}`} - {lockedNozzle.fuelType?.name || 'Unknown'}
                  </p>
                  <p className="text-xs text-muted-foreground">Nozzle pre-selected (locked)</p>
                </div>
              ) : (
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
              )}
            </div>

            {/* Reading Type - locked or selectable */}
            <div className="grid gap-2">
              <Label>Reading Type *</Label>
              {lockedReadingType ? (
                <div className="p-3 rounded-lg border bg-muted/50">
                  <p className="text-sm font-medium capitalize">{readingType}</p>
                  <p className="text-xs text-muted-foreground">Type pre-selected (locked)</p>
                </div>
              ) : (
                <Select value={readingType} onValueChange={(v: 'opening' | 'closing') => setReadingType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="opening">Opening</SelectItem>
                    <SelectItem value="closing">Closing</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Optional Photo Attachment (not for editing) */}
            {!isOcrReading && !isEditing && (
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
                <span>{isEditing ? 'Updated' : 'Entered'} by: {user?.full_name || user?.username || (user as any)?.fullName || 'Current User'}</span>
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
                  <span>Method: {isEditing ? 'Manual correction' : 'Manual entry'}</span>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={isPending || !selectedNozzleId || !meterValue || (!isEditing && !currentShift)}
            >
              {isPending ? 'Submitting...' : isEditing ? 'Update Reading' : 'Submit Reading'}
            </Button>
          </DialogFooter>
        </>
      );
    }

    return null;
  };

  // Format shift time range for section headers
  const formatShiftTimeRange = (shiftInfo: any): string => {
    if (!shiftInfo?.shift) return '';
    const start = formatShiftTime(shiftInfo.shift.start_time);
    const end = formatShiftTime(shiftInfo.shift.end_time);
    if (start && end) return `${start} - ${end}`;
    if (start) return `From ${start}`;
    return 'Time not configured';
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

      {/* Current Shift Info (Task 1: Fixed time display) */}
      {currentShift ? (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-600">
                  <Clock className="h-6 w-6 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-green-900">
                      {(currentShift as any).shift?.name || `Shift #${(currentShift as any).shift?.shiftNumber}`}
                    </h3>
                    <Badge className="bg-green-600 text-white">Active</Badge>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-green-700">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {(() => {
                        const start = formatShiftTime((currentShift as any).shift?.startTime);
                        const end = formatShiftTime((currentShift as any).shift?.endTime);
                        if (start && end) return `${start} - ${end}`;
                        if (start) return `From ${start}`;
                        return 'Time not configured';
                      })()}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      Opened by: {(currentShift as any).openedByUser?.fullName || (currentShift as any).openedByUser?.username || 'Unknown'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {(() => {
                        const dateValue = (currentShift as any).date || (currentShift as any).openedAt;
                        if (!dateValue) return 'N/A';
                        try {
                          return format(new Date(dateValue), 'dd MMM yyyy');
                        } catch {
                          return 'Invalid Date';
                        }
                      })()}
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-green-600 mb-1">Shift Duration</div>
                <div className="text-2xl font-bold text-green-900">
                  {(currentShift as any).openedAt ? (() => {
                    const duration = Math.floor((new Date().getTime() - new Date((currentShift as any).openedAt).getTime()) / 1000 / 60);
                    const hours = Math.floor(duration / 60);
                    const mins = duration % 60;
                    return `${hours}h ${mins}m`;
                  })() : 'N/A'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Alert className="border-orange-200 bg-orange-50">
          <AlertCircle className="h-4 w-4 text-orange-600" />
          <AlertDescription className="text-orange-900">
            <strong>No Active Shift:</strong> Please open a shift before recording meter readings.
          </AlertDescription>
        </Alert>
      )}

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

      {/* Readings Table (Task 3: Grouped by shift) */}
      <Card>
        <CardHeader>
          <CardTitle>Meter Readings - {filterDate ? (() => {
            try {
              const date = new Date(filterDate);
              return isNaN(date.getTime()) ? 'All Dates' : format(date, 'MMM dd, yyyy');
            } catch {
              return 'All Dates';
            }
          })() : 'All Dates'}</CardTitle>
          <p className="text-sm text-muted-foreground">Opening and closing readings grouped by shift</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : !hasReadings ? (
            <div className="text-center py-12 text-muted-foreground">
              <Gauge className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p>No meter readings found</p>
              <p className="text-sm">Record your first meter reading to get started</p>
            </div>
          ) : (
            <div className="space-y-6">
              {shiftGroups.map(([shiftKey, group]) => {
                const si = group.shiftInfo;
                const shiftName = si?.shift?.name || (si?.shift?.shift_number ? `Shift #${si.shift.shift_number}` : 'Unknown Shift');
                const timeRange = formatShiftTimeRange(si);
                const shiftStatus = si?.status || 'unknown';
                const openedAt = si?.opened_at;
                const closedAt = si?.closed_at;
                const openedBy = si?.opened_by?.full_name || si?.opened_by?.username || '';

                return (
                  <div key={shiftKey}>
                    {/* Shift section header (Task 3) */}
                    <div className="flex items-center justify-between px-3 py-2 rounded-t-lg bg-muted/60 border border-b-0">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold">{shiftName}</h4>
                          <Badge variant={shiftStatus === 'open' ? 'warning' : shiftStatus === 'closed' ? 'success' : 'secondary'}>
                            {shiftStatus === 'open' ? 'Open' : shiftStatus === 'closed' ? 'Completed' : shiftStatus}
                          </Badge>
                        </div>
                        {timeRange && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {timeRange}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {openedBy && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {openedBy}
                          </span>
                        )}
                        {openedAt && (
                          <span>
                            {(() => {
                              try { return format(new Date(openedAt), 'dd MMM HH:mm'); } catch { return ''; }
                            })()}
                          </span>
                        )}
                        {closedAt && (
                          <span>
                            {' - '}
                            {(() => {
                              try { return format(new Date(closedAt), 'HH:mm'); } catch { return ''; }
                            })()}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Table for this shift */}
                    <Table className="border border-t-0 rounded-b-lg">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nozzle</TableHead>
                          <TableHead>Opening</TableHead>
                          <TableHead>Time</TableHead>
                          <TableHead>Closing</TableHead>
                          <TableHead>Time</TableHead>
                          <TableHead>Sales (L)</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="w-[80px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.rows.map((row: any, idx: number) => {
                          const sales = row.opening && row.closing
                            ? row.closing.reading_value - row.opening.reading_value
                            : null;
                          const isMismatch = sales !== null && sales < 0;

                          return (
                            <TableRow key={idx} className={isMismatch ? 'bg-destructive/10' : ''}>
                              {/* Task 2: Nozzle display name */}
                              <TableCell className="font-medium">
                                <div className="flex items-center">
                                  <Gauge className="mr-2 h-4 w-4 text-muted-foreground" />
                                  {formatNozzleName(row.nozzle)}
                                </div>
                              </TableCell>
                              <TableCell className="font-mono">
                                {row.opening ? (
                                  <span className="text-green-600 font-semibold">{row.opening.reading_value} L</span>
                                ) : <span className="text-muted-foreground">-</span>}
                              </TableCell>
                              <TableCell className="text-sm">
                                {row.opening?.created_at ? (() => {
                                  try {
                                    return format(new Date(row.opening.created_at), 'HH:mm');
                                  } catch {
                                    return '-';
                                  }
                                })() : '-'}
                              </TableCell>
                              <TableCell className="font-mono">
                                {row.closing ? (
                                  <span className="text-red-600 font-semibold">{row.closing.reading_value} L</span>
                                ) : row.opening ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-auto p-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                    onClick={() => openAddClosing(row.nozzle_id)}
                                    title="Click to add closing reading"
                                  >
                                    + Add Closing
                                  </Button>
                                ) : <span className="text-muted-foreground">-</span>}
                              </TableCell>
                              <TableCell className="text-sm">
                                {row.closing?.created_at ? (() => {
                                  try {
                                    return format(new Date(row.closing.created_at), 'HH:mm');
                                  } catch {
                                    return '-';
                                  }
                                })() : '-'}
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
                              {/* Task 4: Status badge colors */}
                              <TableCell>
                                {!row.opening && !row.closing ? (
                                  <Badge variant="secondary">No Data</Badge>
                                ) : !row.opening ? (
                                  <Badge variant="destructive">Missing Opening</Badge>
                                ) : !row.closing ? (
                                  <Badge variant="warning">Open</Badge>
                                ) : isMismatch ? (
                                  <Badge variant="destructive">Error</Badge>
                                ) : (
                                  <Badge variant="success">Complete</Badge>
                                )}
                              </TableCell>
                              {/* Task 6: Edit Closing action */}
                              <TableCell>
                                {row.closing && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-auto p-1"
                                    onClick={() => openEditClosing(row.closing.id, row.nozzle_id, row.closing.reading_value)}
                                    title="Edit closing reading"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}

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
            </div>
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
