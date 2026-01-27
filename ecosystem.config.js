// ============================================
// BMR Server - PM2 Configuration
// ============================================
// Usage:
//   pm2 start ecosystem.config.js      # Start server
//   pm2 restart bmr-backend            # Restart
//   pm2 logs bmr-backend               # View logs
//   pm2 monit                          # Monitor
//   pm2 save                           # Save process list
//   pm2 startup                        # Auto-start on boot
// ============================================

module.exports = {
    apps: [
        {
            name: "bmr-backend",
            script: "server.js",
            instances: 2,              // หรือ "max" สำหรับ cluster mode
            exec_mode: "fork",         // "fork" หรือ "cluster"
            watch: false,              // ปิด watch ใน production
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
