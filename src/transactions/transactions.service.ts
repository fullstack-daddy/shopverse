import { InjectModel } from '@nestjs/mongoose';
import { Injectable } from "@nestjs/common"
import { Transaction,TransactionDocument } from './schema/transaction.schema';
import { Model } from 'mongoose';

interface TransactionProps {
  amount: number;
  date: Date;
  reference: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  type: 'DEBIT' | 'CREDIT';
  category: 'PRODUCT_PURCHASE' | 'OTHER';
  metadata: Record<string, any>;
  description: string;
}

@Injectable()
export class TransactionService {
  constructor(
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
  ) {}

  async createTransactionRecord({
    amount,
    date,
    reference,
    user,
    category,
    type,
    metadata,
    description,
  }: TransactionProps) {
    try {
      const transaction = new this.transactionModel({
        amount,
        date,
        reference,
        user,
        category,
        type,
        metadata,
        description,
        status: 'PENDING',
      });

      return transaction.save;
    } catch (error) {}
  }
}