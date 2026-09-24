# Security policy

## Supported versions

Only the latest release of HomeKit-CCU receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through
[GitHub security advisories](https://github.com/bloop16/homekit-ccu/security/advisories/new).
Describe the problem, the affected version and how to reproduce it. You will get an answer
within a week.

## What HomeKit-CCU protects

- The configuration UI and its API require a CCU administrator session (see
  [doc/security.md](doc/security.md)).
- HomeKit setup codes and pairing keys are stored only in the add-on's configuration directory
  on the CCU and are never written to the log.
- Names coming from the CCU are shown as text in the configuration UI.
