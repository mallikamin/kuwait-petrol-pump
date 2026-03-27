import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  Dimensions,
  Alert,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { RootStackParamList } from '../types';
import { processImageForOCR, convertImageToBase64 } from '../utils/imageProcessing';
import { extractMeterReading } from '../api/ocr';

type OCRProcessingRouteProp = RouteProp<RootStackParamList, 'OCRProcessing'>;
type OCRProcessingNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'OCRProcessing'
>;

const { width } = Dimensions.get('window');

const OCRProcessingScreen: React.FC = () => {
  const navigation = useNavigation<OCRProcessingNavigationProp>();
  const route = useRoute<OCRProcessingRouteProp>();
  const { imageUri } = route.params;

  const [isProcessing, setIsProcessing] = useState(true);
  const [extractedValue, setExtractedValue] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    processImage();
  }, []);

  const processImage = async () => {
    try {
      setIsProcessing(true);
      setError(null);

      // Step 1: Process image for better OCR
      const processedUri = await processImageForOCR(imageUri, {
        enhanceContrast: true,
        adjustBrightness: true,
        convertToGrayscale: false,
      });

      // Step 2: Convert to base64
      const base64Image = await convertImageToBase64(processedUri);

      // Step 3: Extract meter reading using Claude API
      const result = await extractMeterReading(base64Image);

      if (result.error || result.extractedValue === null) {
        setError(result.error || 'Failed to extract meter reading');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else {
        setExtractedValue(result.extractedValue);
        setConfidence(result.confidence);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      console.error('Processing error:', err);
      setError('Failed to process image. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUseOCRValue = () => {
    if (extractedValue !== null) {
      navigation.navigate('MeterReadingForm', {
        imageUri,
        ocrValue: extractedValue,
        ocrConfidence: confidence,
      });
    }
  };

  const handleEnterManually = () => {
    navigation.navigate('MeterReadingForm', {
      imageUri,
    });
  };

  const handleRetry = () => {
    processImage();
  };

  const getConfidenceColor = (conf: number): string => {
    if (conf >= 0.8) return '#4caf50';
    if (conf >= 0.5) return '#ff9800';
    return '#f44336';
  };

  const getConfidenceText = (conf: number): string => {
    if (conf >= 0.8) return 'High';
    if (conf >= 0.5) return 'Medium';
    return 'Low';
  };

  return (
    <View style={styles.container}>
      {/* Image Preview */}
      <View style={styles.imageContainer}>
        <Image source={{ uri: imageUri }} style={styles.image} />
      </View>

      {/* Processing Status */}
      <View style={styles.contentContainer}>
        {isProcessing ? (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color="#1a73e8" />
            <Text style={styles.processingText}>Processing with AI...</Text>
            <Text style={styles.processingSubtext}>
              Extracting meter reading from image
            </Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.errorSubtext}>
              You can retry OCR or enter the reading manually
            </Text>

            <View style={styles.errorActions}>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={handleRetry}
              >
                <Text style={styles.retryButtonText}>Retry OCR</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.manualButton}
                onPress={handleEnterManually}
              >
                <Text style={styles.manualButtonText}>Enter Manually</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.resultContainer}>
            <Text style={styles.resultLabel}>Extracted Reading</Text>
            <Text style={styles.resultValue}>{extractedValue?.toFixed(2)}</Text>

            <View style={styles.confidenceContainer}>
              <Text style={styles.confidenceLabel}>Confidence:</Text>
              <View
                style={[
                  styles.confidenceBadge,
                  { backgroundColor: getConfidenceColor(confidence) },
                ]}
              >
                <Text style={styles.confidenceText}>
                  {getConfidenceText(confidence)} ({(confidence * 100).toFixed(0)}%)
                </Text>
              </View>
            </View>

            {confidence < 0.8 && (
              <View style={styles.warningContainer}>
                <Text style={styles.warningText}>
                  ⚠️ Please verify this reading before submitting
                </Text>
              </View>
            )}

            <View style={styles.actionsContainer}>
              <TouchableOpacity
                style={styles.useOCRButton}
                onPress={handleUseOCRValue}
              >
                <Text style={styles.useOCRButtonText}>Use This Value</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.manualEntryButton}
                onPress={handleEnterManually}
              >
                <Text style={styles.manualEntryButtonText}>
                  Correct Manually
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  imageContainer: {
    height: 250,
    backgroundColor: '#000',
  },
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  contentContainer: {
    flex: 1,
    padding: 20,
  },
  processingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 16,
  },
  processingSubtext: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#f44336',
    textAlign: 'center',
    marginBottom: 8,
  },
  errorSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  errorActions: {
    width: '100%',
    gap: 12,
  },
  retryButton: {
    backgroundColor: '#1a73e8',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  manualButton: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1a73e8',
  },
  manualButtonText: {
    color: '#1a73e8',
    fontSize: 16,
    fontWeight: 'bold',
  },
  resultContainer: {
    flex: 1,
  },
  resultLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  resultValue: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#1a73e8',
    marginBottom: 24,
  },
  confidenceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  confidenceLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 8,
  },
  confidenceBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  confidenceText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  warningContainer: {
    backgroundColor: '#fff3cd',
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: '#ff9800',
  },
  warningText: {
    color: '#856404',
    fontSize: 14,
  },
  actionsContainer: {
    gap: 12,
    marginTop: 'auto',
  },
  useOCRButton: {
    backgroundColor: '#1a73e8',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  useOCRButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  manualEntryButton: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  manualEntryButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default OCRProcessingScreen;
