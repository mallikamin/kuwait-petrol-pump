import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'meter-readings');

/**
 * Initialize upload directory
 */
export function initializeUploadDirectory(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    console.log(`📁 Created upload directory: ${UPLOAD_DIR}`);
  }
}

/**
 * Save base64 image to disk for audit trail
 * Returns the relative file path to store in database
 */
export async function saveBase64Image(
  base64Data: string,
  metadata?: {
    nozzleId?: string;
    userId?: string;
    readingType?: string;
  }
): Promise<string> {
  try {
    // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
    const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, '');

    // Generate unique filename with timestamp and UUID
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const uniqueId = randomUUID().substring(0, 8);
    const filename = `meter-reading_${timestamp}_${uniqueId}.jpg`;

    // Full path to save file
    const filePath = path.join(UPLOAD_DIR, filename);

    // Convert base64 to buffer and write to disk
    const buffer = Buffer.from(base64Image, 'base64');
    await fs.promises.writeFile(filePath, buffer);

    // Return relative path for database storage
    const relativePath = `/uploads/meter-readings/${filename}`;

    console.log(`✅ Saved meter reading image: ${filename} (${Math.round(buffer.length / 1024)}KB)`);

    return relativePath;
  } catch (error) {
    console.error('❌ Error saving image:', error);
    throw new Error('Failed to save meter reading image');
  }
}

/**
 * Get full path to image file
 */
export function getImagePath(relativePath: string): string {
  return path.join(process.cwd(), relativePath);
}

/**
 * Check if image file exists
 */
export function imageExists(relativePath: string): boolean {
  const fullPath = getImagePath(relativePath);
  return fs.existsSync(fullPath);
}

/**
 * Delete image file (for cleanup if needed)
 */
export async function deleteImage(relativePath: string): Promise<void> {
  const fullPath = getImagePath(relativePath);
  if (fs.existsSync(fullPath)) {
    await fs.promises.unlink(fullPath);
    console.log(`🗑️  Deleted image: ${relativePath}`);
  }
}
