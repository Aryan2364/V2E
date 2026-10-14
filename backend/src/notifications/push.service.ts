import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Web Push (VAPID) delivery. Best-effort: failures are logged, never thrown.
 * Dead subscriptions (404/410 from the push service) are pruned automatically.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly enabled: boolean;

  constructor(private readonly prisma: PrismaService) {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    this.enabled = !!(pub && priv);
    if (this.enabled) {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT ?? 'mailto:admin@rgbindia.com',
        pub!,
        priv!,
      );
    } else {
      this.logger.warn('VAPID keys not set — web push delivery disabled');
    }
  }

  getPublicKey(): string | null {
    return this.enabled ? (process.env.VAPID_PUBLIC_KEY as string) : null;
  }

  async sendToUser(
    orgId: string,
    userId: string,
    payload: { title: string; body: string; link?: string | null; badge_count?: number },
  ) {
    if (!this.enabled) return;
    const subs = await this.prisma.pushSubscription.findMany({
      where: { organization_id: orgId, user_id: userId },
    });
    if (subs.length === 0) return;

    const json = JSON.stringify(payload);
    await Promise.allSettled(
      subs.map((s) =>
        webpush
          .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, json)
          .catch(async (err: any) => {
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              // Subscription expired/unsubscribed — prune it.
              await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => null);
            } else {
              this.logger.warn(`Push send failed for user ${userId}: ${err?.statusCode ?? err}`);
            }
          }),
      ),
    );
  }
}
