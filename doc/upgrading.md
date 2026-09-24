# Moving from hap-homematic to homekit-ccu

hap-homematic has to be removed before homekit-ccu is installed; the installer refuses to run while it is still there. Your configuration and the HomeKit pairing come over with a backup:

1. **Back up hap-homematic.** In its configuration page open *Internals → Backup* and create a backup. Keep the downloaded `.tar.gz` file. A CCU backup does not hurt either.
2. **Uninstall hap-homematic** under *Settings → Control panel → Additional software*. This also deletes its configuration directory, so do step 1 first.
3. **Install homekit-ccu** as described in the [README](../README.md#installation). Close the welcome wizard that opens on the first visit; your devices come with the backup.
4. **Restore the backup** in homekit-ccu under *Internals → Backup*: choose the file from step 1 and click *Restore*. homekit-ccu restarts and brings back your bridges, devices, variables, programs and the HomeKit keys.

Do not remove the bridge from Apple Home. With the restored keys Apple Home recognises it again, and rooms, scenes and automations stay. If you removed it already, add it again with the setup code shown under *Edit instances*.

Also good to know:

- **Bridge names change** from "HomeMatic default" to "HomeKit-CCU" (room bridges "HomeKit-CCU <name>"). Names you gave the bridges and accessories in Apple Home stay.
- **The video doorbell has to be added again.** It now gets its own HomeKit identity (derived from its UUID instead of the fixed `00:00:11:22:22:11`), and the old default PIN `123-45-678` is rejected as trivial. If the doorbell still uses that PIN, set a different one in the doorbell settings; otherwise the doorbell is not published and the log says why. Then remove the old doorbell in Apple Home and add it again with the new PIN. Renaming the doorbell also changes its identity.
- **The configuration UI requires a CCU administrator session**, also on the CCU itself (0.0.x checked the session only in remote mode, and only when turned on). Log in to the CCU WebUI as an administrator and open the configuration page with the HomeKit button in the control panel; a bookmark without the session id gets "No valid CCU session". This covers every change, backup and restore. The upgrade turns the check on even if the old configuration had it off (hap-homematic stored `"useCCCAuthentication": false` by default); to turn it off again, uncheck *Require a CCU administrator session* in the settings (not recommended). See [Authentication](security.md#authentication).
- **Restart** in the configuration UI now calls `/etc/config/rc.d/homekit-ccu restart` directly (the old npm script is gone). In remote mode there is no rc.d script; restart the process yourself.
- **Leftovers of an uninstalled hap-homematic are removed during installation**: its monit config (`/usr/local/etc/monit_hap-homematic.cfg`, which broke every `monit reload` with "Service name conflict"), its lighttpd config and its WebUI button.
