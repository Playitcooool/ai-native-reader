# Releasing RustyBooks

RustyBooks public releases currently target macOS on Apple Silicon and Intel. The supported workflow signs and notarizes both DMGs; do not upload a local unsigned build as a public release.

## One-Time Setup

Add these GitHub Actions secrets from a paid Apple Developer account:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12` certificate;
- `APPLE_CERTIFICATE_PASSWORD`: password used when exporting that certificate;
- `KEYCHAIN_PASSWORD`: a strong random password used only for the CI keychain;
- `APPLE_ID`: Apple ID used for notarization;
- `APPLE_PASSWORD`: app-specific password for that Apple ID; and
- `APPLE_TEAM_ID`: Apple Developer team ID.

Before publishing broadly, also make the repository's license intentional and enable a private security-reporting channel. Neither decision should be inferred by release automation.

## Release Flow

1. Confirm the `Quality` workflow is green on `master`.
2. Run `Prepare release version` with the required semantic-version bump.
3. Run `Publish signed macOS release` from `master`; it repeats the full quality gate on the exact version commit.
4. Inspect both DMGs in the generated draft release, then publish the draft.

The publish workflow rejects reused version tags and missing credentials. It verifies each app's code signature, Gatekeeper assessment, notarization ticket, and DMG checksum before the draft is ready for publication.
