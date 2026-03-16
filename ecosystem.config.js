module.exports = {
  apps: [
    {
      name: "bmr-backend",
      script: "server.js",
      instances: 2,              // Run 2 instances (adjust based on CPU cores)
      exec_mode: "cluster",      // Better performance than fork
      watch: false,              // Disable in production
      max_memory_restart: "500M",

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
