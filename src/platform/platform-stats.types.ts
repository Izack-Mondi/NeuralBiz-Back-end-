import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class PlatformStats {
  @Field(() => Int)
  users: number;

  @Field(() => Int)
  posts: number;

  @Field(() => Int)
  products: number;

  @Field(() => Int)
  offerings: number;

  @Field(() => Int)
  readyVideos: number;

  @Field(() => Int)
  rejectedVideos: number;

  @Field(() => Int)
  activePosters: number;

  @Field(() => Int)
  postsLast7Days: number;
}
