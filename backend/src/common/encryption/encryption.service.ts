import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// Authenticated symmetric encryption for secrets we must be able to READ back
// (unlike passwords/refresh-tokens, which are one-way hashed). Google's OAuth
// refresh token is the first such secret: we have to decrypt it to call Google
// on the user's behalf, but a DB leak must not expose a usable grant.
//
// AES-256-GCM gives confidentiality + tamper detection. The 256-bit key is
// derived (sha256) from GCAL_ENC_KEY, falling back to JWT_SECRET so production
// needs no extra env var. Ciphertext format: `enc:v1:<iv>:<tag>:<data>` (each
// part base64). The `enc:v1:` tag lets us recognise our own ciphertext and
// migrate formats later.
const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret =
      config.get<string>('GCAL_ENC_KEY') ||
      config.get<string>('JWT_SECRET') ||
      'insecure-dev-key-change-me';
    this.key = createHash('sha256').update(secret).digest(); // 32 bytes
  }

  isEncrypted(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return (
      PREFIX +
      [iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':')
    );
  }

  decrypt(value: string): string {
    if (!this.isEncrypted(value)) return value; // tolerate legacy plaintext
    const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(':');
    const decipher = createDecipheriv(ALGO, this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  }

  // Never throw on a bad/rotated key — a token we can't read is treated as
  // "not connected" rather than crashing a request.
  decryptSafe(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
      return this.decrypt(value);
    } catch (err: any) {
      this.logger.warn(`Failed to decrypt a stored secret: ${err?.message ?? err}`);
      return null;
    }
  }
}
