const getInitData = () => {
  if (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) {
    return window.Telegram.WebApp.initData || '';
  }
  return '';
};

const fetchApi = async (path: string, options: RequestInit = {}) => {
  const initData = getInitData();
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer tma ${initData}`,
    ...options.headers,
  };
  
  const response = await fetch(`/api${path}`, { ...options, headers });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }
  
  return response.json();
};

export const api = {
  auth: (referrerId?: string) => fetchApi('/auth', { method: 'POST', body: JSON.stringify({ referrerId }) }),
  claimMining: () => fetchApi('/claim-mining', { method: 'POST' }),
  getTasks: () => fetchApi('/tasks'),
  claimTask: (taskId: string) => fetchApi('/tasks/claim', { method: 'POST', body: JSON.stringify({ taskId }) }),
  swap: (amountUsdt: number) => fetchApi('/swap', { method: 'POST', body: JSON.stringify({ amountUsdt }) }),
  withdraw: (amount: number, address: string) => fetchApi('/withdraw', { method: 'POST', body: JSON.stringify({ amount, address }) }),
  getWithdrawals: () => fetchApi('/withdrawals'),
  claimEarlyUser: () => fetchApi('/early-user/claim', { method: 'POST' }),
  getEarlyUserStatus: () => fetchApi('/early-user/status'),
};
