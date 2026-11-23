import { ReferralMilestone, ReferralRewardConfig } from '../types';

export const REFERRAL_CONFIG: ReferralRewardConfig = {
  WELCOME_BONUS: 100,        // +100 KITTY instant welcome bonus for the invited friend
  WELCOME_BONUS_USDT: 2,     // +2.00 USDT first-time referral entry gift for the invited friend
  REFERRER_REWARD: 250,      // +250 KITTY instant referral reward for the inviter
  REFERRER_SPEED_BOOST: 50,  // +50 KITTY/24h permanent mining speed boost for the inviter
  DEFAULT_BASE_SPEED: 500,   // 500 KITTY/24h default base mining speed
};

export const REFERRAL_MILESTONES: ReferralMilestone[] = [
  {
    id: 'milestone_3',
    title: 'Bronze Recruiter',
    targetCount: 3,
    rewardCoins: 500,
    speedBoost: 100,
    vipDays: 1,
    badgeLabel: '1 Day VIP + 100 Hash/24h',
  },
  {
    id: 'milestone_5',
    title: 'Silver Commander',
    targetCount: 5,
    rewardCoins: 1000,
    speedBoost: 200,
    vipDays: 3,
    badgeLabel: '3 Days VIP + 200 Hash/24h',
  },
  {
    id: 'milestone_10',
    title: 'Gold Ambassador',
    targetCount: 10,
    rewardCoins: 2500,
    speedBoost: 500,
    vipDays: 7,
    badgeLabel: '7 Days VIP + 500 Hash/24h',
  },
  {
    id: 'milestone_25',
    title: 'Diamond Syndicate',
    targetCount: 25,
    rewardCoins: 7000,
    speedBoost: 1500,
    vipDays: 30,
    badgeLabel: '30 Days VIP + 1,500 Hash/24h',
  },
];

export function getMilestoneById(
  milestoneId: string
): ReferralMilestone | undefined {
  return REFERRAL_MILESTONES.find((m) => m.id === milestoneId);
}

export function evaluateMilestoneProgress(
  milestone: ReferralMilestone,
  referralsCount: number,
  claimedMilestones: string[] = []
) {
  const isClaimed = claimedMilestones.includes(milestone.id);
  const isUnlocked = referralsCount >= milestone.targetCount;
  const canClaim = isUnlocked && !isClaimed;
  const progressPct = Math.min(
    100,
    Math.round((referralsCount / milestone.targetCount) * 100)
  );

  return {
    isClaimed,
    isUnlocked,
    canClaim,
    progressPct,
  };
}

export function calculateNextVipExpiry(
  currentVipExpiresAt: number | undefined,
  vipDaysToAdd: number,
  now = Date.now()
): number {
  const baseTime =
    currentVipExpiresAt && currentVipExpiresAt > now
      ? currentVipExpiresAt
      : now;
  return baseTime + vipDaysToAdd * 24 * 60 * 60 * 1000;
}

export function calculateTotalReferralStats(
  userReferralsCount: number | undefined,
  userReferralCountLegacy: number | undefined,
  ledgerLength: number,
  storedEarnedCoins: number | undefined
) {
  const referralsCount = Math.max(
    Number(userReferralsCount) || 0,
    Number(userReferralCountLegacy) || 0,
    ledgerLength
  );
  const earnedReferralCoins = Math.max(
    Number(storedEarnedCoins) || 0,
    referralsCount * REFERRAL_CONFIG.REFERRER_REWARD
  );
  const totalSpeedBoost = referralsCount * REFERRAL_CONFIG.REFERRER_SPEED_BOOST;

  return {
    referralsCount,
    earnedReferralCoins,
    totalSpeedBoost,
  };
}
