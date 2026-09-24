#!/bin/sh
# Install homekit-ccu into the running OpenCCU as a proper addon,
# mirroring what happens when the .tar.gz is uploaded via the WebUI.
#
# Instead of pulling from npm, it symlinks the workspace source so
# every code change is immediately live — no reinstall needed.

set -e

ADDONNAME=homekit-ccu
CONFIG_DIR=/usr/local/etc/config
ADDON_DIR=/usr/local/addons/${ADDONNAME}
ADDONCFG_DIR=${CONFIG_DIR}/addons/${ADDONNAME}
ADDONWWW_DIR=${CONFIG_DIR}/addons/www/${ADDONNAME}
RCD_DIR=${CONFIG_DIR}/rc.d
WORKSPACE=/workspace
LOGFILE=/var/log/hkccu-install.log

echo "=== homekit-ccu addon installer (dev mode) ==="
echo ""

# ---- 1. Wait for CCU services ----
echo "[1/6] Waiting for CCU services..."
MAX_WAIT=120
WAITED=0
INTERVAL=3
# Wait for ReGaHss (port 8181) — needed for addon registration in step 6
while [ "$WAITED" -lt "$MAX_WAIT" ]; do
  if wget -q -O /dev/null --timeout=2 "http://127.0.0.1:8181/tclrega.exe" 2>/dev/null; then
    echo "  ReGaHss is ready (port 8181)"
    break
  fi
  printf "  Waiting for ReGaHss... (%ds/%ds)\n" "$WAITED" "$MAX_WAIT"
  sleep "$INTERVAL"
  WAITED=$((WAITED + INTERVAL))
done
if [ "$WAITED" -ge "$MAX_WAIT" ]; then
  echo "ERROR: ReGaHss did not become ready within ${MAX_WAIT}s" >&2
  exit 1
fi
echo ""

# ---- 2. Create directory structure (same as update_script) ----
echo "[2/6] Creating addon directory structure..."
mkdir -p "${ADDON_DIR}"
mkdir -p "${ADDONCFG_DIR}/etc"
mkdir -p "${ADDONWWW_DIR}"
mkdir -p "${RCD_DIR}"
chmod 755 "${ADDON_DIR}" "${RCD_DIR}"
echo "  ${ADDON_DIR}"
echo "  ${ADDONCFG_DIR}/etc"
echo "  ${ADDONWWW_DIR}"

# ---- 3. Install via symlink instead of npm ----
# The real rc.d install does: cd $ADDON_DIR && npm i homekit-ccu.tgz
# We create the same node_modules/homekit-ccu path but as a symlink
# to /workspace so live edits take effect immediately.
echo "[3/6] Linking workspace as installed addon..."
mkdir -p "${ADDON_DIR}/node_modules"
# Remove existing (symlink or dir) to ensure clean state
rm -rf "${ADDON_DIR}/node_modules/${ADDONNAME}"
ln -sf "${WORKSPACE}" "${ADDON_DIR}/node_modules/${ADDONNAME}"
# Install dependencies from the workspace package.json
cd "${WORKSPACE}"
if [ ! -d node_modules ]; then
  echo "  Running npm install (first time)..."
  npm install --loglevel=error
fi
# Marker file — prevents RaspberryMatic backup from including node_modules
touch "${ADDON_DIR}/.nobackup"
echo "  -> ${ADDON_DIR}/node_modules/${ADDONNAME} -> ${WORKSPACE}"

# ---- 4. Install web UI files ----
echo "[4/6] Installing WebUI files..."
# Copy config UI static files (HTML/JS/CSS, update-check.cgi, logo) so lighttpd serves them
# at /addons/homekit-ccu/, same as the rc.d install
cp -rf "${WORKSPACE}/lib/configurationsrv/html/"* "${ADDONWWW_DIR}/"
chmod +x "${ADDONWWW_DIR}/update-check.cgi"
# Install lighttpd config (passes /addons/homekit-ccu/api/ to the config server)
mkdir -p /etc/config/lighttpd
cp -f "${WORKSPACE}/etc/homekit_ccu.conf" "/etc/config/lighttpd/${ADDONNAME}.conf"
# Reload lighttpd to pick up the new proxy config
killall lighttpd 2>/dev/null; sleep 1; lighttpd -f /etc/lighttpd/lighttpd.conf
echo "  ${ADDONWWW_DIR}/index.html"
echo "  /etc/config/lighttpd/${ADDONNAME}.conf"

# ---- 5. Install rc.d init script ----
echo "[5/6] Installing rc.d init script..."
cp -f "${WORKSPACE}/addon_installer/${ADDONNAME}" "${RCD_DIR}/${ADDONNAME}"
chmod +x "${RCD_DIR}/${ADDONNAME}"
echo "  ${RCD_DIR}/${ADDONNAME}"

# ---- 6. Register addon button in CCU WebUI ----
echo "[6/6] Registering addon in CCU WebUI..."
# Ensure the hm_addons.cfg exists
touch /etc/config/hm_addons.cfg
node "${WORKSPACE}/etc/hm_addon.js" homekit-ccu "${WORKSPACE}/etc/homekit_ccu_addon.cfg"
echo "  Registered 'homekit-ccu' in /etc/config/hm_addons.cfg"

echo ""
echo "=== Installation complete ==="
echo ""
echo "The addon is now installed exactly as the CCU sees it."
echo "Source is symlinked — edit files in /workspace and restart to pick up changes."
echo ""
echo "Usage:"
echo "  ${RCD_DIR}/${ADDONNAME} start     # start as daemon (background)"
echo "  ${RCD_DIR}/${ADDONNAME} stop      # stop daemon"
echo "  ${RCD_DIR}/${ADDONNAME} restart   # restart daemon"
echo "  ${RCD_DIR}/${ADDONNAME} info      # addon info (version, URL)"
echo "  node ${WORKSPACE}/index.js -D     # run in foreground with debug"
echo ""
echo "WebUI addon button: http://localhost:8080/addons/${ADDONNAME}/index.html"
