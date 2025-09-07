import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrderDocument = Order & Document;

@Schema({ timestamps: true })
export class Order {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({
    type: [{ productId: Types.ObjectId, quantity: Number }],
    required: true,
  })
  items: { productId: Types.ObjectId; quantity: number }[];

  @Prop({ required: true })
  totalAmount: number;

  @Prop({ default: 'pending' })
  status: string;

  @Prop()
  shippingAddress: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
