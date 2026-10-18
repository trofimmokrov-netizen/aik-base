export interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  openTelegramLink(url: string): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
}
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}
export type EstimateInput = {
  serviceId: string;
  metal: string;
  width: number;
  height: number;
  quantity: number;
  onsite: boolean;
};
export type Estimate = {
  amount: number | null;
  currency: string;
  message: string;
};
export type PublicConfig = {
  notificationsReady: boolean;
  telegramAuthReady: boolean;
  phone: string;
  email: string;
  botUsername: string;
};
export type PortfolioWork = {
  id: string;
  title: string;
  category: string;
  label: string;
  image: string;
  video?: string;
  position: string;
  demo: boolean;
  description: string;
};
export type Order = {
  id: string;
  serviceId: string;
  description: string;
  status: string;
  createdAt: string;
  notificationStatus: string;
};
