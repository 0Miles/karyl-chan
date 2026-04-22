import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const ENC_VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function getKey(): Buffer {
    const hex = process.env.ENCRYPTION_KEY;
    if (!hex) {
        throw new Error('ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32');
    }
    const key = Buffer.from(hex, 'hex');
    if (key.length !== KEY_BYTES) {
        throw new Error(`ENCRYPTION_KEY must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex characters)`);
    }
    return key;
}

export function encryptSecret(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, getKey(), iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENC_VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(value: string): string {
    if (!value.startsWith(`${ENC_VERSION}:`)) {
        console.warn('decryptSecret: legacy plaintext value detected; re-save via /rcon-forward-channel edit to encrypt at rest.');
        return value;
    }
    const parts = value.split(':');
    if (parts.length !== 4) {
        throw new Error('Invalid encrypted value format');
    }
    const [, ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    const decipher = createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
