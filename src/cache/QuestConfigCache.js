/**
 * Simple In-Memory Cache for Quest Configurations
 * Stores configurations for 1 hour with comprehensive logging
 */
export class QuestConfigCache {
  constructor() {
    this.cache = new Map();
    this.timers = new Map();
    this.stats = {
      hits: 0,      // Cache hits (served from cache)
      misses: 0,    // Cache misses (had to query database)
      sets: 0,      // Times data was stored in cache
      expires: 0    // Times data expired from cache
    };
    
    console.log('🚀 [CACHE] QuestConfigCache initialized');
  }

  /**
   * Store a configuration in cache with TTL
   * @param {string} key - Cache key (usually groupId)
   * @param {Object} value - Quest configuration object
   * @param {number} ttl - Time to live in milliseconds (default: 1 hour)
   */
  set(key, value, ttl = 3600000) { // 1 hour = 3600000ms
    console.log(`🟢 [CACHE SET] Key: "${key}", TTL: ${ttl}ms (${ttl/60000} minutes)`);
    this.stats.sets++;
    
    // Clear existing timer if any
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      console.log(`🔄 [CACHE SET] Cleared existing timer for key: "${key}"`);
    }

    // Store the value
    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl
    });

    // Set expiration timer
    const timer = setTimeout(() => {
      console.log(`⏰ [CACHE EXPIRE] Key: "${key}" expired and removed from cache`);
      this.cache.delete(key);
      this.timers.delete(key);
      this.stats.expires++;
    }, ttl);

    this.timers.set(key, timer);
    
    console.log(`✅ [CACHE SET] Successfully cached config for "${key}" (expires: ${new Date(Date.now() + ttl).toISOString()})`);
  }

  /**
   * Retrieve a configuration from cache
   * @param {string} key - Cache key
   * @returns {Object|null} Quest configuration or null if not found/expired
   */
  get(key) {
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      
      // Double-check expiration (redundant safety)
      if (Date.now() > cached.expiresAt) {
        console.log(`⏰ [CACHE EXPIRED] Key: "${key}" expired during get(), removing`);
        this.delete(key);
        this.stats.misses++;
        return null;
      }
      
      const ageMinutes = ((Date.now() - cached.timestamp) / 60000).toFixed(1);
      console.log(`✅ [CACHE HIT] Key: "${key}" served from cache (age: ${ageMinutes} minutes)`);
      this.stats.hits++;
      return cached.data;
    } else {
      console.log(`❌ [CACHE MISS] Key: "${key}" not found in cache`);
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Check if a key exists in cache
   * @param {string} key - Cache key
   * @returns {boolean} True if key exists and not expired
   */
  has(key) {
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      
      // Check if expired
      if (Date.now() > cached.expiresAt) {
        console.log(`⏰ [CACHE EXPIRED] Key: "${key}" expired during has(), removing`);
        this.delete(key);
        return false;
      }
      
      return true;
    }
    return false;
  }

  /**
   * Manually delete a key from cache
   * @param {string} key - Cache key to delete
   */
  delete(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    
    const existed = this.cache.delete(key);
    if (existed) {
      console.log(`🗑️ [CACHE DELETE] Manually removed key: "${key}"`);
    }
    return existed;
  }

  /**
   * Clear all cached data
   */
  clear() {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    
    const size = this.cache.size;
    this.cache.clear();
    this.timers.clear();
    
    console.log(`🧹 [CACHE CLEAR] Cleared ${size} cached configurations`);
  }

  /**
   * Get detailed cache statistics
   * @returns {Object} Cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 0;
    
    // Get detailed cache contents
    const cacheContents = [];
    for (const [key, value] of this.cache.entries()) {
      const ageMinutes = ((Date.now() - value.timestamp) / 60000).toFixed(1);
      const remainingMinutes = ((value.expiresAt - Date.now()) / 60000).toFixed(1);
      cacheContents.push({
        key,
        age: `${ageMinutes} min`,
        remaining: `${remainingMinutes} min`,
        expires: new Date(value.expiresAt).toISOString()
      });
    }
    
    return {
      ...this.stats,
      totalRequests: total,
      hitRate: `${hitRate}%`,
      currentSize: this.cache.size,
      maxSize: 'unlimited',
      cacheContents,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Log current cache status to console
   */
  logStatus() {
    const stats = this.getStats();
    console.log('📊 [CACHE STATUS]', {
      hits: stats.hits,
      misses: stats.misses,
      hitRate: stats.hitRate,
      currentSize: stats.currentSize,
      totalRequests: stats.totalRequests
    });
    
    if (stats.cacheContents.length > 0) {
      console.log('📋 [CACHE CONTENTS]');
      stats.cacheContents.forEach(item => {
        console.log(`  "${item.key}" - age: ${item.age}, remaining: ${item.remaining}`);
      });
    } else {
      console.log('📭 [CACHE CONTENTS] Empty');
    }
  }

  /**
   * Test the cache functionality
   * @param {string} testKey - Key to use for testing
   * @param {Object} testData - Data to cache for testing
   */
  async testCache(testKey = 'test-config', testData = { test: true, timestamp: Date.now() }) {
    console.log('\n🧪 [CACHE TEST] Starting cache functionality test...');
    
    // Clear test key if exists
    this.delete(testKey);
    
    // Test 1: Cache miss
    console.log('\n--- Test 1: Cache Miss ---');
    const miss = this.get(testKey);
    console.log(`Expected: null, Got: ${miss}`);
    
    // Test 2: Cache set
    console.log('\n--- Test 2: Cache Set ---');
    this.set(testKey, testData, 5000); // 5 second TTL for testing
    
    // Test 3: Cache hit
    console.log('\n--- Test 3: Cache Hit ---');
    const hit = this.get(testKey);
    console.log(`Expected: object, Got: ${hit ? 'object' : 'null'}`);
    console.log(`Data matches: ${JSON.stringify(hit) === JSON.stringify(testData)}`);
    
    // Test 4: Cache stats
    console.log('\n--- Test 4: Cache Stats ---');
    this.logStatus();
    
    // Test 5: Auto-expiration (wait 6 seconds)
    console.log('\n--- Test 5: Auto-expiration (waiting 6 seconds...) ---');
    await new Promise(resolve => setTimeout(resolve, 6000));
    const expired = this.get(testKey);
    console.log(`Expected: null (expired), Got: ${expired}`);
    
    console.log('\n✅ [CACHE TEST] Test complete!');
    this.logStatus();
  }
}

// Create global cache instance
const questConfigCache = new QuestConfigCache();

export default questConfigCache;
