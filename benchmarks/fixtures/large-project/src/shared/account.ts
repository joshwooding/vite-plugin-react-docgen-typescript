export interface AccountOwner {
  id: string;
  displayName: string;
  team: string;
}

export interface AccountRecord {
  id: string;
  name: string;
  owner: AccountOwner;
  region: "AMER" | "EMEA" | "APAC";
  health: "healthy" | "watch" | "risk";
  monthlySpend: number;
}

export interface NotificationPreference {
  channel: "email" | "sms" | "slack";
  enabled: boolean;
  description: string;
}

export interface AlertItem {
  id: string;
  title: string;
  severity: "low" | "medium" | "high";
  summary: string;
}
