module.exports = {
  apps: [
    {
      name: "aotesys.com",
      cwd: "/var/www/vhosts/aotesys.com/current",
      script: "/usr/bin/node",
      args: "server.js --production",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "5174"
      }
    }
  ]
};
