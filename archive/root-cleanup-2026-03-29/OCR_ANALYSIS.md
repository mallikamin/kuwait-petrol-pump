# OCR Analysis - Nozzle Meter Pictures

**Date**: March 26, 2026
**Samples Received**: 34 images
**Location**: `BPO/Nozzle Pictures/`

---

## 📸 Sample Analysis

### Meter Type
**ACTUAL**: Mechanical flip-style displays (NOT fully digital LCD)
- White numbers on dark/black background
- Mechanical roller/flip digit display
- Fixed-width numerical font
- 6-digit readings visible

### Sample Readings Observed
- 399388 (readable)
- 314012 (readable)
- 314019 (readable)
- Multiple meters in various states

### Image Quality
**Positive**:
- ✅ Good resolution (sufficient for OCR)
- ✅ Clear digit visibility
- ✅ Straight-on angles (mostly)
- ✅ Adequate lighting in most samples

**Challenges**:
- ⚠️ Dusty/grimy displays (real-world conditions)
- ⚠️ Some slight angles/perspective distortion
- ⚠️ Varying lighting conditions
- ⚠️ WhatsApp compression artifacts

---

## 🔍 OCR Strategy

### Recommended Approach
1. **Tesseract.js** (Primary engine)
   - Excellent for mechanical digit recognition
   - Handles fixed-width fonts well
   - Configurable for 7-segment style digits

2. **Pre-processing Pipeline**
   ```
   Image → Grayscale → Contrast Enhancement →
   Noise Reduction → Deskew → Crop to ROI → OCR
   ```

3. **Validation Rules**
   - Must be 6 digits
   - Must be numeric only
   - Must be > previous reading
   - Confidence score > 80%

4. **Manual Override**
   - Always available
   - Shows OCR result for verification
   - Operator can correct if needed

### Expected Accuracy
- **Best case** (clean, straight): 95-98%
- **Average case** (normal dirt): 85-90%
- **Worst case** (very dirty, angled): 70-80%
- **With manual verification**: 100%

### Libraries & Tools

**Mobile App (React Native)**:
```javascript
// Option 1: Google ML Kit (Recommended)
import { TextRecognition } from '@react-native-ml-kit/text-recognition';

// Option 2: Tesseract.js
import TesseractOcr from 'react-native-tesseract-ocr';

// Option 3: Custom preprocessing
import { Canvas } from 'react-native-canvas';
```

**Backend (Node.js) - for validation/retry**:
```javascript
import Tesseract from 'tesseract.js';
import sharp from 'sharp'; // Image preprocessing
```

---

## 🎯 Implementation Plan

### Phase 1: Basic OCR (Mobile App)
1. Camera capture with guidelines
2. Image preprocessing (auto-crop, enhance)
3. OCR with Tesseract.js
4. Confidence score display
5. Manual verification step
6. Submit to backend

### Phase 2: Enhanced OCR
1. ML model training (if needed)
2. Historical reading validation
3. Auto-retry with different preprocessing
4. Batch processing support

### Phase 3: Advanced Features
1. Real-time OCR (as user holds camera)
2. Auto-capture when reading stable
3. Multi-reading verification
4. Anomaly detection

---

## 📊 Sample Data for Testing

### Test Readings (from actual photos)
```
Nozzle 1: 399388
Nozzle 2: 314012
Nozzle 3: 314019
Nozzle 4: (other samples)
Nozzle 5: (other samples)
Nozzle 6: (other samples)
```

### Expected Use Case
```
Shift Close:
1. Operator opens mobile app
2. Selects "Close Shift"
3. App shows list of 6 nozzles
4. For each nozzle:
   - Camera opens with guidelines
   - User aligns meter in frame
   - Tap to capture
   - OCR processes image (2-3 seconds)
   - Shows result: "314019"
   - User verifies or corrects
   - Tap "Confirm"
5. All readings submitted to backend
6. Backend validates (all > previous)
7. Shift closed
```

---

## 🔧 Preprocessing Steps

### 1. Grayscale Conversion
```javascript
const grayscale = await sharp(imageBuffer)
  .grayscale()
  .toBuffer();
```

### 2. Contrast Enhancement
```javascript
const enhanced = await sharp(grayscale)
  .normalize()
  .linear(1.5, -(128 * 1.5) + 128)
  .toBuffer();
```

### 3. Noise Reduction
```javascript
const denoised = await sharp(enhanced)
  .median(3)
  .toBuffer();
```

### 4. Binarization (Black & White)
```javascript
const binary = await sharp(denoised)
  .threshold(128)
  .toBuffer();
```

### 5. OCR
```javascript
const { data: { text, confidence } } = await Tesseract.recognize(
  binary,
  'eng',
  {
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: 7, // Single text line
  }
);
```

---

## 📱 Mobile App UI/UX

### Camera Screen
```
┌─────────────────────────┐
│     Close Shift         │
│  Nozzle 1 - PMG (1/6)   │
├─────────────────────────┤
│                         │
│  ┌─────────────────┐    │
│  │   GUIDELINES    │    │
│  │  ┌───────────┐  │    │
│  │  │ 314012    │  │    │ <- Target area
│  │  └───────────┘  │    │
│  └─────────────────┘    │
│                         │
│   Align meter here      │
│                         │
├─────────────────────────┤
│  [  📷 Capture  ]       │
│  [  Manual Entry  ]     │
└─────────────────────────┘
```

### Verification Screen
```
┌─────────────────────────┐
│  Nozzle 1 - PMG         │
├─────────────────────────┤
│  [Image thumbnail]      │
│                         │
│  OCR Reading:           │
│  ┌─────────────────┐    │
│  │   314012   ✓    │    │
│  └─────────────────┘    │
│  Confidence: 92%        │
│                         │
│  Previous: 314005       │
│  Difference: 7 liters   │
│                         │
├─────────────────────────┤
│  [ ✓ Confirm ]          │
│  [ ✗ Retake ]           │
│  [ ✏️  Edit Manually ]   │
└─────────────────────────┘
```

---

## ✅ Action Items

### Immediate (Backend - Now)
- [x] Meter reading API endpoints
- [x] Image upload support (S3/local storage)
- [x] OCR result storage in database
- [x] Validation: reading > previous reading

### Phase 2 (Mobile App - Week 3-4)
- [ ] Camera screen with guidelines
- [ ] Image preprocessing
- [ ] Tesseract.js integration
- [ ] Verification UI
- [ ] Offline queue for poor connectivity

### Future Enhancements
- [ ] ML model training with these 34 samples
- [ ] Auto-capture when reading stable
- [ ] Batch processing (all 6 nozzles)
- [ ] Historical accuracy tracking
- [ ] Operator-specific accuracy stats

---

## 📝 Notes

1. **Questionnaire said "digital meters"** but actual photos show **mechanical flip displays**
   - This is actually BETTER for OCR (more predictable)
   - Tesseract handles mechanical digits very well

2. **34 samples is excellent** for initial testing
   - Can use 80% for testing (27 images)
   - Keep 20% for validation (7 images)

3. **Real-world conditions** well-represented
   - Dust, grime, angles
   - Good for robust OCR development

4. **Manual override always available**
   - Zero risk of system blocking work
   - Operator can type reading if OCR fails

---

**Status**: ✅ Samples analyzed, strategy defined, ready for implementation
