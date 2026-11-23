export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: any;
  version: string;
  platform: string;
  colorScheme: string;
  themeParams: any;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  headerColor: string;
  backgroundColor: string;
  isClosingConfirmationEnabled: boolean;
  expand: () => void;
  close: () => void;
  ready: () => void;
  requestFullscreen?: () => void;
  isFullscreen?: boolean;
  onEvent: (eventType: string, eventHandler: Function) => void;
  offEvent: (eventType: string, eventHandler: Function) => void;
  addToHomeScreen?: () => void;
  checkHomeScreenStatus?: (callback: (status: string) => void) => void;
  isVersionAtLeast?: (version: string) => boolean;
  showAlert: (message: string, callback?: () => void) => void;
  showPopup: (params: any, callback?: (id: string) => void) => void;
  openTelegramLink: (url: string) => void;
  HapticFeedback?: {
    notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
    impactOccurred?: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  };
}

declare global {
  interface Window {
    Telegram: {
      WebApp: TelegramWebApp;
    };
  }
}

export interface TelegramWebAppUser {
  id: string;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export interface KittyUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  balanceKitty: number;
  balanceUsdt: number;
  welcomeUsdtGranted?: boolean;
  miningSpeed: number;
  referralCount: number;
  referralsCount: number;
  earnedReferralCoins: number;
  referredBy: string | null;
  referrerId: string | null;
  referredAt: number | null;
  claimedMilestones: string[];
  vipExpiresAt: number;
  lastMiningClaim: number;
  homeScreenAdded?: boolean;
  createdAt: number;
}

export interface ReferralMilestone {
  id: string;
  title: string;
  targetCount: number;
  rewardCoins: number;
  speedBoost: number;
  vipDays: number;
  badgeLabel: string;
}

export interface ReferralRecord {
  id: string;
  referrerId: string;
  referredId: string;
  referredName: string;
  referredUsername?: string;
  rewardAmount: number;
  welcomeBonus: number;
  welcomeBonusUsdt?: number;
  speedBoost: number;
  timestamp: number;
}

export interface ReferralRewardConfig {
  WELCOME_BONUS: number;
  WELCOME_BONUS_USDT: number;
  REFERRER_REWARD: number;
  REFERRER_SPEED_BOOST: number;
  DEFAULT_BASE_SPEED: number;
}

export interface ProcessReferralParams {
  currentUserId: string;
  currentUserFirstName: string;
  currentUserLastName?: string;
  currentUserUsername?: string;
  rawReferrerParam?: string | null;
}

export interface ProcessReferralResult {
  applied: boolean;
  welcomeGiftGranted?: boolean;
  reason?: string;
  user?: KittyUser | null;
}

export interface MilestoneClaimResult {
  success: boolean;
  milestoneId: string;
  rewardCoins: number;
  speedBoost?: number;
  vipDays: number;
  user?: KittyUser;
}
