#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

interface PulumiConfig {
  config: {
    'gcp:project': string;
    'gcp:region': string;
  };
}

interface ImageInfo {
  digest: string;
  timestamp: string;
  tags: string[];
}

class GCRImageCleanup {
  private projectId: string;
  private region: string;
  private imageName: string;
  private keepCount: number;
  private registry: string;

  constructor() {
    // Load Pulumi configuration
    const pulumiConfig = this.loadPulumiConfig();
    this.projectId = pulumiConfig.config['gcp:project'];
    this.region = pulumiConfig.config['gcp:region'];
    
    // Configuration
    this.imageName = process.env.IMAGE_NAME || 'tpl-scraper';
    this.keepCount = parseInt(process.env.KEEP_COUNT || '2');
    this.registry = process.env.REGISTRY || 'gcr.io';

    console.log(`🚀 GCR Cleanup Configuration:`);
    console.log(`   Project ID: ${this.projectId}`);
    console.log(`   Region: ${this.region}`);
    console.log(`   Image: ${this.registry}/${this.projectId}/${this.imageName}`);
    console.log(`   Keep Count: ${this.keepCount}`);
    console.log('');
  }

  private loadPulumiConfig(): PulumiConfig {
    const pulumiDir = path.join(__dirname, '..', 'pulumi');
    const configPath = path.join(pulumiDir, 'Pulumi.dev.yaml');
    
    if (!fs.existsSync(configPath)) {
      throw new Error(`Pulumi config file not found at: ${configPath}`);
    }

    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(configContent) as PulumiConfig;
    
    if (!config.config || !config.config['gcp:project']) {
      throw new Error('Invalid Pulumi configuration: missing gcp:project');
    }

    return config;
  }

  private executeCommand(command: string): string {
    try {
      return execSync(command, { encoding: 'utf8', stdio: 'pipe' });
    } catch (error: any) {
      if (error.status === 1 && error.stderr.includes('Listed 0 items')) {
        return '';
      }
      throw new Error(`Command failed: ${command}\n${error.stderr}`);
    }
  }

  private checkAuthentication(): void {
    try {
      const result = this.executeCommand('gcloud auth list --filter=status:ACTIVE --format="value(account)"');
      if (!result.trim()) {
        throw new Error('No active gcloud authentication found. Please run: gcloud auth login');
      }
      console.log(`✅ Authenticated as: ${result.trim()}`);
    } catch (error) {
      console.error('❌ Authentication check failed:', error);
      process.exit(1);
    }
  }

  private async getImageList(): Promise<ImageInfo[]> {
    console.log('📋 Fetching image list...');
    
    const command = `gcloud container images list-tags ${this.registry}/${this.projectId}/${this.imageName} ` +
                   `--limit=999 --sort-by=~TIMESTAMP --format="json" --filter="tags:*"`;
    
    const output = this.executeCommand(command);
    
    if (!output.trim()) {
      return [];
    }

    const images = JSON.parse(output) as any[];
    return images.map(img => ({
      digest: img.digest,
      timestamp: img.timestamp.datetime,
      tags: img.tags || []
    }));
  }

  private async deleteImage(digest: string): Promise<boolean> {
    try {
      const command = `gcloud container images delete ${this.registry}/${this.projectId}/${this.imageName}@${digest} --quiet`;
      this.executeCommand(command);
      return true;
    } catch (error) {
      console.error(`❌ Failed to delete image with digest: ${digest}`);
      return false;
    }
  }

  private async getUntaggedImages(): Promise<string[]> {
    console.log('🔍 Fetching untagged images...');
    
    const command = `gcloud container images list-tags ${this.registry}/${this.projectId}/${this.imageName} ` +
                   `--limit=999 --format="value(digest)" --filter="-tags:*"`;
    
    const output = this.executeCommand(command);
    
    if (!output.trim()) {
      return [];
    }

    return output.trim().split('\n').filter(digest => digest.trim());
  }

  public async cleanup(): Promise<void> {
    try {
      // Check authentication
      this.checkAuthentication();

      // Get all tagged images
      const images = await this.getImageList();
      
      if (images.length === 0) {
        console.log(`⚠️  No tagged images found for ${this.imageName}`);
        return;
      }

      console.log(`📊 Found ${images.length} tagged images`);

      if (images.length <= this.keepCount) {
        console.log(`✅ Only ${images.length} images found, nothing to delete (keeping ${this.keepCount})`);
        return;
      }

      // Calculate images to delete
      const deleteCount = images.length - this.keepCount;
      const imagesToDelete = images.slice(this.keepCount);
      
      console.log(`🗑️  Will delete ${deleteCount} old images`);
      console.log('');

      // Delete old images
      let deletedCount = 0;
      for (const image of imagesToDelete) {
        const tags = image.tags.length > 0 ? `[${image.tags.join(', ')}]` : '[untagged]';
        console.log(`🗑️  Deleting image ${tags} (${image.timestamp})`);
        
        if (await this.deleteImage(image.digest)) {
          deletedCount++;
        }
      }

      console.log('');
      console.log(`✅ Cleanup completed! Deleted ${deletedCount}/${deleteCount} images`);
      console.log(`✅ Kept ${this.keepCount} most recent images`);

      // Ask about untagged images
      await this.cleanupUntaggedImages();

    } catch (error) {
      console.error('❌ Cleanup failed:', error);
      process.exit(1);
    }
  }

  private async cleanupUntaggedImages(): Promise<void> {
    const untaggedImages = await this.getUntaggedImages();
    
    if (untaggedImages.length === 0) {
      console.log('ℹ️  No untagged images found');
      return;
    }

    console.log(`🔍 Found ${untaggedImages.length} untagged images`);
    
    // For automated cleanup, you can set CLEANUP_UNTAGGED=true
    const shouldCleanup = process.env.CLEANUP_UNTAGGED === 'true' || 
                         process.argv.includes('--cleanup-untagged');

    if (!shouldCleanup) {
      console.log('ℹ️  Skipping untagged images cleanup. Use --cleanup-untagged flag or set CLEANUP_UNTAGGED=true to clean them up');
      return;
    }

    console.log('🧹 Cleaning up untagged images...');
    let deletedCount = 0;

    for (const digest of untaggedImages) {
      console.log(`🗑️  Deleting untagged image: ${digest.substring(0, 12)}...`);
      if (await this.deleteImage(digest)) {
        deletedCount++;
      }
    }

    console.log(`✅ Untagged images cleanup completed! Deleted ${deletedCount}/${untaggedImages.length} images`);
  }
}

// Main execution
async function main() {
  console.log('🧹 GCR Image Cleanup Tool');
  console.log('========================');
  console.log('');

  const cleanup = new GCRImageCleanup();
  await cleanup.cleanup();
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
} 