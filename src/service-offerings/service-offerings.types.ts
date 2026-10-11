import { Field, ObjectType, InputType, ID, Int, Float } from '@nestjs/graphql';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  IsNumber,
  IsIn,
  Min,
  Max,
  ArrayMaxSize,
  Length,
  IsEnum,
  IsUUID,
} from 'class-validator';
import { KENYA_COUNTIES } from '../common/kenya-counties';
import { Vertical } from '../common/vertical-assignment';
import { PageInfo, PostAuthor, PostMedia } from '../feed/feed.types';

@ObjectType()
export class ServiceOffering {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;

  @Field()
  category: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => [String])
  skills: string[];

  @Field(() => Int)
  yearsExperience: number;

  @Field(() => Float, { nullable: true })
  startingPrice?: number;

  @Field({ nullable: true })
  priceUnit?: string;

  @Field({ nullable: true })
  county?: string;

  @Field(() => ID, { nullable: true })
  demoAssetId?: string;

  @Field(() => PostAuthor)
  provider: PostAuthor;

  @Field(() => PostMedia, { nullable: true })
  media?: PostMedia;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

@ObjectType()
export class ServiceOfferingEdge {
  @Field(() => ServiceOffering)
  node: ServiceOffering;

  @Field()
  cursor: string;
}

@ObjectType()
export class ServiceOfferingConnection {
  @Field(() => [ServiceOfferingEdge])
  edges: ServiceOfferingEdge[];

  @Field(() => PageInfo)
  pageInfo: PageInfo;
}

@InputType()
export class CreateServiceOfferingInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(3, 80)
  title: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(2, 60)
  category: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field(() => [String])
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 30, { each: true })
  skills: string[];

  @Field(() => Int)
  @IsInt()
  @Min(0)
  @Max(60)
  yearsExperience: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  startingPrice?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  priceUnit?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @IsIn(KENYA_COUNTIES)
  county?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  demoAssetId?: string;

  @Field(() => Vertical)
  @IsNotEmpty()
  @IsEnum(Vertical, {
    message: 'Vertical must be either BUSINESS or AGRICULTURE',
  })
  @IsString()
  vertical: Vertical;
}
