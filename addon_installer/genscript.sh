#!/bin/sh
set -e
cd "$(dirname "$0")"

# Read version from package.json — single source of truth
VERSION=$(node -p "require('../package.json').version")
echo "Building homekit-ccu addon v${VERSION}"

mkdir -p tmp
rm -rf tmp/*

# Build the npm package and include it in the archive
# The rc.d install function will install from this tgz (no public registry needed)
cd ..
TGZFILE=$(npm pack --silent | tail -1)
mv "${TGZFILE}" addon_installer/tmp/homekit-ccu.tgz
cd addon_installer

# copy all relevant stuff
cp -a update_script tmp/
cp -a homekit-ccu tmp/

# Patch the VER= line in the rc.d script with the actual version
sed -i "s/^VER=.*/VER=${VERSION}/" tmp/homekit-ccu

TARFILE=homekit-ccu-${VERSION}.tar.gz
if [ -e "$TARFILE" ]; then
    rm -f "$TARFILE"
fi

# generate archive
cd tmp
chmod +x update_script
tar --exclude='._*' --exclude=.DS_Store -czvf ../homekit-ccu-${VERSION}.tar.gz *
cd ..
rm -rf tmp
echo "Done: homekit-ccu-${VERSION}.tar.gz"
