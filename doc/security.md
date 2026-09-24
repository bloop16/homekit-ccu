# Authentication and HTTPS

## Authentication

The configuration UI and its API (ports 9874/49874 on the CCU, 9874 in remote mode) can be reached by every device in your network. They show the HomeKit pairing codes, download backups that contain the HomeKit keys, and change and restart homekit-ccu. That is why every API call, the backup/restore and the live connection (websocket) need a valid session of a CCU administrator:

- Log in to the CCU WebUI as an administrator and open the configuration with the HomeKit button under *Settings → Control panel → Additional software*. The CCU passes its session id (`?sid=@…@`) to the page, and the page sends it with every request. A bookmark or a typed URL carries no session id and shows "No valid CCU session".
- homekit-ccu checks the session against the CCU (ReGaHss session of a user with administrator level) and renews it on use; a checked session is remembered for 30 seconds.
- Pages of other hosts are refused: the API answers browser requests only when the page comes from the same hostname (any port or scheme), so no other web site can use your CCU session.

**Remote mode:** the session is checked against the CCU given with `-H` (ReGaHss on port 8181, JSON-RPC `/api/homematic.cgi` on port 80). The page on `http://<remote-host>:9874/` gets no session id by itself, because the CCU's HomeKit button only exists for the addon on the CCU. Log in to the CCU WebUI, copy the session id from its address bar (the `@…@` value of `sid=`) and open `http://<remote-host>:9874/index.html?sid=@…@`. Remote access with authentication does not work without a CCU login.

When you upgrade from hap-homematic or homekit-ccu 0.0.x, the check is turned on even if the old configuration had it off (`config.json` gets `"configVersion": 2`, and only a `false` stored after that counts). To turn the check off, uncheck *Require a CCU administrator session* in the settings, or set `"useCCCAuthentication": false` in a `config.json` that has `"configVersion": 2`. This is not recommended: everyone in your network can then read the pairing codes, download the HomeKit keys and change the configuration.

## HTTPS

If you are using the https version of your ccu WebUI page, the configuration page is automatically available on port 49874 via the lighttpd HTTPS proxy. homekit-ccu will use the same self signed tls certificate as your ccu.
