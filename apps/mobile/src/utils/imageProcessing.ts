import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';

export interface ImageProcessingOptions {
  enhanceContrast?: boolean;
  adjustBrightness?: boolean;
  convertToGrayscale?: boolean;
  cropToMeter?: boolean;
}

export const processImageForOCR = async (
  imageUri: string,
  options: ImageProcessingOptions = {}
): Promise<string> => {
  try {
    const {
      enhanceContrast = true,
      adjustBrightness = true,
      convertToGrayscale = false,
    } = options;

    // Start with the original image
    let manipulatorResult = await ImageManipulator.manipulateAsync(
      imageUri,
      [
        // Resize to reasonable size for OCR (max 1920px width)
        { resize: { width: 1920 } },
      ],
      { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
    );

    // Apply filters for better OCR
    const actions: ImageManipulator.Action[] = [];

    if (convertToGrayscale) {
      // Note: expo-image-manipulator doesn't have grayscale
      // This would need a custom implementation or different library
    }

    if (enhanceContrast || adjustBrightness) {
      // Apply some basic enhancement
      // expo-image-manipulator has limited filter options
      // For production, consider using expo-gl or react-native-image-filter-kit
    }

    if (actions.length > 0) {
      manipulatorResult = await ImageManipulator.manipulateAsync(
        manipulatorResult.uri,
        actions,
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );
    }

    return manipulatorResult.uri;
  } catch (error) {
    console.error('Image processing error:', error);
    return imageUri; // Return original if processing fails
  }
};

export const convertImageToBase64 = async (imageUri: string): Promise<string> => {
  try {
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return base64;
  } catch (error) {
    console.error('Base64 conversion error:', error);
    throw error;
  }
};

export const compressImage = async (
  imageUri: string,
  quality: number = 0.7
): Promise<string> => {
  try {
    const result = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 1920 } }],
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result.uri;
  } catch (error) {
    console.error('Image compression error:', error);
    return imageUri;
  }
};
