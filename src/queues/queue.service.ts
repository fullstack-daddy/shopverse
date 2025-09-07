import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';

interface QueueItem {
  id: string;
  userId: string;
  productId: string;
  quantity: number;
  timestamp: number;
  expiresAt: number;
  userEmail: string;
  userName: string;
  reservedUntil: number;
}

interface ProductQueue {
  productId: string;
  maxQueueSize: number;
  items: QueueItem[];
  processingTimeout: number;
  isActive: boolean;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly productQueues = new Map<string, ProductQueue>();
  private readonly userQueues = new Map<string, Set<string>>();

  private readonly DEFAULT_QUEUE_SIZE = 10;
  private readonly DEFAULT_TIMEOUT = 15 * 60 * 1000; 
  private readonly LOW_STOCK_THRESHOLD = 5;
  private readonly CLEANUP_INTERVAL = 60 * 1000;
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    private eventEmitter: EventEmitter2,
  ) {
    this.startPeriodicCleanup();
  }
 
  async joinQueue(
    userId: string,
    productId: string,
    quantity: number,
    userEmail: string,
    userName: string,
  ): Promise<{
    success: boolean;
    position?: number;
    estimatedWaitTime?: number;
    queueId?: string;
    message: string;
  }> {
    try {
      const product = await this.productModel.findOne({ id: productId });
      if (!product) {
        return {
          success: false,
          message: 'Product not found',
        };
      }

      if (product.stock < quantity) {
        return {
          success: false,
          message: 'Insufficient stock available',
        };
      }

      if (this.isUserInQueue(userId, productId)) {
        return {
          success: false,
          message: 'You are already in queue for this product',
        };
      }

      let productQueue = this.productQueues.get(productId);
      if (!productQueue) {
        productQueue = this.initializeProductQueue(productId, product.stock);
      }

      if (productQueue.items.length >= productQueue.maxQueueSize) {
        await this.markProductUnavailable(productId);
        return {
          success: false,
          message:
            'Product is currently unavailable due to high demand. Please try again later.',
        };
      }

      const queueId = this.generateQueueId();
      const queueItem: QueueItem = {
        id: queueId,
        userId,
        productId,
        quantity,
        timestamp: Date.now(),
        expiresAt: Date.now() + productQueue.processingTimeout,
        userEmail,
        userName,
        reservedUntil: Date.now() + productQueue.processingTimeout,
      };

      productQueue.items.push(queueItem);
      this.productQueues.set(productId, productQueue);

      if (!this.userQueues.has(userId)) {
        this.userQueues.set(userId, new Set());
      }
      this.userQueues.get(userId)!.add(productId);

      await this.reserveStock(productId, quantity);

      this.eventEmitter.emit('queue.joined', {
        userId,
        productId,
        queueId,
        position: productQueue.items.length,
      });

      this.logger.log(
        `User ${userId} joined queue for product ${productId}. Position: ${productQueue.items.length}`,
      );

      return {
        success: true,
        position: productQueue.items.length,
        estimatedWaitTime: this.calculateEstimatedWaitTime(
          productQueue.items.length,
        ),
        queueId,
        message: 'Successfully joined the queue',
      };
    } catch (error) {
      this.logger.error(`Error joining queue: ${error.message}`, error.stack);
      return {
        success: false,
        message: 'Failed to join queue. Please try again.',
      };
    }
  }

  /**
   * Removes user from queue (manual leave or payment completion)
   */
  async leaveQueue(
    userId: string,
    productId: string,
    queueId?: string,
  ): Promise<boolean> {
    try {
      const productQueue = this.productQueues.get(productId);
      if (!productQueue) return false;

      const itemIndex = productQueue.items.findIndex(
        (item) => item.userId === userId && (!queueId || item.id === queueId),
      );

      if (itemIndex === -1) return false;

      const removedItem = productQueue.items[itemIndex];
      productQueue.items.splice(itemIndex, 1);

      await this.releaseReservedStock(productId, removedItem.quantity);

      const userQueues = this.userQueues.get(userId);
      if (userQueues) {
        userQueues.delete(productId);
        if (userQueues.size === 0) {
          this.userQueues.delete(userId);
        }
      }

      this.updateQueuePositions(productQueue);

      this.eventEmitter.emit('queue.left', {
        userId,
        productId,
        queueId: removedItem.id,
        reason: 'manual',
      });

      await this.checkProductAvailability(productId);

      this.logger.log(`User ${userId} left queue for product ${productId}`);

      return true;
    } catch (error) {
      this.logger.error(`Error leaving queue: ${error.message}`, error.stack);
      return false;
    }
  }


  async processSuccessfulPayment(
    userId: string,
    productId: string,
    quantity: number,
  ): Promise<boolean> {
    try {
      await this.leaveQueue(userId, productId);

      await this.updateActualStock(productId, quantity);

      this.eventEmitter.emit('payment.processed', {
        userId,
        productId,
        quantity,
      });

      this.logger.log(
        `Processed successful payment for user ${userId}, product ${productId}, quantity ${quantity}`,
      );

      return true;
    } catch (error) {
      this.logger.error(
        `Error processing successful payment: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Gets queue status for a user
   */
  getQueueStatus(
    userId: string,
    productId: string,
  ): {
    inQueue: boolean;
    position?: number;
    estimatedWaitTime?: number;
    expiresAt?: number;
  } {
    const productQueue = this.productQueues.get(productId);
    if (!productQueue) {
      return { inQueue: false };
    }

    const queueItem = productQueue.items.find((item) => item.userId === userId);
    if (!queueItem) {
      return { inQueue: false };
    }

    const position =
      productQueue.items.findIndex((item) => item.userId === userId) + 1;

    return {
      inQueue: true,
      position,
      estimatedWaitTime: this.calculateEstimatedWaitTime(position),
      expiresAt: queueItem.expiresAt,
    };
  }

  /**
   * Gets all queues for a user
   */
  getUserQueues(userId: string): string[] {
    const userQueues = this.userQueues.get(userId);
    return userQueues ? Array.from(userQueues) : [];
  }

  /**
   * Checks if product should have queue activated based on stock
   */
  async shouldActivateQueue(productId: string): Promise<boolean> {
    const product = await this.productModel.findOne({ id: productId });
    return product ? product.stock <= this.LOW_STOCK_THRESHOLD : false;
  }

  /**
   * Periodic cleanup of expired queue items
   */
  @Cron(CronExpression.EVERY_MINUTE)
  private async cleanupExpiredItems(): Promise<void> {
    const now = Date.now();
    let cleanupCount = 0;

    for (const [productId, productQueue] of this.productQueues.entries()) {
      const expiredItems = productQueue.items.filter(
        (item) => item.expiresAt <= now,
      );

      for (const expiredItem of expiredItems) {
        const itemIndex = productQueue.items.findIndex(
          (item) => item.id === expiredItem.id,
        );
        if (itemIndex !== -1) {
          productQueue.items.splice(itemIndex, 1);

          await this.releaseReservedStock(productId, expiredItem.quantity);

          const userQueues = this.userQueues.get(expiredItem.userId);
          if (userQueues) {
            userQueues.delete(productId);
            if (userQueues.size === 0) {
              this.userQueues.delete(expiredItem.userId);
            }
          }

          this.eventEmitter.emit('queue.timeout', {
            userId: expiredItem.userId,
            productId,
            queueId: expiredItem.id,
          });

          cleanupCount++;
        }
      }

      if (expiredItems.length > 0) {
        this.updateQueuePositions(productQueue);
        await this.checkProductAvailability(productId);
      }

      if (productQueue.items.length === 0) {
        this.productQueues.delete(productId);
      }
    }

    if (cleanupCount > 0) {
      this.logger.log(`Cleaned up ${cleanupCount} expired queue items`);
    }
  }

  private initializeProductQueue(
    productId: string,
    stock: number,
  ): ProductQueue {
    const maxQueueSize = Math.min(this.DEFAULT_QUEUE_SIZE, stock * 2);

    const productQueue: ProductQueue = {
      productId,
      maxQueueSize,
      items: [],
      processingTimeout: this.DEFAULT_TIMEOUT,
      isActive: true,
    };

    this.productQueues.set(productId, productQueue);
    return productQueue;
  }

  private isUserInQueue(userId: string, productId: string): boolean {
    const userQueues = this.userQueues.get(userId);
    return userQueues ? userQueues.has(productId) : false;
  }

  private generateQueueId(): string {
    return `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateEstimatedWaitTime(position: number): number {
    return position * 2 * 60 * 1000;
  }

  private async reserveStock(
    productId: string,
    quantity: number,
  ): Promise<void> {
    await this.productModel.updateOne(
      { id: productId },
      { $inc: { stock: -quantity } },
    );
  }

  private async releaseReservedStock(
    productId: string,
    quantity: number,
  ): Promise<void> {
    await this.productModel.updateOne(
      { id: productId },
      { $inc: { stock: quantity } },
    );
  }

  private async updateActualStock(
    productId: string,
    quantity: number,
  ): Promise<void> {

  }

  private async markProductUnavailable(productId: string): Promise<void> {
    this.logger.warn(
      `Product ${productId} marked as temporarily unavailable due to queue overflow`,
    );
  }

  private async checkProductAvailability(productId: string): Promise<void> {
    const productQueue = this.productQueues.get(productId);
    const product = await this.productModel.findOne({ id: productId });

    if (
      product &&
      productQueue &&
      productQueue.items.length < productQueue.maxQueueSize
    ) {
      this.logger.log(`Product ${productId} is now available for purchase`);
    }
  }

  private updateQueuePositions(productQueue: ProductQueue): void {
    productQueue.items.forEach((item, index) => {
      this.eventEmitter.emit('queue.position.updated', {
        userId: item.userId,
        productId: item.productId,
        queueId: item.id,
        newPosition: index + 1,
        estimatedWaitTime: this.calculateEstimatedWaitTime(index + 1),
      });
    });
  }

  private startPeriodicCleanup(): void {
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpiredItems().catch((error) => {
        this.logger.error('Error in periodic cleanup:', error);
      });
    }, this.CLEANUP_INTERVAL);
  }
}
