# Security policy for notes

## Supported versions

The latest release line on `main` receives security fixes. Older lines are
considered end-of-life.

## Reporting a vulnerability

**Do not open public GitHub issues for security problems.**

Instead, please report privately via [GitHub Security Advisories](https://github.com/niclaslindstedt/notes/security/advisories/new),
or by email to `niclas@agilator.se`.

## Response

We aim to acknowledge reports within 72 hours and provide a triage update
within 7 days.

## Disclosure

We follow coordinated disclosure: we will agree on a release window with the
reporter and credit them in the release notes (unless they request otherwise).

## Scope

In scope: any vulnerability in the published release of notes. Because the app
is local-first and stores notes in the browser, reports about data exposure
through shared storage, the service worker, or the install scope are
especially welcome.

Out of scope: vulnerabilities in third-party dependencies (please report those
upstream).
