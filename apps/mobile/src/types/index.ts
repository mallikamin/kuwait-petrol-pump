export interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'shift_manager' | 'cashier' | 'attendant' | 'viewer';
  station_id?: string;
  is_active: boolean;
}

export interface AuthTokens {
  access_token: string;
  token_type: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
  remember_me?: boolean;
}

export interface Shift {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export interface Nozzle {
  id: string;
  nozzle_number: string;
  fuel_type: string;
  dispenser_id: string;
  is_active: boolean;
}

export interface MeterReading {
  id: string;
  nozzle_id: string;
  shift_id: string;
  reading_type: 'opening' | 'closing';
  meter_value: number;
  image_url?: string;
  is_ocr: boolean;
  ocr_confidence?: number;
  created_by_id: string;
  created_at: string;
  variance?: number;
}

export interface MeterReadingCreate {
  nozzle_id: string;
  shift_id: string;
  reading_type: 'opening' | 'closing';
  meter_value: number;
  image_base64?: string;
  is_ocr: boolean;
  ocr_confidence?: number;
}

export interface OCRResult {
  extractedValue: number | null;
  confidence: number;
  rawText: string;
  error?: string;
}

export interface DashboardStats {
  current_shift?: Shift;
  pending_readings_count: number;
  last_reading_timestamp?: string;
  total_readings_today: number;
}

export interface OfflineReading {
  id: string;
  data: MeterReadingCreate;
  timestamp: number;
  synced: boolean;
}

export type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
  Camera: undefined;
  OCRProcessing: { imageUri: string };
  MeterReadingForm: {
    imageUri?: string;
    ocrValue?: number;
    ocrConfidence?: number;
  };
  ReadingsHistory: undefined;
  Settings: undefined;
};
