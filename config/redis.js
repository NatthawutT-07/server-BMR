// config/redis.js
const Redis = require('ioredis');

// ถ้า run local, ใช้ default ได้เลย
const redis = new Redis(); 

module.exports = redis;
