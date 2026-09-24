# Running modes

homekit-ccu can run in two modes: **local** (as a CCU addon) or **remote** (on a separate machine connecting to the CCU over the network).

## Local Mode (CCU Addon)

This is the default and recommended mode. homekit-ccu runs directly on the CCU as an addon and communicates with all services via localhost using internal ports.

```bash
node index.js -D
```

## Remote Mode

You can run homekit-ccu on a separate machine (e.g. a Raspberry Pi, NAS, or desktop) and point it at your CCU. Use the `-H` flag to specify the CCU host address. If your CCU has XML-RPC basic auth enabled (common on OpenCCU), provide credentials with `-U` and `-P`.

```bash
node index.js -D -H 192.168.1.100
node index.js -D -H 192.168.1.100 -U rpcuser -P rpcpassword
```

In remote mode, homekit-ccu automatically remaps internal daemon ports (32001, 32010, 39292) to the external lighttpd-proxied ports (2001, 2010, 9292).

| CLI Flag | Description |
|----------|-------------|
| `-D` | Enable debug logging |
| `-H <host>` | CCU host IP address (default: localhost) |
| `-U <user>` | Username for XML-RPC basic auth (remote mode) |
| `-P <password>` | Password for XML-RPC basic auth (remote mode) |
| `-C <path>` | Configuration path |
| `-L <dir>` | Directory for `homekit-ccu.log` (default `/var/log`; the temp directory if neither is writable) |
| `-S <file>` | Simulate with a devices file |
| `-R` | Dry run — only use cached files |

## Ports

* 9874 -> Config WebUI (lighttpd proxies it to the config server on 127.0.0.1:39874; in remote mode the config server listens on 9874 itself)
* 49874 -> Config WebUI HTTPS (proxied through lighttpd)
* 9875 -> RPC event server (only calls from the CCU are accepted; on the CCU itself it listens on 127.0.0.1)
* 9876 -> RPC event server CuxD (optional, same rule)
* 9877..n HAP Instance 0 .. n
* 5353/udp -> mDNS (Bonjour), so HomeKit can find the bridges
* random UDP ports -> video doorbell streams (see [video doorbell](video-doorbell.md))

Ports 9874 and 49874 are automatically opened in the CCU firewall during addon installation.
