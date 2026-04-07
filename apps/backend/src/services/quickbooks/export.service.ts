/**
 * QB Mapping Export Service
 * Handles CSV and Excel export with reconciliation data
 */

import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();

export interface ExportRow {
  'Mapping Type': string;
  'POS Entity ID': string;
  'POS Entity Name': string;
  'QB Entity ID': string;
  'QB Entity Name': string;
  'Account Source': string;
  'Status': string;
  'Ask from Client': boolean;
  'Already Mapped Conflict': string;
  'Last Updated At': string;
  'Updated By': string;
  'Batch ID': string;
  'Notes': string;
}

export class ExportService {
  static async getExportData(organizationId: string): Promise<ExportRow[]> {
    // Get all mappings (active and inactive)
    const allMappings = await prisma.qBEntityMapping.findMany({
      where: { organizationId },
      orderBy: [{ entityType: 'asc' }, { updatedAt: 'desc' }],
    });

    const data: ExportRow[] = [];
    const processedPairs = new Set<string>(); // Track processed POS-QB pairs

    // Group mappings by entity type
    const mappingsByType = new Map<string, typeof allMappings>();
    allMappings.forEach((m) => {
      if (!mappingsByType.has(m.entityType)) {
        mappingsByType.set(m.entityType, []);
      }
      mappingsByType.get(m.entityType)!.push(m);
    });

    // Process each entity type
    for (const [entityType, mappings] of mappingsByType) {
      // 1. Successfully mapped (active mappings)
      const activeMappings = mappings.filter((m) => m.isActive);
      for (const mapping of activeMappings) {
        data.push({
          'Mapping Type': mapping.entityType,
          'POS Entity ID': mapping.localId,
          'POS Entity Name': mapping.localName || '',
          'QB Entity ID': mapping.qbId,
          'QB Entity Name': mapping.qbName || '',
          'Account Source': 'Both',
          'Status': 'Successfully Mapped',
          'Ask from Client': false,
          'Already Mapped Conflict': 'none',
          'Last Updated At': mapping.updatedAt?.toISOString() || '',
          'Updated By': 'System',
          'Batch ID': '',
          'Notes': '',
        });
        processedPairs.add(`${mapping.localId}|${mapping.qbId}`);
      }

      // 2. Ask from Client (inactive mappings - explicitly deferred)
      const inactiveMappings = mappings.filter((m) => !m.isActive);
      for (const mapping of inactiveMappings) {
        data.push({
          'Mapping Type': mapping.entityType,
          'POS Entity ID': mapping.localId,
          'POS Entity Name': mapping.localName || '',
          'QB Entity ID': mapping.qbId,
          'QB Entity Name': mapping.qbName || '',
          'Account Source': 'Both',
          'Status': 'Ask from Client',
          'Ask from Client': true,
          'Already Mapped Conflict': 'none',
          'Last Updated At': mapping.updatedAt?.toISOString() || '',
          'Updated By': 'System',
          'Batch ID': '',
          'Notes': '',
        });
      }

      // 3. Not Mapped in QB (POS entities with no active QB mapping)
      const unmappedPosIds = new Set<string>();
      for (const mapping of mappings) {
        unmappedPosIds.add(mapping.localId);
      }

      for (const posId of unmappedPosIds) {
        const hasActiveMapping = mappings.some(
          (m) => m.localId === posId && m.isActive
        );
        if (!hasActiveMapping) {
          // Find the most recent entry for this POS ID
          const mostRecent = mappings
            .filter((m) => m.localId === posId)
            .sort((a, b) =>
              (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0)
            )[0];

          if (mostRecent && !mostRecent.isActive) {
            // Already included as "Ask from Client", skip
            continue;
          }

          // This POS ID has no mapping at all
          data.push({
            'Mapping Type': entityType,
            'POS Entity ID': posId,
            'POS Entity Name': mostRecent?.localName || posId,
            'QB Entity ID': '',
            'QB Entity Name': '',
            'Account Source': 'POS',
            'Status': 'Not Mapped in QB',
            'Ask from Client': false,
            'Already Mapped Conflict': 'none',
            'Last Updated At': new Date().toISOString(),
            'Updated By': 'System',
            'Batch ID': '',
            'Notes': 'No QB mapping found',
          });
        }
      }

      // 4. Not Mapped in POS (QB entities with no active POS mapping)
      const unmappedQbIds = new Set<string>();
      for (const mapping of mappings) {
        unmappedQbIds.add(mapping.qbId);
      }

      for (const qbId of unmappedQbIds) {
        const hasActiveMapping = mappings.some(
          (m) => m.qbId === qbId && m.isActive
        );
        if (!hasActiveMapping) {
          // Find the most recent entry for this QB ID
          const mostRecent = mappings
            .filter((m) => m.qbId === qbId)
            .sort((a, b) =>
              (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0)
            )[0];

          if (mostRecent && !mostRecent.isActive) {
            // Already included as "Ask from Client", skip
            continue;
          }

          // This QB ID has no mapping at all
          data.push({
            'Mapping Type': entityType,
            'POS Entity ID': '',
            'POS Entity Name': '',
            'QB Entity ID': qbId,
            'QB Entity Name': mostRecent?.qbName || qbId,
            'Account Source': 'QB',
            'Status': 'Not Mapped in POS',
            'Ask from Client': false,
            'Already Mapped Conflict': 'none',
            'Last Updated At': new Date().toISOString(),
            'Updated By': 'System',
            'Batch ID': '',
            'Notes': 'No POS mapping found',
          });
        }
      }
    }

    // Log summary for verification
    const statusCounts = data.reduce(
      (acc, row) => {
        const status = row['Status'];
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    console.log('[QB Export] Reconciliation summary:', {
      totalRows: data.length,
      byStatus: statusCounts,
      organizationId,
    });

    return data;
  }

  static generateCSV(data: ExportRow[]): string {
    if (!data || data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(','),
      ...data.map((row) =>
        headers
          .map((header) => {
            const value = row[header as keyof ExportRow];
            const escaped = String(value || '').replace(/"/g, '""');
            return escaped.includes(',') || escaped.includes('\n')
              ? `"${escaped}"`
              : escaped;
          })
          .join(',')
      ),
    ].join('\n');

    return csv;
  }

  static generateExcel(data: ExportRow[]): Buffer {
    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data, {
      header: [
        'Mapping Type',
        'POS Entity ID',
        'POS Entity Name',
        'QB Entity ID',
        'QB Entity Name',
        'Account Source',
        'Status',
        'Ask from Client',
        'Already Mapped Conflict',
        'Last Updated At',
        'Updated By',
        'Batch ID',
        'Notes',
      ],
    });

    // Set column widths for better readability
    ws['!cols'] = [
      { wch: 15 }, // Mapping Type
      { wch: 20 }, // POS Entity ID
      { wch: 25 }, // POS Entity Name
      { wch: 20 }, // QB Entity ID
      { wch: 25 }, // QB Entity Name
      { wch: 15 }, // Account Source
      { wch: 20 }, // Status
      { wch: 15 }, // Ask from Client
      { wch: 20 }, // Already Mapped Conflict
      { wch: 25 }, // Last Updated At
      { wch: 15 }, // Updated By
      { wch: 20 }, // Batch ID
      { wch: 30 }, // Notes
    ];

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'QB Mappings');

    // Generate buffer
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    return buffer as Buffer;
  }
}
