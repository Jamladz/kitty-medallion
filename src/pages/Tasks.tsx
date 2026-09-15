import React, { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { api } from '../lib/api';
import { Check, CheckCircle2, ChevronRight, Home, PlaySquare, Share2 } from 'lucide-react';

const LOGO_URL = 'https://i.suar.me/PpEzN/l';

export default function Tasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);

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
      if (webApp && webApp.addToHomeScreen) {
        webApp.checkHomeScreenStatus?.((status) => {
          if (status === 'missed' || status === 'unknown') {
            webApp.addToHomeScreen?.();
            // We can't automatically reward without verification, but we can assume they initiated it.
            // In a real app with strict verification, we'd listen to 'homeScreenAdded' event.
            // Since we are mocking the event listener logic:
            webApp.onEvent('homeScreenAdded', async () => {
               await claimReward(task.id);
            });
            // Fallback for immediate claim if they just open it
            setTimeout(() => { claimReward(task.id); }, 5000);
          } else if (status === 'added') {
            claimReward(task.id);
          }
        });
      } else {
        if(webApp) webApp.showAlert('Home screen feature is not supported on your device.');
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

  if (loading) {
    return <div className="p-6 pt-12 text-center text-gray-500">Loading tasks...</div>;
  }

  return (
    <div className="flex flex-col p-6">
      <h1 className="mb-2 text-2xl font-bold text-white">Tasks</h1>
      <p className="mb-6 text-sm text-gray-400">Complete tasks to earn Kitty Medallions and boost your mining speed.</p>

      <div className="flex flex-col space-y-3">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center justify-between rounded-2xl bg-[#1c1c1c] p-4 ring-1 ring-white/5">
            <div className="flex flex-1 items-center space-x-3">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500">
                {task.type === 'home_screen' ? <Home size={24} /> : task.type === 'monetag' ? <PlaySquare size={24} /> : <Share2 size={24} />}
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-white">{task.title}</span>
                <div className="mt-1 flex items-center space-x-2 text-xs text-gray-400">
                  <span className="flex items-center text-orange-400">
                    <img src={LOGO_URL} className="mr-1 h-3 w-3 rounded-full" alt="KITTY" />
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
        ))}
      </div>
    </div>
  );
}
