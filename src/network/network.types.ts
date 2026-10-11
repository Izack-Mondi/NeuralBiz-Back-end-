import { Field, Int, ObjectType, registerEnumType, ID } from '@nestjs/graphql';
import { ConnectionRequestStatus } from '@prisma/client';

registerEnumType(ConnectionRequestStatus, {
  name: 'ConnectionRequestStatus',
  description: 'Status of a connection request',
});

@ObjectType()
export class UserPublic {
  @Field(() => ID)
  id: string;

  @Field()
  fullName: string;

  @Field({ nullable: true })
  location?: string;

  @Field({ nullable: true })
  county?: string;

  @Field(() => [String], { nullable: true })
  interests?: string[];

  @Field()
  emailVerified: boolean;

  @Field()
  phoneVerified: boolean;

  @Field()
  isVerified: boolean;
}

@ObjectType()
export class ConnectionRequestPublic {
  @Field(() => ID)
  id: string;

  @Field(() => UserPublic)
  sender: UserPublic;

  @Field(() => UserPublic)
  receiver: UserPublic;

  @Field(() => ConnectionRequestStatus)
  status: ConnectionRequestStatus;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

@ObjectType()
export class ConnectionPublic {
  @Field(() => ID)
  id: string;

  @Field(() => UserPublic)
  user: UserPublic;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class UserConnection {
  @Field(() => ID)
  id: string;

  @Field(() => UserPublic)
  user: UserPublic;

  @Field(() => String, { nullable: true })
  connectionStatus?: 'CONNECTED' | 'PENDING_SENT' | 'PENDING_RECEIVED' | 'NONE';

  @Field(() => ID, { nullable: true })
  connectionRequestId?: string;
}

@ObjectType()
export class PaginatedUsers {
  @Field(() => [UserConnection])
  users: UserConnection[];

  @Field()
  hasNextPage: boolean;

  @Field(() => String, { nullable: true })
  endCursor?: string;
}

@ObjectType()
export class PaginatedConnectionRequests {
  @Field(() => [ConnectionRequestPublic])
  requests: ConnectionRequestPublic[];

  @Field()
  hasNextPage: boolean;

  @Field(() => String, { nullable: true })
  endCursor?: string;
}

@ObjectType()
export class PaginatedConnections {
  @Field(() => [ConnectionPublic])
  connections: ConnectionPublic[];

  @Field()
  hasNextPage: boolean;

  @Field(() => String, { nullable: true })
  endCursor?: string;
}
