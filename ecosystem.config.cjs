module.exports = {
  apps: [
    {
      name: "flowpoint-api",
      script: "./artifacts/api-server/dist/index.mjs",
      instances: "max",
      exec_mode: "cluster",
      interpreter: "node",
      interpreter_args: "--experimental-vm-modules",
      env: {
        NODE_ENV: "production",
        PORT: 8080,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 8080,
      },
      max_memory_restart: "512M",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      listen_timeout: 10000,
      kill_timeout: 5000,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/api-error.log",
      out_file: "./logs/api-out.log",
      merge_logs: true,
      autorestart: true,
      watch: false,
    },
  ],
};
