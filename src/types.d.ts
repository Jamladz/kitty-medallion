interface TelegramWebApp {
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
}

declare global {
  interface Window {
    Telegram: {
      WebApp: TelegramWebApp;
    };
  }
}

export {};
