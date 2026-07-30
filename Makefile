# PiPOSS — the local development loop.  Human documentation: docs/development.md
#
# A *dispatcher*, not a second build system: every target delegates to the pnpm scripts
# in "PiPOSS Extension/Resources/package.json", to the "Run PNPM Build" phase inside the
# Xcode project (which runs those same scripts), or to `xcodegen`.  So the extension
# bundle has exactly one recipe no matter who starts it.
#
# What this file adds is the glue nobody can be expected to rediscover: finding a real
# Xcode on a machine whose `xcode-select` points at the Command Line Tools; generating
# PiPOSS.xcodeproj, which is not in git; keeping code signing — and therefore the login
# keychain, and therefore a password dialog nobody is there to answer — out of every
# default path; and turning a build into a running app.
#
# Requires a checkout plus `xcodegen` (brew install xcodegen): no `sudo`, no
# `xcode-select`, no pre-exported DEVELOPER_DIR.  Tested with the stock GNU Make 3.81
# that ships with macOS, so no `.ONESHELL` and no make >= 4 functions.

ROOT    := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
EXT_DIR := $(ROOT)/PiPOSS Extension/Resources

# ------------------------------------------------------------------- overrides
PROJECT    := PiPOSS.xcodeproj
SCHEME     ?= PiPOSS
CONFIG     ?= Debug
APP_NAME   := PiPOSS
# Passed to `open` by `make app`.  `OPEN_FLAGS=-g` launches without stealing focus from
# Safari, which is usually what you want mid-session.
OPEN_FLAGS ?=

# --------------------------------------------------------------------- signing
# The most important switch in this file.  Signing reaches into the login keychain for a
# private key, and a keychain dialog does not fail a build — it hangs it for ever.  That
# happened once, to a sleeping owner, so the default is "do not sign at all" and every
# signing mode is opt-in by name.
#
#   SIGN=no     (default) nothing is signed.  Verified: zero `codesign` invocations, with
#               the project's own identity in place — the override beats the project.
#               Safe unattended, and NOT installable: ad-hoc/linker-signed means Sealed
#               Resources=none, so Safari never registers the extension from it.
#   SIGN=dev    automatic Apple Development signing — the same identity the project
#               declares, so this is what a build from Xcode's UI does too.  What Safari
#               needs before it will register the extension at all
#               (docs/research/safari-extension-signing-2026-07.md; Safari's escape hatch,
#               "Allow unsigned extensions", sits behind an authorization prompt and is not
#               a path we rely on).  Touches the login keychain: owner at the keyboard only.
#   SIGN=devid  Developer ID Application, the distribution identity.  This is the one that
#               raised the password dialog.  Reachable only via `make app-signed CONFIRM=1`.
#
# The project declares "Apple Development" in all four configurations deliberately: an
# ad-hoc-signed app has no sealed resources, so Safari does not register the extension
# inside it (measured, same document; T12 removed those settings once and broke exactly
# that).  So the *default* is a signed, Safari-loadable build, and every unattended path
# disables signing on the command line, which beats the project.  SIGNFLAGS_dev names the
# same values the project carries rather than being empty, so `make app` does what it says
# regardless of what the project happens to declare.
SIGN ?= no

SIGNFLAGS_no    := CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""
SIGNFLAGS_dev   := CODE_SIGN_IDENTITY="Apple Development" CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM=R2294BC6J8
SIGNFLAGS_devid := CODE_SIGN_IDENTITY="Developer ID Application" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=R2294BC6J8 PROVISIONING_PROFILE_SPECIFIER=
SIGNFLAGS        = $(SIGNFLAGS_$(SIGN))

# ------------------------------------------------------- ad-hoc, for ONE purpose
# **This is not a fourth SIGN mode, and it must never become one.**  It is deliberately
# not named after `SIGNFLAGS_`, and `adhoc` is deliberately not accepted by `require-sign`,
# so that `make app-build SIGN=adhoc` keeps refusing.
#
# Why it exists: entitlements are embedded by the *signing* step, so a `SIGN=no` product
# carries none — measured, and the reason `make entitlements` exists.  `--sign -` is ad-hoc:
# codesign special-cases it and looks no identity up, so **there is no keychain path and no
# dialog**.  Verified in the build log, which shows exactly
# `/usr/bin/codesign --force --sign - -o runtime --entitlements ….xcent`.
#
# Why it must stay caged: **an ad-hoc-signed product is the one thing Safari refuses to
# register the extension from** (BF09; docs/research/safari-extension-signing-2026-07.md).
# A bundle built this way is for `codesign -d` to read and for nothing else, and it gets its
# own DerivedData so it can never shadow a real build.
ADHOC_VERIFY_FLAGS := CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual PROVISIONING_PROFILE_SPECIFIER=

# Corepack asks for confirmation before downloading a pnpm it does not have cached.  In a
# Makefile that reads as a hang, so answer in advance.
export COREPACK_ENABLE_DOWNLOAD_PROMPT ?= 0

# ---------------------------------------------------------------- tool lookup
# `xcode-select -p` on this machine prints /Library/Developer/CommandLineTools, which
# contains no xcodebuild.  So instead of trusting the active developer directory we look
# for one that actually holds `usr/bin/xcodebuild`.  Never `sudo xcode-select`: that would
# make a human type a password to run `make`.
XCODE_SEARCH_PATHS ?= $(DEVELOPER_DIR) $(shell /usr/bin/xcode-select -p 2>/dev/null) /Applications/Xcode.app/Contents/Developer /Applications/Xcode-beta.app/Contents/Developer
DEV_DIR := $(firstword $(foreach d,$(XCODE_SEARCH_PATHS),$(if $(wildcard $(d)/usr/bin/xcodebuild),$(d))))

XCODEBUILD := DEVELOPER_DIR="$(DEV_DIR)" "$(DEV_DIR)/usr/bin/xcodebuild"

# Not on `PATH`, and the full path is the only way to reach it.  Used by `lsprune` and by
# `entitlements`; read the `lsprune` comment before touching either.
LSREGISTER := /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

# DECISIONS 111: CLAUDE.md's canonical /tmp/piposs-dd-<task> was unreachable through
# make, so concurrent agents shared one DerivedData.  Empty means "Xcode's default".
DERIVED_DATA ?=
DDFLAGS       = $(if $(DERIVED_DATA),-derivedDataPath "$(DERIVED_DATA)")

XCODEFLAGS  = -project "$(ROOT)/$(PROJECT)" -scheme "$(SCHEME)" -configuration "$(CONFIG)" $(DDFLAGS) $(SIGNFLAGS)

# ----------------------------------------------------------- project generation
# PiPOSS.xcodeproj is generated from project.yml and is gitignored (RRR §8), so every
# target that runs xcodebuild has to be able to produce it first.
XCODEGEN ?= $(firstword $(foreach x,xcodegen $(HOME)/.local/bin/xcodegen /opt/homebrew/bin/xcodegen /usr/local/bin/xcodegen,$(if $(shell command -v $(x) 2>/dev/null),$(x))))
PBXPROJ  := $(ROOT)/$(PROJECT)/project.pbxproj

define die_no_xcodegen
echo "make: xcodegen not found, and $(PROJECT) is generated from project.yml." >&2; \
echo "" >&2; \
echo "  Install it:  brew install xcodegen" >&2; \
echo "  Looked in PATH, ~/.local/bin, /opt/homebrew/bin, /usr/local/bin." >&2; \
echo "  Override with: make $(MAKECMDGOALS) XCODEGEN=/path/to/xcodegen" >&2; \
exit 1
endef

define run_xcodegen
echo "==> xcodegen: project.yml -> $(PROJECT)"; \
cd "$(ROOT)" && "$(XCODEGEN)" generate --quiet
endef

# Withdraw one built bundle and its embedded appex from LaunchServices.  $(1) is the
# `.app` path.  Deleting the directory is the caller's job and is not a substitute — see
# the `lsprune` comment.
define lsunregister
"$(LSREGISTER)" -u "$(1)/Contents/PlugIns/$(APP_NAME) Extension.appex" >/dev/null 2>&1 || true; \
"$(LSREGISTER)" -u "$(1)" >/dev/null 2>&1 || true
endef

# GUI-launched processes do not read ~/.zshrc, and pnpm here is a corepack shim in
# Homebrew's prefix — look where the Xcode build phase looks.
PNPM ?= $(firstword $(foreach p,pnpm $(HOME)/.local/share/pnpm/pnpm $(HOME)/Library/pnpm/pnpm /opt/homebrew/bin/pnpm /usr/local/bin/pnpm,$(if $(shell command -v $(p) 2>/dev/null),$(p))))
RUN_PNPM = cd "$(EXT_DIR)" && $(PNPM)

# Resolved lazily: one `-showBuildSettings` costs ~0.6 s, so only pay for it in the
# targets that need a path to the product.
APP_BUNDLE = $(shell $(XCODEBUILD) $(XCODEFLAGS) -showBuildSettings 2>/dev/null | awk -F' = ' '/ CODESIGNING_FOLDER_PATH = /{print $$2; exit}')

.DEFAULT_GOAL := help
.PHONY: release lsprune help doctor deps lint test build format format-check icons watch watch-bundle \
        app app-build app-signed relaunch check entitlements clean project require-xcode \
        require-pnpm require-sign require-xcodegen

# ---------------------------------------------------------------------- meta
help: ## Show this help
	@echo "PiPOSS — make targets (docs/development.md for the human loop)"
	@echo
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[1m%-13s\033[0m %s\n", $$1, $$2}' "$(ROOT)/Makefile"
	@echo
	@echo "  Safe unattended (terminate, never sign, never open a window):"
	@echo "      help doctor deps lint test build format format-check icons project"
	@echo "      app-build check clean"
	@echo "  Interactive — NEVER RETURN, so never run these from a script or an agent:"
	@echo "      watch watch-bundle"
	@echo "  Owner at the keyboard only:"
	@echo "      app (opens a window, reads the keychain), app-signed (password dialog)"
	@echo
	@echo "  Variables: CONFIG=$(CONFIG) SCHEME=$(SCHEME) SIGN=$(SIGN) OPEN_FLAGS='$(OPEN_FLAGS)'"
	@echo "             DERIVED_DATA='$(DERIVED_DATA)' (empty = Xcode's default location)"
	@echo "  Xcode:     $(if $(DEV_DIR),$(DEV_DIR),NOT FOUND — run 'make doctor')"
	@echo "  Project:   $(PROJECT) is generated from project.yml — never edit it directly"

doctor: ## Print the toolchain this Makefile resolved
	@echo "repo root          : $(ROOT)"
	@echo "extension dir      : $(EXT_DIR)"
	@echo "xcode-select -p    : $(shell /usr/bin/xcode-select -p 2>/dev/null || echo '(none)')"
	@echo "DEVELOPER_DIR (env): $(if $(DEVELOPER_DIR),$(DEVELOPER_DIR),(unset))"
	@echo "Xcode used by make : $(if $(DEV_DIR),$(DEV_DIR),(NOT FOUND))"
	@echo "xcodegen           : $(if $(XCODEGEN),$(shell command -v $(XCODEGEN)) ($(shell $(XCODEGEN) --version 2>/dev/null | tr -d '\n')),(NOT FOUND — brew install xcodegen))"
	@echo "generated project  : $(if $(wildcard $(PBXPROJ)),$(PBXPROJ),(not generated yet — any build target makes it))"
	@echo "pnpm               : $(if $(PNPM),$(shell command -v $(PNPM)) ($(shell $(PNPM) --version 2>/dev/null)),(NOT FOUND))"
	@echo "node               : $(shell command -v node 2>/dev/null || echo '(none)') ($(shell node --version 2>/dev/null))"
	@echo "make               : $(MAKE_VERSION)"
	@echo "system log tool    : /usr/bin/log  (plain 'log' is a zsh builtin)"
	@echo "SIGN               : $(SIGN) -> xcodebuild $(if $(SIGNFLAGS),$(SIGNFLAGS),(project defaults, Apple Development))"

require-xcode:
	@if [ -z "$(DEV_DIR)" ]; then \
	  echo "make: cannot find a full Xcode — xcodebuild is unavailable." >&2; \
	  echo "" >&2; \
	  echo "  Looked for usr/bin/xcodebuild under each of:" >&2; \
	  for d in $(XCODE_SEARCH_PATHS); do echo "    $$d" >&2; done; \
	  echo "" >&2; \
	  echo "  xcode-select -p says: $$(/usr/bin/xcode-select -p 2>/dev/null || echo '(nothing)')" >&2; \
	  echo "  The Command Line Tools do NOT contain xcodebuild, so that path is" >&2; \
	  echo "  expected to be rejected here." >&2; \
	  echo "" >&2; \
	  echo "  Fix, in order of preference:" >&2; \
	  echo "    1. Install Xcode into /Applications." >&2; \
	  echo "    2. Point make at an Xcode you already have:" >&2; \
	  echo "         make $(MAKECMDGOALS) DEVELOPER_DIR=/path/to/Xcode.app/Contents/Developer" >&2; \
	  echo "  Do NOT run 'sudo xcode-select' for this — it is not needed." >&2; \
	  exit 1; \
	fi

require-xcodegen:
	@if [ -z "$(XCODEGEN)" ]; then $(die_no_xcodegen); fi

require-pnpm:
	@if [ -z "$(PNPM)" ]; then \
	  echo "make: pnpm not found." >&2; \
	  echo "  Looked in PATH, ~/.local/share/pnpm, ~/Library/pnpm, /opt/homebrew/bin," >&2; \
	  echo "  /usr/local/bin.  pnpm normally arrives here via corepack:" >&2; \
	  echo "      corepack enable pnpm" >&2; \
	  echo "  Override with: make $(MAKECMDGOALS) PNPM=/path/to/pnpm" >&2; \
	  exit 1; \
	fi

# An unrecognised SIGN would fall through to an empty flag list, i.e. silently to the
# project's own signing — the one outcome this switch exists to prevent.
require-sign:
	@case "$(SIGN)" in \
	  no|dev|devid) ;; \
	  *) echo "make: SIGN='$(SIGN)' is not one of: no (unsigned), dev (Apple Development), devid (Developer ID)." >&2; \
	     echo "  Refusing to build: an unknown value would silently mean 'sign with whatever the project says'." >&2; \
	     exit 1 ;; \
	esac

# ------------------------------------------------------------------- project
# A real file rule rather than a phony: regenerating on every invocation would rewrite
# project.pbxproj and make xcodebuild re-plan a build that has not changed.
$(PBXPROJ): $(ROOT)/project.yml
	@if [ -z "$(XCODEGEN)" ]; then $(die_no_xcodegen); fi
	@$(run_xcodegen)

project: require-xcodegen ## Regenerate PiPOSS.xcodeproj from project.yml (forced)
	@$(run_xcodegen)

# ---------------------------------------------------------------- extension
# `deps` is unconditional on purpose.  An earlier version compared manifest mtimes against
# a stamp file, which bought ~150 ms and introduced a one-second granularity hole: a
# lockfile written 0.8 s after the stamp compared as "not newer" and the install was
# skipped.  pnpm already no-ops in about that time when nothing changed.
deps: require-pnpm ## Install extension dependencies (pnpm no-ops when current)
	@$(RUN_PNPM) install --frozen-lockfile

lint: deps ## Typecheck the extension (tsc --noEmit, source + tests)
	@$(RUN_PNPM) run lint:ts

test: deps ## Run the Vitest suites once
	@$(RUN_PNPM) run test

build: deps ## Typecheck and bundle the extension into dist/
	@$(RUN_PNPM) run build

# `format-check` is what `check` and CI run (RRR 9's "Static" row); `format` is what you
# run when it tells you it is unhappy.  Until T13 nothing ran either, which is how
# `test/live/player.ts` sat unformatted from T08 onwards.
format-check: deps ## Check formatting with prettier (RRR 9) — does not write
	@$(RUN_PNPM) run format:check

format: deps ## Reformat with prettier — WRITES to your working tree
	@$(RUN_PNPM) run format

# Every raster file in the repository is generated from the two Figma exports in
# design/icon/ — see docs/icon.md.  A target rather than a line in the docs because there
# is no package.json to look it up in.  Writes to the working tree, needs a real Xcode for
# `xcrun swift`, opens no window and touches no keychain.
icons: require-xcode ## Regenerate every icon from design/icon/ — WRITES to your working tree
	@echo "==> design/icon/render.swift (DEVELOPER_DIR=$(DEV_DIR))"
	@cd "$(ROOT)" && DEVELOPER_DIR="$(DEV_DIR)" /usr/bin/xcrun swift design/icon/render.swift

watch: deps ## INTERACTIVE, never exits: re-run the tests on every source change
	@$(RUN_PNPM) exec vitest --watch

watch-bundle: deps ## INTERACTIVE, never exits: rebuild dist/ on change — see docs
	@$(RUN_PNPM) run watch

# ---------------------------------------------------------------------- app
# The `build` prerequisite is not load-bearing any more — project.yml names every source
# file individually, so the "Run PNPM Build" phase no longer skips after a source-only
# edit (T12 fixed the shipped-stale-bundle bug at the root).  It stays for a smaller
# reason: it puts `tsc` output on the terminal before xcodebuild starts, so a typecheck
# failure reads as one instead of being buried in a build log.  DECISIONS 110 records the
# duplicate work if it is ever worth removing.
app-build: build $(PBXPROJ) require-xcode require-sign ## Compile app + appex, UNSIGNED, no launch — the unattended target
	@echo "==> xcodebuild $(CONFIG) SIGN=$(SIGN) (DEVELOPER_DIR=$(DEV_DIR))"
	@$(XCODEBUILD) $(XCODEFLAGS) build

# Leaves exactly one registered copy of this app on the machine: the one in KEEP.
#
# BF15 is why this exists, and it is not housekeeping.  **LaunchServices registers every
# app bundle it finds**, and every one of them claims `org.artginzburg.PiPOSS.Extension`.
# With more than one present, SafariServices resolves that identifier to an arbitrary
# member of the set, and every call against it fails for the copy the user is actually
# running: `getStateOfSafariExtension` (so the app cannot say whether the extension is on)
# and `showPreferencesForExtension` (so its one button silently does nothing).  Measured
# after two days of agent development: **180 registered bundles, 119 still on disk, one
# real** — reported by the owner as a product bug.  Check the machine with:
#
#     $(LSREGISTER) -dump | grep -E 'path:.*PiPOSS' | sort -u
#
# Two entries — one app, one appex — is healthy.  The ordinary case needs this too, not
# just runaway agents: `make app` builds Debug and `make check` builds Release into the
# same DerivedData, so running both leaves two registered apps, and two is already
# ambiguous.
#
# Unregistering is not enough on its own — a bundle left on disk gets picked up again — and
# deleting is not enough either, because the registration outlives the directory until
# LaunchServices notices.  So: unregister, then delete.  Deletion is confined to build
# products (`…/Build/Products/*/PiPOSS.app` and `/tmp/piposs-dd-*`), which are regenerable
# by definition; nothing else is touched, whatever LaunchServices reports.
lsprune:
	@if [ -z "$(KEEP)" ]; then echo "lsprune: KEEP is required" >&2; exit 1; fi
	@pruned=0; \
	"$(LSREGISTER)" -dump 2>/dev/null \
	  | sed -n 's/^ *path: *\(.*'"$(APP_NAME)"'\.app\)\( (0x[0-9a-f]*)\)\{0,1\}$$/\1/p' \
	  | sort -u > /tmp/piposs-lsprune.txt; \
	while IFS= read -r p; do \
	  [ -n "$$p" ] || continue; \
	  case "$$p" in "$(KEEP)") continue;; esac; \
	  $(call lsunregister,$$p); \
	  case "$$p" in \
	    */Build/Products/*/$(APP_NAME).app|/tmp/piposs-dd-*|/private/tmp/piposs-dd-*) rm -rf "$$p";; \
	  esac; \
	  pruned=$$((pruned+1)); \
	done < /tmp/piposs-lsprune.txt; \
	rm -f /tmp/piposs-lsprune.txt; \
	if [ $$pruned -gt 0 ]; then \
	  echo "==> pruned $$pruned stale $(APP_NAME) registration(s) — see the lsprune comment"; \
	fi

# Not listed in the help: it is an implementation detail of the two owner-facing targets,
# and it is useless on a SIGN=no bundle (no sealed resources, so Safari would refuse the
# extension even if macOS launched the app).
relaunch: $(PBXPROJ) require-xcode
	@bundle="$(APP_BUNDLE)"; \
	if [ -z "$$bundle" ] || [ ! -d "$$bundle" ]; then \
	  echo "error: built app not found (asked xcodebuild for CODESIGNING_FOLDER_PATH)" >&2; \
	  exit 1; \
	fi; \
	echo "==> relaunching $$bundle"; \
	pkill -x "$(APP_NAME)" 2>/dev/null || true; \
	$(MAKE) --no-print-directory lsprune KEEP="$$bundle"; \
	open $(OPEN_FLAGS) "$$bundle" || exit 1; \
	n=0; \
	while [ $$n -lt 40 ]; do \
	  pid=$$(pgrep -x "$(APP_NAME)" | head -1); \
	  if [ -n "$$pid" ]; then echo "==> $(APP_NAME) running, pid $$pid"; exit 0; fi; \
	  n=$$((n+1)); sleep 0.25; \
	done; \
	echo "error: $(APP_NAME) did not come up within 10s" >&2; exit 1

app: ## OWNER ONLY: Apple Development build + relaunch — opens a window, uses the keychain
	@echo "### 'make app' is for a human at the keyboard:"
	@echo "###   * it signs with Apple Development, which reads the login keychain"
	@echo "###   * it opens a GUI window"
	@echo "###   Agents and CI must use 'make app-build' (unsigned, silent) instead."
	@$(MAKE) --no-print-directory app-build SIGN=dev
	@$(MAKE) --no-print-directory relaunch SIGN=dev

release: ## OWNER ONLY, needs CONFIRM=1: Developer ID + notarize + staple + dmg
	@if [ "$(CONFIRM)" != "1" ]; then \
	  echo "make: refusing to run release without CONFIRM=1." >&2; \
	  echo "" >&2; \
	  echo "  This signs with 'Developer ID Application', which reads the login keychain" >&2; \
	  echo "  and can raise a password dialog — a dialog nobody answers hangs the build" >&2; \
	  echo "  rather than failing it.  It also uploads to Apple's notary service, which" >&2; \
	  echo "  takes minutes and is not free to repeat carelessly." >&2; \
	  echo "" >&2; \
	  echo "  Run it only while you are sitting at this Mac:" >&2; \
	  echo "      make release CONFIRM=1" >&2; \
	  echo "" >&2; \
	  echo "  Notarization needs an App Store Connect API key.  It is per-*team*, so the" >&2; \
	  echo "  one issued for any other app of team R2294BC6J8 works here.  Either export" >&2; \
	  echo "  ASC_PRIVATE_KEY_PATH, ASC_KEY_ID and ASC_ISSUER_ID, or store it once:" >&2; \
	  echo "      xcrun notarytool store-credentials piposs-notary \\" >&2; \
	  echo "        --key <AuthKey_XXX.p8> --key-id <KEY_ID> --issuer <ISSUER_ID>" >&2; \
	  echo "" >&2; \
	  echo "  See docs/release.md.  CI does the same thing from a tag." >&2; \
	  exit 1; \
	fi
	@scripts/release.sh

app-signed: ## OWNER ONLY, needs CONFIRM=1: Developer ID build — WILL show a password dialog
	@if [ "$(CONFIRM)" != "1" ]; then \
	  echo "make: refusing to run app-signed without CONFIRM=1." >&2; \
	  echo "" >&2; \
	  echo "  This target signs with 'Developer ID Application', which makes macOS ask" >&2; \
	  echo "  for the login keychain password in a dialog box.  A dialog nobody answers" >&2; \
	  echo "  does not fail the build — it hangs it for ever.  That already happened once," >&2; \
	  echo "  to a sleeping owner, which is why this gate exists." >&2; \
	  echo "" >&2; \
	  echo "  Run it only while you are sitting at this Mac:" >&2; \
	  echo "      make app-signed CONFIRM=1" >&2; \
	  echo "" >&2; \
	  echo "  For a compile check use 'make app-build'; for a Safari-testable build use" >&2; \
	  echo "  'make app'.  Neither needs the distribution identity." >&2; \
	  exit 1; \
	fi
	@echo "### Developer ID signing: macOS may now ask for your keychain password."
	@$(MAKE) --no-print-directory app-build SIGN=devid
	@$(MAKE) --no-print-directory relaunch SIGN=devid

# --------------------------------------------------------------------- gates
# RRR 10.1.4 states the Xcode gate in Release, so that is what `check` builds even though
# the app targets default to Debug.  `make check CHECK_CONFIG=Debug` for a faster pass.
CHECK_CONFIG ?= Release

# ------------------------------------------------------------- entitlements (T18)
# The entitlement set of the **product**, which is the only place it is real.  Why the set
# is what it is belongs to project.yml, where the settings that produce it live; this is
# the check.
#
# `test/entitlements.test.ts` asserts the *declarations*, and a declaration gate can only
# name the settings somebody thought of.  So this target asserts the opposite way round:
# dump what the signature actually carries and require it to equal an exact allow-list,
# which catches settings Xcode has not invented yet.
#
# Two of the four keys look removable and are not.  `get-task-allow` is a
# *development-signing artefact* — Xcode adds it and strips it again when
# DEPLOYMENT_POSTPROCESSING is on, which is what makes a build notarizable, so it appears
# here and not in the shipped Developer ID product (docs/app-store.md §2.2 has that dump).
# `network.client` and `files.user-selected.read-only` are BF13's: removing them broke
# `getStateOfSafariExtension`, and this target could not have caught it — an allow-list
# notices a key *appearing*, and what broke was a key *missing*.  Only Safari can test
# that; project.yml's BF13 block is the account.
#
# `network.client` is app-only; the appex gets the other two.
ENTITLEMENTS_DD       ?= /tmp/piposs-dd-entitlements
ENTITLEMENTS_EXPECTED_APP   := com.apple.security.app-sandbox com.apple.security.get-task-allow \
                               com.apple.security.network.client \
                               com.apple.security.files.user-selected.read-only
ENTITLEMENTS_EXPECTED_APPEX := com.apple.security.app-sandbox com.apple.security.get-task-allow \
                               com.apple.security.files.user-selected.read-only

# The bundle is unregistered and deleted the moment it has been read, and that is not
# tidiness: see the `lsprune` comment for what a stray registration does to the owner's
# Safari.  A target that builds an app it does not install owes the machine that cleanup.
entitlements: $(PBXPROJ) require-xcode ## Assert the product's signed entitlements against the allow-list (ad-hoc, no keychain)
	@echo "==> ad-hoc Release build for entitlement verification only (DEVELOPER_DIR=$(DEV_DIR))"
	@echo "==>   NOT installable: Safari refuses an extension from an ad-hoc-signed app."
	@if ! $(XCODEBUILD) -project "$(ROOT)/$(PROJECT)" -scheme "$(SCHEME)" -configuration Release \
	    -derivedDataPath "$(ENTITLEMENTS_DD)" $(ADHOC_VERIFY_FLAGS) build > "$(ENTITLEMENTS_DD).log" 2>&1; then \
	  echo "error: the ad-hoc verification build failed — see $(ENTITLEMENTS_DD).log" >&2; \
	  tail -25 "$(ENTITLEMENTS_DD).log" >&2; \
	  exit 1; \
	fi
	@if ! grep -q -- "codesign --force --sign - " "$(ENTITLEMENTS_DD).log"; then \
	  echo "error: this build did not sign ad-hoc." >&2; \
	  echo "  Expected '/usr/bin/codesign --force --sign -' in the log.  Anything else means an" >&2; \
	  echo "  identity was resolved, which reads the login keychain and can raise a password" >&2; \
	  echo "  dialog — CLAUDE.md forbids that on an unattended path.  Refusing to continue." >&2; \
	  exit 1; \
	fi
	@app="$(ENTITLEMENTS_DD)/Build/Products/Release/$(APP_NAME).app"; \
	status=0; \
	for bundle in "$$app" "$$app/Contents/PlugIns/$(APP_NAME) Extension.appex"; do \
	  case "$$bundle" in \
	    *.appex) want=$$(printf '%s\n' $(ENTITLEMENTS_EXPECTED_APPEX) | sort);; \
	    *)       want=$$(printf '%s\n' $(ENTITLEMENTS_EXPECTED_APP)   | sort);; \
	  esac; \
	  if [ ! -d "$$bundle" ]; then echo "error: not built: $$bundle" >&2; exit 1; fi; \
	  dump=$$(/usr/bin/codesign -d --entitlements - --xml "$$bundle" 2>/dev/null | /usr/bin/plutil -p -); \
	  if [ -z "$$dump" ]; then \
	    echo "error: $$bundle carries no entitlements at all." >&2; \
	    echo "  That is what a SIGN=no product looks like; this target must sign ad-hoc." >&2; \
	    exit 1; \
	  fi; \
	  got=$$(printf '%s\n' "$$dump" | sed -n 's/^ *"\([^"]*\)" => .*$$/\1/p' | sort); \
	  if [ "$$got" != "$$want" ]; then \
	    echo "FAIL $$(basename "$$bundle"): signed entitlements are not the allow-list." >&2; \
	    echo "  want:" >&2; printf '%s\n' "$$want" | sed 's/^/    /' >&2; \
	    echo "  got:"  >&2; printf '%s\n' "$$got"  | sed 's/^/    /' >&2; \
	    echo "  An extra key means a build setting was added — see project.yml's entitlement" >&2; \
	    echo "  block and docs/app-store.md.  A missing one means a grant the store requires" >&2; \
	    echo "  was lost." >&2; \
	    status=1; \
	  fi; \
	  n=$$(printf '%s\n' "$$dump" | grep -c '=> true'); \
	  k=$$(printf '%s\n' "$$got" | grep -c .); \
	  if [ "$$n" != "$$k" ]; then \
	    echo "FAIL $$(basename "$$bundle"): $$k entitlement keys but $$n of them are true." >&2; \
	    printf '%s\n' "$$dump" | sed 's/^/    /' >&2; \
	    status=1; \
	  fi; \
	  if ! /usr/bin/codesign -dv --verbose=2 "$$bundle" 2>&1 | grep -q "flags=0x[0-9a-f]*(.*runtime"; then \
	    echo "FAIL $$(basename "$$bundle"): the hardened runtime flag is not on the product." >&2; \
	    echo "  ENABLE_HARDENED_RUNTIME is what puts '-o runtime' on the codesign command," >&2; \
	    echo "  and notarization needs it (RRR 10.2.5)." >&2; \
	    status=1; \
	  fi; \
	done; \
	if [ $$status -ne 0 ]; then exit 1; fi; \
	echo "==> signed entitlements equal the allow-list, and the two lists differ:"; \
	echo "==>   app:   $$(printf '%s ' $(ENTITLEMENTS_EXPECTED_APP)   | sed 's/com\.apple\.security\.//g')"; \
	echo "==>   appex: $$(printf '%s ' $(ENTITLEMENTS_EXPECTED_APPEX) | sed 's/com\.apple\.security\.//g')"; \
	echo "==>   plus the hardened runtime flag on both."
	@$(call lsunregister,$(ENTITLEMENTS_DD)/Build/Products/Release/$(APP_NAME).app)
	@rm -rf "$(ENTITLEMENTS_DD)" "$(ENTITLEMENTS_DD).log"

# `require-sign` runs here even though the sub-make forces SIGN=no: the forcing makes a
# garbage SIGN *harmless*, but it would also make it *silent*, and a refusal this file
# advertises has to fire on the target people actually run.
check: require-sign require-xcode require-xcodegen format-check lint test build entitlements ## The automatic gates in one command (see docs for what it does NOT assert)
	@$(MAKE) --no-print-directory app-build CONFIG=$(CHECK_CONFIG) SIGN=no
	@echo "==> formatting, lint, tests, bundle, the product's signed entitlements and an"
	@echo "==> unsigned $(CHECK_CONFIG) xcodebuild all passed: RRR 10.1 items 1-3 in full,"
	@echo "==> plus the command behind 4.  NOT asserted here: 4's 'zero warnings introduced"
	@echo "==> by us', which needs a cold build and a per-Xcode-version inventory"
	@echo "==> (DECISIONS 149) — docs/development.md has the command.  Signature"
	@echo "==> verification and every Safari check are RRR 10.2, the owner's."

# Deliberately does NOT depend on $(PBXPROJ): cleaning is not a reason to generate a
# project, and a checkout with no project has nothing for xcodebuild to clean.
clean: require-pnpm ## Drop dist/ and the Xcode build products
	@$(RUN_PNPM) run clean
	@if [ -n "$(DEV_DIR)" ] && [ -f "$(PBXPROJ)" ]; then \
	  $(XCODEBUILD) $(XCODEFLAGS) -quiet clean >/dev/null 2>/tmp/piposs-clean.err || \
	    { echo "error: xcodebuild clean failed:" >&2; cat /tmp/piposs-clean.err >&2; exit 1; }; \
	fi
	@echo "==> cleaned"
