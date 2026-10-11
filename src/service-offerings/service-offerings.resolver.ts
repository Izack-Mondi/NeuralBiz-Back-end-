import { Resolver, Mutation, Query, Args, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ServiceOfferingsService } from './service-offerings.service';
import {
  CreateServiceOfferingInput,
  ServiceOffering,
  ServiceOfferingConnection,
} from './service-offerings.types';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Throttle } from '@nestjs/throttler';

@Resolver()
export class ServiceOfferingsResolver {
  constructor(private readonly serviceOfferingsService: ServiceOfferingsService) {}

  @Mutation(() => ID)
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createServiceOffering(
    @CurrentUser() user: any,
    @Args('input') input: CreateServiceOfferingInput,
  ): Promise<string> {
    const result = await this.serviceOfferingsService.createServiceOffering(user.sub, input);
    return result.offeringId;
  }

  @Query(() => ServiceOffering)
  @UseGuards(GqlAuthGuard)
  async serviceOffering(@Args('id') id: string): Promise<ServiceOffering> {
    return this.serviceOfferingsService.getServiceOffering(id);
  }

  @Query(() => ServiceOfferingConnection)
  @UseGuards(GqlAuthGuard)
  async serviceOfferings(
    @CurrentUser() user: { sub: string },
    @Args('first', { type: () => Int, nullable: true, defaultValue: 10 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
    @Args('category', { nullable: true }) category?: string,
    @Args('county', { nullable: true }) county?: string,
    @Args('providerId', { type: () => ID, nullable: true }) providerId?: string,
  ): Promise<ServiceOfferingConnection> {
    return this.serviceOfferingsService.listServiceOfferings(
      user.sub,
      first ?? 10,
      after,
      category,
      county,
      providerId,
    );
  }
}
