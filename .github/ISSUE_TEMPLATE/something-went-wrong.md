---
name: Something went wrong
about: A device, the configuration or the add-on does not work as expected
title: ''
labels: bug
assignees: ''
---

**What happens**
Describe what you see, for example in Apple Home or in the HomeKit-CCU configuration.

**What should happen**

**Device and settings**
- Device type (for example HmIP-eTRV-2) and channel:
- Service chosen in HomeKit-CCU and its settings:

**Versions**
- HomeKit-CCU:
- OpenCCU:
- iOS / Apple Home:

**Log**
Turn on debug in the configuration (*Internals → Enable Debug*), reproduce the problem and attach the relevant part of `/var/log/homekit-ccu.log`. The log contains no setup codes, but please check it for anything else you do not want to share.
