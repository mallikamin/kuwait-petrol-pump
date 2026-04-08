import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Camera, X, CheckCircle, AlertCircle, Loader2, Edit2, Upload } from 'lucide-react';
import { apiClient } from '@/api/client';

export interface MeterReadingData {
  previousReading: number;
  currentReading: number;
  calculatedLiters: number;
  imageUrl?: string;
  ocrConfidence?: number;
  isManualReading: boolean;
}

export interface MeterReadingCaptureProps {
  nozzleId?: string;
  fuelTypeId?: string;
  nozzleName?: string;
  previousReading?: number;
  onCapture: (data: MeterReadingData) => void;
  onCancel?: () => void;
}

interface OCRResult {
  extractedValue: number | null;
  confidence: number;
  rawText: string;
  error?: string;
  quota?: {
    used: number;
    remaining: number;
    total: number;
    resetAt: string;
  };
}

type OCRProcessingState = 'idle' | 'image-selected' | 'uploading' | 'processing-ocr' | 'success' | 'error';

export function MeterReadingCapture({
  nozzleId,
  fuelTypeId: _fuelTypeId,
  nozzleName,
  previousReading = 0,
  onCapture,
  onCancel,
}: MeterReadingCaptureProps) {
  const [mode, setMode] = useState<'choose' | 'camera' | 'manual' | 'upload-manual'>('choose');
  const [captureMode, setCaptureMode] = useState<'ocr' | 'manual'>('ocr'); // Track whether user selected OCR or manual mode
  const [loading, setLoading] = useState(false);
  const [_uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [currentReading, setCurrentReading] = useState<string>('');
  const [manualEdit, setManualEdit] = useState(false);
  const [ocrProcessingState, setOcrProcessingState] = useState<OCRProcessingState>('idle');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calculate liters
  const calculatedLiters = currentReading
    ? Math.max(0, parseFloat(currentReading) - previousReading)
    : 0;

  // Start camera
  const startCamera = async () => {
    try {
      setMode('camera');
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Use back camera on mobile
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error('[Camera] Error:', err);
      setError(err.message || 'Failed to access camera. Please check permissions.');
      setMode('choose');
    }
  };

  // Stop camera
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Compress image to ~200KB
  const compressImage = (dataUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        // Resize to max 1024px width
        const maxWidth = 1024;
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Try different quality levels to hit ~200KB
        let quality = 0.8;
        let compressed = canvas.toDataURL('image/jpeg', quality);

        // Reduce quality if still too large
        while (compressed.length > 300000 && quality > 0.3) {
          quality -= 0.1;
          compressed = canvas.toDataURL('image/jpeg', quality);
        }

        console.log(`[Compress] Original: ${dataUrl.length} bytes, Compressed: ${compressed.length} bytes (quality: ${quality})`);
        resolve(compressed);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    });
  };

  // Capture photo
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
    setOcrProcessingState('image-selected');

    // Compress and process OCR
    try {
      setLoading(true);
      setError(null);
      setOcrProcessingState('uploading');

      const compressed = await compressImage(dataUrl);

      // Upload image
      console.log('[Upload] Uploading image...');
      const uploadRes = await apiClient.post<{ success: boolean; imageUrl: string; size: number }>(
        '/api/meter-readings/upload',
        { imageBase64: compressed, nozzleId }
      );

      console.log('[Upload] ✅ Image uploaded:', uploadRes.data.imageUrl);

      // Call OCR
      setOcrProcessingState('processing-ocr');
      console.log('[OCR] Processing...');
      const ocrRes = await apiClient.post<OCRResult>('/api/meter-readings/ocr', {
        imageBase64: compressed,
      });

      console.log('[OCR] Result:', ocrRes.data);
      setOcrResult(ocrRes.data);

      if (ocrRes.data.extractedValue && !ocrRes.data.error) {
        setCurrentReading(ocrRes.data.extractedValue.toString());
        setImageDataUrl(uploadRes.data.imageUrl); // Store server URL instead of base64
        setOcrProcessingState('success');
      } else {
        setError(ocrRes.data.error || 'Could not extract meter reading. Please enter manually.');
        setManualEdit(true);
        setOcrProcessingState('error');
      }

      setLoading(false);
    } catch (err: any) {
      console.error('[Capture] Error:', err);
      setError(err.response?.data?.error || 'Failed to process image');
      setLoading(false);
      setManualEdit(true);
      setOcrProcessingState('error');
    }
  };

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    // Check file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('Image file is too large (max 10MB)');
      return;
    }

    // Read file as data URL
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setImageDataUrl(dataUrl);
      setOcrProcessingState('image-selected'); // Show image selected state

      try {
        setLoading(true);
        setError(null);
        setUploadProgress(10);
        setOcrProcessingState('uploading');

        const compressed = await compressImage(dataUrl);
        setUploadProgress(30);

        // Upload image
        console.log('[Upload] Uploading image...');
        const uploadRes = await apiClient.post<{ success: boolean; imageUrl: string; size: number }>(
          '/api/meter-readings/upload',
          { imageBase64: compressed, nozzleId }
        );

        console.log('[Upload] ✅ Image uploaded:', uploadRes.data.imageUrl);
        setUploadProgress(70);
        setImageDataUrl(uploadRes.data.imageUrl); // Store server URL instead of base64

        // If manual mode, skip OCR
        if (captureMode === 'manual') {
          setUploadProgress(100);
          setLoading(false);
          setManualEdit(true); // Keep in manual mode
          setCurrentReading(''); // Clear any auto-filled reading
          setOcrProcessingState('idle'); // Don't show OCR states in manual mode
          console.log('[Manual Mode] Image stored without OCR');
          return;
        }

        // Call OCR only for OCR mode
        setOcrProcessingState('processing-ocr');
        console.log('[OCR] Processing...');
        const ocrRes = await apiClient.post<OCRResult>('/api/meter-readings/ocr', {
          imageBase64: compressed,
        });

        console.log('[OCR] Result:', ocrRes.data);
        setOcrResult(ocrRes.data);

        if (ocrRes.data.extractedValue && !ocrRes.data.error) {
          setCurrentReading(ocrRes.data.extractedValue.toString());
          setOcrProcessingState('success');
        } else {
          setError(ocrRes.data.error || 'Could not extract meter reading. Please enter manually.');
          setManualEdit(true);
          setOcrProcessingState('error');
        }

        setUploadProgress(100);
        setLoading(false);
      } catch (err: any) {
        console.error('[Upload] Error:', err);
        setError(err.response?.data?.error || 'Failed to process image');
        setLoading(false);
        setManualEdit(true);
        setOcrProcessingState('error');
      }
    };
    reader.onerror = () => {
      setError('Failed to read image file');
      setOcrProcessingState('error');
    };
    reader.readAsDataURL(file);
  };

  // Confirm reading
  const confirmReading = () => {
    const current = parseFloat(currentReading);

    if (isNaN(current) || current < 0) {
      setError('Please enter a valid meter reading');
      return;
    }

    if (current < previousReading) {
      setError('Current reading cannot be less than previous reading');
      return;
    }

    // Determine if this reading is manual (user typed it in)
    const isManualReading = manualEdit || mode === 'manual' || captureMode === 'manual';

    onCapture({
      previousReading,
      currentReading: current,
      calculatedLiters,
      imageUrl: imageDataUrl || undefined,
      ocrConfidence: isManualReading ? undefined : ocrResult?.confidence, // Don't send OCR confidence for manual
      isManualReading,
    });
  };

  // Choose mode view
  if (mode === 'choose') {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Record Meter Reading</span>
            {onCancel && (
              <Button variant="ghost" size="sm" onClick={onCancel}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </CardTitle>
          {nozzleName && <p className="text-sm text-muted-foreground">{nozzleName}</p>}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <span className="text-sm font-medium">Previous Reading</span>
            <span className="text-2xl font-bold">{previousReading.toFixed(2)}L</span>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-3 gap-4">
            <Button
              size="lg"
              className="h-24 flex flex-col gap-2"
              onClick={() => {
                setCaptureMode('ocr');
                startCamera();
              }}
            >
              <Camera className="h-8 w-8" />
              <span>Take Photo</span>
            </Button>

            <Button
              size="lg"
              variant="outline"
              className="h-24 flex flex-col gap-2"
              onClick={() => {
                setCaptureMode('ocr');
                fileInputRef.current?.click();
              }}
            >
              <Upload className="h-8 w-8" />
              <span>Upload Photo (OCR)</span>
            </Button>

            <Button
              size="lg"
              variant="outline"
              className="h-24 flex flex-col gap-2"
              onClick={() => setMode('manual')}
            >
              <Edit2 className="h-8 w-8" />
              <span>Manual Entry</span>
            </Button>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />

          <p className="text-xs text-center text-muted-foreground">
            Take a photo or upload for OCR, or enter reading manually
          </p>
        </CardContent>
      </Card>
    );
  }

  // Camera view
  if (mode === 'camera') {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Capture Meter Photo</span>
            <Button variant="ghost" size="sm" onClick={() => { stopCamera(); setMode('choose'); }}>
              <X className="h-4 w-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <Button size="lg" className="w-full" onClick={capturePhoto} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Camera className="mr-2 h-5 w-5" />
                Capture Photo
              </>
            )}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Position the meter display in frame and capture
          </p>
        </CardContent>
      </Card>
    );
  }

  // Manual entry view (text input only)
  if (mode === 'manual') {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Manual Meter Reading Entry</span>
            <Button variant="ghost" size="sm" onClick={() => { setMode('choose'); setCurrentReading(''); setError(null); setManualEdit(false); }}>
              <X className="h-4 w-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Previous reading */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <span className="text-sm font-medium">Previous Reading</span>
            <span className="text-lg font-bold">{previousReading.toFixed(2)}L</span>
          </div>

          {/* Current reading input */}
          <div className="space-y-2">
            <Label htmlFor="manual-reading">Current Reading</Label>
            <Input
              id="manual-reading"
              type="number"
              step="0.01"
              placeholder="Enter current meter reading"
              value={currentReading}
              onChange={(e) => setCurrentReading(e.target.value)}
              className="text-xl font-semibold"
              autoFocus
            />
          </div>

          {/* Calculated liters */}
          {currentReading && (
            <div className="flex items-center justify-between p-4 bg-primary/10 rounded-lg">
              <span className="text-sm font-medium">Calculated Quantity</span>
              <span className="text-2xl font-bold text-primary">{calculatedLiters.toFixed(2)}L</span>
            </div>
          )}

          {/* Alternative: Upload photo for manual entry */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setCaptureMode('manual');
              fileInputRef.current?.click();
            }}
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload Photo (No OCR) - Use as Reference
          </Button>

          {/* Error */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => { setMode('choose'); setCurrentReading(''); setError(null); setManualEdit(false); }}
            >
              Back
            </Button>
            <Button
              className="flex-1"
              onClick={confirmReading}
              disabled={!currentReading || loading}
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Continue
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            Enter reading manually or upload a reference photo
          </p>
        </CardContent>
      </Card>
    );
  }

  // OCR result or captured image confirmation view
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{captureMode === 'manual' ? 'Confirm Reading (Manual)' : 'Confirm OCR Reading'}</span>
          <Button variant="ghost" size="sm" onClick={() => { setMode('choose'); setCurrentReading(''); setOcrResult(null); setImageDataUrl(null); setError(null); setManualEdit(false); setOcrProcessingState('idle'); }}>
            <X className="h-4 w-4" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Previous reading */}
        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">Previous Reading</span>
          <span className="text-lg font-bold">{previousReading.toFixed(2)}L</span>
        </div>

        {/* OCR Processing States (only in OCR mode, not manual) */}
        {imageDataUrl && ocrProcessingState !== 'idle' && captureMode !== 'manual' && (
          <div className="space-y-2">
            {/* Image Selected */}
            {ocrProcessingState === 'image-selected' && (
              <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                <CheckCircle className="h-5 w-5 text-blue-600" />
                <span className="text-sm font-medium text-blue-900 dark:text-blue-200">✓ Image selected</span>
              </div>
            )}
            {/* Uploading */}
            {ocrProcessingState === 'uploading' && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950 rounded-lg">
                <Loader2 className="h-5 w-5 text-amber-600 animate-spin" />
                <span className="text-sm font-medium text-amber-900 dark:text-amber-200">Uploading image...</span>
              </div>
            )}
            {/* Processing OCR */}
            {ocrProcessingState === 'processing-ocr' && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950 rounded-lg">
                <Loader2 className="h-5 w-5 text-amber-600 animate-spin" />
                <span className="text-sm font-medium text-amber-900 dark:text-amber-200">Extracting meter reading from image...</span>
              </div>
            )}
            {/* Success with extracted value */}
            {ocrProcessingState === 'success' && ocrResult?.extractedValue !== null && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <span className="text-sm font-medium text-green-900 dark:text-green-200">✓ Meter reading extracted</span>
                </div>
                {ocrResult && (
                  <div className="p-3 bg-muted rounded-lg border">
                    <p className="text-xs text-muted-foreground mb-1">Extracted Value:</p>
                    <p className="text-2xl font-bold">{ocrResult.extractedValue?.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground mt-1">Confidence: {Math.round(ocrResult.confidence * 100)}%</p>
                  </div>
                )}
              </div>
            )}
            {/* Error */}
            {ocrProcessingState === 'error' && (
              <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950 rounded-lg">
                <AlertCircle className="h-5 w-5 text-red-600" />
                <span className="text-sm font-medium text-red-900 dark:text-red-200">Could not extract reading - please enter manually</span>
              </div>
            )}
          </div>
        )}

        {/* OCR confidence - simplified for success state */}
        {ocrResult && !manualEdit && ocrProcessingState !== 'success' && (
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <span className="text-sm font-medium">OCR Confidence</span>
            <Badge variant={ocrResult.confidence > 0.8 ? 'default' : 'secondary'}>
              {Math.round(ocrResult.confidence * 100)}%
            </Badge>
          </div>
        )}

        {/* Current reading input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="current-reading">Current Reading</Label>
            {imageDataUrl && !manualEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setManualEdit(true)}
              >
                <Edit2 className="h-4 w-4 mr-1" />
                Edit
              </Button>
            )}
          </div>
          <Input
            id="current-reading"
            type="number"
            step="0.01"
            placeholder="Enter current reading"
            value={currentReading}
            onChange={(e) => setCurrentReading(e.target.value)}
            className="text-xl font-semibold"
          />
        </div>

        {/* Calculated liters */}
        {currentReading && (
          <div className="flex items-center justify-between p-4 bg-primary/10 rounded-lg">
            <span className="text-sm font-medium">Calculated Quantity</span>
            <span className="text-2xl font-bold text-primary">{calculatedLiters.toFixed(2)}L</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => { setMode('choose'); setCurrentReading(''); setOcrResult(null); setImageDataUrl(null); setError(null); setManualEdit(false); setOcrProcessingState('idle'); }}
          >
            Retake / Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={confirmReading}
            disabled={!currentReading || loading}
          >
            <CheckCircle className="mr-2 h-4 w-4" />
            Continue
          </Button>
        </div>

        <p className="text-xs text-center text-muted-foreground">
          {manualEdit ? 'Manual entry' : 'OCR extracted - review and confirm'}
        </p>
      </CardContent>
    </Card>
  );
}
