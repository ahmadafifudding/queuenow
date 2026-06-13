import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('bcrypt');

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('AuthService', () => {
  let service: AuthService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    organization: {
      create: jest.fn(),
    },
    userRole: {
      create: jest.fn(),
    },
    queueSettings: {
      create: jest.fn(),
    },
    organizationBranding: {
      create: jest.fn(),
    },
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    // tx === mockPrisma so transactional calls hit the same mocks
    $transaction: jest.fn((callback: (tx: typeof mockPrisma) => unknown) =>
      callback(mockPrisma),
    ),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock-token'),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, fallback?: string) => {
      const config: Record<string, string> = {
        JWT_REFRESH_SECRET: 'test-refresh-secret',
        JWT_REFRESH_EXPIRATION: '7d',
      };
      return config[key] ?? fallback;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    // Default token behaviour
    mockJwtService.sign.mockReturnValue('mock-token');
    mockPrisma.session.create.mockResolvedValue({ id: 'session-id' });
  });

  describe('register', () => {
    const registerDto = {
      email: 'owner@example.com',
      password: 'StrongPass123',
      fullName: 'Owner One',
      phone: '0123456789',
      organizationName: 'My Clinic',
      organizationType: 'CLINIC',
    } as never;

    it('should create user, org, role, settings, and branding in a transaction', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockedBcrypt.hash.mockResolvedValue('hashed-password' as never);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-id',
        email: registerDto.email,
        fullName: 'Owner One',
      });
      mockPrisma.organization.create.mockResolvedValue({
        id: 'org-id',
        name: 'My Clinic',
        slug: 'my-clinic',
      });
      mockPrisma.userRole.create.mockResolvedValue({});
      mockPrisma.queueSettings.create.mockResolvedValue({});
      mockPrisma.organizationBranding.create.mockResolvedValue({});

      const result = await service.register(registerDto);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockedBcrypt.hash).toHaveBeenCalledWith('StrongPass123', 12);
      expect(mockPrisma.user.create).toHaveBeenCalled();
      expect(mockPrisma.organization.create).toHaveBeenCalled();
      expect(mockPrisma.userRole.create).toHaveBeenCalledWith({
        data: { userId: 'user-id', orgId: 'org-id', role: 'OWNER' },
      });
      expect(mockPrisma.queueSettings.create).toHaveBeenCalled();
      expect(mockPrisma.organizationBranding.create).toHaveBeenCalled();
      expect(result.user.email).toBe('owner@example.com');
      expect(result.organization.slug).toBe('my-clinic');
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(service.register(registerDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should generate access and refresh tokens', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockedBcrypt.hash.mockResolvedValue('hashed-password' as never);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-id',
        email: registerDto.email,
        fullName: 'Owner One',
      });
      mockPrisma.organization.create.mockResolvedValue({
        id: 'org-id',
        name: 'My Clinic',
        slug: 'my-clinic',
      });

      const result = await service.register(registerDto);

      expect(mockJwtService.sign).toHaveBeenCalledTimes(2);
      expect(mockPrisma.session.create).toHaveBeenCalled();
      expect(result.tokens).toEqual({
        accessToken: 'mock-token',
        refreshToken: 'mock-token',
      });
    });
  });

  describe('login', () => {
    const loginDto = { email: 'owner@example.com', password: 'StrongPass123' } as never;

    const userWithRole = {
      id: 'user-id',
      email: 'owner@example.com',
      fullName: 'Owner One',
      avatarUrl: null,
      passwordHash: 'hashed-password',
      roles: [
        {
          orgId: 'org-id',
          role: 'OWNER',
          org: { id: 'org-id', name: 'My Clinic', slug: 'my-clinic' },
        },
      ],
    };

    it('should return user, organization, and tokens for valid credentials', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(userWithRole);
      mockedBcrypt.compare.mockResolvedValue(true as never);
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.login(loginDto);

      expect(mockedBcrypt.compare).toHaveBeenCalledWith(
        'StrongPass123',
        'hashed-password',
      );
      expect(mockPrisma.user.update).toHaveBeenCalled();
      expect(result.organization.role).toBe('OWNER');
      expect(result.tokens.accessToken).toBe('mock-token');
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for a wrong password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(userWithRole);
      mockedBcrypt.compare.mockResolvedValue(false as never);

      await expect(service.login(loginDto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when the user has no roles', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...userWithRole, roles: [] });
      mockedBcrypt.compare.mockResolvedValue(true as never);

      await expect(service.login(loginDto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('refreshToken', () => {
    it('should rotate the session and return new tokens', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 'session-id',
        expiresAt: new Date(Date.now() + 60_000),
        user: {
          id: 'user-id',
          roles: [{ orgId: 'org-id', role: 'OWNER' }],
        },
      });
      mockPrisma.session.delete.mockResolvedValue({});

      const result = await service.refreshToken('valid-refresh-token');

      expect(mockPrisma.session.delete).toHaveBeenCalledWith({
        where: { id: 'session-id' },
      });
      expect(result.tokens.accessToken).toBe('mock-token');
    });

    it('should throw UnauthorizedException for an expired refresh token', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 'session-id',
        expiresAt: new Date(Date.now() - 60_000),
        user: { id: 'user-id', roles: [{ orgId: 'org-id', role: 'OWNER' }] },
      });

      await expect(service.refreshToken('expired')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(mockPrisma.session.delete).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when the refresh token is unknown', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);

      await expect(service.refreshToken('unknown')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should delete sessions matching the refresh token', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.logout('some-refresh-token');

      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { refreshToken: 'some-refresh-token' },
      });
      expect(result.message).toBe('Logged out successfully');
    });
  });
});
