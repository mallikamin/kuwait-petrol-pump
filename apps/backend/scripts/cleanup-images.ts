#!/usr/bin/env node
/**
 * Image Cleanup Script
 *
 * Deletes meter reading images older than specified days.
 * Run via cron: 0 3 * * * cd ~/kuwait-pos/apps/backend && npx ts-node scripts/cleanup-images.ts
 */

import { ImageUploadService } from '../src/modules/meter-readings/image-upload.service';

const DAYS_TO_KEEP = process.env.IMAGE_RETENTION_DAYS
  ? parseInt(process.env.IMAGE_RETENTION_DAYS)
  : 90;

async function main() {
  console.log(`[Cleanup] Starting image cleanup (retention: ${DAYS_TO_KEEP} days)...`);

  try {
    const deletedCount = await ImageUploadService.cleanupOldImages(DAYS_TO_KEEP);

    if (deletedCount > 0) {
      console.log(`[Cleanup] ✅ Success: Deleted ${deletedCount} old images`);
    } else {
      console.log(`[Cleanup] ℹ️  No images to clean up`);
    }

    // Show disk usage after cleanup
    const stats = await ImageUploadService.getDiskUsage();
    console.log(`[Cleanup] 📊 Current usage: ${stats.totalFiles} files, ${stats.totalSizeMB}MB`);

    process.exit(0);
  } catch (error) {
    console.error('[Cleanup] ❌ Failed:', error);
    process.exit(1);
  }
}

main();
