import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { ApiConfigService } from 'src/config/env.validation';

interface PaymentProps {
  amount: string;
  email: string;
  currency: string;
  name: string;
  paymentChannels: string[];
  metadata: Record<string, any>;
  checkout_url: string;
}

@Injectable()
export class PaymentService {
  constructor(private readonly apiConfig: ApiConfigService) {}
  async initiateCardPayment(
    amount: string,
    email: string,
    currency: string,
    name: string,
    paymentChannels: string[],
    metadata: Record<string, any>,
  ): Promise<PaymentProps> {
    try {
      const amountInKobo = parseInt(amount) * 100;

      const response = await axios.post(
        `${this.apiConfig.squadBaseUrl}/transaction/initiate`,
        {
          amount: amountInKobo,
          email,
          currency,
          customer_name: name,
          initiate_type: 'inline',
          transaction_ref: metadata?.reference,
          payment_channels: paymentChannels,
          metadata,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiConfig.squadSecretKey}`,
          },
        },
      );

      if (response.status === 200) {
        return response.data.data;
      } else {
        console.log(response.data);
        throw new InternalServerErrorException('Payment initiation failed');
      }
    } catch (error) {
      console.error('Error initiating payment:', error);
      throw new InternalServerErrorException('Payment initiation failed');
    }
  }
}
