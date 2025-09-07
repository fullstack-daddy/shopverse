import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {v4 as uuidv4} from "uuid"

export type ProductDocument = Product & Document;

@Schema({ timestamps: true })
export class Product {

  @Prop({ required: true, default: uuidv4, unique: true })
  id: string;
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  price: number;

  @Prop({ required: true })
  stock: number;

  @Prop({ type: [String], default: [] })
  images: string[];

  @Prop({ required: true })
  category: string;

  @Prop({ default: false })
  isFeatured: boolean;

  @Prop({ default: 0 })
  rating: number;

  @Prop({ default: 0 })
  numReviews: number;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
