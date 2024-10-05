import { Injectable, Inject, Logger } from '@nestjs/common';
import { FCM_OPTIONS } from '../fcm.constants';
import { FcmOptions } from '../interfaces/fcm-options.interface';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import {
  getMessaging,
  MulticastMessage,
  MessagingPayload,
  SendResponse,
  BatchResponse,
  Messaging,
} from 'firebase-admin/messaging';

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private messaging: Messaging;

  constructor(
    @Inject(FCM_OPTIONS) private readonly fcmOptionsProvider: FcmOptions,
  ) {
    // Initialize Firebase app if it hasn't been initialized yet
    if (!getApps().length) {
      initializeApp({
        credential: cert(this.fcmOptionsProvider.firebaseSpecsPath),
      });
      this.logger.log('Firebase app initialized');
    }
    // Initialize messaging after the app has been initialized
    this.messaging = getMessaging();
  }

  async sendNotification(
    deviceIds: string[],
    payload: MessagingPayload,
    silent: boolean,
    imageUrl?: string,
  ): Promise<{
    failureCount: number;
    successCount: number;
    failedDeviceIds: string[];
  }> {
    if (!deviceIds.length) {
      this.logger.warn('Empty device IDs list provided');
      throw new Error('You provided an empty device IDs list!');
    }

    const batchSize = 500;
    let failureCount = 0;
    let successCount = 0;
    const failedDeviceIds: string[] = [];

    // Prepare the message template
    const messageTemplate: Partial<MulticastMessage> = {
      data: payload?.data,
      notification: {
        title: payload?.notification?.title,
        body: payload?.notification?.body,
        imageUrl,
      },
      apns: {
        payload: {
          aps: {
            sound: payload?.notification?.sound,
            'content-available': silent ? 1 : undefined,
            'mutable-content': 1,
          },
        },
        fcmOptions: {
          imageUrl,
        },
      },
      android: {
        priority: 'high',
        ttl: 86400000, // 24 hours in milliseconds
        notification: {
          sound: payload?.notification?.sound,
        },
      },
    };

    try {
      while (deviceIds.length) {
        const tokensBatch = deviceIds.splice(0, batchSize);
        const multicastMessage: MulticastMessage = {
          ...messageTemplate,
          tokens: tokensBatch,
        } as MulticastMessage;

        const response: BatchResponse =
          await this.messaging.sendEachForMulticast(multicastMessage);

        successCount += response.successCount;
        failureCount += response.failureCount;

        response.responses.forEach((resp: SendResponse, idx: number) => {
          if (!resp.success) {
            const failedToken = tokensBatch[idx];
            failedDeviceIds.push(failedToken);
            this.logger.error(
              `Failed to send notification to ${failedToken}: ${resp.error?.message}`,
            );
          }
        });

        this.logger.log(
          `Batch processed: ${response.successCount} successful, ${response.failureCount} failed.`,
        );
      }
    } catch (error) {
      this.logger.error('Error sending notifications', error.stack);
      throw error;
    }

    this.logger.log(
      `Notifications sent: ${successCount} successful, ${failureCount} failed in total.`,
    );

    return { failureCount, successCount, failedDeviceIds };
  }
}
