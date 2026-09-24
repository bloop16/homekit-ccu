[🇬🇧 English](../development.md) | 🇩🇪 Deutsch

# Entwicklung

```bash
npm install          # install dependencies (Node.js 22.12 or newer, see .nvmrc)
npm test             # run tests
npm run lint         # neostandard (ESLint 9), enforced in CI
npm run coverage     # c8, at least 80 % for the camera code
node index.js -D     # run in debug mode (expects CCU on localhost)
node index.js -D -H <host>  # run against remote CCU
```

## Devcontainer

Ein Devcontainer in `.devcontainer/` stellt eine vollständige OpenCCU-Umgebung zum Entwickeln und Debuggen bereit. Er startet mit Podman einen einzelnen Container auf Basis des OpenCCU-Images (das Node.js 22 mitbringt).

## Nützliche Befehle zur Fehlersuche

```shell

# re-deploy lighttpd conf
cp /usr/local/addons/homekit-ccu/node_modules/homekit-ccu/etc/homekit_ccu.conf /usr/local/etc/config/lighttpd/homekit-ccu.conf
# /etc/config -> ../usr/local/etc/config

# validate lighttpd config (catches syntax errors before restart)
lighttpd -t -f /etc/lighttpd/lighttpd.conf

# kill and restart lighttpd proxy
killall lighttpd; sleep 1; lighttpd -f /etc/lighttpd/lighttpd.conf

# print current lighttpd config
lighttpd -p -f /etc/lighttpd/lighttpd.conf 2>&1

# handle homekit-ccu daemon 
/usr/local/etc/config/rc.d/homekit-ccu restart
/usr/local/etc/config/rc.d/homekit-ccu stop 
/usr/local/etc/config/rc.d/homekit-ccu start

# serve 
node /usr/local/addons/homekit-ccu/node_modules/homekit-ccu/index.js -D 

# kill and restart homekit-ccu server
pkill -f 'node.*index.js' 2>/dev/null; sleep 1; node /usr/local/addons/homekit-ccu/node_modules/homekit-ccu/index.js -D 

# check if server is running 
curl -v http://127.0.0.1:9874/ 2>&1 | head -20

# Check if ports are open
netstat -tlnp | grep 9874

# check if ReGaHSS Remote Script API is available
curl -X POST -d "dom.GetObject(\"HmIP-RF\");" http://127.0.0.1:8181/rega.exe
# With login
curl -X POST -u "<admin-user>:<admin-password>" -d "dom.GetObject(\"HmIP-RF\");" http://127.0.0.1:8181/rega.exe

ls /usr/local/etc/config/addons/homekit-ccu/

tail -f /var/log/homekit-ccu.log 
```


## Releases

1. Setze die Version in `package.json`, `package-lock.json` (`npm version <version> --no-git-tag-version`) und `VER=` in `addon_installer/homekit-ccu`, committe und pushe nach `master`.
2. Starte das Release auf einem der beiden Wege:
   - Tag pushen: `git tag -a v<version> -m "<version>" && git push origin v<version>`
   - oder GitHub → Actions → Release → „Run workflow“ auf `master`; der Workflow legt den Tag `v<version>` selbst an.

Der Workflow testet, baut das Add-on-Paket und veröffentlicht es; eine Version mit `-` (z. B. `0.1.0-rc.8`) wird zum Pre-Release. Der Release-Text ist der Abschnitt der Version in CHANGELOG.md; vor einem endgültigen Release dort das Datum eintragen.
