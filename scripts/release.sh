#!/bin/bash
# Builds, notarizes and staples the direct-download release: a Developer ID
# archive, exported, packed into a dmg, submitted to Apple's notary service and
# stapled. It prints the `sha256` the Homebrew cask needs and stops there —
# creating the GitHub release and editing the cask stay the owner's, because both
# publish.
#
# Modelled on WheelClick's scripts/release-direct.sh, minus two things PiPOSS does
# not need: there is no Sparkle framework to sign an update for, and no
# associated-domains entitlement — which is what makes WheelClick demand a
# provisioning profile under every signing flavour. PiPOSS's entitlements are
# app-sandbox, files.user-selected.read-only and network.client, none of which
# needs a profile, so signing stays automatic and nothing has to be installed.
#
# Notarization auth, in order of preference:
#   1. App Store Connect API key, when ASC_PRIVATE_KEY_PATH, ASC_KEY_ID and
#      ASC_ISSUER_ID are set. CI does this; the key is a repository secret and
#      never touches a developer's Mac.
#   2. Otherwise the `piposs-notary` keychain profile, once:
#        xcrun notarytool store-credentials piposs-notary \
#          --key <AuthKey_XXX.p8> --key-id <KEY_ID> --issuer <ISSUER_ID>
#
# **The key is per-team, not per-app.** PiPOSS is team R2294BC6J8, the same team
# as WheelClick, so the key already issued there notarizes this too. Nothing new
# has to be created in the developer portal.
#
# Usage: scripts/release.sh   (or `make release CONFIRM=1`)
set -euo pipefail

cd "$(dirname "$0")/.."

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

BUILD=build/release
ARCHIVE="$BUILD/PiPOSS.xcarchive"
EXPORT="$BUILD/export"
DMG="$BUILD/PiPOSS.dmg"
TEAM_ID=R2294BC6J8

rm -rf "$BUILD"
mkdir -p "$BUILD"

# PiPOSS.xcodeproj is generated from project.yml and gitignored (RRR §8), so a
# clean checkout has to produce it before anything can build.
make --no-print-directory project

echo "▸ Archiving (Release, Developer ID, manual)…"
# The version is whatever project.yml says. Deliberately not overridden from
# `git rev-list --count HEAD` the way WheelClick does it: this project keeps one
# source of truth per fact, a committed test asserts that project.yml,
# manifest.json and package.json agree, and a build number invented here would be
# a fourth version nobody chose. Bump CURRENT_PROJECT_VERSION in project.yml.
#
# **Signed Developer ID *manually*, overriding project.yml's `Apple Development` +
# `Automatic`.** That default is right for a developer's Mac and wrong here, twice
# over. Automatic signing resolves a provisioning profile, and a CI runner has no
# Apple ID logged into Xcode to resolve one with — while a Developer ID Mac app
# needs no profile at all, which is exactly why this project has never had one.
# Signing as Developer ID from the archive rather than only at export also makes
# the local run and the CI run identical, so a failure in one reproduces in the
# other. `DEVELOPMENT_TEAM` is named because manual signing does not infer it.
xcodebuild -project PiPOSS.xcodeproj -scheme PiPOSS \
  -configuration Release -derivedDataPath "$BUILD/DerivedData" \
  -archivePath "$ARCHIVE" \
  CODE_SIGN_IDENTITY="Developer ID Application" \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  PROVISIONING_PROFILE_SPECIFIER="" \
  archive

echo "▸ Exporting with Developer ID signing…"
cat > "$BUILD/export-options.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>developer-id</string>
	<key>teamID</key>
	<string>$TEAM_ID</string>
	<key>signingStyle</key>
	<string>manual</string>
	<key>signingCertificate</key>
	<string>Developer ID Application</string>
</dict>
</plist>
PLIST
xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$BUILD/export-options.plist" -exportPath "$EXPORT"

APP="$EXPORT/PiPOSS.app"
VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist")
BUILD_NUMBER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$APP/Contents/Info.plist")

# Before spending Apple's time: the two properties that decide whether Safari will
# register the extension at all. An ad-hoc signature has no sealed resources, and
# Safari refuses a web extension from such a host app — that shipped once (BF09).
echo "▸ Checking the signature before notarizing…"
if ! codesign -dv --verbose=2 "$APP" 2>&1 | grep -q "Authority=Developer ID Application"; then
  echo "error: the exported app is not Developer ID signed." >&2
  codesign -dv --verbose=2 "$APP" >&2 2>&1 || true
  exit 1
fi
if ! codesign -dv --verbose=2 "$APP" 2>&1 | grep -qE "flags=0x[0-9a-f]*\(.*runtime"; then
  echo "error: the hardened runtime flag is missing, so notarization would be refused." >&2
  exit 1
fi
codesign --verify --deep --strict "$APP"

echo "▸ Building dmg…"
# A window with the app and a link to /Applications — the plain Mac shape, no
# background image and no AppleScript to place icons. `-ov` so a rerun overwrites.
STAGING="$BUILD/dmg-staging"
mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname PiPOSS -srcfolder "$STAGING" -ov -format UDZO "$DMG"

echo "▸ Notarizing (waits for Apple)…"
if [[ -n "${ASC_PRIVATE_KEY_PATH:-}" ]]; then
  NOTARY_AUTH=(--key "$ASC_PRIVATE_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID")
else
  NOTARY_AUTH=(--keychain-profile piposs-notary)
fi
xcrun notarytool submit "$DMG" "${NOTARY_AUTH[@]}" --wait \
  --output-format plist > "$BUILD/notarization.plist"
NOTARY_STATUS=$(/usr/libexec/PlistBuddy -c "Print :status" "$BUILD/notarization.plist")
if [[ "$NOTARY_STATUS" != Accepted ]]; then
  SUBMISSION_ID=$(/usr/libexec/PlistBuddy -c "Print :id" "$BUILD/notarization.plist")
  echo "Notarization failed with status: $NOTARY_STATUS" >&2
  xcrun notarytool log "$SUBMISSION_ID" "${NOTARY_AUTH[@]}" >&2 || true
  exit 1
fi

echo "▸ Stapling…"
xcrun stapler staple "$DMG"

# Read back from the file that will actually be downloaded. Stapling rewrites the
# dmg, so a hash taken before it is the hash of something else — and `spctl` is
# not used as evidence anywhere here, because this Mac has assessments disabled
# and prints `accepted` regardless (RRR §10.2).
xcrun stapler validate "$DMG"
SHA=$(shasum -a 256 "$DMG" | cut -d' ' -f1)

# LaunchServices registers every app bundle on disk, and each claims
# org.artginzburg.PiPOSS.Extension. With more than one present, SafariServices
# resolves that identifier to an arbitrary member of the set, and the owner's app
# stops knowing whether its extension is on (BF15). This run just created three more
# copies — in the archive, the export and the dmg staging — so each is withdrawn by
# path and then deleted.
#
# Deliberately NOT `make lsprune`: that target keeps one path and unregisters every
# other copy on the machine, which would include whatever build the owner is using in
# Safari right now. Unregister first, then delete: the record outlives the directory
# until LaunchServices happens to notice.
echo "▸ Withdrawing the copies this run registered…"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
for copy in "$ARCHIVE/Products/Applications/PiPOSS.app" "$APP" "$STAGING/PiPOSS.app"; do
  "$LSREGISTER" -u "$copy/Contents/PlugIns/PiPOSS Extension.appex" >/dev/null 2>&1 || true
  "$LSREGISTER" -u "$copy" >/dev/null 2>&1 || true
done
rm -rf "$ARCHIVE" "$EXPORT" "$STAGING" "$BUILD/DerivedData"

# The dmg is kept, and it holds an app bundle too — but inside a disk image, which is
# not mounted, so LaunchServices does not see it. Verified after this script's first
# run; if `lsregister -dump` ever shows a path inside a dmg, add it to the loop above.

cat <<SUMMARY

▸ Done. Notarized and stapled.

    file      $DMG
    version   $VERSION (build $BUILD_NUMBER)
    sha256    $SHA

Still yours, because both publish:

  1. gh release create "$VERSION" "$DMG" --title "$VERSION" --generate-notes
  2. In artginzburg/homebrew-tap, Casks/piposs.rb:
         version "$VERSION"
         sha256 "$SHA"
     and the url's asset name if it is still PiPOSS.zip — this ships a dmg.
SUMMARY
