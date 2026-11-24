import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { HomeScreenStatus } from '../types';
import {
  checkOfficialTelegramHomeScreenStatus,
  isHomeScreenAddedLocally,
  markHomeScreenAddedLocally,
  triggerTelegramHaptic,
} from '../lib/telegram';
import {
  CheckCircle2,
  ChevronRight,
  PlaySquare,
  Share2,
  Smartphone,
  Send,
  Zap,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';

const LOGO_URL = 'https://i.ibb.co/3ykKfM0F/file-00000000e9e88246928f3f50b525d0a7.png';

const formatTaskMeta = (
  task: any,
  homeScreenStatus: HomeScreenStatus,
  awaitingHomeScreenVerify: boolean
) => {
  if (task.type === 'home_screen' || task.id === 'home_screen') {
    if (task.isCompleted) {
      return {
        title: 'Add to Home Screen',
        subtitle: 'Verified on phone home screen',
        actionLabel: 'Done',
        Icon: Smartphone,
      };
    }
    if (homeScreenStatus === 'added') {
      return {
        title: 'Add to Home Screen',
        subtitle: 'Shortcut detected · Tap to claim reward',
        actionLabel: 'Claim',
        Icon: ShieldCheck,
      };
    }
    if (awaitingHomeScreenVerify) {
      return {
        title: 'Add to Home Screen',
        subtitle: 'Confirm prompt then tap Verify to check',
        actionLabel: 'Verify',
        Icon: ShieldCheck,
      };
    }
    return {
      title: 'Add to Home Screen',
      subtitle: '1-tap instant access shortcut',
      actionLabel: 'Add',
      Icon: Smartphone,
    };
  }
  if (task.id === 'telegram_channel') {
    return {
      title: 'Join Telegram Channel',
      subtitle: 'Official announcements & drops',
      actionLabel: 'Join',
      Icon: Send,
    };
  }
  if (task.id === 'twitter_follow') {
    return {
      title: 'Follow on X (Twitter)',
      subtitle: 'Stay updated with community news',
      actionLabel: 'Follow',
      Icon: Share2,
    };
  }
  if (task.type === 'monetag' || task.id === 'watch_ad') {
    return {
      title: 'Watch Sponsored Ad',
      subtitle: 'Support ecosystem & earn instant yield',
      actionLabel: 'Watch',
      Icon: PlaySquare,
    };
  }
  return {
    title: task.title || 'Special Mission',
    subtitle: task.description || 'Complete mission to claim reward',
    actionLabel: 'Start',
    Icon: Sparkles,
  };
};

export default function Tasks() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);

  const [homeScreenStatus, setHomeScreenStatus] = useState<HomeScreenStatus>(
    isHomeScreenAddedLocally() ? 'added' : 'unknown'
  );
  const [awaitingHomeScreenVerify, setAwaitingHomeScreenVerify] =
    useState(false);

  const tasksRef = useRef<any[]>([]);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const claimReward = useCallback(async (taskId: string) => {
    setClaiming(taskId);
    try {
      await api.claimTask(taskId);
      triggerTelegramHaptic('success');
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, isCompleted: true } : t))
      );
      if (taskId === 'home_screen') {
        setAwaitingHomeScreenVerify(false);
        window.Telegram?.WebApp?.showAlert?.(
          'Home Screen shortcut verified! +2,000 KITTY & +100/24h speed boost credited to your account.'
        );
      }
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.toLowerCase().includes('already completed')) {
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, isCompleted: true } : t))
        );
      } else {
        window.Telegram?.WebApp?.showAlert?.(msg || 'Failed to claim task');
      }
    } finally {
      setClaiming(null);
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await api.getTasks();
      setTasks(res.tasks || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Official Telegram Bot API 8.0+ Home Screen status check & event listeners
  useEffect(() => {
    let mounted = true;

    const verifyStatusFromTelegram = async (autoClaimIfAdded = false) => {
      const status = await checkOfficialTelegramHomeScreenStatus();
      if (!mounted) return;
      setHomeScreenStatus(status);

      if (status === 'added' && autoClaimIfAdded) {
        const hsTask = tasksRef.current.find(
          (t) => t.type === 'home_screen' || t.id === 'home_screen'
        );
        if (hsTask && !hsTask.isCompleted) {
          claimReward(hsTask.id);
        }
      }
    };

    verifyStatusFromTelegram(false);

    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;

    // Fired officially by Telegram when the user confirms "Add" in the native Add to Home Screen prompt
    const handleHomeScreenAdded = () => {
      markHomeScreenAddedLocally();
      if (!mounted) return;
      setHomeScreenStatus('added');
      setAwaitingHomeScreenVerify(false);

      const hsTask = tasksRef.current.find(
        (t) => t.type === 'home_screen' || t.id === 'home_screen'
      );
      if (hsTask && !hsTask.isCompleted) {
        claimReward(hsTask.id);
      }
    };

    // Fired officially by Telegram when checkHomeScreenStatus completes
    const handleHomeScreenChecked = (payload?: { status?: string } | string) => {
      if (!mounted) return;
      const rawStatus =
        typeof payload === 'string' ? payload : payload?.status || '';
      const normalized = rawStatus.toLowerCase();

      if (normalized === 'added') {
        markHomeScreenAddedLocally();
        setHomeScreenStatus('added');
      } else if (normalized === 'missed' || normalized === 'not-added') {
        setHomeScreenStatus('missed');
      }
    };

    const handleAppResume = () => {
      if (document.visibilityState === 'hidden') return;
      // When user returns from OS home screen shortcut confirmation, re-verify status via Telegram API
      verifyStatusFromTelegram(awaitingHomeScreenVerify);
    };

    try {
      webApp.onEvent?.('homeScreenAdded', handleHomeScreenAdded);
      webApp.onEvent?.('homeScreenChecked', handleHomeScreenChecked);
      webApp.onEvent?.('activated', handleAppResume);
    } catch {}

    window.addEventListener('focus', handleAppResume);
    document.addEventListener('visibilitychange', handleAppResume);

    return () => {
      mounted = false;
      try {
        webApp.offEvent?.('homeScreenAdded', handleHomeScreenAdded);
        webApp.offEvent?.('homeScreenChecked', handleHomeScreenChecked);
        webApp.offEvent?.('activated', handleAppResume);
      } catch {}
      window.removeEventListener('focus', handleAppResume);
      document.removeEventListener('visibilitychange', handleAppResume);
    };
  }, [awaitingHomeScreenVerify, claimReward]);

  const handleHomeScreenTask = async (task: any) => {
    const webApp = window.Telegram?.WebApp;

    // 1. Check current official Telegram Home Screen status first
    setClaiming(task.id);
    const currentStatus = await checkOfficialTelegramHomeScreenStatus();
    setHomeScreenStatus(currentStatus);

    // 2. If Telegram confirms the shortcut is already 'added' (or homeScreenAdded event fired), claim reward!
    if (currentStatus === 'added' || isHomeScreenAddedLocally()) {
      await claimReward(task.id);
      return;
    }

    setClaiming(null);

    // 3. Check if official Telegram Bot API 8.0+ addToHomeScreen is available
    const canPromptAddToHomeScreen =
      Boolean(webApp) &&
      typeof webApp.addToHomeScreen === 'function' &&
      (!webApp.isVersionAtLeast || webApp.isVersionAtLeast('8.0'));

    if (!canPromptAddToHomeScreen || currentStatus === 'unsupported') {
      webApp?.showAlert?.(
        'Adding to Home Screen requires the official Telegram Mobile app (v8.0+ on Android or iOS). Please open Kitty Medallion on your phone in Telegram to complete this mission.'
      );
      return;
    }

    // 4. If user hasn't opened the native Add prompt yet, open Telegram's official addToHomeScreen() dialog
    //    and switch the task button to "Verify" (do NOT claim until homeScreenAdded fires or checkHomeScreenStatus === 'added')
    if (!awaitingHomeScreenVerify) {
      setAwaitingHomeScreenVerify(true);
      try {
        webApp.addToHomeScreen!();
      } catch (err) {
        console.error('Error calling addToHomeScreen:', err);
      }
      return;
    }

    // 5. User tapped "Verify": we just checked `checkOfficialTelegramHomeScreenStatus()` above and it is NOT 'added'!
    triggerTelegramHaptic('warning');
    if (webApp?.showPopup) {
      webApp.showPopup(
        {
          title: 'Shortcut Not Detected',
          message:
            'Kitty Medallion has not been added to your phone Home Screen yet. Tap "Add Shortcut" and confirm in Telegram to verify and claim your +2,000 KITTY reward.',
          buttons: [
            { id: 'add_again', type: 'default', text: 'Add Shortcut' },
            { id: 'cancel', type: 'cancel' },
          ],
        },
        (btnId) => {
          if (btnId === 'add_again') {
            try {
              webApp.addToHomeScreen?.();
            } catch {}
          }
        }
      );
    } else {
      webApp?.showAlert?.(
        'Shortcut not found on your Home Screen yet. Please confirm adding Kitty Medallion to your Home Screen first.'
      );
      try {
        webApp?.addToHomeScreen?.();
      } catch {}
    }
  };

  const handleTaskAction = async (task: any) => {
    if (task.isCompleted || claiming) return;

    if (task.type === 'home_screen' || task.id === 'home_screen') {
      await handleHomeScreenTask(task);
      return;
    }

    if (task.type === 'monetag') {
      const webApp = window.Telegram?.WebApp;
      if (webApp?.showPopup) {
        webApp.showPopup(
          {
            title: 'Watch Ad',
            message: 'This will open a sponsored ad. Continue?',
            buttons: [{ id: 'ok', type: 'ok' }, { id: 'cancel', type: 'cancel' }],
          },
          (btnId) => {
            if (btnId === 'ok') {
              setClaiming(task.id);
              setTimeout(() => {
                claimReward(task.id);
              }, 3000);
            }
          }
        );
      } else {
        setClaiming(task.id);
        setTimeout(() => {
          claimReward(task.id);
        }, 2000);
      }
      return;
    }

    if (task.type === 'social') {
      const webApp = window.Telegram?.WebApp;
      webApp?.openTelegramLink?.('https://t.me/durov');
      setTimeout(() => {
        claimReward(task.id);
      }, 2000);
      return;
    }

    await claimReward(task.id);
  };

  if (loading) {
    return (
      <div className="flex flex-col px-4 sm:px-5 pt-4 sm:pt-6 space-y-3">
        <div className="h-7 w-28 rounded-lg bg-white/5 animate-pulse" />
        <div className="h-4 w-64 rounded-lg bg-white/5 animate-pulse mb-4" />
        {[1, 2, 3, 4].map((n) => (
          <div
            key={n}
            className="h-[86px] sm:h-[88px] w-full rounded-2xl bg-[#141419] border border-white/[0.05] animate-pulse"
          />
        ))}
      </div>
    );
  }

  const completedCount = tasks.filter((t) => t.isCompleted).length;
  const totalRewards = tasks.reduce((acc, t) => acc + (Number(t.reward) || 0), 0);
  const progressPct =
    tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  return (
    <div className="flex flex-col px-4 sm:px-5 pt-4 sm:pt-6 pb-8">
      {/* Header & Progress Summary */}
      <div className="mb-4 sm:mb-5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-white">
            Missions
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Complete quests to earn medallions & boost 24h mining yield.
          </p>
        </div>

        {tasks.length > 0 && (
          <div className="flex shrink-0 flex-col items-end rounded-2xl bg-[#141419] px-3 sm:px-3.5 py-2 border border-white/[0.06]">
            <span className="font-mono text-xs font-extrabold tabular-nums text-amber-400">
              {completedCount} / {tasks.length}
            </span>
            <span className="text-[10px] font-medium text-zinc-500">
              Completed
            </span>
          </div>
        )}
      </div>

      {/* Mission Pool Progress Banner */}
      <div className="mb-4 sm:mb-5 rounded-2xl bg-gradient-to-r from-amber-500/15 via-[#141419] to-[#141419] p-3.5 sm:p-4 border border-amber-500/20">
        <div className="flex items-center justify-between text-xs mb-2.5">
          <span className="font-semibold text-zinc-300">
            Total Mission Pool
          </span>
          <div className="flex items-center space-x-1.5 font-mono font-bold text-amber-400 tabular-nums">
            <img
              src={LOGO_URL}
              className="h-4 w-4 rounded-full object-contain"
              alt="KITTY"
              referrerPolicy="no-referrer"
            />
            <span>+{totalRewards.toLocaleString()} KITTY</span>
          </div>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#0b0b0e]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-400 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Uniform Equal-Sized Mission Frames */}
      <div className="flex flex-col space-y-2.5 sm:space-y-3">
        {tasks.map((task) => {
          const isHomeScreenTask =
            task.type === 'home_screen' || task.id === 'home_screen';
          const { title, subtitle, actionLabel, Icon } = formatTaskMeta(
            task,
            homeScreenStatus,
            awaitingHomeScreenVerify
          );
          const isCompleted = Boolean(task.isCompleted);
          const isClaiming = claiming === task.id;
          const isVerifyMode =
            isHomeScreenTask &&
            !isCompleted &&
            (awaitingHomeScreenVerify || homeScreenStatus === 'added');

          return (
            <div
              key={task.id}
              onClick={() => handleTaskAction(task)}
              className={`group flex h-[86px] sm:h-[88px] w-full items-center justify-between gap-2.5 sm:gap-3.5 rounded-2xl px-3.5 sm:px-4 border transition-all cursor-pointer select-none ${
                isCompleted
                  ? 'bg-[#141419]/65 border-emerald-500/20'
                  : isVerifyMode
                  ? 'bg-[#141419] border-emerald-500/35 hover:border-emerald-400/50 active:scale-[0.99] shadow-lg shadow-black/25'
                  : 'bg-[#141419] border-white/[0.07] hover:border-amber-500/35 active:scale-[0.99] shadow-lg shadow-black/25'
              }`}
            >
              {/* Left: Fixed Equal Icon Frame */}
              <div
                className={`flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-2xl border transition-colors ${
                  isCompleted
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                    : isVerifyMode
                    ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-400'
                    : 'bg-gradient-to-br from-amber-500/15 to-orange-500/5 border-amber-500/25 text-amber-400 group-hover:border-amber-400/40'
                }`}
              >
                <Icon size={20} />
              </div>

              {/* Center: Single-line Title, Subtitle & Reward Row */}
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <span className="font-display text-[13px] sm:text-sm font-bold text-white truncate">
                  {title}
                </span>
                <span
                  className={`mt-0.5 text-[11px] truncate ${
                    isVerifyMode ? 'text-emerald-300/90 font-medium' : 'text-zinc-400'
                  }`}
                >
                  {subtitle}
                </span>

                <div className="mt-1.5 flex items-center space-x-1.5 sm:space-x-2 text-xs">
                  <span className="flex items-center font-mono font-bold tabular-nums text-amber-400">
                    <img
                      src={LOGO_URL}
                      className="mr-1 h-3.5 w-3.5 shrink-0 rounded-full object-contain"
                      alt="KITTY"
                      referrerPolicy="no-referrer"
                    />
                    +{Number(task.reward || 0).toLocaleString()}
                  </span>
                  <span className="text-zinc-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="flex items-center font-mono font-semibold tabular-nums text-emerald-400">
                    <Zap size={11} className="mr-0.5 shrink-0" />+{task.miningBoost}/24h
                  </span>
                </div>
              </div>

              {/* Right: Uniform Fixed-Size Action Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTaskAction(task);
                }}
                disabled={isCompleted || isClaiming}
                className={`flex h-9 w-[78px] sm:h-10 sm:w-[86px] shrink-0 items-center justify-center space-x-1 rounded-xl text-xs font-bold transition-all ${
                  isCompleted
                    ? 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 cursor-default'
                    : isVerifyMode
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-400 text-zinc-950 hover:from-emerald-400 hover:to-teal-300 active:scale-95 shadow-md shadow-emerald-500/20'
                    : 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-950 hover:from-amber-400 hover:to-orange-400 active:scale-95 shadow-md shadow-amber-500/15'
                }`}
              >
                {isCompleted ? (
                  <>
                    <CheckCircle2 size={14} />
                    <span>Done</span>
                  </>
                ) : isClaiming ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-950 border-t-transparent" />
                ) : (
                  <>
                    <span>{actionLabel}</span>
                    <ChevronRight size={14} />
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
