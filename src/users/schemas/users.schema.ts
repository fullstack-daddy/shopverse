import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {v4 as uuidv4} from "uuid"

export type UserDocument = User & Document;

@Schema({ timestamps: true, })
export class User {
  @Prop({ required: true, default: uuidv4, unique: true })
  id: string;
  

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ default: 'customer' })
  role: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
