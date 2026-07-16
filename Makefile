.PHONY: build build-native test lint fmt fmt-check icons dev dev-seed preview clean install changelog bump

install:
	npm ci

dev:
	npm run dev

# Dev server seeded with realistic fake data (sets VITE_SEED). Populates
# localStorage with several namespaces of varied notes on first load so the
# UI can be debugged against lifelike content. Overwrites local sample data.
dev-seed:
	npm run dev:seed

build:
	npm run build

# Build the app for embedding in the native WebView wrapper: relative asset
# base, no service worker, output to native/web/ (copied into the binary at
# prebuild). See native/README.md.
build-native:
	npm run build:native

preview:
	npm run preview

test:
	npm run test

lint:
	npm run lint

fmt:
	npm run fmt

fmt-check:
	npm run fmt:check

# Regenerate the PWA icon set from public/favicon.svg.
icons:
	npm run icons

# Local preview of what the Release workflow will write to CHANGELOG.md.
# Pass the planned version: `make changelog VERSION=0.2.0`. Consumes the
# fragments in .changes/unreleased/ — run inside a scratch branch or
# revert afterwards if you only wanted a preview.
changelog:
	@test -n "$(VERSION)" || { \
		echo "usage: make changelog VERSION=X.Y.Z"; exit 2; \
	}
	node scripts/release/collate-changelog.mjs $(VERSION)

# Print the semver bump (patch/minor/major) the Release workflow will
# auto-derive from the current .changes/unreleased/ fragments. Read-only
# — touches nothing.
bump:
	@node scripts/release/compute-bump.mjs

clean:
	rm -rf dist dev-dist node_modules
