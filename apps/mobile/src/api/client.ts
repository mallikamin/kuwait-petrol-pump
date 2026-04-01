import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8001/api';

const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('access_token');
    console.log('API Request:', config.baseURL + config.url);
    console.log('Token present:', !!token);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    console.error('Request interceptor error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor to handle auth errors
apiClient.interceptors.response.use(
  (response) => {
    console.log('API Response success:', response.config.url);
    return response;
  },
  async (error) => {
    console.error('API Response error:', error.message, error.config?.url);
    if (error.response?.status === 401) {
      // Clear stored tokens on auth error
      await AsyncStorage.multiRemove(['access_token', 'user']);
    }
    return Promise.reject(error);
  }
);

export default apiClient;
