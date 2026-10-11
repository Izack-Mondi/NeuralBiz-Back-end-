import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { NetworkService } from './network.service';
import {
  UserPublic,
  ConnectionRequestPublic,
  ConnectionPublic,
  PaginatedUsers,
  PaginatedConnectionRequests,
  PaginatedConnections,
} from './network.types';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Throttle } from '@nestjs/throttler';

@Resolver()
export class NetworkResolver {
  constructor(private readonly networkService: NetworkService) {}

  // ============================================
  // USER DISCOVERY
  // ============================================

  @Query(() => PaginatedUsers)
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async searchUsers(
    @CurrentUser() user: any,
    @Args('query', { nullable: true }) query?: string,
    @Args('first', { nullable: true, defaultValue: 20 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ): Promise<PaginatedUsers> {
    return this.networkService.searchUsers(user.sub, query, first, after);
  }

  // ============================================
  // CONNECTION REQUESTS
  // ============================================

  @Mutation(() => ConnectionRequestPublic)
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async sendConnectionRequest(
    @CurrentUser() user: any,
    @Args('receiverId', { type: () => ID }) receiverId: string,
  ): Promise<ConnectionRequestPublic> {
    return this.networkService.sendConnectionRequest(user.sub, receiverId);
  }

  @Mutation(() => String)
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async cancelConnectionRequest(
    @CurrentUser() user: any,
    @Args('requestId', { type: () => ID }) requestId: string,
  ): Promise<string> {
    await this.networkService.cancelConnectionRequest(requestId, user.sub);
    return requestId;
  }

  @Mutation(() => String)
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async acceptConnectionRequest(
    @CurrentUser() user: any,
    @Args('requestId', { type: () => ID }) requestId: string,
  ): Promise<string> {
    await this.networkService.acceptConnectionRequest(requestId, user.sub);
    return requestId;
  }

  @Mutation(() => String)
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async rejectConnectionRequest(
    @CurrentUser() user: any,
    @Args('requestId', { type: () => ID }) requestId: string,
  ): Promise<string> {
    await this.networkService.rejectConnectionRequest(requestId, user.sub);
    return requestId;
  }

  // ============================================
  // PENDING REQUESTS
  // ============================================

  @Query(() => PaginatedConnectionRequests)
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async pendingRequests(
    @CurrentUser() user: any,
    @Args('type', { nullable: true, defaultValue: 'all' }) type?: 'incoming' | 'outgoing' | 'all',
    @Args('first', { nullable: true, defaultValue: 20 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ): Promise<PaginatedConnectionRequests> {
    return this.networkService.getPendingRequests(user.sub, type, first, after);
  }

  // ============================================
  // ACTIVE CONNECTIONS
  // ============================================

  @Query(() => PaginatedConnections)
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async connections(
    @CurrentUser() user: any,
    @Args('first', { nullable: true, defaultValue: 20 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ): Promise<PaginatedConnections> {
    return this.networkService.getConnections(user.sub, first, after);
  }
}
