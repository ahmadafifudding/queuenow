import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { randomBytes } from 'crypto';

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async invite(orgId: string, dto: any, user: any) {
    this.validateOrgAccess(orgId, user);

    // Check if user already exists in org
    const existingRole = await this.prisma.userRole.findFirst({
      where: {
        orgId,
        user: { email: dto.email },
      },
    });

    if (existingRole) {
      throw new ConflictException('User is already a member of this organization');
    }

    // Check for pending invitation
    const existingInvitation = await this.prisma.invitation.findFirst({
      where: {
        orgId,
        email: dto.email,
        status: 'PENDING',
      },
    });

    if (existingInvitation) {
      throw new ConflictException('An invitation is already pending for this email');
    }

    // Validate service exists if provided
    if (dto.serviceId) {
      const service = await this.prisma.service.findFirst({
        where: { id: dto.serviceId, orgId },
      });
      if (!service) {
        throw new NotFoundException('Service not found in this organization');
      }
    }

    // Create invitation
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    return this.prisma.invitation.create({
      data: {
        orgId,
        email: dto.email,
        role: dto.role ?? 'STAFF',
        serviceId: dto.serviceId,
        invitedById: user.sub,
        token,
        expiresAt,
      },
    });
  }

  async findAll(orgId: string, role: string | undefined, user: any) {
    this.validateOrgAccess(orgId, user);

    const where: any = { orgId };
    if (role) {
      where.role = role;
    }

    return this.prisma.userRole.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            avatarUrl: true,
            lastLoginAt: true,
            isActive: true,
          },
        },
        service: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listInvitations(orgId: string, user: any) {
    this.validateOrgAccess(orgId, user);

    return this.prisma.invitation.findMany({
      where: { orgId, status: 'PENDING' },
      include: {
        invitedBy: { select: { id: true, fullName: true } },
        service: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(orgId: string, userId: string, user: any) {
    this.validateOrgAccess(orgId, user);

    // Cannot remove yourself
    if (userId === user.sub) {
      throw new BadRequestException('Cannot remove yourself from the organization');
    }

    const userRole = await this.prisma.userRole.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });

    if (!userRole) {
      throw new NotFoundException('Staff member not found in this organization');
    }

    // Cannot remove owner
    if (userRole.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove organization owner');
    }

    // Remove role and any active staff assignments
    await this.prisma.$transaction([
      this.prisma.staffAssignment.updateMany({
        where: { userId, orgId, releasedAt: null },
        data: { releasedAt: new Date() },
      }),
      this.prisma.userRole.delete({
        where: { userId_orgId: { userId, orgId } },
      }),
    ]);
  }

  async cancelInvitation(orgId: string, invitationId: string, user: any) {
    this.validateOrgAccess(orgId, user);

    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, orgId, status: 'PENDING' },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    await this.prisma.invitation.delete({ where: { id: invitationId } });
  }

  private validateOrgAccess(orgId: string, user: any): void {
    if (user.orgId !== orgId) {
      throw new ForbiddenException('Access denied to this organization');
    }
  }
}
