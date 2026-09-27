'use server';

import { z } from 'zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { withTenantContext, type TenantTx } from '@/lib/db/tenant';
import {
  users,
  teams,
  teamMembers,
  activityLogs,
  type NewUser,
  type NewTeam,
  type NewActivityLog,
  ActivityType,
  invitations
} from '@/lib/db/schema';
import { comparePasswords, hashPassword, setSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { createCheckoutSession } from '@/lib/payments/stripe';
import {
  getMembershipForUser,
  getUser,
  getUserWithTeam
} from '@/lib/db/queries';
import { rateLimit } from '@/lib/security/rate-limit';
import {
  validatedAction,
  validatedActionWithUser
} from '@/lib/auth/middleware';

async function logActivity(
  teamId: number | null | undefined,
  userId: number,
  type: ActivityType,
  ipAddress?: string,
  tx?: TenantTx
) {
  if (teamId === null || teamId === undefined) {
    return;
  }
  const newActivity: NewActivityLog = {
    teamId,
    userId,
    action: type,
    ipAddress: ipAddress || ''
  };
  // activity_logs 受 RLS 约束，须在租户上下文事务内写入。
  if (tx) {
    await tx.insert(activityLogs).values(newActivity);
    return;
  }
  await withTenantContext(teamId, userId, async (t) => {
    await t.insert(activityLogs).values(newActivity);
  });
}

/**
 * 取客户端 IP（Vercel 会写入 x-forwarded-for），用于登录/注册限流。
 */
async function getClientIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

const signInSchema = z.object({
  email: z.string().email().min(3).max(255),
  password: z.string().min(8).max(100)
});

export const signIn = validatedAction(signInSchema, async (data, formData) => {
  const { email, password } = data;

  // 防暴力破解：同一 IP + 账号 15 分钟内最多 10 次尝试
  const rl = await rateLimit(
    `signin:${await getClientIp()}:${email}`,
    10,
    15 * 60_000
  );
  if (!rl.allowed) {
    return { error: '尝试过于频繁，请 15 分钟后再试。' };
  }

  // users 为全局表，不受 RLS；先按邮箱定位用户（需要其 id 才能设置 app.user_id）。
  const [foundUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!foundUser) {
    return {
      error: '邮箱或密码不正确，请重试。',
      email
    };
  }

  // team_members / teams 受 RLS 约束：登录阶段尚无 team_id，只能靠 app.user_id
  // 放行「本人所属」的行（见 docs/RLS.md 第八节）。
  const foundTeam = await withTenantContext(null, foundUser.id, async (tx) => {
    const rows = await tx
      .select({ team: teams })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(teamMembers.userId, foundUser.id))
      .orderBy(asc(teamMembers.id))
      .limit(1);
    return rows[0]?.team ?? null;
  });

  const isPasswordValid = await comparePasswords(
    password,
    foundUser.passwordHash
  );

  if (!isPasswordValid) {
    return {
      error: '邮箱或密码不正确，请重试。',
      email
    };
  }

  await Promise.all([
    setSession(foundUser),
    logActivity(foundTeam?.id, foundUser.id, ActivityType.SIGN_IN)
  ]);
  const redirectTo = formData.get('redirect') as string | null;
  if (redirectTo === 'checkout') {
    const priceId = formData.get('priceId') as string;
    return createCheckoutSession({ team: foundTeam, priceId });
  }

  redirect('/dashboard');
});

const signUpSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(8, '密码至少 8 位'),
  inviteId: z.string().optional()
});

export const signUp = validatedAction(signUpSchema, async (data, formData) => {
  const { email, password, inviteId } = data;

  // 防注册刷号：同一 IP 每小时最多 10 次
  const rl = await rateLimit(`signup:${await getClientIp()}`, 10, 60 * 60_000);
  if (!rl.allowed) {
    return { error: '注册过于频繁，请稍后再试。' };
  }

  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser.length > 0) {
    return {
      error: 'Failed to create user. Please try again.',
      email
    };
  }

  const passwordHash = await hashPassword(password);

  const newUser: NewUser = {
    email,
    passwordHash,
    platformRole: 'user'
  };

  const [createdUser] = await db.insert(users).values(newUser).returning();

  if (!createdUser) {
    return {
      error: 'Failed to create user. Please try again.',
      email
    };
  }

  let teamId: number;
  let userRole: 'owner' | 'admin' | 'member';
  let createdTeam: typeof teams.$inferSelect | null = null;

  if (inviteId) {
    // invitations / team_members / teams 均受 RLS 约束。此阶段尚无 team_id
    // （正是要解析的目标），只能设置 app.user_id。
    // ⚠️ invitations 策略仅按 team_id 放行，RLS 启用后这次读取会返回空 ——
    // 需要特权路径，见报告。
    const [invitation] = await withTenantContext(
      null,
      createdUser.id,
      async (tx) => {
        return await tx
          .select()
          .from(invitations)
          .where(
            and(
              eq(invitations.id, parseInt(inviteId)),
              eq(invitations.email, email),
              eq(invitations.status, 'pending')
            )
          )
          .limit(1);
      }
    );

    if (!invitation) {
      return { error: 'Invalid or expired invitation.', email };
    }

    teamId = invitation.teamId;
    userRole = (invitation.role as 'owner' | 'admin' | 'member') || 'member';

    // 同租户的多次写入放进同一个事务。
    createdTeam = await withTenantContext(teamId, createdUser.id, async (tx) => {
      await tx
        .update(invitations)
        .set({ status: 'accepted' })
        .where(eq(invitations.id, invitation.id));

      await tx.insert(teamMembers).values({
        userId: createdUser.id,
        teamId,
        role: userRole,
      });

      await logActivity(
        teamId,
        createdUser.id,
        ActivityType.ACCEPT_INVITATION,
        undefined,
        tx
      );
      await logActivity(teamId, createdUser.id, ActivityType.SIGN_UP, undefined, tx);

      const [team] = await tx
        .select()
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);
      return team ?? null;
    });
  } else {
    // Create a new team if there's no invitation.
    // 新建 team 此刻尚无 id，teams 策略的 WITH CHECK 靠 app.user_id 非空放行；
    // team_members 的 WITH CHECK 也放行 user_id = app.user_id。
    const newTeam: NewTeam = {
      name: `${email}'s Team`
    };

    const team = await withTenantContext(null, createdUser.id, async (tx) => {
      const [created] = await tx.insert(teams).values(newTeam).returning();
      if (!created) return null;
      await tx.insert(teamMembers).values({
        userId: createdUser.id,
        teamId: created.id,
        role: 'owner',
      });
      return created;
    });

    if (!team) {
      return {
        error: 'Failed to create team. Please try again.',
        email
      };
    }

    createdTeam = team;
    teamId = team.id;
    userRole = 'owner';

    // activity_logs 策略要求 app.team_id，此时 team 已创建，带 team 上下文写入。
    await withTenantContext(teamId, createdUser.id, async (tx) => {
      await logActivity(teamId, createdUser.id, ActivityType.CREATE_TEAM, undefined, tx);
      await logActivity(teamId, createdUser.id, ActivityType.SIGN_UP, undefined, tx);
    });
  }

  await setSession(createdUser);

  const redirectTo = formData.get('redirect') as string | null;
  if (redirectTo === 'checkout') {
    const priceId = formData.get('priceId') as string;
    return createCheckoutSession({ team: createdTeam, priceId });
  }

  redirect('/dashboard');
});

export async function signOut() {
  const user = await getUser();
  if (user) {
    const userWithTeam = await getUserWithTeam(user.id);
    await logActivity(userWithTeam?.teamId, user.id, ActivityType.SIGN_OUT);
  }
  (await cookies()).delete('session');
}

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(100),
  newPassword: z.string().min(8).max(100),
  confirmPassword: z.string().min(8).max(100)
});

export const updatePassword = validatedActionWithUser(
  updatePasswordSchema,
  async (data, _, user) => {
    const { currentPassword, newPassword, confirmPassword } = data;

    const isPasswordValid = await comparePasswords(
      currentPassword,
      user.passwordHash
    );

    if (!isPasswordValid) {
      return {
        currentPassword,
        newPassword,
        confirmPassword,
        error: 'Current password is incorrect.'
      };
    }

    if (currentPassword === newPassword) {
      return {
        currentPassword,
        newPassword,
        confirmPassword,
        error: 'New password must be different from the current password.'
      };
    }

    if (confirmPassword !== newPassword) {
      return {
        currentPassword,
        newPassword,
        confirmPassword,
        error: '两次输入的新密码不一致。'
      };
    }

    const newPasswordHash = await hashPassword(newPassword);
    const userWithTeam = await getUserWithTeam(user.id);

    await Promise.all([
      db
        .update(users)
        .set({ passwordHash: newPasswordHash })
        .where(eq(users.id, user.id)),
      logActivity(userWithTeam?.teamId, user.id, ActivityType.UPDATE_PASSWORD)
    ]);

    return {
      success: 'Password updated successfully.'
    };
  }
);

const deleteAccountSchema = z.object({
  password: z.string().min(8).max(100)
});

export const deleteAccount = validatedActionWithUser(
  deleteAccountSchema,
  async (data, _, user) => {
    const { password } = data;

    const isPasswordValid = await comparePasswords(password, user.passwordHash);
    if (!isPasswordValid) {
      return {
        error: 'Incorrect password. Account deletion failed.'
      };
    }

    const userWithTeam = await getUserWithTeam(user.id);

    await logActivity(
      userWithTeam?.teamId,
      user.id,
      ActivityType.DELETE_ACCOUNT
    );

    // Soft delete
    await db
      .update(users)
      .set({
        deletedAt: sql`CURRENT_TIMESTAMP`,
        email: sql`CONCAT(email, '-', id, '-deleted')` // Ensure email uniqueness
      })
      .where(eq(users.id, user.id));

    if (userWithTeam?.teamId) {
      const teamId = userWithTeam.teamId;
      await withTenantContext(teamId, user.id, async (tx) => {
        await tx
          .delete(teamMembers)
          .where(
            and(
              eq(teamMembers.userId, user.id),
              eq(teamMembers.teamId, teamId)
            )
          );
      });
    }

    (await cookies()).delete('session');
    redirect('/sign-in');
  }
);

const updateAccountSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email address')
});

export const updateAccount = validatedActionWithUser(
  updateAccountSchema,
  async (data, _, user) => {
    const { name, email } = data;
    const userWithTeam = await getUserWithTeam(user.id);

    await Promise.all([
      db.update(users).set({ name, email }).where(eq(users.id, user.id)),
      logActivity(userWithTeam?.teamId, user.id, ActivityType.UPDATE_ACCOUNT)
    ]);

    return { name, success: 'Account updated successfully.' };
  }
);

const removeTeamMemberSchema = z.object({
  // FormData 的值始终是字符串，必须 coerce，否则校验永远失败
  memberId: z.coerce.number().int().positive()
});

export const removeTeamMember = validatedActionWithUser(
  removeTeamMemberSchema,
  async (data, _, user) => {
    const { memberId } = data;
    const userWithTeam = await getUserWithTeam(user.id);

    if (!userWithTeam?.teamId) {
      return { error: 'User is not part of a team' };
    }
    const teamId = userWithTeam.teamId;

    // 同一业务动作的多次查询/写入放在同一个租户事务内。
    return await withTenantContext(teamId, user.id, async (tx) => {
      // 服务端角色校验：前端隐藏按钮不构成权限边界
      const callerRole = await getMembershipForUser(user.id, teamId, tx);
      if (callerRole !== 'owner' && callerRole !== 'admin') {
        return { error: '没有权限移除团队成员' };
      }

      const [target] = await tx
        .select()
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.id, memberId),
            eq(teamMembers.teamId, teamId)
          )
        )
        .limit(1);

      if (!target) {
        return { error: '成员不存在' };
      }

      if (target.role === 'owner' && callerRole !== 'owner') {
        return { error: '只有所有者可以移除其他所有者' };
      }

      await tx
        .delete(teamMembers)
        .where(
          and(
            eq(teamMembers.id, memberId),
            eq(teamMembers.teamId, teamId)
          )
        );

      await logActivity(teamId, user.id, ActivityType.REMOVE_TEAM_MEMBER, undefined, tx);

      return { success: 'Team member removed successfully' };
    });
  }
);

const inviteTeamMemberSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  role: z.enum(['member', 'admin', 'owner'])
});

export const inviteTeamMember = validatedActionWithUser(
  inviteTeamMemberSchema,
  async (data, _, user) => {
    const { email, role } = data;
    const userWithTeam = await getUserWithTeam(user.id);

    if (!userWithTeam?.teamId) {
      return { error: 'User is not part of a team' };
    }
    const teamId = userWithTeam.teamId;

    // 同一业务动作的多次查询/写入放在同一个租户事务内。
    return await withTenantContext(teamId, user.id, async (tx) => {
      // 服务端角色校验：普通成员不得邀请他人，也不得邀请为 owner
      const callerRole = await getMembershipForUser(user.id, teamId, tx);
      if (callerRole !== 'owner' && callerRole !== 'admin') {
        return { error: '没有权限邀请团队成员' };
      }
      if (role === 'owner' && callerRole !== 'owner') {
        return { error: '只有所有者可以邀请所有者' };
      }

      const existingMember = await tx
        .select()
        .from(users)
        .leftJoin(teamMembers, eq(users.id, teamMembers.userId))
        .where(
          and(eq(users.email, email), eq(teamMembers.teamId, teamId))
        )
        .limit(1);

      if (existingMember.length > 0) {
        return { error: 'User is already a member of this team' };
      }

      // Check if there's an existing invitation
      const existingInvitation = await tx
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.email, email),
            eq(invitations.teamId, teamId),
            eq(invitations.status, 'pending')
          )
        )
        .limit(1);

      if (existingInvitation.length > 0) {
        return { error: 'An invitation has already been sent to this email' };
      }

      // Create a new invitation
      await tx.insert(invitations).values({
        teamId,
        email,
        role,
        invitedBy: user.id,
        status: 'pending'
      });

      await logActivity(teamId, user.id, ActivityType.INVITE_TEAM_MEMBER, undefined, tx);

      // TODO: Send invitation email and include ?inviteId={id} to sign-up URL
      // await sendInvitationEmail(email, userWithTeam.team.name, role)

      return { success: '邀请已发送。' };
    });
  }
);
