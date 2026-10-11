import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionRequestStatus } from '@prisma/client';
import {
  UserPublic,
  ConnectionRequestPublic,
  ConnectionPublic,
  UserConnection,
  PaginatedUsers,
  PaginatedConnectionRequests,
  PaginatedConnections,
} from './network.types';

@Injectable()
export class NetworkService {
  private readonly logger = new Logger(NetworkService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Helper: Convert User to UserPublic
  private toUserPublic(user: any): UserPublic {
    return {
      id: user.id,
      fullName: user.fullName,
      location: user.location,
      county: user.county,
      interests: user.interests,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      isVerified: user.emailVerified && user.phoneVerified,
    };
  }

  // Helper: Encode cursor
  private encodeCursor(id: string, createdAt: Date): string {
    return Buffer.from(JSON.stringify({ id, createdAt: createdAt.toISOString() })).toString('base64url');
  }

  // Helper: Decode cursor
  private decodeCursor(cursor: string): { id: string; createdAt: Date } | null {
    try {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
      const { id, createdAt } = JSON.parse(decoded);
      return { id, createdAt: new Date(createdAt) };
    } catch {
      return null;
    }
  }

  // ============================================
  // USER DISCOVERY
  // ============================================

  async searchUsers(
    userId: string,
    query?: string,
    first: number = 20,
    after?: string,
  ): Promise<PaginatedUsers> {
    const take = Math.min(first, 50);
    const cursor = after ? this.decodeCursor(after) : null;

    // Build where clause
    const where: any = {
      id: { not: userId }, // Exclude current user
      status: 'ACTIVE', // Only active users
    };

    if (query) {
      where.OR = [
        { fullName: { contains: query, mode: 'insensitive' } },
        { location: { contains: query, mode: 'insensitive' } },
        { county: { contains: query, mode: 'insensitive' } },
        { interests: { has: query } },
      ];
    }

    // Cursor-based pagination
    if (cursor) {
      where.createdAt = { lt: cursor.createdAt };
    }

    const users = await this.prisma.user.findMany({
      where,
      take: take + 1,
      orderBy: { createdAt: 'desc' },
    });

    const hasNextPage = users.length > take;
    const paginatedUsers = hasNextPage ? users.slice(0, take) : users;

    // Get connection status for each user
    const usersWithStatus = await Promise.all(
      paginatedUsers.map(async (user) => {
        const connectionStatus = await this.getConnectionStatus(userId, user.id);
        return {
          user: this.toUserPublic(user),
          connectionStatus: connectionStatus.status,
          connectionRequestId: connectionStatus.requestId,
        } as UserConnection;
      }),
    );

    const endCursor =
      paginatedUsers.length > 0
        ? this.encodeCursor(paginatedUsers[paginatedUsers.length - 1].id, paginatedUsers[paginatedUsers.length - 1].createdAt)
        : undefined;

    return {
      users: usersWithStatus,
      hasNextPage,
      endCursor,
    };
  }

  // ============================================
  // CONNECTION REQUESTS
  // ============================================

  async sendConnectionRequest(senderId: string, receiverId: string): Promise<ConnectionRequestPublic> {
    if (senderId === receiverId) {
      throw new BadRequestException('Cannot send connection request to yourself');
    }

    // Check if users exist
    const [sender, receiver] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: senderId } }),
      this.prisma.user.findUnique({ where: { id: receiverId } }),
    ]);

    if (!sender) throw new NotFoundException('Sender not found');
    if (!receiver) throw new NotFoundException('Receiver not found');

    // Check if already connected
    const existingConnection = await this.prisma.connection.findFirst({
      where: {
        OR: [
          { user1Id: senderId, user2Id: receiverId },
          { user1Id: receiverId, user2Id: senderId },
        ],
      },
    });

    if (existingConnection) {
      throw new BadRequestException('Already connected with this user');
    }

    // Check for existing pending request
    const existingRequest = await this.prisma.connectionRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
        status: ConnectionRequestStatus.PENDING,
      },
    });

    if (existingRequest) {
      if (existingRequest.senderId === senderId) {
        throw new BadRequestException('Connection request already sent');
      } else {
        throw new BadRequestException('This user has already sent you a connection request');
      }
    }

    // Create connection request
    const request = await this.prisma.connectionRequest.create({
      data: {
        senderId,
        receiverId,
        status: ConnectionRequestStatus.PENDING,
      },
      include: {
        sender: true,
        receiver: true,
      },
    });

    this.logger.log(`Connection request sent from ${senderId} to ${receiverId}`);

    return {
      id: request.id,
      sender: this.toUserPublic(request.sender),
      receiver: this.toUserPublic(request.receiver),
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  async cancelConnectionRequest(requestId: string, userId: string): Promise<void> {
    const request = await this.prisma.connectionRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Connection request not found');
    }

    if (request.senderId !== userId) {
      throw new BadRequestException('You can only cancel your own connection requests');
    }

    if (request.status !== ConnectionRequestStatus.PENDING) {
      throw new BadRequestException('Can only cancel pending requests');
    }

    await this.prisma.connectionRequest.update({
      where: { id: requestId },
      data: { status: ConnectionRequestStatus.CANCELLED },
    });

    this.logger.log(`Connection request ${requestId} cancelled by ${userId}`);
  }

  async acceptConnectionRequest(requestId: string, userId: string): Promise<void> {
    const request = await this.prisma.connectionRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Connection request not found');
    }

    if (request.receiverId !== userId) {
      throw new BadRequestException('You can only accept requests sent to you');
    }

    if (request.status !== ConnectionRequestStatus.PENDING) {
      throw new BadRequestException('Request is no longer pending');
    }

    // Use transaction to update request and create connection
    await this.prisma.$transaction(async (tx) => {
      // Update request status
      await tx.connectionRequest.update({
        where: { id: requestId },
        data: { status: ConnectionRequestStatus.ACCEPTED },
      });

      // Create connection (ensure user1Id < user2Id for uniqueness)
      const [user1Id, user2Id] = [request.senderId, request.receiverId].sort();
      await tx.connection.create({
        data: {
          user1Id,
          user2Id,
        },
      });
    });

    this.logger.log(`Connection request ${requestId} accepted by ${userId}`);
  }

  async rejectConnectionRequest(requestId: string, userId: string): Promise<void> {
    const request = await this.prisma.connectionRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Connection request not found');
    }

    if (request.receiverId !== userId) {
      throw new BadRequestException('You can only reject requests sent to you');
    }

    if (request.status !== ConnectionRequestStatus.PENDING) {
      throw new BadRequestException('Request is no longer pending');
    }

    await this.prisma.connectionRequest.update({
      where: { id: requestId },
      data: { status: ConnectionRequestStatus.REJECTED },
    });

    this.logger.log(`Connection request ${requestId} rejected by ${userId}`);
  }

  // ============================================
  // PENDING REQUESTS
  // ============================================

  async getPendingRequests(
    userId: string,
    type: 'incoming' | 'outgoing' | 'all',
    first: number = 20,
    after?: string,
  ): Promise<PaginatedConnectionRequests> {
    const take = Math.min(first, 50);
    const cursor = after ? this.decodeCursor(after) : null;

    const where: any = {
      status: ConnectionRequestStatus.PENDING,
    };

    if (type === 'incoming') {
      where.receiverId = userId;
    } else if (type === 'outgoing') {
      where.senderId = userId;
    } else {
      where.OR = [{ senderId: userId }, { receiverId: userId }];
    }

    if (cursor) {
      where.createdAt = { lt: cursor.createdAt };
    }

    const requests = await this.prisma.connectionRequest.findMany({
      where,
      take: take + 1,
      orderBy: { createdAt: 'desc' },
      include: {
        sender: true,
        receiver: true,
      },
    });

    const hasNextPage = requests.length > take;
    const paginatedRequests = hasNextPage ? requests.slice(0, take) : requests;

    const endCursor =
      paginatedRequests.length > 0
        ? this.encodeCursor(paginatedRequests[paginatedRequests.length - 1].id, paginatedRequests[paginatedRequests.length - 1].createdAt)
        : undefined;

    return {
      requests: paginatedRequests.map((req) => ({
        id: req.id,
        sender: this.toUserPublic(req.sender),
        receiver: this.toUserPublic(req.receiver),
        status: req.status,
        createdAt: req.createdAt,
        updatedAt: req.updatedAt,
      })),
      hasNextPage,
      endCursor,
    };
  }

  // ============================================
  // ACTIVE CONNECTIONS
  // ============================================

  async getConnections(
    userId: string,
    first: number = 20,
    after?: string,
  ): Promise<PaginatedConnections> {
    const take = Math.min(first, 50);
    const cursor = after ? this.decodeCursor(after) : null;

    const where: any = {
      OR: [{ user1Id: userId }, { user2Id: userId }],
    };

    if (cursor) {
      where.createdAt = { lt: cursor.createdAt };
    }

    const connections = await this.prisma.connection.findMany({
      where,
      take: take + 1,
      orderBy: { createdAt: 'desc' },
    });

    const hasNextPage = connections.length > take;
    const paginatedConnections = hasNextPage ? connections.slice(0, take) : connections;

    // Get the connected user for each connection
    const connectionsWithUsers = await Promise.all(
      paginatedConnections.map(async (conn) => {
        const connectedUserId = conn.user1Id === userId ? conn.user2Id : conn.user1Id;
        const user = await this.prisma.user.findUnique({
          where: { id: connectedUserId },
        });

        if (!user) throw new NotFoundException('Connected user not found');

        return {
          id: conn.id,
          user: this.toUserPublic(user),
          createdAt: conn.createdAt,
        } as ConnectionPublic;
      }),
    );

    const endCursor =
      paginatedConnections.length > 0
        ? this.encodeCursor(paginatedConnections[paginatedConnections.length - 1].id, paginatedConnections[paginatedConnections.length - 1].createdAt)
        : undefined;

    return {
      connections: connectionsWithUsers,
      hasNextPage,
      endCursor,
    };
  }

  // ============================================
  // HELPER: Get connection status between two users
  // ============================================

  private async getConnectionStatus(
    userId: string,
    otherUserId: string,
  ): Promise<{ status: 'CONNECTED' | 'PENDING_SENT' | 'PENDING_RECEIVED' | 'NONE'; requestId?: string }> {
    // Check if connected
    const connection = await this.prisma.connection.findFirst({
      where: {
        OR: [
          { user1Id: userId, user2Id: otherUserId },
          { user1Id: otherUserId, user2Id: userId },
        ],
      },
    });

    if (connection) {
      return { status: 'CONNECTED' };
    }

    // Check for pending request
    const request = await this.prisma.connectionRequest.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: userId },
        ],
        status: ConnectionRequestStatus.PENDING,
      },
    });

    if (request) {
      if (request.senderId === userId) {
        return { status: 'PENDING_SENT', requestId: request.id };
      } else {
        return { status: 'PENDING_RECEIVED', requestId: request.id };
      }
    }

    return { status: 'NONE' };
  }
}
