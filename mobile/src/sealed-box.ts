// Sealed-box encryption for GitHub repository secrets.
//
// GitHub's Secrets API requires values encrypted with libsodium's crypto_box_seal
// against the repo's public key. We implement crypto_box_seal manually with
// tweetnacl + blakejs because libsodium-wrappers trips the Metro bundler's
// import.meta limitation on web.
//
// Algorithm (from libsodium source):
//   ephemeral_pk, ephemeral_sk = nacl_box_keypair()
//   nonce = blake2b(ephemeral_pk || recipient_pk, 24 bytes)
//   ciphertext = nacl_box(message, nonce, recipient_pk, ephemeral_sk)
//   sealed = ephemeral_pk || ciphertext         // 32-byte pk prepended
//
// Reference: https://libsodium.gitbook.io/doc/public-key_cryptography/sealed_boxes

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { blake2b } from 'blakejs';

function cryptoBoxSeal(message: Uint8Array, recipientPk: Uint8Array): Uint8Array {
  const ephemeral = nacl.box.keyPair();
  const nonceInput = new Uint8Array(ephemeral.publicKey.length + recipientPk.length);
  nonceInput.set(ephemeral.publicKey, 0);
  nonceInput.set(recipientPk, ephemeral.publicKey.length);
  const nonce = blake2b(nonceInput, undefined, 24);
  const box = nacl.box(message, nonce, recipientPk, ephemeral.secretKey);
  const sealed = new Uint8Array(ephemeral.publicKey.length + box.length);
  sealed.set(ephemeral.publicKey, 0);
  sealed.set(box, ephemeral.publicKey.length);
  return sealed;
}

export async function encryptForSecret(publicKeyB64: string, plaintext: string): Promise<string> {
  const pk = naclUtil.decodeBase64(publicKeyB64);
  const msg = naclUtil.decodeUTF8(plaintext);
  const sealed = cryptoBoxSeal(msg, pk);
  return naclUtil.encodeBase64(sealed);
}

// Base64 helpers used by the Contents API. Async for consistency with the
// previous libsodium-based shape, but the underlying calls are synchronous.
export async function utf8ToBase64(s: string): Promise<string> {
  return naclUtil.encodeBase64(naclUtil.decodeUTF8(s));
}

export async function base64ToUtf8(b64: string): Promise<string> {
  return naclUtil.encodeUTF8(naclUtil.decodeBase64(b64));
}
