# Aotesys Deploy

The CI jobs build the app, package the production files into
`aotesys-release.tgz`, upload it to the server, then run:

```sh
sudo /usr/local/sbin/aotesys-deploy /tmp/aotesys-release.tgz
```

Server setup:

```sh
sudo mkdir -p /var/www/vhosts/aotesys.com/shared
sudo install -o root -g root -m 0755 deploy/aotesys-deploy /usr/local/sbin/aotesys-deploy
sudo install -o root -g root -m 0440 deploy/sudoers.d/loopy /etc/sudoers.d/loopy
sudo visudo -cf /etc/sudoers.d/loopy
```

The deploy script uses PM2 and only starts or reloads the process named
`aotesys.com`. It does not run `pm2 restart all`, and it does not touch the
existing `/var/www/vhosts/oceanviewholidaypark` or
`/var/www/vhosts/PublicPatrol-WebUI` applications.

Place production secrets in:

```sh
/var/www/vhosts/aotesys.com/shared/.env
```

The included PM2 ecosystem file defaults to `127.0.0.1:5174`. Point the
`aotesys.com` virtual host or reverse proxy at that local port.

GitHub repository secrets:

- `DEPLOY_HOST`
- `DEPLOY_PORT` optional, defaults to `22`
- `DEPLOY_USER` optional, defaults to `loopy`
- `DEPLOY_SSH_KEY`

GitLab CI/CD variables:

- `DEPLOY_HOST`
- `DEPLOY_PORT` optional, defaults to `22`
- `DEPLOY_USER` optional, defaults to `loopy`
- `DEPLOY_SSH_KEY`
