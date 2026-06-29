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
sudo install -o root -g root -m 0644 deploy/aotesys.service /etc/systemd/system/aotesys.service
sudo systemctl daemon-reload
sudo systemctl enable aotesys.service
```

Place production secrets in:

```sh
/var/www/vhosts/aotesys.com/shared/.env
```

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
