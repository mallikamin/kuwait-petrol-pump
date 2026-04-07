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
    const mappings = await prisma.qBEntityMapping.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
    });

    // Transform to export format
    const data: ExportRow[] = mappings.map((mapping) => ({
      'Mapping Type': mapping.entityType,
      'POS Entity ID': mapping.localId,
      'POS Entity Name': mapping.localName || '',
      'QB Entity ID': mapping.qbId,
      'QB Entity Name': mapping.qbName || '',
      'Account Source': 'Both',
      'Status': mapping.isActive ? 'Successfully Mapped' : 'Deactivated',
      'Ask from Client': false,
      'Already Mapped Conflict': 'none',
      'Last Updated At': mapping.updatedAt?.toISOString() || '',
      'Updated By': 'System',
      'Batch ID': '',
      'Notes': '',
    }));

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
