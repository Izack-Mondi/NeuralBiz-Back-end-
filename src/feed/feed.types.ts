import { Field, ObjectType, InputType, ID, registerEnumType, Int, Float } from '@nestjs/graphql';
import { Vertical } from '../common/vertical-assignment';
import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsString,
  IsUUID,
  IsNumber,
  IsBoolean,
  Length,
} from 'class-validator';
import { MediaAssetKind } from '../media/media.types';

export enum PostType {
  GENERAL = 'GENERAL',
  MARKETPLACE = 'MARKETPLACE',
  SERVICE = 'SERVICE',
  OPPORTUNITY = 'OPPORTUNITY',
}

registerEnumType(PostType, {
  name: 'PostType',
});

registerEnumType(Vertical, {
  name: 'PostVertical',
});

export enum FeedTab {
  ALL = 'ALL',
  BUSINESS = 'BUSINESS',
  AGRICULTURE = 'AGRICULTURE',
  OPPORTUNITY = 'OPPORTUNITY',
}

registerEnumType(FeedTab, {
  name: 'FeedTab',
});

export enum MediaType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  TEXT = 'TEXT',
}

registerEnumType(MediaType, {
  name: 'MediaType',
});

export enum PostStatus {
  PUBLISHED = 'PUBLISHED',
  PROCESSING = 'PROCESSING',
  REJECTED = 'REJECTED',
}

registerEnumType(PostStatus, {
  name: 'PostStatus',
});

@ObjectType()
export class PostAuthor {
  @Field(() => ID)
  id: string;

  @Field()
  fullName: string;

  @Field({ nullable: true })
  location?: string;

  @Field()
  isVerified: boolean;
}

@ObjectType()
export class PostContact {
  @Field(() => ID)
  id: string;

  @Field()
  fullName: string;

  @Field({ nullable: true })
  phoneNumber?: string;
}

@ObjectType()
export class PostMedia {
  @Field(() => MediaAssetKind)
  kind: MediaAssetKind;

  @Field()
  thumbnailUrl: string;

  @Field()
  previewUrl: string;

  @Field()
  blurhash: string;

  @Field(() => Float, { nullable: true })
  durationSec?: number;

  @Field(() => Int, { nullable: true })
  width?: number;

  @Field(() => Int, { nullable: true })
  height?: number;

  @Field()
  hasVideo: boolean;
}

@ObjectType()
export class PostServiceOffering {
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
}

@ObjectType()
export class PostProduct {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  price: number;

  @Field()
  unit: string;

  @Field()
  category: string;

  @Field({ nullable: true })
  location?: string;

  @Field({ nullable: true })
  mediaUrl?: string;

  @Field({ nullable: true })
  thumbnailUrl?: string;

  @Field(() => MediaType)
  mediaType: MediaType;
}

@ObjectType()
export class PostService {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  category: string;

  @Field({ nullable: true })
  location?: string;

  @Field({ nullable: true })
  price?: string;

  @Field({ nullable: true })
  availability?: string;

  @Field({ nullable: true })
  experience?: string;

  @Field({ nullable: true })
  mediaUrl?: string;

  @Field({ nullable: true })
  thumbnailUrl?: string;

  @Field(() => MediaType)
  mediaType: MediaType;

  @Field()
  rating: number;

  @Field()
  reviews: number;
}

@ObjectType()
export class Post {
  @Field(() => ID)
  id: string;

  @Field(() => PostAuthor)
  author: PostAuthor;

  @Field(() => PostType)
  type: PostType;

  @Field(() => Vertical)
  vertical: Vertical;

  @Field({ nullable: true })
  caption?: string;

  @Field({ nullable: true })
  mediaUrl?: string;

  @Field({ nullable: true })
  thumbnailUrl?: string;

  @Field(() => MediaType)
  mediaType: MediaType;

  @Field({ nullable: true })
  media?: PostMedia;

  @Field({ nullable: true })
  offering?: PostServiceOffering;

  @Field({ nullable: true })
  product?: PostProduct;

  @Field({ nullable: true, deprecationReason: 'Use serviceOffering instead.' })
  service?: PostService;

  @Field({ nullable: true })
  rejectionReason?: string;

  @Field(() => PostStatus)
  status: PostStatus;

  @Field(() => Int, {
    description: 'Deprecated: engagement counts are not currently supported.',
    deprecationReason: 'Engagement counts are not currently supported.',
  })
  likesCount: number;

  @Field(() => Int, {
    description: 'Deprecated: engagement counts are not currently supported.',
    deprecationReason: 'Engagement counts are not currently supported.',
  })
  commentsCount: number;

  @Field(() => Int)
  viewsCount: number;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

@ObjectType()
export class PageInfo {
  @Field()
  hasNextPage: boolean;

  @Field({ nullable: true })
  endCursor?: string;
}

@ObjectType()
export class PostEdge {
  @Field(() => Post)
  node: Post;

  @Field()
  cursor: string;
}

@ObjectType()
export class FeedConnection {
  @Field(() => [PostEdge])
  edges: PostEdge[];

  @Field(() => PageInfo)
  pageInfo: PageInfo;
}

@InputType()
export class FeedInput {
  @Field(() => Int, { nullable: true, defaultValue: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  first?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  after?: string;

  @Field(() => PostType, { nullable: true, description: 'Deprecated: Use tab instead' })
  @IsOptional()
  @IsEnum(PostType)
  type?: PostType;

  @Field(() => FeedTab, { nullable: true, defaultValue: FeedTab.ALL })
  @IsOptional()
  @IsEnum(FeedTab)
  tab?: FeedTab;
}

@InputType()
export class CreatePostInput {
  @Field(() => PostType)
  @IsEnum(PostType)
  type: PostType;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  caption?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 2048)
  mediaUrl?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 2048)
  thumbnailUrl?: string;

  @Field(() => MediaType, { nullable: true })
  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  mediaAssetId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  serviceId?: string;
}

@InputType()
export class CreateProductInput {
  @Field()
  @IsString()
  @Length(2, 120)
  name: string;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  price: number;

  @Field()
  @IsString()
  @Length(1, 32)
  unit: string;

  @Field()
  @IsString()
  @Length(2, 60)
  category: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  location?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 2048)
  mediaUrl?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 2048)
  thumbnailUrl?: string;

  @Field(() => MediaType, { nullable: true })
  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  mediaAssetId?: string;

  @Field(() => Boolean, { nullable: true, defaultValue: true })
  @IsOptional()
  @IsBoolean()
  postToFeed?: boolean;
}

@InputType()
export class CreateServiceInput {
  @Field()
  @IsString()
  @Length(2, 120)
  name: string;

  @Field()
  @IsString()
  @Length(2, 60)
  category: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  location?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  price?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  availability?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  experience?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 2048)
  mediaUrl?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 2048)
  thumbnailUrl?: string;

  @Field(() => MediaType, { nullable: true })
  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;
}

@ObjectType()
export class ProductListing {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Float)
  price: number;

  @Field()
  unit: string;

  @Field()
  category: string;

  @Field({ nullable: true })
  location?: string;

  @Field(() => PostAuthor)
  seller: PostAuthor;

  @Field(() => PostMedia, { nullable: true })
  media?: PostMedia;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class ProductEdge {
  @Field(() => ProductListing)
  node: ProductListing;

  @Field()
  cursor: string;
}

@ObjectType()
export class ProductConnection {
  @Field(() => [ProductEdge])
  edges: ProductEdge[];

  @Field(() => PageInfo)
  pageInfo: PageInfo;
}

@ObjectType()
export class PlaybackResponse {
  @Field()
  postId: string;

  @Field()
  hlsUrl: string;

  @Field(() => Float)
  durationSec: number;

  @Field()
  expiresAt: Date;
}
