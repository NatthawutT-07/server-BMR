const NodeCache = require("node-cache");

/**
 * CacheManager - Centralized cache management
 */
class CacheManager {
  constructor() {
    this.caches = {};
  }

  /**
   * Get or create a cache instance
   * @param {string} name - Unique name for the cache namespace
   * @param {object} options - NodeCache options
   * @returns {NodeCache}
   */
  getCache(name, options = { stdTTL: 60 }) {
    if (!this.caches[name]) {
      this.caches[name] = new NodeCache(options);
      console.log(`[CacheManager] Created new cache: ${name} (TTL: ${options.stdTTL}s)`);
    }
    return this.caches[name];
  }

  /**
   * Clear a specific cache
   * @param {string} name 
   */
  clearCache(name) {
    if (this.caches[name]) {
      this.caches[name].flushAll();
      console.log(`[CacheManager] Cleared cache: ${name}`);
    }
  }

  /**
   * Clear all caches
   */
  clearAll() {
    Object.keys(this.caches).forEach(name => {
      this.caches[name].flushAll();
    });
    console.log(`[CacheManager] Cleared all caches`);
  }
}

// Export as singleton
module.exports = new CacheManager();
