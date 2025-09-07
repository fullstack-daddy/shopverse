import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { QueueService } from '../queues/queue.service';
import { ApiConfigService } from 'src/config/env.validation';
import { ProductsModule } from 'src/products/products.module';
import { UsersModule } from 'src/users/users.module';
import { TransactionsModule } from 'src/transactions/transactions.module';
import { Product, ProductSchema } from 'src/products/schemas/product.schema';

@Module({
  imports: [
    ProductsModule,
    UsersModule,
    TransactionsModule,
    MongooseModule.forFeature([{ name: Product.name, schema: ProductSchema }]),
    EventEmitterModule.forRoot({
      maxListeners: 10,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    }),
  ],
  controllers: [PaymentController],
  providers: [
    ApiConfigService,
    PaymentService,
    QueueService,
  ],
  exports: [PaymentService, QueueService],
})
export class PaymentModule {}
