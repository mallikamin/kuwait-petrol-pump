import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import apiClient from '../api/client';
import { MeterReading } from '../types';

const ReadingsHistoryScreen: React.FC = () => {
  const [filter, setFilter] = useState<'all' | 'ocr' | 'manual'>('all');

  const {
    data: readings,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['meter-readings', filter],
    queryFn: async () => {
      const response = await apiClient.get<MeterReading[]>('/meter-readings', {
        params: {
          limit: 100,
          is_ocr: filter === 'ocr' ? true : filter === 'manual' ? false : undefined,
        },
      });
      return response.data;
    },
  });

  const renderReadingItem = ({ item }: { item: MeterReading }) => (
    <View style={styles.readingCard}>
      <View style={styles.readingHeader}>
        <View style={styles.readingHeaderLeft}>
          <Text style={styles.readingValue}>{item.meter_value.toFixed(2)}</Text>
          <Text style={styles.readingType}>
            {item.reading_type === 'opening' ? '🟢 Opening' : '🔴 Closing'}
          </Text>
        </View>
        {item.image_url && (
          <Image
            source={{ uri: item.image_url }}
            style={styles.thumbnail}
          />
        )}
      </View>

      <View style={styles.readingDetails}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Nozzle:</Text>
          <Text style={styles.detailValue}>{item.nozzle_id}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Time:</Text>
          <Text style={styles.detailValue}>
            {format(new Date(item.created_at), 'dd MMM yyyy, HH:mm')}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Method:</Text>
          <View
            style={[
              styles.methodBadge,
              item.is_ocr ? styles.ocrBadge : styles.manualBadge,
            ]}
          >
            <Text style={styles.methodText}>
              {item.is_ocr
                ? `OCR (${((item.ocr_confidence ?? 0) * 100).toFixed(0)}%)`
                : 'Manual'}
            </Text>
          </View>
        </View>

        {item.variance !== undefined && item.variance !== null && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Variance:</Text>
            <Text
              style={[
                styles.varianceText,
                item.variance > 0 ? styles.positiveVariance : styles.negativeVariance,
              ]}
            >
              {item.variance > 0 ? '+' : ''}
              {item.variance.toFixed(2)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'all' && styles.filterTabActive]}
          onPress={() => setFilter('all')}
        >
          <Text
            style={[
              styles.filterTabText,
              filter === 'all' && styles.filterTabTextActive,
            ]}
          >
            All
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterTab, filter === 'ocr' && styles.filterTabActive]}
          onPress={() => setFilter('ocr')}
        >
          <Text
            style={[
              styles.filterTabText,
              filter === 'ocr' && styles.filterTabTextActive,
            ]}
          >
            OCR Only
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterTab, filter === 'manual' && styles.filterTabActive]}
          onPress={() => setFilter('manual')}
        >
          <Text
            style={[
              styles.filterTabText,
              filter === 'manual' && styles.filterTabTextActive,
            ]}
          >
            Manual Only
          </Text>
        </TouchableOpacity>
      </View>

      {/* Readings List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1a73e8" />
        </View>
      ) : (
        <FlatList
          data={readings}
          renderItem={renderReadingItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No readings found</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  filterContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  filterTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 4,
  },
  filterTabActive: {
    backgroundColor: '#1a73e8',
  },
  filterTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  filterTabTextActive: {
    color: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
  },
  readingCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  readingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  readingHeaderLeft: {
    flex: 1,
  },
  readingValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a73e8',
    marginBottom: 4,
  },
  readingType: {
    fontSize: 14,
    color: '#666',
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    resizeMode: 'cover',
  },
  readingDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 14,
    color: '#666',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  methodBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  ocrBadge: {
    backgroundColor: '#e3f2fd',
  },
  manualBadge: {
    backgroundColor: '#f3e5f5',
  },
  methodText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#333',
  },
  varianceText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  positiveVariance: {
    color: '#4caf50',
  },
  negativeVariance: {
    color: '#f44336',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
  },
});

export default ReadingsHistoryScreen;
