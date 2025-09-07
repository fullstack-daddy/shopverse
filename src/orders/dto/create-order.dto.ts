import { IsArray, IsNumber, IsString, IsMongoId } from 'class-validator';

export class CreateOrderDto {
  @IsMongoId()
  user: string;

  @IsArray()
  items: { productId: string; quantity: number }[];

  @IsNumber()
  totalAmount: number;

  @IsString()
  shippingAddress: string;
}
