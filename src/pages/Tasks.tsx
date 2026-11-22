import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { CheckCircle2, ChevronRight, PlaySquare, Share2, Smartphone, Plus } from 'lucide-react';

const LOGO_URL = 'https://i.suar.me/PpEzN/l';

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
      setTasks(res.tasks);
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
      webApp?.showPopup(
        {
          title: 'Watch Ad',
          message: 'This will open a Monetag ad. Continue?',
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
      return;
    }

    if (task.type === 'social') {
      const webApp = window.Telegram?.WebApp;
      webApp?.openTelegramLink('https://t.me/durov');
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
      window.Telegram?.WebApp?.showAlert(e.message || 'Failed to claim task');
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
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-20 w-full rounded-2xl bg-[#141419] border border-white/[0.04] animate-pulse" />
        ))}
      </div>
    );
  }

  const completedCount = tasks.filter((t) => t.isCompleted).length;

  return (
    <div className="flex flex-col px-5 pt-6 pb-8">
      {/* Header & Progress Summary */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Missions
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Complete quests to earn medallions and boost daily yield.
          </p>
        </div>
        {tasks.length > 0 && (
          <div className="text-right">
            <span className="font-mono text-xs font-semibold tabular-nums text-amber-400">
              {completedCount}/{tasks.length}
            </span>
            <span className="block text-[10px] text-zinc-500">Completed</span>
          </div>
        )}
      </div>

      <div className="flex flex-col space-y-3">
        {tasks.map((task) => {
          const isHomeScreen = task.type === 'home_screen';

          if (isHomeScreen) {
            return (
              <div
                key={task.id}
                className={`flex flex-col rounded-3xl p-5 border transition-all ${
                  task.isCompleted
                    ? 'bg-[#141419]/60 border-emerald-500/20'
                    : 'bg-gradient-to-br from-amber-500/12 via-[#141419] to-[#141419] border-amber-500/25 shadow-xl'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-1 items-start space-x-3.5">
                    <div
                      className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border ${
                        task.isCompleted
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          : 'bg-amber-500/15 border-amber-500/25 text-amber-400'
                      }`}
                    >
                      <Smartphone size={22} />
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center space-x-2">
                        <span className="font-display font-bold text-white text-base">
                          Home Screen Shortcut
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                        Add Kitty Medallion to your phone home screen for instant 1-tap access.
                      </p>
                      {/* Clean unboxed reward metadata */}
                      <div className="mt-2.5 flex items-center space-x-2 text-xs font-semibold">
                        <span className="flex items-center text-amber-400 font-mono tabular-nums">
                          <img
                            src={LOGO_URL}
                            className="mr-1.5 h-4 w-4 rounded-full object-contain"
                            alt="KITTY"
                            referrerPolicy="no-referrer"
                          />
                          +{task.reward.toLocaleString()} KITTY
                        </span>
                        <span className="text-zinc-600" aria-hidden="true">·</span>
                        <span className="text-emerald-400 font-mono tabular-nums">
                          +{task.miningBoost} Hash/d
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleTaskAction(task)}
                    disabled={task.isCompleted || claiming === task.id}
                    className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl transition-all ${
                      task.isCompleted
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-amber-500 text-zinc-950 hover:bg-amber-400 active:scale-95 shadow-md shadow-amber-500/20'
                    }`}
                  >
                    {task.isCompleted ? (
                      <CheckCircle2 size={20} />
                    ) : claiming === task.id ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-950 border-t-transparent" />
                    ) : (
                      <Plus size={20} />
                    )}
                  </button>
                </div>

                {!task.isCompleted && (
                  <button
                    onClick={() => handleTaskAction(task)}
                    disabled={claiming === task.id}
                    className="mt-4 w-full flex items-center justify-center space-x-2 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 active:scale-[0.98] py-3 text-xs font-bold text-zinc-950 hover:from-amber-400 hover:to-orange-400 transition duration-150 shadow-md shadow-orange-500/15"
                  >
                    <Plus size={15} />
                    <span>Add to Home Screen</span>
                  </button>
                )}
              </div>
            );
          }

          return (
            <div
              key={task.id}
              onClick={() => handleTaskAction(task)}
              className={`group flex items-center justify-between rounded-2xl bg-[#141419] p-4 border transition-all cursor-pointer ${
                task.isCompleted
                  ? 'border-white/[0.04] opacity-75'
                  : 'border-white/[0.06] hover:border-white/15 active:scale-[0.99]'
              }`}
            >
              <div className="flex flex-1 items-center space-x-3.5 pr-3">
                <div
                  className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border ${
                    task.isCompleted
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : 'bg-white/[0.03] border-white/[0.06] text-amber-400'
                  }`}
                >
                  {task.type === 'monetag' ? <PlaySquare size={20} /> : <Share2 size={20} />}
                </div>
                <div className="flex flex-col">
                  <span className="font-semibold text-sm text-white leading-snug">
                    {task.title}
                  </span>
                  <div className="mt-1 flex items-center space-x-2 text-xs">
                    <span className="flex items-center font-mono font-semibold tabular-nums text-amber-400">
                      <img
                        src={LOGO_URL}
                        className="mr-1 h-3.5 w-3.5 rounded-full object-contain"
                        alt="KITTY"
                        referrerPolicy="no-referrer"
                      />
                      +{task.reward.toLocaleString()}
                    </span>
                    <span className="text-zinc-600" aria-hidden="true">·</span>
                    <span className="font-mono font-medium tabular-nums text-emerald-400">
                      +{task.miningBoost} Hash/d
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleTaskAction(task);
                }}
                disabled={task.isCompleted || claiming === task.id}
                className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl transition-all ${
                  task.isCompleted
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-white text-zinc-950 hover:bg-zinc-200 active:scale-95'
                }`}
              >
                {task.isCompleted ? (
                  <CheckCircle2 size={19} />
                ) : claiming === task.id ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-950 border-t-transparent" />
                ) : (
                  <ChevronRight size={19} />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
