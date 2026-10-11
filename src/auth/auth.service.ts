import { Injectable, UnauthorizedException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { ActivityService } from '../activity/activity.service';
import {
  AuthPayload,
  User,
  RegisterInput,
  VerifyRegistrationInput,
  ResendVerificationCodeInput,
  CompletePasswordSetupInput,
  CompleteProfileInput,
  LoginInput,
  RefreshSessionInput,
  LogoutInput,
} from './auth.types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtExpirationTime: string;
  private readonly refreshTokenExpirationTime: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    @Optional() private readonly activityService?: ActivityService,
  ) {
    this.jwtExpirationTime = this.configService.get('JWT_EXPIRES_IN') || '15m';
    this.refreshTokenExpirationTime = this.configService.get('REFRESH_TOKEN_EXPIRES_IN') || '7d';
  }

  private generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private async generateTokens(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.jwtService.sign(
      { sub: userId },
      { expiresIn: this.jwtExpirationTime as any },
    );

    const refreshToken = this.jwtService.sign(
      { sub: userId, type: 'refresh' },
      { expiresIn: this.refreshTokenExpirationTime as any },
    );

    // Store refresh token in database
    const refreshTokenExpiry = new Date();
    refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 7); // 7 days

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId,
        expiresAt: refreshTokenExpiry,
      },
    });

    return { accessToken, refreshToken };
  }

  private mapToUser(user: any): User {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      country: user.country,
      location: user.location,
      interests: user.interests,
      status: user.status,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
    };
  }

  async register(input: RegisterInput): Promise<AuthPayload> {
    this.logger.log(`DEBUG register called with verificationMethod: ${input.verificationMethod}`);
    
    // Check if user already exists and is verified
    const existingUser = await this.prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existingUser && existingUser.emailVerified) {
      throw new BadRequestException('Email already registered and verified');
    }

    // If user exists but is not verified, reuse the existing record (idempotency)
    let user = existingUser;

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          fullName: input.fullName,
          email: input.email,
          phoneNumber: input.phoneNumber,
          status: 'PENDING',
          emailVerified: false,
          phoneVerified: false,
          interests: [],
        },
      });
      await this.activityService?.record('USER_REGISTERED', user.id);
    }

    // Generate and store verification code
    const code = this.generateVerificationCode();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour expiry

    // Delete any existing unused verification codes for this user
    await this.prisma.verificationCode.deleteMany({
      where: {
        userId: user.id,
        used: false,
      },
    });

    await this.prisma.verificationCode.create({
      data: {
        code,
        userId: user.id,
        type: 'EMAIL_VERIFICATION',
        expiresAt,
      },
    });

    // Send verification code based on verification method
    const verificationMethod = input.verificationMethod || 'EMAIL';
    this.logger.log(`DEBUG using verification method: ${verificationMethod}`);
    try {
      if (verificationMethod === 'PHONE') {
        await this.smsService.sendVerificationSms(user.phoneNumber, code);
      } else {
        await this.emailService.sendVerificationEmail(user.email, code);
      }
    } catch (err) {
      this.logger.error(`Failed to send verification code via ${verificationMethod}: ${err instanceof Error ? err.message : String(err)}`);
      // Don't fail the whole registration - the user and code already exist,
      // they can retry via resendVerificationCode.
    }
    const message = verificationMethod === 'PHONE' 
      ? 'Registration successful. Please check your phone for verification code.'
      : 'Registration successful. Please check your email for verification code.';

    return {
      accessToken: null,
      refreshToken: null,
      verificationRequired: true,
      message,
      user: this.mapToUser(user),
    };
  }

  async verifyRegistration(input: VerifyRegistrationInput): Promise<AuthPayload> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const verificationCode = await this.prisma.verificationCode.findFirst({
      where: {
        userId: input.userId,
        code: input.code,
        type: 'EMAIL_VERIFICATION',
        used: false,
        expiresAt: { gte: new Date() },
      },
    });

    if (!verificationCode) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Mark verification code as used
    await this.prisma.verificationCode.update({
      where: { id: verificationCode.id },
      data: { used: true },
    });

    // Mark user as email verified
    const updatedUser = await this.prisma.user.update({
      where: { id: input.userId },
      data: { emailVerified: true },
    });

    return {
      accessToken: null,
      refreshToken: null,
      verificationRequired: false,
      message: 'Email verified successfully. Please complete your profile setup.',
      user: this.mapToUser(updatedUser),
    };
  }

  async resendVerificationCode(input: ResendVerificationCodeInput): Promise<AuthPayload> {
    let user: any;

    if (input.userId) {
      user = await this.prisma.user.findUnique({
        where: { id: input.userId },
      });
    } else if (input.email) {
      user = await this.prisma.user.findUnique({
        where: { email: input.email },
      });
    }

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email already verified');
    }

    // Generate new verification code
    const code = this.generateVerificationCode();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    // Delete any existing unused verification codes
    await this.prisma.verificationCode.deleteMany({
      where: {
        userId: user.id,
        used: false,
      },
    });

    await this.prisma.verificationCode.create({
      data: {
        code,
        userId: user.id,
        type: 'EMAIL_VERIFICATION',
        expiresAt,
      },
    });

    // Send verification code based on verification method
    const verificationMethod = input.verificationMethod || 'EMAIL';

    try {
      if (verificationMethod === 'PHONE') {
        await this.smsService.sendVerificationSms(user.phoneNumber, code);
      } else {
        await this.emailService.sendVerificationEmail(user.email, code);
      }
    } catch (err) {
      this.logger.error(`Failed to send verification code via ${verificationMethod}: ${err instanceof Error ? err.message : String(err)}`);
      // Don't fail the whole resend - the user and code already exist,
      // they can retry again.
    }

    const message = verificationMethod === 'PHONE' 
      ? 'Verification code resent. Please check your phone.'
      : 'Verification code resent. Please check your email.';

    return {
      accessToken: null,
      refreshToken: null,
      verificationRequired: true,
      message,
      user: this.mapToUser(user),
    };
  }

  async completePasswordSetup(input: CompletePasswordSetupInput): Promise<AuthPayload> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!user.emailVerified) {
      throw new BadRequestException('Email must be verified before setting password');
    }

    if (user.passwordHash) {
      throw new BadRequestException('Password already set');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    const updatedUser = await this.prisma.user.update({
      where: { id: input.userId },
      data: { passwordHash },
    });

    return {
      accessToken: null,
      refreshToken: null,
      verificationRequired: false,
      message: 'Password set successfully. Please complete your profile.',
      user: this.mapToUser(updatedUser),
    };
  }

  async completeProfile(input: CompleteProfileInput, authHeader?: string): Promise<AuthPayload> {
    let user: any;

    // If authorization header is present, verify the token and use that user
    if (authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const payload = this.jwtService.verify(token);
        
        // Verify the userId from token matches the input userId
        if (payload.sub !== input.userId) {
          throw new UnauthorizedException('User ID mismatch');
        }

        user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
        });

        if (!user) {
          throw new BadRequestException('User not found');
        }
      } catch (error) {
        throw new UnauthorizedException('Invalid or expired token');
      }
    } else {
      // No auth header - this is the onboarding flow
      user = await this.prisma.user.findUnique({
        where: { id: input.userId },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Security check: only allow profile completion during onboarding
      // User must be in PENDING state
      if (user.status !== 'PENDING') {
        throw new BadRequestException('Profile can only be completed during onboarding. Please login to update your profile.');
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: input.userId },
      data: {
        fullName: input.fullName,
        country: input.country,
        location: input.location,
        interests: input.interests,
        status: 'ACTIVE',
      },
    });

    return {
      accessToken: null,
      refreshToken: null,
      verificationRequired: false,
      message: 'Profile completed successfully. You can now login.',
      user: this.mapToUser(updatedUser),
    };
  }

  async login(input: LoginInput): Promise<AuthPayload> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: input.identifier },
          { phoneNumber: input.identifier },
        ],
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.passwordHash) {
      throw new BadRequestException('Please complete password setup first');
    }

    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.emailVerified) {
      throw new BadRequestException('Please verify your email first');
    }

    const { accessToken, refreshToken } = await this.generateTokens(user.id);

    return {
      accessToken,
      refreshToken,
      verificationRequired: false,
      message: 'Login successful',
      user: this.mapToUser(user),
    };
  }

  async refreshSession(input: RefreshSessionInput): Promise<AuthPayload> {
    try {
      const payload = this.jwtService.verify(input.refreshToken);

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Check if refresh token exists in database and is not expired
      const storedToken = await this.prisma.refreshToken.findUnique({
        where: { token: input.refreshToken },
      });

      if (!storedToken || storedToken.expiresAt < new Date()) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      // Delete old refresh token
      await this.prisma.refreshToken.delete({
        where: { token: input.refreshToken },
      });

      // Generate new tokens
      const { accessToken, refreshToken } = await this.generateTokens(payload.sub);

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      return {
        accessToken,
        refreshToken,
        verificationRequired: false,
        message: 'Session refreshed successfully',
        user: this.mapToUser(user),
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(input: LogoutInput): Promise<string> {
    try {
      // Delete the refresh token from database
      await this.prisma.refreshToken.delete({
        where: { token: input.refreshToken },
      });

      return 'Logout successful';
    } catch (error) {
      // Even if token doesn't exist, return success (idempotent)
      return 'Logout successful';
    }
  }

  async me(authHeader?: string): Promise<User> {
    if (!authHeader) {
      throw new UnauthorizedException('Authorization header required');
    }

    try {
      const token = authHeader.replace('Bearer ', '');
      const payload = this.jwtService.verify(token);

      if (payload.type === 'refresh') {
        throw new UnauthorizedException('Refresh token cannot be used for authentication');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      return this.mapToUser(user);
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
