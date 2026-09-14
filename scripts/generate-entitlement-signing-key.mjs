import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePkcs8 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const publicSpki = publicKey.export({ type: "spki", format: "der" }).toString("base64");

console.log("Generated a new Ensemblis desktop entitlement signing keypair.");
console.log("Store the private value only in the production secret manager.");
console.log("\nENSEMBLIS_ENTITLEMENT_SIGNER_PKCS8_BASE64=" + privatePkcs8);
console.log("ENSEMBLIS_ENTITLEMENT_PUBLIC_KEY_SPKI_BASE64=" + publicSpki);
