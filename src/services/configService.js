import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import questConfigCache from '../cache/QuestConfigCache.js';

export class ConfigService {
  
  // Utility: Exponential backoff retry wrapper
  // Retries the provided async operation a limited number of times with increasing delays
  static async retryWithBackoff(operation, description = 'operation', options = {}) {
    const {
      retries = 2,          // total retries after the first attempt (=> up to 3 tries)
      baseDelayMs = 200,    // initial delay
      factor = 2,           // backoff multiplier
      maxDelayMs = 2000,    // max cap for delay
      jitter = true         // add jitter to avoid thundering herd
    } = options;
    
    let attempt = 0;
    let delay = baseDelayMs;
    let lastError = null;
    
    while (attempt <= retries) {
      try {
        if (attempt > 0) {
          console.log(`🔁 [Retry] Attempt ${attempt + 1}/${retries + 1} for ${description}`);
        }
        const result = await operation();
        if (result !== null && result !== undefined) {
          if (attempt > 0) {
            console.log(`✅ [Retry] Succeeded ${description} on attempt ${attempt + 1}`);
          }
          return result;
        }
        // Treat null/undefined as a retryable miss
        lastError = new Error(`${description} returned no result`);
        throw lastError;
      } catch (error) {
        lastError = error;
        if (attempt === retries) {
          console.warn(`❌ [Retry] ${description} failed after ${attempt + 1} attempts: ${error.message}`);
          break;
        }
        // Wait with backoff
        const waitMs = Math.min(delay, maxDelayMs) + (jitter ? Math.floor(Math.random() * 100) : 0);
        console.warn(`⏳ [Retry] ${description} failed (attempt ${attempt + 1}/${retries + 1}): ${error.message}. Retrying in ${waitMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        delay = Math.min(delay * factor, maxDelayMs);
        attempt++;
      }
    }
    return null;
  }
  
  // NEW: Save config to database (safe - doesn't break anything)
  static async saveConfigToDatabase(groupId, configData) {
    try {
      console.log(`💾 [ConfigService] Attempting to save config to database for: ${groupId}`);
      
      // Use the main OSS-Doorway database connection (same as URI/DB_NAME)
      const ossDoorwayURI = process.env.URI;
      const ossDoorwayDBName = process.env.DB_NAME;
      
      if (!ossDoorwayURI || !ossDoorwayDBName) {
        console.warn(`⚠️ [ConfigService] Main database credentials not found, skipping database save`);
        return false;
      }
      
      // Create connection to main OSS-Doorway database
      const connection = mongoose.createConnection(`${ossDoorwayURI}/${ossDoorwayDBName}`);
      
      // Define QuestConfig schema for this connection
      const questConfigSchema = new mongoose.Schema({
        groupId: String,
        configData: Object,
        createdAt: Date,
        updatedAt: Date,
        source: String
      }, { collection: 'questconfigs' });
      
      const QuestConfig = connection.model('QuestConfig', questConfigSchema);
      
      // Save the config
      await QuestConfig.findOneAndUpdate(
        { groupId },
        { 
          configData,
          updatedAt: new Date(),
          source: 'database'
        },
        { upsert: true, new: true }
      );
      
      // Close connection
      await connection.close();
      
      // Invalidate both raw and processed cache for this groupId since config was updated
      const rawCacheKey = `quest-config-${groupId}`;
      const processedCacheKey = `processed-quest-config-${groupId}`;
      
      if (questConfigCache.has(rawCacheKey)) {
        questConfigCache.delete(rawCacheKey);
        console.log(`🗑️ [ConfigService] Invalidated raw cache for updated config: ${groupId}`);
      }
      
      if (questConfigCache.has(processedCacheKey)) {
        questConfigCache.delete(processedCacheKey);
        console.log(`🗑️ [ConfigService] Invalidated processed cache for updated config: ${groupId}`);
      }
      
      console.log(`✅ [ConfigService] Successfully saved config to database for: ${groupId}`);
      return true;
    } catch (error) {
      console.error(`❌ [ConfigService] Failed to save config to database for ${groupId}:`, error.message);
      // Don't throw - this is optional functionality
      return false;
    }
  }

  // NEW: Load config from database (safe - doesn't break anything)
  static async loadConfigFromDatabase(groupId) {
    try {
      console.log(`🔍 [ConfigService] Attempting to load config from database for: ${groupId}`);
      
      // Use the main OSS-Doorway database connection (same as URI/DB_NAME)
      const ossDoorwayURI = process.env.URI;
      const ossDoorwayDBName = process.env.DB_NAME;
      
      if (!ossDoorwayURI || !ossDoorwayDBName) {
        console.warn(`⚠️ [ConfigService] Main database credentials not found, skipping database lookup`);
        return null;
      }
      
      // Create connection to main OSS-Doorway database
      const connection = mongoose.createConnection(`${ossDoorwayURI}/${ossDoorwayDBName}`);
      
      // Define QuestConfig schema for this connection - handle both schema types
      const questConfigSchema = new mongoose.Schema({
        groupId: String,     // Legacy schema field
        configId: String,    // New schema field (has unique index)
        classId: String,     // Class/group identifier
        configData: Object,  // Legacy schema field
        config: mongoose.Schema.Types.Mixed,      // Mixed type to handle both Object and String
        createdAt: Date,
        updatedAt: Date,
        source: String,      // Legacy schema field
        createdBy: String,   // New schema field
        originalFilePath: String, // New schema field
        version: Number      // New schema field
      }, { collection: 'questconfigs' });
      
      const QuestConfig = connection.model('QuestConfig', questConfigSchema);
      
      // Find the config using multiple field types to handle schema inconsistencies
      const config = await QuestConfig.findOne({
        $or: [
          { groupId: groupId },
          { configId: groupId },
          { classId: groupId }
        ]
      });
      
      // Close connection
      await connection.close();
      
      if (config) {
        console.log(`✅ [ConfigService] Successfully loaded config from database for: ${groupId}`);
        
        // Get the config data from either field
        let configData = config.configData || config.config;
        
        // If config field is a string (JSON), parse it
        if (typeof configData === 'string') {
          try {
            configData = JSON.parse(configData);
            console.log(`🔧 [ConfigService] Parsed string config to object for: ${groupId}`);
          } catch (parseError) {
            console.error(`❌ [ConfigService] Failed to parse config JSON for ${groupId}:`, parseError.message);
            return null;
          }
        }
        
        return configData;
      }
      
      console.log(`⚠️ [ConfigService] No config found in database for: ${groupId}`);
      return null;
    } catch (error) {
      console.error(`❌ [ConfigService] Failed to load config from database for ${groupId}:`, error.message);
      return null;
    }
  }

  // EXISTING: Keep original file system loading (100% safe)
  static loadConfigFromFile(groupId) {
    try {
      const configPath = path.join(process.cwd(), 'src/config/generated', `quest_config_${groupId}.json`);
      console.log(`🔍 [ConfigService] Attempting to load config from file: ${configPath}`);
      
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(content);
        console.log(`✅ [ConfigService] Successfully loaded config from file for: ${groupId}`);
        return config;
      }
      
      console.log(`⚠️ [ConfigService] Config file not found for: ${groupId}`);
      return null;
    } catch (error) {
      console.error(`❌ [ConfigService] Failed to load config from file for ${groupId}:`, error.message);
      return null;
    }
  }

  // NEW: Hybrid loader with multiple fallbacks + caching (very safe)
  static async loadConfig(groupId) {
    const startTime = Date.now();
    console.log(`🔍 [ConfigService] Loading config for: ${groupId}`);
    
    // Priority 0: Check cache first (fastest)
    const cacheKey = `quest-config-${groupId}`;
    if (questConfigCache.has(cacheKey)) {
      const cachedConfig = questConfigCache.get(cacheKey);
      const duration = Date.now() - startTime;
      console.log(`⚡ [ConfigService] Config for "${groupId}" served from cache in ${duration}ms`);
      return cachedConfig;
    }
    
    // Priority 1: Try database (new functionality) with exponential backoff
    try {
      console.log(`🐌 [ConfigService] Cache miss for "${groupId}", querying database with retries...`);
      console.time(`db-query-${groupId}`);
      
      const dbConfig = await this.retryWithBackoff(
        async () => await this.loadConfigFromDatabase(groupId),
        `database lookup for ${groupId}`,
        { retries: 4, baseDelayMs: 250, factor: 2, maxDelayMs: 2000, jitter: true }
      );
      console.timeEnd(`db-query-${groupId}`);
      
      if (dbConfig) {
        const duration = Date.now() - startTime;
        console.log(`✅ [ConfigService] Database config loaded for "${groupId}" in ${duration}ms`);
        
        // Store in cache for future requests (1 hour TTL)
        console.log(`💾 [ConfigService] Caching config for "${groupId}" (1 hour TTL)`);
        questConfigCache.set(cacheKey, dbConfig, 3600000); // 1 hour
        
        return dbConfig;
      }
    } catch (error) {
      console.warn(`⚠️ [ConfigService] Database lookup failed for ${groupId}, continuing with file fallback:`, error.message);
    }

    // Priority 2: Fallback to file system (existing functionality) with limited retry
    try {
      console.log(`📁 [ConfigService] Trying file system for "${groupId}" with retries...`);
      console.time(`file-read-${groupId}`);
      
      const fileConfig = await this.retryWithBackoff(
        async () => this.loadConfigFromFile(groupId),
        `file system read for ${groupId}`,
        { retries: 1, baseDelayMs: 150, factor: 2, maxDelayMs: 600, jitter: true }
      );
      console.timeEnd(`file-read-${groupId}`);
      
      if (fileConfig) {
        const duration = Date.now() - startTime;
        console.log(`✅ [ConfigService] File config loaded for "${groupId}" in ${duration}ms`);
        
        // Store in cache for future requests (1 hour TTL)
        console.log(`💾 [ConfigService] Caching file config for "${groupId}" (1 hour TTL)`);
        questConfigCache.set(cacheKey, fileConfig, 3600000); // 1 hour
        
        // Auto-migrate to database for future use (safe - won't break if it fails)
        try {
          const migrated = await this.saveConfigToDatabase(groupId, fileConfig);
          if (migrated) {
            console.log(`🔄 [ConfigService] Auto-migrated file config to database for: ${groupId}`);
          }
        } catch (migrationError) {
          console.warn(`⚠️ [ConfigService] Auto-migration failed for ${groupId} (this is not critical):`, migrationError.message);
        }
        
        return fileConfig;
      }
    } catch (error) {
      console.warn(`⚠️ [ConfigService] File lookup failed for ${groupId}:`, error.message);
    }

    // Priority 3: No config found
    const duration = Date.now() - startTime;
    console.log(`⚠️ [ConfigService] No config found for: ${groupId} after ${duration}ms (will use default)`);
    return null;
  }

  // Cache management utilities
  static getCacheStats() {
    return questConfigCache.getStats();
  }

  static logCacheStatus() {
    questConfigCache.logStatus();
  }

  static clearCache() {
    questConfigCache.clear();
  }

  static deleteCacheKey(groupId) {
    const cacheKey = `quest-config-${groupId}`;
    return questConfigCache.delete(cacheKey);
  }

  // Direct cache access methods
  static has(key) {
    return questConfigCache.has(key);
  }

  static get(key) {
    return questConfigCache.get(key);
  }

  static set(key, value, ttl = 3600000) {
    return questConfigCache.set(key, value, ttl);
  }

  static async testCache() {
    return await questConfigCache.testCache();
  }

  // High-level cache management for processed quest configs
  static deleteProcessedQuestConfigCache(groupId) {
    const cacheKey = `processed-quest-config-${groupId || 'default'}`;
    return questConfigCache.delete(cacheKey);
  }

  static clearProcessedQuestConfigCache() {
    // Clear all processed quest config cache entries
    const stats = questConfigCache.getStats();
    let cleared = 0;
    
    stats.cacheContents.forEach(item => {
      if (item.key.startsWith('processed-quest-config-')) {
        questConfigCache.delete(item.key);
        cleared++;
      }
    });
    
    console.log(`🧹 [ConfigService] Cleared ${cleared} processed quest config cache entries`);
    return cleared;
  }
}
