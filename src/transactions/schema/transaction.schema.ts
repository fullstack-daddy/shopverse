import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type TransactionDocument = Transaction & Document;

class UserRef {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  email: string;
}

@Schema({ timestamps: true })
export class Transaction {
  @Prop({ required: true, default: () => uuidv4(), unique: true })
  id: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  date: Date;

  @Prop({ required: true })
  reference: string;

  @Prop({ type: UserRef, required: true })
  user: UserRef;

  @Prop({ required: true, enum: ['DEBIT', 'CREDIT'] })
  type: 'DEBIT' | 'CREDIT';

  @Prop({ required: true, enum: ['PRODUCT_PURCHASE', 'OTHER'] })
  category: 'PRODUCT_PURCHASE' | 'OTHER';

  @Prop({ required: true, enum: ['NGN'] })
  currency: 'NGN';

  @Prop({ required: true })
  description: string;

  @Prop({ required: true, type: Object })
  metadata: Record<string, any>;

  @Prop({ required: true, enum: ['PENDING', 'SUCCESSFUL', 'FAILED'] })
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
