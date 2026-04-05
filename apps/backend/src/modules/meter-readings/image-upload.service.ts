/**
 * Image Upload Service
 *
 * Handles meter reading image upload and storage.
 * Images are stored in file system and URLs are returned for DB storage.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const UPLOAD_BASE_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads/meter-readings');
const MAX_IMAGE_SIZE_MB = 10; // 10MB max
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

export interface UploadResult {
  imageUrl: string;
  filename: string;
  size: number;
}

export class ImageUploadService {
  /**
   * Ensure upload directory exists
   */
  private static ensureUploadDir(dateFolder: string): string {
    const uploadPath = path.join(UPLOAD_BASE_DIR, dateFolder);

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    return uploadPath;
  }

  /**
   * Generate unique filename for meter image
   */
  private static generateFilename(nozzleId: string, extension: string = 'jpg'): string {
    const timestamp = Date.now();
    const randomHash = crypto.randomBytes(8).toString('hex');
    return `nozzle-${nozzleId}-${timestamp}-${randomHash}.${extension}`;
  }

  /**
   * Detect image MIME type from base64 header
   */
  private static detectMimeType(base64: string): string {
    if (base64.startsWith('data:image/png')) return 'png';
    if (base64.startsWith('data:image/jpeg') || base64.startsWith('data:image/jpg')) return 'jpg';
    if (base64.startsWith('data:image/webp')) return 'webp';
    return 'jpg'; // Default
  }

  /**
   * Upload meter reading image to file system
   *
   * @param imageBase64 - Base64 encoded image (with or without data URL prefix)
   * @param nozzleId - Nozzle ID for filename organization
   * @returns Upload result with public URL
   */
  static async uploadImage(imageBase64: string, nozzleId: string): Promise<UploadResult> {
    try {
      // Remove data URL prefix if present
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

      // Validate base64
      if (!base64Data || base64Data.length < 100) {
        throw new Error('Invalid or empty image data');
      }

      // Convert to buffer and check size
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const sizeBytes = imageBuffer.length;

      if (sizeBytes > MAX_IMAGE_SIZE_BYTES) {
        throw new Error(`Image too large (${(sizeBytes / 1024 / 1024).toFixed(2)}MB). Max ${MAX_IMAGE_SIZE_MB}MB.`);
      }

      // Detect extension
      const extension = this.detectMimeType(imageBase64);

      // Create date folder (YYYY-MM-DD)
      const now = new Date();
      const dateFolder = now.toISOString().split('T')[0]; // '2026-04-02'
      const uploadPath = this.ensureUploadDir(dateFolder);

      // Generate filename and full path
      const filename = this.generateFilename(nozzleId, extension);
      const filePath = path.join(uploadPath, filename);

      // Write file
      fs.writeFileSync(filePath, imageBuffer);

      // Generate public URL
      const imageUrl = `/uploads/meter-readings/${dateFolder}/${filename}`;

      console.log(`[ImageUpload] ✅ Saved image: ${imageUrl} (${(sizeBytes / 1024).toFixed(0)}KB)`);

      return {
        imageUrl,
        filename,
        size: sizeBytes,
      };
    } catch (error) {
      console.error('[ImageUpload] ❌ Upload failed:', error);
      throw error;
    }
  }

  /**
   * Delete old images (for cleanup cron job)
   *
   * @param daysToKeep - Number of days to retain images (default 90)
   * @returns Number of files deleted
   */
  static async cleanupOldImages(daysToKeep: number = 90): Promise<number> {
    let deletedCount = 0;

    try {
      if (!fs.existsSync(UPLOAD_BASE_DIR)) {
        console.log('[ImageUpload] No upload directory found, skipping cleanup');
        return 0;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      const cutoffTimestamp = cutoffDate.getTime();

      // Read all date folders
      const dateFolders = fs.readdirSync(UPLOAD_BASE_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      for (const dateFolder of dateFolders) {
        const folderPath = path.join(UPLOAD_BASE_DIR, dateFolder);
        const folderDate = new Date(dateFolder);

        // If folder date is older than cutoff, delete entire folder
        if (!isNaN(folderDate.getTime()) && folderDate.getTime() < cutoffTimestamp) {
          const files = fs.readdirSync(folderPath);

          // Delete all files in folder
          for (const file of files) {
            fs.unlinkSync(path.join(folderPath, file));
            deletedCount++;
          }

          // Delete folder
          fs.rmdirSync(folderPath);
          console.log(`[ImageUpload] 🗑️  Deleted folder: ${dateFolder} (${files.length} files)`);
        }
      }

      if (deletedCount > 0) {
        console.log(`[ImageUpload] ✅ Cleanup complete: ${deletedCount} images deleted`);
      }

      return deletedCount;
    } catch (error) {
      console.error('[ImageUpload] ❌ Cleanup failed:', error);
      return deletedCount;
    }
  }

  /**
   * Get disk usage statistics
   */
  static async getDiskUsage(): Promise<{ totalFiles: number; totalSizeMB: number }> {
    let totalFiles = 0;
    let totalSizeBytes = 0;

    try {
      if (!fs.existsSync(UPLOAD_BASE_DIR)) {
        return { totalFiles: 0, totalSizeMB: 0 };
      }

      const dateFolders = fs.readdirSync(UPLOAD_BASE_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      for (const dateFolder of dateFolders) {
        const folderPath = path.join(UPLOAD_BASE_DIR, dateFolder);
        const files = fs.readdirSync(folderPath);

        for (const file of files) {
          const filePath = path.join(folderPath, file);
          const stats = fs.statSync(filePath);
          totalFiles++;
          totalSizeBytes += stats.size;
        }
      }

      return {
        totalFiles,
        totalSizeMB: parseFloat((totalSizeBytes / 1024 / 1024).toFixed(2)),
      };
    } catch (error) {
      console.error('[ImageUpload] ❌ Failed to get disk usage:', error);
      return { totalFiles: 0, totalSizeMB: 0 };
    }
  }
}
