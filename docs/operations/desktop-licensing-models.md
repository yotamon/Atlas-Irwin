# Desktop licensing and optional model operations

## Purpose

Ensemblis Studio desktop licensing authorizes capabilities, not plan names. The local runtime can continue licensed local work without a network connection, while cloud capabilities remain online service capabilities.

## Signing configuration

Production license issuance requires two server-only environment values:

- `ENSEMBLIS_ENTITLEMENT_SIGNER_PKCS8_BASE64`: Ed25519 private signing key encoded as PKCS#8 DER then Base64.
- `ENSEMBLIS_ENTITLEMENT_PUBLIC_KEY_SPKI_BASE64`: matching Ed25519 public key encoded as SPKI DER then Base64.

Generate a fresh production pair locally with:

```bash
node scripts/generate-entitlement-signing-key.mjs
```

Run that command only in a trusted local/admin environment. It prints the new private and public values once so they can be copied directly into the deployment secret manager. Never run the generator in shared CI logs and never commit either generated value to the repository.

Never expose the private key to browser or desktop code. Store it only in the deployment secret manager. The public key is distributed inside an explicitly issued `.license` document and is pinned by the desktop after signature verification.

A signing-key rotation is an explicit trust event. Existing desktop installations fail closed if a different key is presented through a refresh/import path. Re-pair or explicitly import a license signed by the new trusted key as part of a documented rotation. Generate the replacement pair first, update both server values atomically, then deliberately re-establish trust on affected desktops. Do not silently accept a key change during entitlement refresh.

## Perpetual Studio activation

Studio v1 is represented by a perpetual major-version activation. Activation is enforced server-side under a row lock and permits at most three active devices for an owner/major-version pair. Reissuing a license for an already activated device is idempotent and does not consume another slot.

The signed claims contain short-lived online/account capabilities and perpetual local capabilities. `local.processing` and `local.advanced_models` remain usable offline for a verified Studio perpetual license. Processor code never checks `studio_perpetual_v1` directly; it checks the required capability.

## Issuing a license

The authenticated Studio endpoint is:

`POST /api/studio/dj-library/license`

Body:

```json
{
  "artistId": "<artist UUID>",
  "deviceId": "<paired device UUID>"
}
```

The endpoint verifies ownership/artist scope, activates the Studio major-version license, signs a device-bound entitlement and returns an attachment named `Ensemblis-Studio-<public-device-id>.license`.

The desktop imports that file through **Import Studio license**. The Rust trust boundary verifies:

1. document size and schema,
2. device identity,
3. Ed25519 SPKI key shape and key id,
4. token signature,
5. signed claim identity and time ordering,
6. offline-capability subset rules,
7. pinned-key consistency on subsequent refresh/import paths.

Only after those checks are capabilities persisted in device-local SQLite settings.

## Publishing optional models

The model catalog is cloud metadata only. A model row contains:

- stable id/version,
- target operating system and architecture,
- HTTPS artifact URL,
- exact byte size,
- `sha256:<hex>` checksum,
- optional required capability,
- path-free display metadata.

Publish a row only after the artifact has been generated for the exact target and its immutable size/checksum are known. Replacing bytes under an existing `(id, version, platform, architecture)` identity is prohibited operationally; publish a new version instead.

## Desktop model installation

The native runtime filters the catalog to the current OS/architecture. Before install it verifies the required signed capability. Download/install then fails closed unless all of the following are true:

- initial and redirected URLs remain HTTPS,
- no URL contains embedded credentials,
- redirect count stays within the native limit,
- declared model size is within the 20 GiB safety budget,
- streamed bytes never exceed the exact declared size,
- final byte count exactly matches the catalog,
- SHA-256 exactly matches the catalog,
- the temporary file is fsynced before atomic rename.

The portable project, sync envelope and cloud model catalog never receive the final local model path.

## Revocation and limits

Revoking a paired Library Bridge device stops cloud/device authentication but does not silently rewrite a previously issued perpetual license file. Device-limit administration and license-key rotation are separate explicit operations. If product policy later requires perpetual local revocation, introduce a new signed license contract/version rather than making offline behavior depend on a hidden network check.
