import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  CheckCircle2,
  ChevronRight,
  PlaySquare,
  Share2,
  Smartphone,
  Send,
  Zap,
  Sparkles,
} from 'lucide-react';

const LOGO_URL = 'https://i.suar.me/PpEzN/l';

const formatTaskMeta = (task: any) => {
  if (task.type === 'home_screen' || task.id === 'home_screen') {
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

  const [, setIsHomeScreenSupported] = useState(false);
  const [, setHomeScreenStatus] = useState<'added' | 'not-added' | 'unknown'>('unknown');

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      const res = await api.getTasks();
      setTasks(res.tasks || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleTaskAction = async (task: any) => {
    if (task.isCompleted || claiming) return;

    if (task.type === 'home_screen') {
      const webApp = window.Telegram?.WebApp;
      if (webApp && typeof webApp.addToHomeScreen === 'function') {
        try {
          webApp.addToHomeScreen();
          claimReward(task.id);
        } catch (err) {
          console.error('Error with addToHomeScreen:', err);
          claimReward(task.id);
        }
      } else {
        claimReward(task.id);
      }
      return;
    }

    if (task.type === 'monetag') {
      const webApp = window.Telegram?.WebApp;
      if (webApp?.showPopup) {
        webApp.showPopup(
          {
            title: 'Watch Ad',
            message: 'This will open a sponsored ad. Continue?',
            buttons: [{ type: 'ok' }, { type: 'cancel' }],
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

  const claimReward = async (taskId: string) => {
    setClaiming(taskId);
    try {
      await api.claimTask(taskId);
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, isCompleted: true } : t))
      );
    } catch (e: any) {
      window.Telegram?.WebApp?.showAlert?.(e.message || 'Failed to claim task');
    }
    setClaiming(null);
  };

  useEffect(() => {
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;

      if (typeof tg.addToHomeScreen === 'function') {
        setIsHomeScreenSupported(true);

        if (typeof tg.checkHomeScreenStatus === 'function') {
          try {
            tg.checkHomeScreenStatus((status: 'added' | 'not-added' | 'unknown') => {
              setHomeScreenStatus(status || 'unknown');
            });
          } catch (e) {
            console.error('Error checking home screen status:', e);
          }
        }
      } else {
        const version = tg.version || '0.0';
        const parts = version.split('.').map(Number);
        if (parts[0] > 7 || (parts[0] === 7 && parts[1] >= 10)) {
          setIsHomeScreenSupported(true);
        }
      }

      const handleAdded = () => {
        setHomeScreenStatus('added');
        if (tg.showAlert) {
          tg.showAlert('Kitty Medallion has been added to your Home Screen!');
        }
        const hsTask = tasks.find((t) => t.type === 'home_screen');
        if (hsTask && !hsTask.isCompleted) {
          claimReward(hsTask.id);
        }
      };

      const handleChecked = (payload: any) => {
        if (payload && payload.status) {
          setHomeScreenStatus(payload.status);
          if (payload.status === 'added') {
            const hsTask = tasks.find((t) => t.type === 'home_screen');
            if (hsTask && !hsTask.isCompleted) {
              claimReward(hsTask.id);
            }
          }
        }
      };

      try {
        if (typeof tg.onEvent === 'function') {
          tg.onEvent('homeScreenAdded', handleAdded);
          tg.onEvent('homeScreenChecked', handleChecked);
        }
      } catch (e) {
        console.error('Error binding events:', e);
      }

      return () => {
        try {
          if (typeof tg.offEvent === 'function') {
            tg.offEvent('homeScreenAdded', handleAdded);
            tg.offEvent('homeScreenChecked', handleChecked);
          }
        } catch (e) {
          console.error('Error unbinding events:', e);
        }
      };
    }
  }, [tasks]);

  if (loading) {
    return (
      <div className="flex flex-col px-5 pt-6 space-y-3">
        <div className="h-7 w-28 rounded-lg bg-white/5 animate-pulse" />
        <div className="h-4 w-64 rounded-lg bg-white/5 animate-pulse mb-4" />
        {[1, 2, 3, 4].map((n) => (
          <div
            key={n}
            className="h-[88px] w-full rounded-2xl bg-[#141419] border border-white/[0.05] animate-pulse"
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
    <div className="flex flex-col px-5 pt-6 pb-10">
      {/* Header & Progress Summary */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Missions
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Complete quests to earn medallions & boost 24h mining yield.
          </p>
        </div>

        {tasks.length > 0 && (
          <div className="flex flex-col items-end rounded-2xl bg-[#141419] px-3.5 py-2 border border-white/[0.06]">
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
      <div className="mb-5 rounded-2xl bg-gradient-to-r from-amber-500/15 via-[#141419] to-[#141419] p-4 border border-amber-500/20">
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
      <div className="flex flex-col space-y-3">
        {tasks.map((task) => {
          const { title, subtitle, actionLabel, Icon } = formatTaskMeta(task);
          const isCompleted = Boolean(task.isCompleted);
          const isClaiming = claiming === task.id;

          return (
            <div
              key={task.id}
              onClick={() => handleTaskAction(task)}
              className={`group flex h-[88px] w-full items-center justify-between gap-3.5 rounded-2xl px-4 border transition-all cursor-pointer select-none ${
                isCompleted
                  ? 'bg-[#141419]/65 border-emerald-500/20'
                  : 'bg-[#141419] border-white/[0.07] hover:border-amber-500/35 active:scale-[0.99] shadow-lg shadow-black/25'
              }`}
            >
              {/* Left: Fixed 48x48 Icon Frame */}
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border transition-colors ${
                  isCompleted
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                    : 'bg-gradient-to-br from-amber-500/15 to-orange-500/5 border-amber-500/25 text-amber-400 group-hover:border-amber-400/40'
                }`}
              >
                <Icon size={21} />
              </div>

              {/* Center: Single-line Title, Subtitle & Reward Row */}
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <span className="font-display text-sm font-bold text-white truncate">
                  {title}
                </span>
                <span className="mt-0.5 text-[11px] text-zinc-400 truncate">
                  {subtitle}
                </span>

                <div className="mt-1.5 flex items-center space-x-2 text-xs">
                  <span className="flex items-center font-mono font-bold tabular-nums text-amber-400">
                    <img
                      src={LOGO_URL}
                      className="mr-1 h-3.5 w-3.5 rounded-full object-contain"
                      alt="KITTY"
                      referrerPolicy="no-referrer"
                    />
                    +{Number(task.reward || 0).toLocaleString()}
                  </span>
                  <span className="text-zinc-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="flex items-center font-mono font-semibold tabular-nums text-emerald-400">
                    <Zap size={11} className="mr-0.5" />+{task.miningBoost}/24h
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
                className={`flex h-10 w-[86px] shrink-0 items-center justify-center space-x-1 rounded-xl text-xs font-bold transition-all ${
                  isCompleted
                    ? 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 cursor-default'
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

