import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { RootStackParamList, Nozzle, Shift, MeterReadingCreate } from '../types';
import apiClient from '../api/client';
import { convertImageToBase64 } from '../utils/imageProcessing';
import { Picker } from '@react-native-picker/picker';

type MeterReadingFormRouteProp = RouteProp<
  RootStackParamList,
  'MeterReadingForm'
>;
type MeterReadingFormNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'MeterReadingForm'
>;

const MeterReadingFormScreen: React.FC = () => {
  const navigation = useNavigation<MeterReadingFormNavigationProp>();
  const route = useRoute<MeterReadingFormRouteProp>();
  const queryClient = useQueryClient();

  const { imageUri, ocrValue, ocrConfidence } = route.params;

  const [nozzleId, setNozzleId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [readingType, setReadingType] = useState<'opening' | 'closing'>('opening');
  const [meterValue, setMeterValue] = useState(
    ocrValue ? ocrValue.toString() : ''
  );

  // Fetch nozzles
  const { data: nozzles, isLoading: nozzlesLoading } = useQuery({
    queryKey: ['nozzles'],
    queryFn: async () => {
      const response = await apiClient.get<Nozzle[]>('/nozzles');
      return response.data.filter((n) => n.is_active);
    },
  });

  // Fetch shifts
  const { data: shifts, isLoading: shiftsLoading } = useQuery({
    queryKey: ['shifts'],
    queryFn: async () => {
      const response = await apiClient.get<Shift[]>('/shifts');
      return response.data.filter((s) => s.is_active);
    },
  });

  // Auto-select current shift
  useEffect(() => {
    if (shifts && shifts.length > 0 && !shiftId) {
      // Find current active shift (basic implementation)
      const currentShift = shifts[0];
      setShiftId(currentShift.id);
    }
  }, [shifts]);

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: async (data: MeterReadingCreate) => {
      const response = await apiClient.post('/meter-readings', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meter-readings'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Success',
        'Meter reading submitted successfully!',
        [
          {
            text: 'OK',
            onPress: () => navigation.navigate('Dashboard'),
          },
        ]
      );
    },
    onError: (error: unknown) => {
      console.error('Submit error:', error);
      let errorMessage = 'Failed to submit reading. Please try again.';
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { data?: { detail?: string } } };
        errorMessage = axiosError.response?.data?.detail || errorMessage;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', errorMessage);
    },
  });

  const handleSubmit = async () => {
    // Validation
    if (!nozzleId) {
      Alert.alert('Validation Error', 'Please select a nozzle');
      return;
    }

    if (!shiftId) {
      Alert.alert('Validation Error', 'Please select a shift');
      return;
    }

    if (!meterValue || parseFloat(meterValue) <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid meter value');
      return;
    }

    try {
      let imageBase64: string | undefined;

      if (imageUri) {
        imageBase64 = await convertImageToBase64(imageUri);
      }

      const data: MeterReadingCreate = {
        nozzle_id: nozzleId,
        shift_id: shiftId,
        reading_type: readingType,
        meter_value: parseFloat(meterValue),
        image_base64: imageBase64,
        is_ocr: !!ocrValue,
        ocr_confidence: ocrConfidence,
      };

      submitMutation.mutate(data);
    } catch (error) {
      console.error('Submission error:', error);
      Alert.alert('Error', 'Failed to prepare submission');
    }
  };

  const isLoading = nozzlesLoading || shiftsLoading || submitMutation.isPending;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        {/* Image Preview */}
        {imageUri && (
          <View style={styles.imagePreviewContainer}>
            <Image source={{ uri: imageUri }} style={styles.imagePreview} />
            {ocrValue && (
              <View style={styles.ocrBadge}>
                <Text style={styles.ocrBadgeText}>
                  OCR: {ocrValue.toFixed(2)} ({((ocrConfidence ?? 0) * 100).toFixed(0)}%)
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Form */}
        <View style={styles.formSection}>
          <Text style={styles.sectionTitle}>Reading Details</Text>

          {/* Nozzle Selection */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Nozzle *</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={nozzleId}
                onValueChange={(value) => setNozzleId(value)}
                enabled={!isLoading}
                style={styles.picker}
              >
                <Picker.Item label="Select a nozzle..." value="" />
                {nozzles?.map((nozzle) => (
                  <Picker.Item
                    key={nozzle.id}
                    label={`${nozzle.nozzle_number} - ${nozzle.fuel_type}`}
                    value={nozzle.id}
                  />
                ))}
              </Picker>
            </View>
          </View>

          {/* Shift Selection */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Shift *</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={shiftId}
                onValueChange={(value) => setShiftId(value)}
                enabled={!isLoading}
                style={styles.picker}
              >
                <Picker.Item label="Select a shift..." value="" />
                {shifts?.map((shift) => (
                  <Picker.Item
                    key={shift.id}
                    label={`${shift.name} (${shift.start_time} - ${shift.end_time})`}
                    value={shift.id}
                  />
                ))}
              </Picker>
            </View>
          </View>

          {/* Reading Type */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Reading Type *</Text>
            <View style={styles.segmentedControl}>
              <TouchableOpacity
                style={[
                  styles.segment,
                  readingType === 'opening' && styles.segmentActive,
                ]}
                onPress={() => setReadingType('opening')}
                disabled={isLoading}
              >
                <Text
                  style={[
                    styles.segmentText,
                    readingType === 'opening' && styles.segmentTextActive,
                  ]}
                >
                  Opening
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.segment,
                  readingType === 'closing' && styles.segmentActive,
                ]}
                onPress={() => setReadingType('closing')}
                disabled={isLoading}
              >
                <Text
                  style={[
                    styles.segmentText,
                    readingType === 'closing' && styles.segmentTextActive,
                  ]}
                >
                  Closing
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Meter Value */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Meter Value *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter meter reading"
              placeholderTextColor="#999"
              value={meterValue}
              onChangeText={setMeterValue}
              keyboardType="decimal-pad"
              editable={!isLoading}
            />
            {ocrValue && meterValue !== ocrValue.toString() && (
              <Text style={styles.helperText}>
                OCR suggested: {ocrValue.toFixed(2)}
              </Text>
            )}
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isLoading}
          >
            {submitMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Submit Reading</Text>
            )}
          </TouchableOpacity>

          {isLoading && !submitMutation.isPending && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#1a73e8" />
              <Text style={styles.loadingText}>Loading form data...</Text>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 16,
  },
  imagePreviewContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    resizeMode: 'contain',
  },
  ocrBadge: {
    position: 'absolute',
    top: 20,
    right: 20,
    backgroundColor: '#1a73e8',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  ocrBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  formSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  pickerContainer: {
    backgroundColor: '#f9f9f9',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    overflow: 'hidden',
  },
  picker: {
    height: 50,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 6,
  },
  segmentActive: {
    backgroundColor: '#1a73e8',
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  segmentTextActive: {
    color: '#fff',
  },
  input: {
    backgroundColor: '#f9f9f9',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#333',
  },
  helperText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  submitButton: {
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: {
    backgroundColor: '#93b9e8',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  loadingText: {
    marginLeft: 8,
    color: '#666',
    fontSize: 14,
  },
});

export default MeterReadingFormScreen;
