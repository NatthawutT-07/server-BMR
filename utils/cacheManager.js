const NodeCache = require("node-cache");
class CacheManager {
  constructor() {
    this.caches = {};
  }

  getCache(name, options = { stdTTL: 60 }) {
    if (!this.caches[name]) {
      this.caches[name] = new NodeCache(options);
      console.log(`[CacheManager] Created new cache: ${name} (TTL: ${options.stdTTL}s)`);
    }
    return this.caches[name];
  }

  clearCache(name) {
    if (this.caches[name]) {
      this.caches[name].flushAll();
      console.log(`[CacheManager] Cleared cache: ${name}`);
    }
  }

  clearAll() {
    Object.keys(this.caches).forEach(name => {
      this.caches[name].flushAll();
    });
    console.log(`[CacheManager] Cleared all caches`);
  }
}

// Export as singleton
module.exports = new CacheManager();
