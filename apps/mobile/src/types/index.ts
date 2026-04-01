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
  branchId: string;
  shiftNumber: number;
  name: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
  createdAt: string;
}

export interface Nozzle {
  id: string;
  dispensingUnitId: string;
  nozzleNumber: number;
  fuelTypeId: string;
  meterType: string;
  isActive: boolean;
  createdAt: string;
  fuelType: {
    id: string;
    code: string;
    name: string;
    unit: string;
  };
  dispensingUnit: {
    id: string;
    branchId: string;
    unitNumber: number;
    name: string;
    isActive: boolean;
  };
}

export interface MeterReading {
  id: string;
  nozzle_id: string;
  nozzle?: {
    id: string;
    nozzle_number: number;
    fuel_type?: {
      id: string;
      name: string;
      code: string;
    } | null;
  } | null;
  shift_id: string;
  reading_type: 'opening' | 'closing';
  meter_value: number;
  image_url?: string;
  is_ocr: boolean;
  ocr_confidence?: number;
  created_by_id: string;
  created_by?: {
    id: string;
    full_name: string;
    username: string;
  } | null;
  created_at: string;
  variance?: number;
}

export interface MeterReadingCreate {
  nozzleId: string;
  shiftId: string;
  readingType: 'opening' | 'closing';
  meterValue: number;
  imageBase64?: string;
  isOcr: boolean;
  ocrConfidence?: number;
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
