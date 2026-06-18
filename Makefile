.PHONY: build test lint fmt fmt-check icons dev preview clean install

install:
	npm ci

dev:
	npm run dev

build:
	npm run build

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

clean:
	rm -rf dist dev-dist node_modules
