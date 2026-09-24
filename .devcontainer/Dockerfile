# pinned to an OpenCCU release; bump it to test against a newer one
FROM ghcr.io/openccu/openccu:3.89.11.20260919

# OpenCCU is a buildroot image with /sbin/init as entrypoint.
# OpenCCU 3.89+ ships Node.js 22, so homekit-ccu runs inside the CCU
# just like a real addon — connecting to localhost ports directly.

# Create the addon directory structure matching a real CCU addon install
RUN mkdir -p /usr/local/etc/config/addons/homekit-ccu/etc \
    && mkdir -p /usr/local/addons/homekit-ccu

WORKDIR /workspace
