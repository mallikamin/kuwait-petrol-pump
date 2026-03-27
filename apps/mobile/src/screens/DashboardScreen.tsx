import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { useOfflineStore } from '../store/offlineStore';
import apiClient from '../api/client';
import { RootStackParamList, DashboardStats } from '../types';
import { format } from 'date-fns';

type DashboardNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'Dashboard'
>;

const DashboardScreen: React.FC = () => {
  const navigation = useNavigation<DashboardNavigationProp>();
  const { user } = useAuthStore();
  const { isOnline, pendingReadings } = useOfflineStore();

  const {
    data: stats,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const response = await apiClient.get<DashboardStats>('/dashboard/stats');
      return response.data;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const handleCameraPress = () => {
    navigation.navigate('Camera');
  };

  const handleHistoryPress = () => {
    navigation.navigate('ReadingsHistory');
  };

  const handleSettingsPress = () => {
    navigation.navigate('Settings');
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.welcomeText}>Welcome back,</Text>
          <Text style={styles.userName}>{user?.full_name || 'User'}</Text>
          <Text style={styles.userRole}>{user?.role.replace('_', ' ').toUpperCase()}</Text>
        </View>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={handleSettingsPress}
        >
          <Text style={styles.settingsButtonText}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* Offline Indicator */}
      {!isOnline && (
        <View style={styles.offlineBar}>
          <Text style={styles.offlineText}>
            📡 Offline - {pendingReadings.length} readings pending sync
          </Text>
        </View>
      )}

      {/* Stats Cards */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1a73e8" />
        </View>
      ) : (
        <View style={styles.statsContainer}>
          {/* Current Shift */}
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Current Shift</Text>
            <Text style={styles.statValue}>
              {stats?.current_shift?.name || 'No active shift'}
            </Text>
            {stats?.current_shift && (
              <Text style={styles.statSubtext}>
                {stats.current_shift.start_time} - {stats.current_shift.end_time}
              </Text>
            )}
          </View>

          {/* Pending Readings */}
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Pending Readings</Text>
            <Text style={[styles.statValue, styles.pendingValue]}>
              {stats?.pending_readings_count || 0}
            </Text>
            <Text style={styles.statSubtext}>Need attention</Text>
          </View>

          {/* Today's Readings */}
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Today's Readings</Text>
            <Text style={styles.statValue}>
              {stats?.total_readings_today || 0}
            </Text>
            <Text style={styles.statSubtext}>Submitted</Text>
          </View>

          {/* Last Reading */}
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Last Reading</Text>
            <Text style={styles.statValue}>
              {stats?.last_reading_timestamp
                ? format(new Date(stats.last_reading_timestamp), 'HH:mm')
                : '--:--'}
            </Text>
            <Text style={styles.statSubtext}>
              {stats?.last_reading_timestamp
                ? format(new Date(stats.last_reading_timestamp), 'dd MMM')
                : 'No readings yet'}
            </Text>
          </View>
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.actionsContainer}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>

        <TouchableOpacity
          style={styles.primaryActionButton}
          onPress={handleCameraPress}
        >
          <View style={styles.actionButtonContent}>
            <Text style={styles.actionIcon}>📷</Text>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitle}>Capture Meter Reading</Text>
              <Text style={styles.actionSubtitle}>
                Take a photo with AI OCR extraction
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryActionButton}
          onPress={handleHistoryPress}
        >
          <View style={styles.actionButtonContent}>
            <Text style={styles.actionIcon}>📊</Text>
            <View style={styles.actionTextContainer}>
              <Text style={styles.secondaryActionTitle}>View History</Text>
              <Text style={styles.secondaryActionSubtitle}>
                Browse all submitted readings
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryActionButton}
          onPress={() => navigation.navigate('MeterReadingForm', {})}
        >
          <View style={styles.actionButtonContent}>
            <Text style={styles.actionIcon}>✏️</Text>
            <View style={styles.actionTextContainer}>
              <Text style={styles.secondaryActionTitle}>Manual Entry</Text>
              <Text style={styles.secondaryActionSubtitle}>
                Enter reading without photo
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#1a73e8',
    padding: 20,
    paddingTop: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  welcomeText: {
    color: '#fff',
    fontSize: 14,
    opacity: 0.9,
  },
  userName: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 4,
  },
  userRole: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.8,
    marginTop: 2,
  },
  settingsButton: {
    padding: 8,
  },
  settingsButtonText: {
    fontSize: 28,
  },
  offlineBar: {
    backgroundColor: '#ff9800',
    padding: 12,
    alignItems: 'center',
  },
  offlineText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: 12,
  },
  statCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    width: '48%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  pendingValue: {
    color: '#ff5722',
  },
  statSubtext: {
    fontSize: 12,
    color: '#999',
  },
  actionsContainer: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  primaryActionButton: {
    backgroundColor: '#1a73e8',
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  secondaryActionButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  actionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionIcon: {
    fontSize: 32,
    marginRight: 16,
  },
  actionTextContainer: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  actionSubtitle: {
    fontSize: 14,
    color: '#fff',
    opacity: 0.9,
  },
  secondaryActionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  secondaryActionSubtitle: {
    fontSize: 12,
    color: '#666',
  },
});

export default DashboardScreen;
