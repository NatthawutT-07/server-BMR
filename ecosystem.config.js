module.exports = {
  apps: [
    {
      name: "bmr-backend",
      script: "server.js",
      instances: 1,              // For 1 vCPU, 1 instance is optimal
      exec_mode: "fork",         // Fork mode is better for single instance
      watch: false,              // Disable in production
      max_memory_restart: "800M", // Increased slightly since it's only 1 process on 2GB RAM

      // Environment
      env: {
        NODE_ENV: "development",
        PORT: 5001,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 5001,
      },

      // Logging
      log_file: "./logs/combined.log",
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // Auto-restart
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 4000,

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
    },
  ],
};
