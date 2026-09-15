import React, { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { api } from '../lib/api';
import { Check, CheckCircle2, ChevronRight, Home, PlaySquare, Share2, Smartphone, Plus } from 'lucide-react';

const LOGO_URL = 'https://i.suar.me/PpEzN/l';

export default function Tasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);

  const [isHomeScreenSupported, setIsHomeScreenSupported] = useState(false);
  const [homeScreenStatus, setHomeScreenStatus] = useState<'added' | 'not-added' | 'unknown'>('unknown');

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
          // Start the reward claim process
          claimReward(task.id);
        } catch (err) {
          console.error('Error with addToHomeScreen:', err);
          claimReward(task.id);
        }
      } else {
        // Fallback for dev / desktop testing
        claimReward(task.id);
      }
      return;
    }

    if (task.type === 'monetag') {
      // Simulate Monetag ad SDK call
      const webApp = window.Telegram?.WebApp;
      webApp?.showPopup({
        title: 'Watch Ad',
        message: 'This will open a Monetag ad. Continue?',
        buttons: [{ type: 'ok' }, { type: 'cancel' }]
      }, (btnId) => {
        if (btnId === 'ok') {
          // Mock ad duration
          setClaiming(task.id);
          setTimeout(() => {
            claimReward(task.id);
          }, 3000);
        }
      });
      return;
    }

    if (task.type === 'social') {
      const webApp = window.Telegram?.WebApp;
      webApp?.openTelegramLink('https://t.me/durov');
      setTimeout(() => { claimReward(task.id); }, 2000);
      return;
    }
    
    // Direct claim
    await claimReward(task.id);
  };

  const claimReward = async (taskId: string) => {
    setClaiming(taskId);
    try {
      await api.claimTask(taskId);
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, isCompleted: true } : t));
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
          tg.showAlert('Kitty Medallion has been added to your Home Screen! 🎉');
        }
        const hsTask = tasks.find(t => t.type === 'home_screen');
        if (hsTask && !hsTask.isCompleted) {
          claimReward(hsTask.id);
        }
      };

      const handleChecked = (payload: any) => {
        if (payload && payload.status) {
          setHomeScreenStatus(payload.status);
          if (payload.status === 'added') {
            const hsTask = tasks.find(t => t.type === 'home_screen');
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

  const handleAddToHomeScreen = () => {
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      if (typeof tg.addToHomeScreen === 'function') {
        try {
          tg.addToHomeScreen();
        } catch (e) {
          console.error('Error calling addToHomeScreen:', e);
          if (tg.showAlert) {
            tg.showAlert('Unable to prompt. Make sure your Telegram app is updated.');
          }
        }
      } else {
        if (tg.showAlert) {
          tg.showAlert('Your version of Telegram does not support direct Home Screen shortcuts. Please update Telegram.');
        }
      }
    } else {
      alert('Please open this app inside Telegram to add the shortcut.');
    }
  };

  if (loading) {
    return <div className="p-6 pt-12 text-center text-gray-500">Loading tasks...</div>;
  }

  return (
    <div className="flex flex-col p-6">
      <h1 className="mb-2 text-2xl font-bold text-white">Tasks</h1>
      <p className="mb-6 text-sm text-gray-400">Complete tasks to earn Kitty Medallions and boost your mining speed.</p>

      <div className="flex flex-col space-y-3">
        {tasks.map((task) => {
          const isHomeScreen = task.type === 'home_screen';
          
          if (isHomeScreen) {
            return (
              <div
                key={task.id}
                className={`flex flex-col rounded-2xl p-5 ring-1 transition-all ${
                  task.isCompleted
                    ? 'bg-[#1c1c1c]/50 ring-green-500/10'
                    : 'bg-gradient-to-br from-indigo-950/40 to-slate-900/40 ring-indigo-500/25 shadow-xl shadow-indigo-950/20'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex flex-1 items-start space-x-3.5">
                    <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border ${
                      task.isCompleted
                        ? 'bg-green-500/10 border-green-500/20 text-green-500'
                        : 'bg-indigo-600/15 border-indigo-500/20 text-indigo-400'
                    }`}>
                      <Smartphone size={24} className={task.isCompleted ? "" : "animate-pulse"} />
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center space-x-1.5 flex-wrap">
                        <span className="font-bold text-white text-base">Home Screen Shortcut</span>
                        <span className="text-[10px] bg-indigo-500/20 text-indigo-300 font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wider">Official</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-400 leading-relaxed">
                        Add Kitty Medallion to your device home screen for 1-tap instant launching and full-screen experience.
                      </p>
                      <div className="mt-2.5 flex items-center space-x-2 text-xs font-semibold">
                        <span className="flex items-center text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-lg border border-orange-500/10">
                          <img src={LOGO_URL} className="mr-1 h-3.5 w-3.5 rounded-full object-contain" alt="KITTY" referrerPolicy="no-referrer" />
                          +{task.reward} KITTY
                        </span>
                        <span className="text-green-400 bg-green-500/10 px-2 py-0.5 rounded-lg border border-green-500/10">
                          +{task.miningBoost} Hash/d
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleTaskAction(task)}
                    disabled={task.isCompleted || claiming === task.id}
                    className={`ml-4 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-all ${
                      task.isCompleted
                        ? 'bg-green-500/20 text-green-500'
                        : 'bg-indigo-500 text-white hover:bg-indigo-600 shadow-md shadow-indigo-500/15 active:scale-95'
                    }`}
                  >
                    {task.isCompleted ? (
                      <CheckCircle2 size={20} />
                    ) : claiming === task.id ? (
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      <Plus size={18} />
                    )}
                  </button>
                </div>

                {!task.isCompleted && (
                  <button
                    onClick={() => handleTaskAction(task)}
                    disabled={claiming === task.id}
                    className="mt-4 w-full flex items-center justify-center space-x-2 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 active:scale-[0.98] py-2.5 text-xs font-bold text-white hover:from-indigo-600 hover:to-indigo-700 transition duration-150 shadow-md shadow-indigo-500/10"
                  >
                    <Plus size={14} />
                    <span>Add to Home Screen</span>
                  </button>
                )}
              </div>
            );
          }

          return (
            <div key={task.id} className="flex items-center justify-between rounded-2xl bg-[#1c1c1c] p-4 ring-1 ring-white/5">
              <div className="flex flex-1 items-center space-x-3">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500">
                  {task.type === 'monetag' ? <PlaySquare size={24} /> : <Share2 size={24} />}
                </div>
                <div className="flex flex-col">
                  <span className="font-semibold text-white">{task.title}</span>
                  <div className="mt-1 flex items-center space-x-2 text-xs text-gray-400">
                    <span className="flex items-center text-orange-400">
                      <img src={LOGO_URL} className="mr-1 h-3 w-3 rounded-full" alt="KITTY" referrerPolicy="no-referrer" />
                      +{task.reward}
                    </span>
                    <span>•</span>
                    <span className="text-green-400">+{task.miningBoost} Hash/d</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleTaskAction(task)}
                disabled={task.isCompleted || claiming === task.id}
                className={`ml-4 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
                  task.isCompleted
                    ? 'bg-green-500/20 text-green-500'
                    : 'bg-white text-black hover:bg-gray-200'
                }`}
              >
                {task.isCompleted ? (
                  <CheckCircle2 size={20} />
                ) : claiming === task.id ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-black border-t-transparent" />
                ) : (
                  <ChevronRight size={20} />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
