module.exports = {
  apps: [
    {
      name: 'whatsapp-count-me-in',
      script: 'node',
      args: 'dist/index.js',
      watch: false,
      autorestart: true,
      restart_delay: 5000,       // wait 5s before restarting after a crash
      max_restarts: 10,          // give up after 10 consecutive crashes
      min_uptime: '10s',         // process must stay up 10s to count as stable
      max_memory_restart: '800M', // restart if RAM goes above 800MB (protect the 1GB Oracle VM)
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
    },
  ],
};
