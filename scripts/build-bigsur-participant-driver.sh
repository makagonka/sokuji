#!/bin/bash
# Build a second BlackHole-derived 2ch virtual cable for participant audio on
# the Big Sur compatibility build. This is separate from SokujiVirtualAudio,
# which remains the virtual microphone heard by the meeting application.

set -euo pipefail

DRIVER_NAME="SokujiParticipantAudio"
BUNDLE_ID="com.sokuji.participantaudio"
DEVICE_NAME="SokujiParticipantAudio"
PRODUCT_NAME="SokujiParticipantAudio"
CHANNELS=2
PLUGIN_UUID="17c11cb7-8e45-4bd7-bf0a-41a17da03e31"

echo "Building $DEVICE_NAME (x86_64, macOS 10.13+)..."

test -d BlackHole || {
  echo "BlackHole submodule is missing. Checkout with submodules enabled."
  exit 1
}

cp assets/icon.icns BlackHole/SokujiParticipant.icns
pushd BlackHole >/dev/null

xcodebuild clean -quiet || true
rm -rf build/

xcodebuild \
  -project BlackHole.xcodeproj \
  -configuration Release \
  -quiet \
  -arch x86_64 \
  ONLY_ACTIVE_ARCH=YES \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGN_ENTITLEMENTS="" \
  DEVELOPMENT_TEAM="" \
  MACOSX_DEPLOYMENT_TARGET=10.13 \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
  PRODUCT_NAME="$PRODUCT_NAME" \
  GCC_PREPROCESSOR_DEFINITIONS="\$GCC_PREPROCESSOR_DEFINITIONS kDriver_Name=\\\"$DRIVER_NAME\\\" kPlugIn_BundleID=\\\"$BUNDLE_ID\\\" kPlugIn_Icon=\\\"SokujiParticipant.icns\\\" kDevice_Name=\\\"$DEVICE_NAME\\\" kNumber_Of_Channels=$CHANNELS"

DRIVER="build/Release/$PRODUCT_NAME.driver"
test -d "$DRIVER"

popd >/dev/null

DEST="resources/drivers/$PRODUCT_NAME.driver"
rm -rf "$DEST"
cp -R "BlackHole/$DRIVER" "$DEST"

rm -f "$DEST/Contents/Resources/BlackHole.icns" || true
cp assets/icon.icns "$DEST/Contents/Resources/SokujiParticipant.icns"

PLIST="$DEST/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName '$PRODUCT_NAME'" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier '$BUNDLE_ID'" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable '$PRODUCT_NAME'" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :LSMinimumSystemVersion '10.13'" "$PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Add :LSMinimumSystemVersion string '10.13'" "$PLIST"

# BlackHole's installer regenerates this UUID for every customized driver. Do
# the same deterministically so our two HAL plug-ins never share a factory UUID.
/usr/libexec/PlistBuddy -c "Delete :CFPlugInFactories:e395c745-4eea-4d94-bb92-46224221047c" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Delete :CFPlugInFactories:8a70ea4a-c3ed-4dc1-a01b-0ed9bc34f76a" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFPlugInFactories:$PLUGIN_UUID string BlackHole_Create" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :CFPlugInTypes:443ABAB8-E7B3-491A-B985-BEB9187030DB" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFPlugInTypes:443ABAB8-E7B3-491A-B985-BEB9187030DB dict" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFPlugInTypes:443ABAB8-E7B3-491A-B985-BEB9187030DB:0 string $PLUGIN_UUID" "$PLIST"

rm -f BlackHole/SokujiParticipant.icns

echo "Built $DEST"
