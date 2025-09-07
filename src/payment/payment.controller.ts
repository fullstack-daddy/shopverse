import {
  Controller,
  Post,
  Body,
  HttpStatus,
  HttpException,
  Get,
  Param,
  Delete,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { UsersService } from '../users/users.service';
import { TransactionService } from '../transactions/transactions.service';
import { QueueService } from '../queues/queue.service';
import { createId } from '@paralleldrive/cuid2';
import { ApiConfigService } from 'src/config/env.validation';
import { ProductsService } from 'src/products/products.service';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';

interface RequestProps {
  userId: string;
  productId: string;
  quantity: number;
}

interface QueueStatusResponse {
  inQueue: boolean;
  position?: number;
  estimatedWaitTime?: number;
  expiresAt?: number;
  message: string;
}

@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly productService: ProductsService,
    private readonly userService: UsersService,
    private readonly transactionService: TransactionService,
    private readonly queueService: QueueService,
    private readonly apiConfig: ApiConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Post('checkout')
  async initiateCheckout(@Body() body: RequestProps) {
    const { userId, productId, quantity } = body;

    if (!userId || !productId || !quantity) {
      throw new HttpException(
        {
          error: 'Missing required fields',
          details: 'userId, quantity, and productId are required',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (quantity <= 0 || quantity > 10) {
      throw new HttpException(
        'Invalid quantity. Must be between 1 and 10',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.userService.findOne(userId);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const product = await this.productService.findOne(productId);
    if (!product) {
      throw new HttpException('Product not found', HttpStatus.NOT_FOUND);
    }

    const shouldUseQueue =
      await this.queueService.shouldActivateQueue(productId);

    if (shouldUseQueue) {
      return this.handleQueuedCheckout(user, product, quantity);
    } else {
      return this.handleRegularCheckout(user, product, quantity);
    }
  }

  @Get('queue/status/:userId/:productId')
  async getQueueStatus(
    @Param('userId') userId: string,
    @Param('productId') productId: string,
  ): Promise<QueueStatusResponse> {
    const queueStatus = this.queueService.getQueueStatus(userId, productId);

    if (!queueStatus.inQueue) {
      return {
        inQueue: false,
        message: 'You are not currently in queue for this product',
      };
    }

    const timeRemaining = queueStatus.expiresAt
      ? queueStatus.expiresAt - Date.now()
      : 0;

    return {
      inQueue: true,
      position: queueStatus.position,
      estimatedWaitTime: queueStatus.estimatedWaitTime,
      expiresAt: queueStatus.expiresAt,
      message: `You are in position ${queueStatus.position}. Time remaining: ${Math.ceil(timeRemaining / 60000)} minutes`,
    };
  }

  @Get('queue/all/:userId')
  async getUserQueues(@Param('userId') userId: string) {
    const queues = this.queueService.getUserQueues(userId);
    return {
      message: 'User queues retrieved successfully',
      data: { activeQueues: queues },
    };
  }

  @Delete('queue/:userId/:productId')
  async leaveQueue(
    @Param('userId') userId: string,
    @Param('productId') productId: string,
  ) {
    const success = await this.queueService.leaveQueue(userId, productId);

    if (!success) {
      throw new HttpException(
        'Failed to leave queue or not in queue',
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      message: 'Successfully left the queue',
    };
  }

  private async handleQueuedCheckout(
    user: any,
    product: any,
    quantity: number,
  ) {
    try {
      const queueResult = await this.queueService.joinQueue(
        user.id || user._id,
        product.id,
        quantity,
        user.email,
        user.name,
      );

      if (!queueResult.success) {
        throw new HttpException(
          {
            message: 'Unable to join queue',
            details: queueResult.message,
            isQueueFull: queueResult.message.includes(
              'unavailable due to high demand',
            ),
          },
          HttpStatus.CONFLICT,
        );
      }
      const purchaseAmount = product.price * quantity;
      const newTransactionRef = `${this.apiConfig.squadMID}_${createId()}_QW_${Date.now()}`;

      await this.transactionService.createTransactionRecord({
        amount: purchaseAmount,
        user: {
          id: user.id || user._id,
          name: user.name,
          email: user.email,
        },
        type: 'CREDIT',
        category: 'PRODUCT_PURCHASE',
        description: `Queued purchase of ${product.name} (Qty: ${quantity}) at ₦${purchaseAmount}`,
        reference: newTransactionRef,
        metadata: {
          reference: newTransactionRef,
          userId: user.id || user._id,
          purchaseAmount,
          email: user.email,
          name: user.name,
          transactionCategory: 'PRODUCT_PURCHASE_QUEUED',
          queueId: queueResult.queueId,
          productId: product.id,
          quantity,
        },
        date: new Date(),
      });

      const initiateCheckout = await this.paymentService.initiateCardPayment(
        String(purchaseAmount),
        user.email,
        'NGN',
        user.name,
        ['card', 'bank', 'ussd', 'transfer'],
        {
          reference: newTransactionRef,
          userId: user.id || user._id,
          purchaseAmount,
          email: user.email,
          name: user.name,
          transactionCategory: 'PRODUCT_PURCHASE_QUEUED',
          queueId: queueResult.queueId,
          productId: product.id,
          quantity,
          description: `Queued purchase of ${product.name} (Qty: ${quantity})`,
        },
      );

      return {
        message: 'Successfully joined queue and payment initiated',
        data: {
          checkoutUrl: initiateCheckout.checkout_url,
          queueInfo: {
            position: queueResult.position,
            estimatedWaitTime: queueResult.estimatedWaitTime,
            queueId: queueResult.queueId,
          },
        },
      };
    } catch (error) {
      this.logger.error('Queued checkout error:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          message: 'Queue checkout failed',
          details: 'Please try again later or contact support',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async handleRegularCheckout(
    user: any,
    product: any,
    quantity: number,
  ) {
    try {
      if (product.stock < quantity) {
        throw new HttpException(
          'Insufficient stock available',
          HttpStatus.CONFLICT,
        );
      }

      const purchaseAmount = product.price * quantity;
      const newTransactionRef = `${this.apiConfig.squadMID}_${createId()}_FW_${Date.now()}`;

      const initiateCheckout = await this.paymentService.initiateCardPayment(
        String(purchaseAmount),
        user.email,
        'NGN',
        user.name,
        ['card', 'bank', 'ussd', 'transfer'],
        {
          reference: newTransactionRef,
          userId: user.id || user._id,
          purchaseAmount,
          email: user.email,
          name: user.name,
          transactionCategory: 'PRODUCT_PURCHASE',
          productId: product.id,
          quantity,
          description: `Purchase of ${product.name} (Qty: ${quantity}) at ₦${purchaseAmount}`,
        },
      );

      await this.transactionService.createTransactionRecord({
        amount: purchaseAmount,
        user: {
          id: user.id || user._id,
          name: user.name,
          email: user.email,
        },
        type: 'CREDIT',
        category: 'PRODUCT_PURCHASE',
        description: `Purchase of ${product.name} (Qty: ${quantity}) at ₦${purchaseAmount}`,
        reference: newTransactionRef,
        metadata: {
          reference: newTransactionRef,
          userId: user.id || user._id,
          purchaseAmount,
          email: user.email,
          name: user.name,
          transactionCategory: 'PRODUCT_PURCHASE',
          productId: product.id,
          quantity,
          description: `Purchase of ${product.name} (Qty: ${quantity}) at ₦${purchaseAmount}`,
        },
        date: new Date(),
      });

      return {
        message: 'Purchase initiated successfully',
        data: { checkoutUrl: initiateCheckout.checkout_url },
      };
    } catch (transferError) {
      this.logger.error('Regular checkout error:', transferError);

      if (transferError instanceof HttpException) {
        throw transferError;
      }

      throw new HttpException(
        {
          message: 'Initiate checkout failed due to payment service error',
          details: 'Please try again later or contact support',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @OnEvent('queue.timeout')
  async handleQueueTimeout(payload: {
    userId: string;
    productId: string;
    queueId: string;
  }) {
    this.logger.warn(
      `Queue timeout for user ${payload.userId}, product ${payload.productId}`,
    );

  }

  @OnEvent('payment.processed')
  async handlePaymentProcessed(payload: {
    userId: string;
    productId: string;
    quantity: number;
  }) {
    this.logger.log(
      `Payment processed for user ${payload.userId}, product ${payload.productId}`,
    );
  }

  @OnEvent('queue.position.updated')
  async handleQueuePositionUpdated(payload: {
    userId: string;
    productId: string;
    queueId: string;
    newPosition: number;
    estimatedWaitTime: number;
  }) {
    this.logger.log(
      `Queue position updated for user ${payload.userId}: position ${payload.newPosition}`,
    );
  }
}
